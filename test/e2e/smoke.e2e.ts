import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
import type PdfQuoteJoinPlugin from '../../src/main';

const original = '> [!pdf] [[A.pdf#page=1|p1]]\n> First.\n\n> [!pdf] [[A.pdf#page=2|p2]]\n> Second.';
const joined = '> [!pdf] [[A.pdf#page=1|p1]] [[A.pdf#page=2|p2]]\n> First.\n>\n> Second.';
let fixtureNumber = 0;
async function prepare(value: string): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, PdfQuoteJoinPlugin> } }).plugins.plugins['pdf-quote-join']!;
		for (const m of [...p.modals]) m.close();
		p.pro!.signOut();
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	});
	// A fresh path keeps a previous dirty editor's pending save out of this fixture.
	const path = `Quotes-${++fixtureNumber}.md`;
	await obsidianPage.write(path, value);
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, expected, path) => app.workspace.activeEditor?.file?.path === path && app.workspace.activeEditor.editor?.getValue() === expected && !!app.metadataCache.getFirstLinkpathDest('A.pdf', path), value, path), { timeout: 10000 });
	await browser.executeObsidian(({ app }) => {
		const e = app.workspace.activeEditor!.editor!;
		e.setSelection({ line: 0, ch: 0 }, e.offsetToPos(e.getValue().length));
		e.focus();
	});
}
async function text(): Promise<string> { return browser.executeObsidian(({ app }) => app.workspace.activeEditor!.editor!.getValue()); }
async function notice(phrase: string): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian((_ctx, value) => [...document.querySelectorAll('.notice')].some((n) => n.textContent?.includes(value)), phrase), { timeout: 5000 });
}
async function command(): Promise<void> { await browser.executeObsidianCommand(`${pluginId}:join-selected`); }
async function mockPro(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, PdfQuoteJoinPlugin> } }).plugins.plugins['pdf-quote-join']!;
		const manager = p.pro!;
		(manager as unknown as { opts: { http: () => Promise<unknown> } }).opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret('pdf-quote-join-github-token', 'gho_' + '0'.repeat(36));
		await manager.refreshNow();
	});
}
async function output(): Promise<string> { const el = await browser.$('.pdf-quote-join-output'); await el.waitForExist(); return el.getText(); }
describe(`${pluginId} real editor`, function () {
	it('loads and reloads without console errors', async function () { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); });
	it('previews, applies and restores the exact pair with one Undo', async function () {
		await prepare(original); await command(); expect(await output()).toBe(joined);
		await browser.$('.pdf-quote-join-apply').click(); await browser.waitUntil(async () => await text() === joined, { timeout: 5000 });
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor!.editor!.undo());
		await browser.waitUntil(async () => await text() === original, { timeout: 5000 });
	});
	it('keeps a duplicate source link once', async function () {
		await prepare(original.replace('[[A.pdf#page=2|p2]]', '[[A.pdf#page=1|p1]]')); await command();
		expect(await output()).toBe('> [!pdf] [[A.pdf#page=1|p1]]\n> First.\n>\n> Second.');
	});
	it('rejects mixed PDFs and incompatible colors without writing', async function () {
		const mixed = original.replace('A.pdf#page=2', 'B.pdf#page=2'); await prepare(mixed); await command(); await notice('Mixed PDFs'); expect(await text()).toBe(mixed);
		const colors = original.replace('[!pdf]', '[!pdf|yellow]').replace('[!pdf]', '[!pdf|red]'); await prepare(colors); await command(); await notice('Incompatible callouts'); expect(await text()).toBe(colors);
	});
	it('rejects third callouts, nested quotes and fences', async function () {
		for (const value of [original + '\n\n> [!pdf] [[A.pdf#page=3]]\n> Third.', original.replace('> First.', '> > First.'), original.replace('> First.', '> ```\n> code\n> ```')]) {
			await prepare(value); await command(); await notice('Select exactly two'); expect(await text()).toBe(value);
		}
	});
	it('keeps reverse page order', async function () {
		const blocks = original.split('\n\n'); await prepare(blocks[1]! + '\n\n' + blocks[0]!); await command();
		expect(await output()).toBe('> [!pdf] [[A.pdf#page=2|p2]] [[A.pdf#page=1|p1]]\n> Second.\n>\n> First.');
	});
	it('rejects a stale preview and keeps current text', async function () {
		await prepare(original); await command(); await browser.$('.pdf-quote-join-apply').waitForExist();
		const changed = original.replace('First.', 'Changed.'); await browser.executeObsidian(({ app }, value) => app.workspace.activeEditor!.editor!.setValue(value), changed);
		await browser.$('.pdf-quote-join-apply').click(); await notice('Stale preview'); expect(await text()).toBe(changed);
	});
	it('gates Pro, finds pairs and saves and applies a named format', async function () {
		await prepare(original); await browser.executeObsidianCommand(`${pluginId}:find-pairs`); await notice('pro feature'); expect(await browser.$('.pdf-quote-join-pair-preview').isExisting()).toBe(false);
		await browser.executeObsidianCommand(`${pluginId}:save-format`); await notice('pro feature'); expect(await browser.$('.pdf-quote-join-save-format').isExisting()).toBe(false);
		await mockPro(); await browser.executeObsidianCommand(`${pluginId}:find-pairs`); const pair = await browser.$('.pdf-quote-join-pair-preview'); await pair.waitForExist(); await pair.click(); await browser.$('.pdf-quote-join-apply').waitForExist(); expect(await text()).toBe(original);
		await browser.executeObsidian(({ app }) => { const p = (app as unknown as { plugins: { plugins: Record<string, PdfQuoteJoinPlugin> } }).plugins.plugins['pdf-quote-join']!; for (const m of [...p.modals]) m.close(); });
		await browser.executeObsidianCommand(`${pluginId}:save-format`); await browser.$('.pdf-quote-join-save-format').waitForExist();
		await browser.$('.pdf-quote-join-name').setValue('Study'); await browser.$('.pdf-quote-join-header').setValue('Research'); await browser.$('.pdf-quote-join-source').setValue('Sources: {links}'); await browser.$('.pdf-quote-join-save-format').click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => (app as unknown as { plugins: { plugins: Record<string, PdfQuoteJoinPlugin> } }).plugins.plugins['pdf-quote-join']!.settings.formats.some((f) => f.name === 'Study')), { timeout: 5000 });
		await command(); await browser.$('.pdf-quote-join-format').waitForExist(); await browser.$('.pdf-quote-join-format').selectByVisibleText('Study');
		expect(await output()).toBe('> [!pdf] Research\n> Sources: [[A.pdf#page=1|p1]] [[A.pdf#page=2|p2]]\n>\n> First.\n>\n> Second.');
		await browser.$('.pdf-quote-join-apply').click(); await browser.waitUntil(async () => (await text()).includes('Sources: [[A.pdf#page=1|p1]] [[A.pdf#page=2|p2]]'), { timeout: 5000 });
	});
});
