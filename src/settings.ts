import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { validFormat, type NamedFormat } from './join';
import { PRO_UI } from './pro';
import type PdfQuoteJoinPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface PdfQuoteJoinSettings { formats: NamedFormat[] }
export const DEFAULT_SETTINGS: PdfQuoteJoinSettings = { formats: [] };
export function normalizeSettings(saved: unknown): PdfQuoteJoinSettings {
	if (!saved || typeof saved !== 'object') return { formats: [] };
	const data = saved as { formats?: unknown };
	const formats: NamedFormat[] = [];
	if (Array.isArray(data.formats)) {
		for (const f of data.formats as unknown[]) {
			if (validFormat(f) && !formats.some((s) => s.name === f.name)) formats.push({ ...f });
			if (formats.length === 20) break;
		}
	}
	return { formats };
}
export class PdfQuoteJoinSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: PdfQuoteJoinPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Callout format', desc: 'Select two complete adjacent callouts. Headers must contain local PDF wiki page links. Types and colors must match.' },
			{ name: 'Named formats (Pro)', desc: 'Save a header and a source line. Choose a format in the preview.', render: (setting) => { setting.addButton((button) => button.setButtonText('Manage formats').onClick(() => this.plugin.openFormats())); } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
}
