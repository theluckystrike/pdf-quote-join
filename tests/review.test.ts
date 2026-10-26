import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PdfQuoteJoinPlugin from '../src/main';
import manifest from '../manifest.json';
import { bindPro, resetPro } from '../src/pro';
import { findPairs, joinCallouts, rangeIsSafe } from '../src/join';

const pair = '> [!pdf] [[A.pdf#page=1|p1]]\n> First.\n\n> [!pdf] [[A.pdf#page=2|p2]]\n> Second.';
const resolve = () => 'A.pdf';
afterEach(() => { resetPro(); vi.useRealTimers(); });

describe('review regressions', () => {
	it.each(['```markdown', '~~~markdown'])('rejects selected examples inside a quoted %s fence', (fence) => {
		const prefix = `> ${fence}\n`;
		const example = pair.replace('\n\n', '\n');
		const doc = prefix + example;
		expect(rangeIsSafe(doc, prefix.length, doc.length)).toBe(false);
		expect(findPairs(doc, resolve)).toEqual([]);
	});
	it('accepts a pair after a quoted code fence closes or its container ends', () => {
		for (const prefix of ['> ```\n> Example\n> ```\n\n', '> ```\n> Example\n\nParagraph\n\n']) {
			const doc = prefix + pair;
			expect(rangeIsSafe(doc, prefix.length, doc.length)).toBe(true);
			expect(findPairs(doc, resolve)).toHaveLength(1);
		}
	});
	it('keeps dollar sequences in source strings with a named format', () => {
		const text = pair.replace('p1', () => "$& $` $' $$");
		const result = joinCallouts(text, () => 'Cost $&.pdf', { name: 'Study', header: 'From {pdf}', source: 'Sources: {links}' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.text).toBe("> [!pdf] From Cost $&.pdf\n> Sources: [[A.pdf#page=1|$& $` $' $$]] [[A.pdf#page=2|p2]]\n>\n> First.\n>\n> Second.");
	});
	it('does not start a refresh timer after unload while layout is pending', async () => {
		vi.useFakeTimers();
		const app = App.createConfigured__();
		let ready = () => undefined;
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((cb) => { ready = cb; });
		const plugin = new PdfQuoteJoinPlugin(app as never, manifest as never);
		await plugin.onload();
		plugin.onunload();
		const intervals = vi.spyOn(plugin, 'registerInterval');
		ready();
		expect(intervals).not.toHaveBeenCalled();
	});
	it('scans a large note without blocking for several seconds', () => {
		const doc = Array.from({ length: 6000 }, (_, i) => `> [!pdf] [[A.pdf#page=${i + 1}]]\n> Quote.`).join('\n\n');
		const start = performance.now();
		expect(findPairs(doc, resolve)).toHaveLength(5999);
		expect(performance.now() - start).toBeLessThan(3000);
	});
	it('keeps body links without using them to choose the PDF', () => {
		const input = pair.replace('First.', 'First. [[B.pdf#page=3]]');
		const resolver = vi.fn((path: string) => path === 'A.pdf' ? path : null);
		const joined = joinCallouts(input, resolver);
		expect(joined.ok).toBe(true);
		if (joined.ok) expect(joined.text).toContain('> First. [[B.pdf#page=3]]');
		expect(resolver.mock.calls.map((call) => call[0])).toEqual(['A.pdf', 'A.pdf']);
	});
	it('rejects multiple selections before opening a preview', () => {
		const plugin = new PdfQuoteJoinPlugin(App.createConfigured__() as never, manifest as never);
		const open = vi.spyOn(plugin, 'openPreview');
		plugin.previewSelection({ listSelections: () => [{}, {}] } as never, {} as never);
		expect(open).not.toHaveBeenCalled();
	});
	it('keeps the 20-format limit while allowing replacement and refusing removal after Pro expires', async () => {
		let enabled = true;
		bindPro({ isPro: () => enabled, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' }, onChange: () => () => undefined } as never);
		const plugin = new PdfQuoteJoinPlugin(App.createConfigured__() as never, manifest as never);
		vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
		for (let i = 0; i < 20; i++) expect(await plugin.storeFormat({ name: `Study ${i}`, header: 'Study', source: '{links}' })).toBe(true);
		expect(await plugin.storeFormat({ name: 'Extra', header: 'Study', source: '{links}' })).toBe(false);
		expect(await plugin.storeFormat({ name: 'Study 0', header: 'Changed', source: '{links}' })).toBe(true);
		expect(plugin.settings.formats).toHaveLength(20);
		enabled = false;
		await plugin.removeFormat('Study 0');
		expect(plugin.settings.formats).toHaveLength(20);
	});
});
