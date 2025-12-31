import moment from "moment-timezone";
import type { TimestampParserFn } from "./wikitext/timestamps";
import { DEFAULT_MESSAGES, getTimestampParser, getTimestampRegexp } from "./wikitext/timestamps";

/**
 * Escape special characters inside a string.
 * @param string {String} - Raw string.
 * @returns {String} - Escaped string.
 */
export function escapeRegex(string: string): string {
	return mw.util.escapeRegExp(string);
}

/**
 * Get the current timestamp formatted using the wiki's signature style.
 * @returns Signature timestamp string.
 */
export function getCurrentSignatureTimestamp(): string {
	return formatDateForSignature(new Date());
}

interface DiscussionToolsParserData {
	dateFormat: Record<string, string>;
	digits: Record<string, string[]>;
	localTimezone: string;
	timezones: Record<string, Record<string, string>>;
	contLangMessages: Record<string, Record<string, string>>;
}

interface TimestampMatcher {
	regex: RegExp;
	parser: TimestampParserFn;
}

let cachedParserData: DiscussionToolsParserData | null = null;
let timestampMatchers: TimestampMatcher[] | null = null;
let timestampFormatter: ((date: Date) => string) | null = null;

/**
 * Escape special characters for use inside a regex character class.
 * @param token - Raw string.
 * @returns Escaped string.
 */
function escapeForCharacterClass(token: string): string {
	return token.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&");
}

/**
 * Retrieve the DiscussionTools parser data, if available.
 * @returns Parser data or null if not available.
 */
function getParserData(): DiscussionToolsParserData | null {
	if (cachedParserData) {
		return cachedParserData;
	}
	try {
		const module = mw.loader.require("ext.discussionTools.init") as { parserData?: DiscussionToolsParserData } | undefined;
		if (!module?.parserData) {
			console.error("[Reaction] DiscussionTools parser data missing.");
			return null;
		}
		cachedParserData = module.parserData;
		return cachedParserData;
	} catch {
		console.error("[Reaction] Unable to access DiscussionTools parser data.");
	}
	return null;
}

/**
 * Determine the preferred content language variant for formatting.
 * @param parserData - DiscussionTools parser data.
 * @returns Variant key or null.
 */
function getPreferredVariant(parserData: DiscussionToolsParserData): string | null {
	const candidates = [
		mw.config.get("wgPageContentLanguage") as string | undefined,
		mw.config.get("wgContentLanguage") as string | undefined,
	];
	for (const candidate of candidates) {
		if (candidate && parserData.dateFormat[candidate]) {
			return candidate;
		}
	}
	const variants = Object.keys(parserData.dateFormat);
	return variants.length > 0 ? variants[0] : null;
}

/**
 * Build a signature timestamp formatter using the parser data.
 * @returns Formatter function or null if unavailable.
 */
function getTimestampFormatter(): ((date: Date) => string) | null {
	if (timestampFormatter) {
		return timestampFormatter;
	}
	const parserData = getParserData();
	if (!parserData) {
		return null;
	}
	const variant = getPreferredVariant(parserData);
	if (!variant) {
		return null;
	}
	const format = parserData.dateFormat[variant];
	const digits = parserData.digits[variant];
	const tzAbbrs = parserData.timezones[variant];
	if (!format || !tzAbbrs) {
		return null;
	}
	const messages = parserData.contLangMessages[variant];
	timestampFormatter = createTimestampFormatter(format, {
		digits,
		messages,
		timezone: parserData.localTimezone,
		timezoneAbbreviations: tzAbbrs,
	});
	return timestampFormatter;
}

interface TimestampFormatterOptions {
	digits?: string[];
	messages?: Record<string, string>;
	timezone: string;
	timezoneAbbreviations: Record<string, string>;
}

/**
 * Create a timestamp formatter based on a MediaWiki date format string.
 * @param format - MediaWiki date format.
 * @param options - Formatting options.
 * @returns Formatter function.
 */
function createTimestampFormatter(format: string, options: TimestampFormatterOptions): (date: Date) => string {
	const digits = options.digits && options.digits.length === 10 ? options.digits : null;
	const messages = options.messages ?? {};

	const monthGenKeys = [
		"january-gen",
		"february-gen",
		"march-gen",
		"april-gen",
		"may-gen",
		"june-gen",
		"july-gen",
		"august-gen",
		"september-gen",
		"october-gen",
		"november-gen",
		"december-gen",
	];
	const monthFullKeys = [
		"january",
		"february",
		"march",
		"april",
		"may_long",
		"june",
		"july",
		"august",
		"september",
		"october",
		"november",
		"december",
	];
	const monthShortKeys = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
	const dayShortKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
	const dayLongKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

	const monthGenNames = monthGenKeys.map((key) => messages[key] ?? DEFAULT_MESSAGES[key]);
	const monthNames = monthFullKeys.map((key) => messages[key] ?? DEFAULT_MESSAGES[key]);
	const monthShortNames = monthShortKeys.map((key) => messages[key] ?? DEFAULT_MESSAGES[key]);
	const dayShortNames = dayShortKeys.map((key) => messages[key] ?? DEFAULT_MESSAGES[key]);
	const dayLongNames = dayLongKeys.map((key) => messages[key] ?? DEFAULT_MESSAGES[key]);

	const localizeDigits = (value: string, rawNumbers: boolean): string => {
		if (rawNumbers || !digits) {
			return value;
		}
		return value.replace(/\d/g, (digit) => digits[Number(digit)] ?? digit);
	};

	const formatNumber = (value: number, padLength: number | null, rawNumbers: boolean): string => {
		const base = padLength != null ? value.toString().padStart(padLength, "0") : value.toString();
		return localizeDigits(base, rawNumbers);
	};

	const getTimezoneDisplay = (abbr: string): string => {
		for (const [display, normalized] of Object.entries(options.timezoneAbbreviations)) {
			if (normalized === abbr) {
				return display;
			}
		}
		const entries = Object.keys(options.timezoneAbbreviations);
		if (entries.length > 0) {
			return entries[0];
		}
		return abbr || "UTC";
	};

	return (date: Date): string => {
		const momentDate = moment(date).tz(options.timezone);
		let rawNumbers = false;
		let output = "";

		for (let i = 0; i < format.length; i++) {
			let code = format[i];
			if (code === "x" && i < format.length - 1) {
				code += format[++i];
			}
			if (code === "xk" && i < format.length - 1) {
				code += format[++i];
			}

			switch (code) {
				case "xx":
					output += "x";
					break;
				case "xg":
					output += monthGenNames[momentDate.month()] ?? "";
					break;
				case "xn":
					rawNumbers = true;
					break;
				case "d":
					output += formatNumber(momentDate.date(), 2, rawNumbers);
					rawNumbers = false;
					break;
				case "j":
					output += formatNumber(momentDate.date(), null, rawNumbers);
					rawNumbers = false;
					break;
				case "D":
					output += dayShortNames[momentDate.day()] ?? "";
					break;
				case "l":
					output += dayLongNames[momentDate.day()] ?? "";
					break;
				case "F":
					output += monthNames[momentDate.month()] ?? "";
					break;
				case "M":
					output += monthShortNames[momentDate.month()] ?? "";
					break;
				case "m":
					output += formatNumber(momentDate.month() + 1, 2, rawNumbers);
					rawNumbers = false;
					break;
				case "n":
					output += formatNumber(momentDate.month() + 1, null, rawNumbers);
					rawNumbers = false;
					break;
				case "Y":
					output += formatNumber(momentDate.year(), 4, rawNumbers);
					rawNumbers = false;
					break;
				case "xkY":
					output += formatNumber(momentDate.year() + 543, 4, rawNumbers);
					rawNumbers = false;
					break;
				case "G":
					output += formatNumber(momentDate.hour(), null, rawNumbers);
					rawNumbers = false;
					break;
				case "H":
					output += formatNumber(momentDate.hour(), 2, rawNumbers);
					rawNumbers = false;
					break;
				case "i":
					output += formatNumber(momentDate.minute(), 2, rawNumbers);
					rawNumbers = false;
					break;
				case "s":
					output += formatNumber(momentDate.second(), 2, rawNumbers);
					rawNumbers = false;
					break;
				case "\\":
					if (i < format.length - 1) {
						output += format[++i];
					} else {
						output += "\\";
					}
					break;
				case "\"": {
					if (i < format.length - 1) {
						const endQuote = format.indexOf("\"", i + 1);
						if (endQuote === -1) {
							output += "\"";
						} else {
							output += format.slice(i + 1, endQuote);
							i = endQuote;
						}
					} else {
						output += "\"";
					}
					break;
				}
				default: {
					const codePoint = format.codePointAt(i);
					if (codePoint != null) {
						const char = String.fromCodePoint(codePoint);
						output += char;
						i += char.length - 1;
					}
				}
			}
		}

		const timezoneDisplay = getTimezoneDisplay(momentDate.zoneAbbr());
		return `${output} (${timezoneDisplay})`;
	};
}

/**
 * Get compiled timestamp matchers from the parser data.
 * @returns Array of timestamp matchers or null if not available.
 */
function getTimestampMatchers(): TimestampMatcher[] | null {
	if (timestampMatchers) {
		return timestampMatchers;
	}
	const parserData = getParserData();
	if (!parserData) {
		return null;
	}

	const matchers: TimestampMatcher[] = [];
	Object.keys(parserData.dateFormat).forEach((variant) => {
		const format = parserData.dateFormat[variant];
		const digits = parserData.digits[variant];
		const tzAbbrs = parserData.timezones[variant];
		const messages = parserData.contLangMessages[variant];
		if (!format || !tzAbbrs) {
			return;
		}
		const digitsPattern = digits && digits.length > 0 ? `[${digits.map((digit) => escapeForCharacterClass(digit)).join("")}]` : "\\d";
		matchers.push({
			regex: new RegExp(
				getTimestampRegexp(format, {
					digitsPattern,
					timezoneAbbreviations: tzAbbrs,
					messages,
				}),
				"u"
			),
			parser: getTimestampParser(format, {
				digits: digits ?? null,
				timeZone: parserData.localTimezone,
				timezoneAbbreviations: tzAbbrs,
				messages,
			}),
		});
	});
	if (matchers.length === 0) {
		return null;
	}
	timestampMatchers = matchers;
	return timestampMatchers;
}

/**
 * Format a Date instance according to the wiki's signature format.
 * @param date - Date to format.
 * @returns Signature timestamp or ISO string fallback.
 */
function formatDateForSignature(date: Date): string {
	const formatter = getTimestampFormatter();
	if (formatter) {
		return formatter(date);
	}
	return date.toISOString();
}

/**
 * Parse a timestamp from the href attribute of an anchor element.
 * @param timestamp {HTMLElement} - Timestamp element.
 * @returns {null|string} - UTC string or null if parsing fails.
 */
function parseTimestampFromHref(timestamp: HTMLElement): string | null {
	const href = timestamp.getAttribute("href");
	const tsSegment = (href?.split("#")[1] ?? "").trim();
	if (!tsSegment.startsWith("c-")) {
		return null;
	}
	let extracted = (tsSegment.match(/-(\d{14})/) ?? [])[1];
	if (extracted) {
		return formatDateForSignature(parseUtc14(extracted));
	}
	extracted = (tsSegment.match(/-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z)/) ?? [])[1];
	if (extracted) {
		const date = new Date(extracted);
		return formatDateForSignature(date);
	}
	return null;
}

/**
 * Parse a 14-digit UTC date string into a Date object.
 * @param utc14 {string} - Example: 「20231015123456」.
 * @returns {Date} - Parsed Date instance.
 */
function parseUtc14(utc14: string): Date {
	// Extract year, month, day, hour, minute, and second from the string
	const year = Number(utc14.slice(0, 4));
	const month = Number(utc14.slice(4, 6)) - 1; // JavaScript months are 0-indexed
	const day = Number(utc14.slice(6, 8));
	const hour = Number(utc14.slice(8, 10));
	const minute = Number(utc14.slice(10, 12));
	const second = Number(utc14.slice(12, 14));

	// Create a Date object from UTC values
	return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * Parse a timestamp anchor and return its UTC string.
 * @param timestamp {HTMLElement} - Timestamp element.
 * @returns {null|string} - UTC string or null if parsing fails.
 */
export function parseTimestamp(timestamp: HTMLElement): string | null {
	const localTimestamp = timestamp.querySelector(".localcomments");
	if (localTimestamp) {
		const title = localTimestamp.getAttribute("title");
		if (title) {
			return title;
		}
	}
	const text = timestamp.textContent?.trim() ?? "";
	if (text) {
		const matchers = getTimestampMatchers();
		if (matchers) {
			for (const matcher of matchers) {
				const match = text.match(matcher.regex);
				if (!match) {
					continue;
				}
				const parsed = matcher.parser(match);
				if (!parsed) {
					continue;
				}
				return match[0];
			}
		}
	}

	const fallback = parseTimestampFromHref(timestamp);
	if (!fallback) {
		console.error("[Reaction] Unable to parse timestamp in:", timestamp);
	}
	return fallback;
}

/**
 * Normalize a wiki page title by collapsing whitespace and converting spaces to underscores.
 * @param title - Raw page title text.
 * @returns Normalized title string.
 */
export function normalizeTitle(title: string): string {
	return String(title ?? '').replace(/\s+/g, ' ').trim().replace(/ /g, '_');
}

/**
 * Encode a normalized wiki page title for use in URLs, keeping slashes/colons readable.
 * @param title - Normalized title.
 * @returns URL-safe title string.
 */
export function encodeTitle(title: string): string {
	return encodeURIComponent(title).replace(/%2F/g, '/').replace(/%3A/gi, ':');
}
