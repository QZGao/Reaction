import moment from "moment-timezone";
import type { Moment } from "moment-timezone";
import type { TimestampParserFn } from "./wikitext/timestamps";
import { DEFAULT_MESSAGES, getTimestampParser, getTimestampRegexp } from "./wikitext/timestamps";
import { encodeTitle, normalizeTitle } from "./titleUtils";

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
let cachedFormatMetadata: TimestampFormatMetadata | null = null;
let timestampRenderer: ((momentDate: Moment) => string) | null = null;

interface TimestampFormatMetadata {
	format: string;
	digits: string[] | null;
	messages: Record<string, string>;
	timezone: string;
	timezoneAbbreviations: Record<string, string>;
}

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
	const metadata = getTimestampFormatMetadata();
	const renderer = getTimestampRenderer();
	if (!metadata || !renderer) {
		return null;
	}
	timestampFormatter = (date: Date): string => {
		const momentDate = moment(date).tz(metadata.timezone);
		const timezoneDisplay = getTimezoneDisplay(momentDate.zoneAbbr(), metadata.timezoneAbbreviations);
		return `${renderer(momentDate)} (${timezoneDisplay})`;
	};
	return timestampFormatter;
}

/**
 * Retrieve cached timestamp format metadata.
 * @returns Metadata or null if unavailable.
 */
function getTimestampFormatMetadata(): TimestampFormatMetadata | null {
	if (cachedFormatMetadata) {
		return cachedFormatMetadata;
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
	const tzAbbrs = parserData.timezones[variant];
	if (!format || !tzAbbrs) {
		return null;
	}
	cachedFormatMetadata = {
		format,
		digits: parserData.digits[variant] ?? null,
		messages: parserData.contLangMessages[variant] ?? {},
		timezone: parserData.localTimezone,
		timezoneAbbreviations: tzAbbrs,
	};
	return cachedFormatMetadata;
}

/**
 * Retrieve cached timestamp renderer.
 * @returns Renderer function or null if unavailable.
 */
function getTimestampRenderer(): ((momentDate: Moment) => string) | null {
	if (timestampRenderer) {
		return timestampRenderer;
	}
	const metadata = getTimestampFormatMetadata();
	if (!metadata) {
		return null;
	}
	timestampRenderer = createTimestampPatternRenderer(metadata.format, metadata.digits, metadata.messages);
	return timestampRenderer;
}

/**
 * Create a timestamp pattern renderer function.
 * @param format - Timestamp format string.
 * @param digitMap - Localized digits or null.
 * @param messages - Localization messages.
 * @returns Renderer function.
 */
function createTimestampPatternRenderer(
	format: string,
	digitMap: string[] | null,
	messages: Record<string, string>,
): (momentDate: Moment) => string {
	const localizedDigits = digitMap && digitMap.length === 10 ? digitMap : null;
	const messageOverrides = messages ?? {};

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

	const monthGenNames = monthGenKeys.map((key) => messageOverrides[key] ?? DEFAULT_MESSAGES[key]);
	const monthNames = monthFullKeys.map((key) => messageOverrides[key] ?? DEFAULT_MESSAGES[key]);
	const monthShortNames = monthShortKeys.map((key) => messageOverrides[key] ?? DEFAULT_MESSAGES[key]);
	const dayShortNames = dayShortKeys.map((key) => messageOverrides[key] ?? DEFAULT_MESSAGES[key]);
	const dayLongNames = dayLongKeys.map((key) => messageOverrides[key] ?? DEFAULT_MESSAGES[key]);

	const localizeDigits = (value: string, rawNumbers: boolean): string => {
		if (rawNumbers || !localizedDigits) {
			return value;
		}
		return value.replace(/\d/g, (digit) => localizedDigits[Number(digit)] ?? digit);
	};

	const formatNumber = (value: number, padLength: number | null, rawNumbers: boolean): string => {
		const base = padLength != null ? value.toString().padStart(padLength, "0") : value.toString();
		return localizeDigits(base, rawNumbers);
	};

	return (momentDate: Moment): string => {
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

		return output;
	};
}

/**
 * Get the display form of a timezone abbreviation.
 * @param abbr - Timezone abbreviation.
 * @param timezoneAbbreviations - Mapping of display to normalized abbreviations.
 * @returns Display form of the abbreviation.
 */
function getTimezoneDisplay(abbr: string, timezoneAbbreviations: Record<string, string>): string {
	for (const [display, normalized] of Object.entries(timezoneAbbreviations)) {
		if (normalized === abbr) {
			return display;
		}
	}
	const entries = Object.keys(timezoneAbbreviations);
	if (entries.length > 0) {
		return entries[0];
	}
	return abbr || "UTC";
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
export function formatDateForSignature(date: Date): string {
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
 * Parse a localized signature timestamp string into a Date.
 * @param timestampText - Timestamp text content.
 * @returns Parsed Date or null.
 */
export function parseSignatureTimestampText(timestampText: string): Date | null {
	if (!timestampText) {
		return null;
	}
	const matchers = getTimestampMatchers();
	if (!matchers) {
		return null;
	}
	for (const matcher of matchers) {
		const match = timestampText.match(matcher.regex);
		if (!match) {
			continue;
		}
		const parsed = matcher.parser(match);
		if (parsed?.date) {
			return parsed.date;
		}
	}
	return null;
}

/**
 * Retrieve the user's timezone offset preference from MediaWiki settings.
 * @param referenceDate - Date for evaluating DST-aware offsets.
 * @returns Offset in minutes from UTC or null if unavailable.
 */
export function getUserTimezoneOffsetMinutes(referenceDate?: Date): number | null {
	const correctionRaw: unknown = mw.user.options.get("timecorrection");
	const correctionString = typeof correctionRaw === "string" ? correctionRaw : null;
	const correctionOffset = correctionString ? getOffsetFromTimeCorrection(correctionString, referenceDate) : null;
	const timezonePref = resolveUserTimezoneName();
	const timezoneOffset = timezonePref ? getOffsetFromTimezoneName(timezonePref, referenceDate) : null;
	const finalOffset = correctionOffset ?? timezoneOffset ?? 0;
	return finalOffset;
}

/**
 * Parse a timezone offset expression into minutes.
 * @param expression - Offset expression (e.g. "+5:30", "-120", "3").
 * @returns Offset in minutes or null if parsing fails.
 */
function parseOffsetMinutes(expression: string): number | null {
	const trimmed = expression.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.includes(":")) {
		const match = trimmed.match(/^([+-]?)(\d{1,2}):(\d{2})$/);
		if (!match) {
			return null;
		}
		const sign = match[1] === "-" ? -1 : 1;
		const hours = Number(match[2]);
		const minutes = Number(match[3]);
		if (minutes >= 60) {
			return null;
		}
		return sign * (hours * 60 + minutes);
	}
	const numeric = Number(trimmed);
	if (!Number.isNaN(numeric)) {
		return numeric;
	}
	return null;
}

/**
 * Format a UTC offset in minutes into a display label.
 * @param offsetMinutes - Offset in minutes.
 * @returns Formatted label (e.g. "UTC+5:30").
 */
function formatUtcOffsetLabel(offsetMinutes: number): string {
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absolute = Math.abs(offsetMinutes);
	const hours = Math.floor(absolute / 60);
	const minutes = absolute % 60;
	if (minutes === 0) {
		return `UTC${sign}${hours}`;
	}
	return `UTC${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Format a Date with a specific UTC offset.
 * @param date - Date to format.
 * @param offsetMinutes - Offset in minutes from UTC.
 * @returns Formatted timestamp string or null if formatting fails.
 */
function formatDateWithOffset(date: Date, offsetMinutes: number): string | null {
	const renderer = getTimestampRenderer();
	if (!renderer) {
		return null;
	}
	const momentDate = moment(date).utcOffset(offsetMinutes);
	const timezoneDisplay = formatUtcOffsetLabel(offsetMinutes);
	return `${renderer(momentDate)} (${timezoneDisplay})`;
}

/**
 * Convert a signature timestamp to the user's preferred timezone, when available.
 * @param timestamp - Raw signature timestamp text.
 * @returns Localized timestamp string.
 */
export function convertTimestampToUserTimezone(timestamp: string): string {
	const parsedDate = parseSignatureTimestampText(timestamp);
	if (!parsedDate) {
		return timestamp;
	}
	const offsetMinutes = getUserTimezoneOffsetMinutes(parsedDate);
	if (!offsetMinutes) {
		return timestamp;
	}
	const localized = formatDateWithOffset(parsedDate, offsetMinutes);
	return localized ?? timestamp;
}

/**
 * Get the user's time correction offset from MediaWiki settings.
 * @param referenceDate - Date for evaluating DST-aware offsets.
 * @returns Offset in minutes or null if unavailable.
 */
function getOffsetFromTimeCorrection(correctionValue: string, referenceDate?: Date): number | null {
	const correction = correctionValue.trim();
	if (!correction || correction.toLowerCase() === "default") {
		return null;
	}
	const [modeRaw, ...rest] = correction.split("|");
	const mode = (modeRaw ?? "").toLowerCase();
	const values = rest.map((value) => value.trim()).filter((value) => value.length > 0);

	if (mode === "zoneinfo") {
		const timezoneCandidate = values.find((value) => parseOffsetMinutes(value) === null) ?? null;
		if (timezoneCandidate) {
			const normalized = normalizeTimezoneCandidate(timezoneCandidate);
			for (const candidate of normalized) {
				const offset = getOffsetFromTimezoneName(candidate, referenceDate);
				if (offset !== null) {
					return offset;
				}
			}
		}
		const fallback = values.find((value) => parseOffsetMinutes(value) !== null);
		if (fallback) {
			const parsed = parseOffsetMinutes(fallback);
			if (parsed !== null) {
				return parsed;
			}
		}
		return null;
	}

	if (mode === "offset") {
		for (const value of values) {
			const parsed = parseOffsetMinutes(value);
			if (parsed !== null) {
				return parsed;
			}
		}
		return null;
	}

	for (const candidate of [...values, correction]) {
		const parsed = parseOffsetMinutes(candidate);
		if (parsed !== null) {
			return parsed;
		}
		const normalized = normalizeTimezoneCandidate(candidate);
		for (const name of normalized) {
			const offset = getOffsetFromTimezoneName(name, referenceDate);
			if (offset !== null) {
				return offset;
			}
		}
	}
	return null;
}

/**
 * Resolve the user's timezone name preference from MediaWiki settings.
 * @returns Timezone name or null if not set.
 */
function resolveUserTimezoneName(): string | null {
	const tz = mw.config.get("wgUserTimezone");
	if (typeof tz === "string") {
		const normalized = tz.trim();
		if (!normalized || normalized.toLowerCase() === "default") {
			return null;
		}
		if (normalized.toLowerCase() === "system" || normalized.toLowerCase() === "local") {
			const guessed = moment.tz.guess();
			return guessed || null;
		}
		return normalized;
	}
	return null;
}

/**
 * Get the offset in minutes from a timezone name.
 * @param timezone - Timezone name.
 * @param referenceDate - Date for evaluating DST-aware offsets.
 * @returns Offset in minutes or null if unavailable.
 */
function getOffsetFromTimezoneName(timezone: string, referenceDate?: Date): number | null {
	if (!timezone) {
		return null;
	}
	const numeric = parseOffsetMinutes(timezone);
	if (numeric !== null) {
		return numeric;
	}
	const candidates = [timezone];
	const underscoreCandidate = timezone.replace(/_/g, "/");
	if (underscoreCandidate !== timezone) {
		candidates.push(underscoreCandidate);
	}
	for (const candidate of candidates) {
		try {
			const base = referenceDate ? moment(referenceDate) : moment();
			const zoned = base.tz(candidate);
			const offset = zoned.utcOffset();
			if (Number.isFinite(offset)) {
				return offset;
			}
		} catch {
			// Continue trying other candidates.
		}
	}
	return null;
}

/**
 * Normalize a timezone candidate by generating variants.
 * @param value - Raw timezone string.
 * @returns Array of normalized timezone candidates.
 */
function normalizeTimezoneCandidate(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	const variants = new Set<string>([trimmed]);
	if (trimmed.includes("_")) {
		variants.add(trimmed.replace(/_/g, "/"));
	}
	return Array.from(variants);
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

export { normalizeTitle, encodeTitle };
