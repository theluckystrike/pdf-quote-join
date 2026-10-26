import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PdfQuoteJoinPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { findPairs, validFormat } from '../src/join';
import manifest from '../manifest.json';
import type { Preview } from '../src/modals';

const text = '> [!pdf] [[A.pdf#page=1|p1]]\n> First.\n\n> [!pdf] [[A.pdf#page=2|p2]]\n> Second.';
const format = { name: 'Study', header: 'From {pdf}', source: 'Sources: {links}' };
afterEach(() => resetPro());
function setup() {
	const app = App.createConfigured__({ files: { 'note.md': text, 'A.pdf': 'sample' } });
	const plugin = new PdfQuoteJoinPlugin(app as never, manifest as never);
	vi.spyOn(plugin, 'resolver').mockReturnValue((path) => path === 'A.pdf' ? path : null);
	let doc = text;
	const history: string[] = [];
	const editor = {
		getValue: () => doc,
		offsetToPos: (offset: number) => { const lines = doc.slice(0, offset).split('\n'); return { line: lines.length - 1, ch: lines[lines.length - 1]!.length }; },
		transaction: vi.fn((tx: { changes: { text: string }[] }) => { history.push(doc); doc = tx.changes[0]!.text; }),
		undo: () => { doc = history.pop()!; },
	};
	const info = { file: { path: 'note.md' }, editor };
	const preview = { editor, info, doc, original: text, path: 'note.md', from: 0, to: text.length, proOnly: false } as unknown as Preview;
	return { plugin, editor, preview, edit: (v: string) => { doc = v; } };
}
function pro(on: boolean) { bindPro({ isPro: () => on, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' }, onChange: () => () => undefined } as never); }
describe('plugin and editor boundary', () => {
	it('loads free settings in an in-memory vault', async () => { const { plugin } = setup(); await plugin.loadSettings(); expect(plugin.settings).toEqual(DEFAULT_SETTINGS); expect(isPro()).toBe(false); });
	it('applies in one transaction and restores exact source strings with one undo', () => { const { plugin, editor, preview } = setup(); expect(plugin.applyPreview(preview)).toBe(true); expect(editor.transaction).toHaveBeenCalledTimes(1); expect(editor.getValue()).toContain('[[A.pdf#page=2|p2]]'); editor.undo(); expect(editor.getValue()).toBe(text); });
	it('refuses a changed document', () => { const { plugin, editor, preview, edit } = setup(); edit(text+'\nChanged'); expect(plugin.applyPreview(preview)).toBe(false); expect(editor.transaction).not.toHaveBeenCalled(); });
	it('refuses a switched file', () => { const { plugin, editor, preview } = setup(); (preview.info.file as { path: string }).path = 'other.md'; expect(plugin.applyPreview(preview)).toBe(false); expect(editor.transaction).not.toHaveBeenCalled(); });
	it('refuses an editor replaced by a different editor', () => { const { plugin, editor, preview } = setup(); preview.info.editor = {} as never; expect(plugin.applyPreview(preview)).toBe(false); expect(editor.transaction).not.toHaveBeenCalled(); });
	it('resolves PDF targets again on Apply', () => { const { plugin, editor, preview } = setup(); vi.spyOn(plugin, 'resolver').mockReturnValue(() => null); expect(plugin.applyPreview(preview)).toBe(false); expect(editor.transaction).not.toHaveBeenCalled(); });
	it('blocks a named format without Pro and keeps the note', () => { const { plugin, editor, preview } = setup(); expect(plugin.applyPreview(preview,format)).toBe(false); expect(editor.transaction).not.toHaveBeenCalled(); });
	it('blocks a pair preview after Pro expires', () => { const { plugin, editor, preview } = setup(); preview.proOnly = true; expect(plugin.applyPreview(preview)).toBe(false); expect(editor.transaction).not.toHaveBeenCalled(); });
	it('uses a named format with Pro', () => { pro(true); const { plugin, editor, preview } = setup(); expect(plugin.applyPreview(preview,format)).toBe(true); expect(editor.getValue()).toContain('Sources: [[A.pdf#page=1|p1]] [[A.pdf#page=2|p2]]'); });
	it('blocks saving and scanning without Pro', async () => { const { plugin, preview } = setup(); expect(await plugin.storeFormat(format)).toBe(false); plugin.scan(preview.editor,preview.info); expect(plugin.modals.size).toBe(0); expect(plugin.settings.formats).toEqual([]); });
	it('saves and replaces a named format with Pro', async () => { pro(true); const { plugin } = setup(); const saved = vi.spyOn(plugin,'saveSettings').mockResolvedValue(); expect(await plugin.storeFormat(format)).toBe(true); expect(await plugin.storeFormat({...format,header:'Changed'})).toBe(true); expect(plugin.settings.formats).toEqual([{...format,header:'Changed'}]); expect(saved).toHaveBeenCalledTimes(2); await plugin.removeFormat('Study'); expect(plugin.settings.formats).toEqual([]); });
	it('uses the reference Sponsors configuration', () => expect(SPONSORS).toEqual({clientId:'Ov23lic5UPGPZqhBlBGg',sponsorLogin:'theluckystrike',minMonthlyUsd:5,oneTimeUsd:15,oneTimeMonths:0,scope:'read:user'}));
});
describe('scan and format safety', () => {
	it('finds one pair without writing', () => { const doc = '# Study\n\n'+text+'\n\nEnd'; const found = findPairs(doc,(p)=>p); expect(found).toHaveLength(1); expect(doc.slice(found[0]!.from,found[0]!.to)).toBe(text); });
	it('finds both pairs in a three-callout chain', () => { const chain = text.replace('\n\n','\n')+'\n> [!pdf] [[A.pdf#page=3]]\n> Third.'; expect(findPairs(chain,(p)=>p)).toHaveLength(2); });
	it('skips fenced examples', () => expect(findPairs('~~~md\n'+text+'\n~~~',(p)=>p)).toEqual([]));
	it('skips mixed PDFs and intervening prose', () => { expect(findPairs(text.replace('page=2','page=2').replace('A.pdf#page=2','B.pdf#page=2'),(p)=>p)).toEqual([]); expect(findPairs(text.replace('\n\n','\n\nComment\n\n'),(p)=>p)).toEqual([]); });
	it('drops invalid settings and duplicates', () => { expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS); expect(normalizeSettings({formats:[{},format,format]})).toEqual({formats:[format]}); });
	it('requires one links placeholder and single-line fields', () => { expect(validFormat(format)).toBe(true); expect(validFormat({...format,source:'No sources'})).toBe(false); expect(validFormat({...format,source:'{links} {links}'})).toBe(false); expect(validFormat({...format,header:'Title\n> altered'})).toBe(false); });
});
