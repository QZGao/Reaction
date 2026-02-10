import rawCatalogues from 'virtual:i18n';
import rawEmojiI18n from 'virtual:emoji-i18n';
import { encodeTitle, normalizeTitle } from './titleUtils';

type ReplacementValue = string | number;
export type MessageParams = ReplacementValue[];

type CatalogueMap = Record<string, Record<string, string>>;

let catalogues: CatalogueMap = normalizeCatalogues(rawCatalogues);

export type LocaleCode = Extract<keyof typeof catalogues, string>;
export type MessageKey = string;

export type RichMessageSegment =
	| { type: 'text'; text: string }
	| { type: 'link'; text: string; href: string };

let fallbackLocale: LocaleCode = "en" as LocaleCode;
let activeLocale: LocaleCode = "en" as LocaleCode;
const REACTION_PREFIX = "[Reaction] ";

export interface EmojiI18nData {
	emojis?: Record<string, { name?: string; keywords?: string[] }>;
	aliases?: Record<string, string>;
}

let emojiI18nByLocale: Record<string, EmojiI18nData> = normalizeEmojiI18n(rawEmojiI18n);

const GLOBAL_I18N_KEY = "__REACTION_I18N__";
const GLOBAL_EMOJI_I18N_KEY = "__REACTION_EMOJI_I18N__";
const GLOBAL_REGISTER_I18N_KEY = "__REACTION_REGISTER_I18N__";
const GLOBAL_REGISTER_EMOJI_I18N_KEY = "__REACTION_REGISTER_EMOJI_I18N__";

/**
 * Access the global MediaWiki instance if available.
 * @returns The mw object exposed by MediaWiki or undefined outside that environment.
 */
function getMwInstance(): typeof mw | undefined {
	return (globalThis as { mw?: typeof mw }).mw;
}

/**
 * Retrieve a string configuration value from MediaWiki.
 * @param name - Configuration key.
 * @returns The configuration value if present and a string; otherwise undefined.
 */
function getMwConfigString(name: string): string | undefined {
	const value = getMwInstance()?.config?.get(name);
	return typeof value === 'string' ? value : undefined;
}

/**
 * Resolve the most appropriate locale based on the MediaWiki user/content language.
 * Falls back to English if the requested locale is unavailable.
 * @returns The detected locale code.
 */
function detectInitialLocale(): LocaleCode {
	const candidates = getFallbackCandidates();
	for (const candidate of candidates) {
		if (isSupportedLocale(candidate)) {
			return candidate;
		}
	}
	return fallbackLocale;
}

/**
 * Get the list of candidate locales from MediaWiki configuration.
 * @returns Array of locale codes.
 */
function getFallbackCandidates(): string[] {
	const mwFallbackChain = getMwLanguageFallbackChain();
	if (mwFallbackChain.length) {
		return mwFallbackChain;
	}

	const userLang = getMwConfigString('wgUserLanguage');
	const contentLang = getMwConfigString('wgContentLanguage');

	return dedupeLocales([userLang, contentLang]);
}

/**
 * Check if a locale code is supported.
 * @param locale - Locale code.
 * @returns True if supported, false otherwise.
 */
function isSupportedLocale(locale: string): locale is LocaleCode {
	return Object.prototype.hasOwnProperty.call(catalogues, locale);
}

/**
 * Resolve the fallback locale to use when no preferred locale is found.
 * Prefers 'en' if available, otherwise picks the first available locale.
 * @returns The fallback locale code.
 */
function resolveFallbackLocale(): LocaleCode {
	if (isSupportedLocale('en')) {
		return 'en';
	}
	const locales = Object.keys(catalogues).filter(isSupportedLocale);
	if (locales.length === 0) {
		return 'en' as LocaleCode;
	}
	return locales[0];
}

/**
 * Resolve a message template for a given key and locale.
 * Falls back to the default locale if the key is not found.
 * @param key - Message key.
 * @param locale - Locale code.
 * @returns The message template string.
 */
function resolveTemplate(key: MessageKey, locale: LocaleCode): string {
	return catalogues[locale]?.[key] ?? catalogues[fallbackLocale]?.[key] ?? key;
}

/**
 * Format a message template with optional parameters.
 * @param template - The message template string.
 * @param params - Optional array of replacement values.
 * @returns The formatted message string.
 */
function format(template: string, params?: MessageParams): string {
	const populated = (!params || params.length === 0) ? template : template.replace(/\$(\d+)/g, (_match, rawIndex) => {
		const idx = Number(rawIndex) - 1;
		const value = params[idx];
		return value == null ? '' : String(value);
	});
	return populated;
}

/**
 * Format a message into segmented rich content (text + wiki links).
 * @param template - Message template string.
 * @param params - Optional replacement values.
 * @returns Array of rich message segments.
 */
function formatRichMessage(template: string, params?: MessageParams): RichMessageSegment[] {
	const populated = (!params || params.length === 0) ? template : template.replace(/\$(\d+)/g, (_match, rawIndex) => {
		const idx = Number(rawIndex) - 1;
		const value = params[idx];
		return value == null ? '' : String(value);
	});
	return renderWikiLinkSegments(populated);
}

/**
 * Normalize raw catalogue data into the expected structure.
 * @param input - Raw catalogue data.
 * @returns Normalized catalogue map.
 */
function normalizeCatalogues(input: unknown): CatalogueMap {
	if (!isPlainRecord(input)) {
		return {};
	}
	const result: CatalogueMap = {};
	for (const [locale, messages] of Object.entries(input)) {
		if (!isPlainRecord(messages)) {
			continue;
		}
		const safeMessages: Record<string, string> = {};
		for (const [key, value] of Object.entries(messages)) {
			if (typeof value === 'string') {
				safeMessages[key] = value;
			}
		}
		if (Object.keys(safeMessages).length > 0) {
			result[locale] = safeMessages;
		}
	}
	return result;
}

/**
 * Check if a value is a plain object (Record<string, unknown>).
 * @param value - Value to check.
 * @returns True if plain object, false otherwise.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Get the MediaWiki language fallback chain.
 * @returns Array of locale codes.
 */
function getMwLanguageFallbackChain(): string[] {
	const chain = getMwInstance()?.language?.getFallbackLanguageChain?.();
	if (!Array.isArray(chain)) {
		return [];
	}
	return dedupeLocales(chain);
}

/**
 * Deduplicate and normalize an array of locale codes.
 * @param items - Array of locale codes.
 * @returns Deduplicated array of normalized locale codes.
 */
function dedupeLocales(items: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of items) {
		const normalized = normalizeLocaleCode(raw);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

/**
 * Normalize a locale code to lowercase.
 * @param code - Locale code.
 * @returns Normalized locale code or undefined.
 */
function normalizeLocaleCode(code?: string): string | undefined {
	if (!code) {
		return undefined;
	}
	return code.toLowerCase();
}

/**
 * Normalize raw emoji i18n data into the expected structure.
 * @param input - Raw emoji i18n data.
 * @returns Normalized emoji i18n map.
 */
function normalizeEmojiI18n(input: unknown): Record<string, EmojiI18nData> {
	if (!isPlainRecord(input)) {
		return {};
	}
	const result: Record<string, EmojiI18nData> = {};
	for (const [locale, payload] of Object.entries(input)) {
		if (!isPlainRecord(payload)) {
			continue;
		}
		const emojis = isPlainRecord(payload.emojis)
			? normalizeEmojiEntries(payload.emojis)
			: undefined;
		const aliases = isPlainRecord(payload.aliases)
			? normalizeEmojiAliases(payload.aliases)
			: undefined;
		result[locale.toLowerCase()] = { emojis, aliases };
	}
	return result;
}

/**
 * Merge new emoji i18n data into the existing store.
 * @param next - New emoji i18n data.
 */
function mergeEmojiI18n(next: Record<string, EmojiI18nData>): void {
	for (const [locale, payload] of Object.entries(next)) {
		emojiI18nByLocale[locale.toLowerCase()] = payload;
	}
}

/**
 * Persist emoji i18n data into the shared global snapshot for other bundles.
 * @param next - Emoji i18n payload to persist.
 */
function persistGlobalEmojiI18n(next: Record<string, EmojiI18nData>): void {
	const globalObj = globalThis as Record<string, unknown>;
	const existing = normalizeEmojiI18n(globalObj[GLOBAL_EMOJI_I18N_KEY]);
	globalObj[GLOBAL_EMOJI_I18N_KEY] = Object.assign(existing, next);
}

/**
 * Merge new catalogue data into the existing store.
 * @param next - New catalogue data.
 */
function mergeCatalogues(next: CatalogueMap): void {
	for (const [locale, messages] of Object.entries(next)) {
		catalogues[locale.toLowerCase()] = messages;
	}
	fallbackLocale = resolveFallbackLocale();
	refreshLocale();
}

/**
 * Persist i18n catalogue data into the shared global snapshot for other bundles.
 * @param next - Catalogue payload to persist.
 */
function persistGlobalCatalogues(next: CatalogueMap): void {
	const globalObj = globalThis as Record<string, unknown>;
	const existing = normalizeCatalogues(globalObj[GLOBAL_I18N_KEY]);
	globalObj[GLOBAL_I18N_KEY] = Object.assign(existing, next);
}

/**
 * Register new i18n catalogue data.
 * @param input - New catalogue data.
 */
export function registerI18nCatalogues(input: unknown): void {
	const normalized = normalizeCatalogues(input);
	if (Object.keys(normalized).length === 0) {
		return;
	}
	mergeCatalogues(normalized);
	persistGlobalCatalogues(normalized);
}

/**
 * Register new emoji i18n data.
 * @param input - New emoji i18n data.
 */
export function registerEmojiI18nData(input: unknown): void {
	const normalized = normalizeEmojiI18n(input);
	if (Object.keys(normalized).length === 0) {
		return;
	}
	mergeEmojiI18n(normalized);
	persistGlobalEmojiI18n(normalized);
}

/**
 * Consume any pending global i18n data and set up global registration functions.
 */
function consumeGlobalI18n(): void {
	const globalObj = globalThis as Record<string, unknown>;
	const pendingI18n = globalObj[GLOBAL_I18N_KEY];
	const pendingEmoji = globalObj[GLOBAL_EMOJI_I18N_KEY];
	if (pendingI18n) {
		registerI18nCatalogues(pendingI18n);
	}
	if (pendingEmoji) {
		registerEmojiI18nData(pendingEmoji);
	}
	globalObj[GLOBAL_REGISTER_I18N_KEY] = registerI18nCatalogues;
	globalObj[GLOBAL_REGISTER_EMOJI_I18N_KEY] = registerEmojiI18nData;
}

/**
 * Normalize emoji entries for a locale.
 * @param input - Raw emoji entries.
 * @returns Normalized emoji entries.
 */
function normalizeEmojiEntries(input: Record<string, unknown>): Record<string, { name?: string; keywords?: string[] }> {
	const result: Record<string, { name?: string; keywords?: string[] }> = {};
	for (const [id, value] of Object.entries(input)) {
		if (!isPlainRecord(value)) {
			continue;
		}
		const name = typeof value.name === 'string' ? value.name : undefined;
		const keywords = Array.isArray(value.keywords)
			? value.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
			: undefined;
		if (name || (keywords && keywords.length > 0)) {
			result[id] = { name, keywords };
		}
	}
	return result;
}

/**
 * Normalize emoji alias entries for a locale.
 * @param input - Raw emoji alias entries.
 * @returns Normalized emoji alias entries.
 */
function normalizeEmojiAliases(input: Record<string, unknown>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [alias, value] of Object.entries(input)) {
		if (typeof value === 'string') {
			result[alias] = value;
		}
	}
	return result;
}

/**
 * Translate a message key into the active locale, optionally applying parameters.
 */
export function t(key: MessageKey, params?: MessageParams): string {
	const template = resolveTemplate(key, activeLocale);
	return format(template, params);
}

/**
 * Translate a message key and add the standard gadget prefix.
 * @param key - Message key.
 * @param params - Optional replacement parameters.
 * @returns Prefixed localized string.
 */
export function tReaction(key: MessageKey, params?: MessageParams): string {
	const message = t(key, params);
	return message.startsWith(REACTION_PREFIX) ? message : `${REACTION_PREFIX}${message}`;
}

/**
 * Translate a message key into structured rich segments (text + links).
 * @param key - Message key.
 * @param params - Optional replacement parameters.
 * @returns Array of rich message segments.
 */
export function tRich(key: MessageKey, params?: MessageParams): RichMessageSegment[] {
	const template = resolveTemplate(key, activeLocale);
	return formatRichMessage(template, params);
}

/**
 * Refresh the active locale based on MediaWiki configuration.
 */
export function refreshLocale(): void {
	activeLocale = detectInitialLocale();
}

/**
 * Get the current active locale.
 * @returns The active locale code.
 */
export function getLocale(): LocaleCode {
	return activeLocale;
}

/**
 * Get the MediaWiki locale fallback chain used for i18n resolution.
 * @returns Array of locale codes.
 */
export function resolveEmojiI18nData(locale: LocaleCode): EmojiI18nData | null {
	const candidates = [locale, ...getFallbackCandidates()];
	for (const candidate of candidates) {
		const normalized = candidate.toLowerCase();
		if (Object.prototype.hasOwnProperty.call(emojiI18nByLocale, normalized)) {
			return emojiI18nByLocale[normalized];
		}
	}
	return null;
}

consumeGlobalI18n();
fallbackLocale = resolveFallbackLocale();
refreshLocale();

/**
 * Parse wiki-style links into structured segments.
 * @param text - Message text containing optional wiki links.
 * @returns Array of text/link segments.
 */
function renderWikiLinkSegments(text: string): RichMessageSegment[] {
	if (!text.includes('[[')) {
		return text ? [{ type: 'text', text }] : [];
	}
	const segments: RichMessageSegment[] = [];
	const regex = /\[\[([^[\]|]+?)(?:\|([\s\S]*?))?\]\]/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const [raw, rawTarget, rawLabel] = match;
		const start = match.index;
		if (start > lastIndex) {
			segments.push({ type: 'text', text: text.slice(lastIndex, start) });
		}
		const target = (rawTarget || '').trim();
		if (!target) {
			segments.push({ type: 'text', text: raw });
		} else {
			const label = (rawLabel ?? rawTarget).trim();
			segments.push({ type: 'link', text: label, href: buildWikiHref(target) });
		}
		lastIndex = start + raw.length;
	}
	if (lastIndex < text.length) {
		segments.push({ type: 'text', text: text.slice(lastIndex) });
	}
	return segments;
}

/**
 * Build an absolute URL to the given wiki page, falling back to enwiki if needed.
 * @param title - Target page title.
 * @returns Fully-qualified article URL.
 */
function buildWikiHref(title: string): string {
	const normalized = normalizeTitle(title);
	const mwInstance = getMwInstance();
	if (mwInstance?.util?.getUrl) {
		const url = mwInstance.util.getUrl(normalized);
		if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
			return url;
		}
		const server = getMwConfigString('wgServer');
		return server ? server.replace(/\/$/, '') + url : url;
	}
	const server = getMwConfigString('wgServer') || 'https://en.wikipedia.org';
	const articlePath = getMwConfigString('wgArticlePath') || '/wiki/$1';
	const encoded = encodeTitle(normalized);
	const resolvedPath = articlePath.includes('$1')
		? articlePath.replace('$1', encoded)
		: `${articlePath.replace(/\/$/, '')}/${encoded}`;
	const normalizedServer = server.replace(/\/$/, '');
	const prefixedPath = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
	return `${normalizedServer}${prefixedPath}`;
}
