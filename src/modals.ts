import { Modal, Notice, type Editor, type MarkdownFileInfo } from 'obsidian';
import type PdfQuoteJoinPlugin from './main';
import { joinCallouts, type JoinResult, type NamedFormat, type Pair } from './join';
import { isPro } from './pro';

export interface Preview { editor: Editor; info: MarkdownFileInfo; doc: string; from: number; to: number; original: string; path: string; proOnly: boolean }
export class PreviewModal extends Modal {
	constructor(private plugin: PdfQuoteJoinPlugin, private preview: Preview, private result: Extract<JoinResult, { ok: true }>) { super(plugin.app); }
	onOpen(): void {
		this.plugin.modals.add(this);
		this.setTitle('Join two PDF callouts');
		this.contentEl.addClass('pdf-quote-join-preview');
		this.contentEl.createEl('p', { text: 'Check the body and source links. This joins saved note text. It does not make a continuous PDF selection.' });
		let format: NamedFormat | undefined;
		if (isPro() && this.plugin.settings.formats.length) {
			const label = this.contentEl.createEl('label', { text: 'Named format (pro)' });
			const select = label.createEl('select', { cls: 'pdf-quote-join-format' });
			select.createEl('option', { text: 'Default', value: '' });
			for (const f of this.plugin.settings.formats) select.createEl('option', { text: f.name, value: f.name });
			select.addEventListener('change', () => {
				format = this.plugin.settings.formats.find((f) => f.name === select.value);
				const joined = joinCallouts(this.preview.original, this.plugin.resolver(this.preview.path), format);
				if (joined.ok) pre.setText(joined.text);
			});
		}
		const pre = this.contentEl.createEl('pre', { text: this.result.text, cls: 'pdf-quote-join-output' });
		this.contentEl.createEl('p', { text: `${this.result.links.length} distinct source link${this.result.links.length === 1 ? '' : 's'} to ${this.result.pdf}.` });
		const controls = this.contentEl.createDiv({ cls: 'pdf-quote-join-actions' });
		controls.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		controls.createEl('button', { text: 'Apply', cls: 'mod-cta pdf-quote-join-apply' }).addEventListener('click', () => { if (this.plugin.applyPreview(this.preview, format)) this.close(); });
	}
	onClose(): void { this.plugin.modals.delete(this); this.contentEl.empty(); }
}
export class PairModal extends Modal {
	constructor(private plugin: PdfQuoteJoinPlugin, private editor: Editor, private info: MarkdownFileInfo, private snapshotDoc: string, private pairs: Pair[]) { super(plugin.app); this.sourcePath = info.file?.path ?? null; }
	private sourcePath: string | null;
	onOpen(): void {
		this.plugin.modals.add(this);
		this.setTitle('Eligible adjacent pairs (pro)');
		this.contentEl.createEl('p', { text: `${this.pairs.length} eligible pair${this.pairs.length === 1 ? '' : 's'} in the active note. Choose one to preview. The scan does not change the note.` });
		for (const pair of this.pairs) {
			const row = this.contentEl.createDiv({ cls: 'pdf-quote-join-pair' });
			row.createEl('p', { text: `Line ${this.editor.offsetToPos(pair.from).line + 1}: ${pair.result.pdf}` });
			row.createEl('pre', { text: pair.result.text, cls: 'pdf-quote-join-output' });
			row.createEl('button', { text: 'Preview pair', cls: 'pdf-quote-join-pair-preview' }).addEventListener('click', () => {
				if (this.editor.getValue() !== this.snapshotDoc || this.info.file?.path !== this.sourcePath) { new Notice('Stale pair list. Run the scan again.'); return; }
				this.close();
				this.plugin.openPreview(this.editor, this.info, pair.from, pair.to, true);
			});
		}
	}
	onClose(): void { this.plugin.modals.delete(this); this.contentEl.empty(); }
}
export class FormatModal extends Modal {
	constructor(private plugin: PdfQuoteJoinPlugin) { super(plugin.app); }
	onOpen(): void {
		this.plugin.modals.add(this);
		this.setTitle('Named formats (pro)');
		this.contentEl.createEl('p', { text: 'Use {pdf} in the header if needed. Put {links} once in the source line. The callout type and color stay from the selected pair.' });
		const field = (label: string, value: string, cls: string) => {
			const el = this.contentEl.createEl('label', { text: label, cls: 'pdf-quote-join-field' });
			return el.createEl('input', { type: 'text', value, cls });
		};
		const name = field('Name', 'Research quotes', 'pdf-quote-join-name');
		const header = field('Joined header', 'Joined PDF quotes', 'pdf-quote-join-header');
		const source = field('Source line', 'Sources: {links}', 'pdf-quote-join-source');
		const controls = this.contentEl.createDiv({ cls: 'pdf-quote-join-actions' });
		controls.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		controls.createEl('button', { text: 'Save format', cls: 'mod-cta pdf-quote-join-save-format' }).addEventListener('click', () => {
			void this.plugin.storeFormat({ name: name.value.trim(), header: header.value, source: source.value }).then((ok) => { if (ok) this.close(); });
		});
		for (const f of this.plugin.settings.formats) {
			const row = this.contentEl.createDiv({ cls: 'pdf-quote-join-pair' });
			row.createEl('p', { text: f.name });
			row.createEl('button', { text: 'Edit' }).addEventListener('click', () => { name.value = f.name; header.value = f.header; source.value = f.source; });
			row.createEl('button', { text: 'Remove' }).addEventListener('click', () => { void this.plugin.removeFormat(f.name).then(() => { if (isPro()) row.remove(); }); });
		}
	}
	onClose(): void { this.plugin.modals.delete(this); this.contentEl.empty(); }
}
