export interface NamedFormat {
	name: string;
	header: string;
	source: string;
}
export type Resolver = (path: string) => string | null;
export type JoinResult = { ok: true; text: string; links: string[]; pdf: string } | { ok: false; error: string };
export interface Pair { from: number; to: number; result: Extract<JoinResult, { ok: true }> }
const invalid = (): JoinResult => ({ ok: false, error: 'Select exactly two complete adjacent PDF callouts.' });
const HEADER = /^> \[!([a-zA-Z][\w-]*)(?:\|([a-zA-Z][\w-]*))?\] (.+)$/;
const LINK = /\[\[([^[\]|#]+\.pdf)#(page=[1-9]\d*(?:&[^[\]|\s]+)?)(?:\|([^[\]\r\n]+))?\]\]/gi;

export function validFormat(value: unknown): value is NamedFormat {
	if (!value || typeof value !== 'object') return false;
	const f = value as Partial<NamedFormat>;
	return typeof f.name === 'string' && f.name.trim().length > 0 && f.name.length <= 60
		&& typeof f.header === 'string' && f.header.length <= 160 && !/[\r\n[\]{}]/.test(f.header.replace(/\{pdf\}/g, ''))
		&& typeof f.source === 'string' && f.source.length <= 200 && f.source.split('{links}').length === 2
		&& !/[\r\n[\]{}]/.test(f.source.replace('{links}', ''));
}

/** The simple format keeps source strings, quote lines and body order. */
export function joinCallouts(text: string, resolve: Resolver, format?: NamedFormat): JoinResult {
	const newline = text.includes('\r\n') ? '\r\n' : '\n';
	const trailing = text.endsWith('\n');
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	if (trailing) lines.pop();
	if (lines.length === 0 || !HEADER.test(lines[0]!)) return invalid();
	const blocks: { type: string; color: string; links: string[]; paths: string[]; body: string[] }[] = [];
	let gap = false;
	for (const line of lines) {
		const head = HEADER.exec(line);
		if (head) {
			const raw = head[3]!;
			const matches = [...raw.matchAll(LINK)];
			if (!matches.length || raw.replace(LINK, '').trim() !== '') return invalid();
			const paths = matches.map((m) => m[1]!.trim());
			if (paths.some((p) => /[:\\]/.test(p) || p.startsWith('/') || p.split('/').includes('..'))) return { ok: false, error: 'Use one local PDF.' };
			blocks.push({ type: head[1]!, color: head[2] ?? '', links: matches.map((m) => m[0]), paths, body: [] });
			gap = false;
			continue;
		}
		if (line.trim() === '') { gap = true; continue; }
		const body = /^>(?: (.*))?$/.exec(line);
		if (!body || gap || !blocks.length || /^\s*>/.test(body[1] ?? '') || /```|~~~|\[!/.test(body[1] ?? '')) return invalid();
		blocks[blocks.length - 1]!.body.push(line);
	}
	if (blocks.length !== 2 || blocks.some((b) => !b.body.some((s) => s.replace(/^> ?/, '').trim()))) return invalid();
	const [a, b] = blocks as [typeof blocks[number], typeof blocks[number]];
	if (a.type !== b.type || a.color !== b.color) return { ok: false, error: 'Incompatible callouts' };
	const resolved = [...a.paths, ...b.paths].map(resolve);
	if (resolved.some((p) => !p || !/\.pdf$/i.test(p))) return { ok: false, error: 'Use one local PDF.' };
	if (new Set(resolved).size !== 1) return { ok: false, error: 'Mixed PDFs' };
	const pdf = resolved[0]!;
	const links = [...new Set([...a.links, ...b.links])];
	const marker = `> [!${a.type}${a.color ? '|' + a.color : ''}]`;
	let header = `${marker} ${links.join(' ')}`;
	if (format) {
		if (!validFormat(format)) return { ok: false, error: 'Invalid named format.' };
		header = `${marker} ${format.header.replace(/\{pdf\}/g, () => pdf)}${newline}> ${format.source.replace('{links}', () => links.join(' '))}${newline}>`;
	}
	return { ok: true, pdf, links, text: [header, ...a.body, '>', ...b.body].join(newline) + (trailing ? newline : '') };
}

/** Mark code and YAML lines in one pass. */
function protectedLines(lines: string[]): boolean[] {
	const protectedLine: boolean[] = [];
	let fence = '';
	let fenceDepth = 0;
	let frontmatter = lines[0]?.trim() === '---';
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (frontmatter) {
			protectedLine.push(true);
			if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
			continue;
		}
		const quote = /^(?: {0,3}> ?)+/.exec(line)?.[0] ?? '';
		const depth = quote.split('>').length - 1;
		// A quoted fence ends when its quote container ends.
		if (fenceDepth > depth && line.trim()) fence = '';
		const content = line.slice(quote.length);
		const m = /^ {0,3}(`{3,}|~{3,})/.exec(content);
		protectedLine.push(!!fence || !!m);
		if (!m) continue;
		if (!fence) { fence = m[1]!; fenceDepth = depth; }
		else if (depth === fenceDepth && m[1]![0] === fence[0] && m[1]!.length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(content)) fence = '';
	}
	return protectedLine;
}

function rangeEndIsSafe(doc: string, to: number): boolean {
	let start = to;
	if (doc[to - 1] !== '\n') {
		if (doc[start] === '\r') start++;
		if (doc[start] === '\n') start++;
	}
	const end = doc.indexOf('\n', start);
	const next = doc.slice(start, end < 0 ? doc.length : end);
	return !next.trim() || HEADER.test(next);
}

/** Select complete lines. Refuse a range inside a fence or a longer quote body. */
export function rangeIsSafe(doc: string, from: number, to: number): boolean {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > doc.length) return false;
	if (from > 0 && doc[from - 1] !== '\n') return false;
	if (to < doc.length && doc[to] !== '\n' && doc[to - 1] !== '\n') return false;
	const protectedLine = protectedLines(doc.slice(0, from).split('\n'));
	if (protectedLine[protectedLine.length - 1]) return false;
	return rangeEndIsSafe(doc, to);
}

/** Lists ranges only. A scan does not change the editor. Fences and frontmatter are excluded. */
export function findPairs(doc: string, resolve: Resolver): Pair[] {
	const lines = doc.split('\n');
	const protectedLine = protectedLines(lines);
	const offsets: number[] = [];
	const starts: number[] = [];
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		offsets.push(offset);
		if (!protectedLine[i] && HEADER.test(lines[i]!.replace(/\r$/, ''))) starts.push(i);
		offset += lines[i]!.length + 1;
	}
	const pairs: Pair[] = [];
	for (let i = 0; i < starts.length - 1; i++) {
		const from = offsets[starts[i]!]!;
		const second = starts[i + 1]!;
		let end = second + 1;
		while (end < lines.length && !HEADER.test(lines[end]!) && /^>/.test(lines[end]!)) {
			end++;
		}
		let to = offsets[end] ?? doc.length;
		const text = doc.slice(from, to).replace(/\r?\n$/, '');
		to = from + text.length;
		if (!rangeEndIsSafe(doc, to)) continue;
		const result = joinCallouts(text, resolve);
		if (result.ok) pairs.push({ from, to, result });
	}
	return pairs;
}

/** A preview can write only its original document and file. */
export function previewIsCurrent(original: string, current: string, originalPath: string, currentPath: string | null): boolean {
	return original === current && originalPath === currentPath;
}

/** JSON input for the shared acceptance vectors. */
export function joinWithPaths(text: string, paths: Record<string, string | null>, format?: NamedFormat): JoinResult {
	return joinCallouts(text, (path) => paths[path] ?? null, format);
}
