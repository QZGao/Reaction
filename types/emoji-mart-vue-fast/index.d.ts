import type { DefineComponent } from "vue";

export interface EmojiData {
	[key: string]: unknown;
}

export interface EmojiSelection {
	id?: string;
	name?: string;
	colons?: string;
	native?: string;
	short_names?: string[];
	i18nName?: string | null;
	skin?: number | null;
	text?: string;
	emoticons?: string[];
	keywords?: string[];
	imageUrl?: string;
}

export interface EmojiI18nData {
	emojis?: Record<string, { name?: string; keywords?: string[] }>;
	aliases?: Record<string, string>;
}

export interface EmojiIndexOptions {
	include?: string[];
	exclude?: string[];
	custom?: EmojiSelection[];
	emojiI18n?: EmojiI18nData;
}

export class EmojiIndex {
	constructor(data: EmojiData, options?: EmojiIndexOptions);
	search(term?: string, maxResults?: number): EmojiSelection[];
	findEmoji(search: string): EmojiSelection | null;
	nativeEmoji(native: string): EmojiSelection | null;
	firstEmoji(): EmojiSelection | null;
	categories(): { id: string; name: string; emojis: EmojiSelection[] }[];
}

export interface PickerI18nMessages {
	search?: string;
	[key: string]: unknown;
}

export interface PickerProps {
	data: EmojiIndex;
	custom?: EmojiSelection[];
	i18n?: PickerI18nMessages;
	native?: boolean;
	autoFocus?: boolean;
	showPreview?: boolean;
	showSearch?: boolean;
	showCategories?: boolean;
	perLine?: number;
	emojiSize?: number;
	emojiTooltip?: boolean;
	skin?: number | null;
	onSelect?: (emoji: EmojiSelection) => void;
	infiniteScroll?: boolean;
}

export const Picker: DefineComponent<PickerProps>;

declare module "emoji-mart-vue-fast/src" {
	export * from "emoji-mart-vue-fast";
}

export { };
