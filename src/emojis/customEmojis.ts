import type { EmojiSelection } from "emoji-mart-vue-fast";
import type { LocaleCode } from "../i18n";

interface CustomEmojiI18nEntry {
	name?: string;
	keywords?: string[];
}

interface CustomEmojiDefinition extends EmojiSelection {
	i18n?: Partial<Record<LocaleCode, CustomEmojiI18nEntry>>;
}

const customEmojiDefinitions: CustomEmojiDefinition[] = [
	{
		name: "orz",
		short_names: ["orz"],
		text: "File:Symbol_囧_vote.svg",
		imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Symbol_%E5%9B%A7_vote.svg/40px-Symbol_%E5%9B%A7_vote.svg.png",
		keywords: ["orz"],
		i18n: {
			"zh-hans": { name: "囧", keywords: ["囧", "orz"] },
			"zh-hant": { name: "囧", keywords: ["囧", "orz"] },
		},
	},
	{
		name: "doge",
		short_names: ["doge"],
		text: "File:Doge.png",
		imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Doge.svg/40px-Doge.svg.png",
		keywords: ["doge"],
		i18n: {
			"zh-hans": { name: "狗头", keywords: ["狗头", "doge"] },
			"zh-hant": { name: "狗頭", keywords: ["狗頭", "doge"] },
		},
	},
	{
		name: "cyberduck",
		short_names: ["cyberduck"],
		text: "File:Cyberduck_icon.png",
		imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Cyberduck_icon.png/40px-Cyberduck_icon.png",
		keywords: ["cyberduck"],
	},
	{
		name: "wikipedia",
		short_names: ["wikipedia"],
		text: "File:Wikipedia's_W.svg",
		imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Wikipedia%27s_W.svg/40px-Wikipedia%27s_W.svg.png",
		keywords: ["wikipedia"],
		i18n: {
			"zh-hans": { name: "维基百科", keywords: ["维基百科", "wikipedia"] },
			"zh-hant": { name: "維基百科", keywords: ["維基百科", "wikipedia"] },
		},
	}
];

/**
 * Applies internationalization to a custom emoji definition based on the provided locale. If localized entries are available, they will override the default name and keywords.
 * @param definition - The custom emoji definition to localize.
 * @param locale - The locale code for localization.
 * @returns The localized emoji selection.
 */
function applyCustomEmojiI18n(
	definition: CustomEmojiDefinition,
	locale: LocaleCode,
): EmojiSelection {
	const localized = definition.i18n?.[locale];
	if (!localized) {
		return { ...definition };
	}
	const mergedKeywords = [
		...(definition.keywords ?? []),
		...(localized.keywords ?? []),
	];
	return {
		...definition,
		name: localized.name ?? definition.name,
		i18nName: localized.name ?? definition.name,
		keywords: mergedKeywords,
	};
}

/**
 * Retrieves the list of custom emojis with localization applied based on the provided locale.
 * @param locale - The locale code for localization.
 * @returns An array of localized emoji selections.
 */
export function getCustomEmojis(locale: LocaleCode): EmojiSelection[] {
	return customEmojiDefinitions.map((definition) =>
		applyCustomEmojiI18n(definition, locale),
	);
}

/**
 * Generates a mapping of custom emoji short names to their corresponding text representations.
 * @returns A record mapping short names to text.
 */
export function getCustomEmojiTextMap(): Record<string, string> {
	return customEmojiDefinitions.reduce<Record<string, string>>((acc, emoji) => {
		const key = emoji.short_names?.[0];
		if (key && typeof emoji.text === "string" && emoji.text.length > 0) {
			acc[key] = emoji.text;
		}
		return acc;
	}, {});
}
