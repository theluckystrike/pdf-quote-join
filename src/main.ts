import { Notice, Plugin, type Editor, type MarkdownFileInfo } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { bindPro, isPro, resetPro, SPONSORS } from './pro';
import { findPairs, joinCallouts, previewIsCurrent, rangeIsSafe, validFormat, type NamedFormat, type Resolver } from './join';
import { PdfQuoteJoinSettingTab, normalizeSettings, type PdfQuoteJoinSettings } from './settings';
import { FormatModal, PairModal, PreviewModal, type Preview } from './modals';

export default class PdfQuoteJoinPlugin extends Plugin {
	settings: PdfQuoteJoinSettings = { formats: [] };
	pro: SponsorsManager | null = null;
	readonly modals = new Set<PreviewModal | PairModal | FormatModal>();
	private unloaded = false;

	async onload(): Promise<void> {
		this.unloaded = false;
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new PdfQuoteJoinSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'join-selected', name: 'Join two selected PDF callouts', editorCallback: (editor, info) => this.previewSelection(editor, info) });
		this.addCommand({ id: 'find-pairs', name: 'Find adjacent PDF pairs (pro)', editorCallback: (editor, info) => this.scan(editor, info) });
		this.addCommand({ id: 'save-format', name: 'Save a named format (pro)', callback: () => this.openFormats() });
		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void {
		this.unloaded = true;
		for (const modal of [...this.modals]) modal.close();
		resetPro();
	}

	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as unknown); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }

	resolver(sourcePath: string): Resolver {
		return (path) => {
			const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
			return file?.extension.toLowerCase() === 'pdf' ? file.path : null;
		};
	}

	previewSelection(editor: Editor, info: MarkdownFileInfo): void {
		if (editor.listSelections().length !== 1) { new Notice('Select one range with two PDF callouts.'); return; }
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		this.openPreview(editor, info, from, to, false);
	}

	openPreview(editor: Editor, info: MarkdownFileInfo, from: number, to: number, proOnly: boolean): void {
		if (proOnly && !this.requirePro()) return;
		const doc = editor.getValue();
		if (!info.file || !rangeIsSafe(doc, from, to)) { new Notice('Select exactly two complete adjacent PDF callouts.'); return; }
		const original = doc.slice(from, to);
		const result = joinCallouts(original, this.resolver(info.file.path));
		if (!result.ok) { new Notice(result.error); return; }
		const preview: Preview = { editor, info, doc, from, to, original, path: info.file.path, proOnly };
		new PreviewModal(this, preview, result).open();
	}

	applyPreview(preview: Preview, format?: NamedFormat): boolean {
		if ((preview.proOnly || format) && !this.requirePro()) return false;
		if (!this._current(preview)) { new Notice('Stale preview. Close it and select the callouts again.'); return false; }
		// Resolve again: a PDF can move or disappear while a preview is open.
		const result = joinCallouts(preview.original, this.resolver(preview.path), format);
		if (!result.ok) { new Notice(result.error); return false; }
		preview.editor.transaction({ changes: [{ from: preview.editor.offsetToPos(preview.from), to: preview.editor.offsetToPos(preview.to), text: result.text }] }, 'pdf-quote-join');
		new Notice('Joined two PDF callouts. Use undo to restore them.');
		return true;
	}

	_current(preview: Preview): boolean {
		return previewIsCurrent(preview.doc, preview.editor.getValue(), preview.path, preview.info.file?.path ?? null)
			&& preview.info.editor === preview.editor;
	}

	scan(editor: Editor, info: MarkdownFileInfo): void {
		if (!this.requirePro() || !info.file) return;
		const doc = editor.getValue();
		const pairs = findPairs(doc, this.resolver(info.file.path));
		new PairModal(this, editor, info, doc, pairs).open();
	}

	openFormats(): void { if (this.requirePro()) new FormatModal(this).open(); }

	async storeFormat(format: NamedFormat): Promise<boolean> {
		if (!this.requirePro()) return false;
		if (!validFormat(format)) { new Notice('Use a name, a single-line header and one {links} in the source format.'); return false; }
		const formats = this.settings.formats.filter((f) => f.name !== format.name);
		if (formats.length >= 20) { new Notice('The limit is 20 named formats. Replace a name or remove a format.'); return false; }
		this.settings.formats = [...formats, { ...format }];
		await this.saveSettings();
		return true;
	}

	async removeFormat(name: string): Promise<void> {
		if (!this.requirePro()) return;
		this.settings.formats = this.settings.formats.filter((f) => f.name !== name);
		await this.saveSettings();
	}

	requirePro(): boolean {
		if (isPro()) return true;
		new Notice('This is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.');
		return false;
	}
}
