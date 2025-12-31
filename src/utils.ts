import state from "./state";

/**
 * Regex that matches the Chinese-formatted UTC timestamp string.
 * @type {string}
 * @constant
 */
const chineseUtcRegex = `\\d{4}年\\d{1,2}月\\d{1,2}日 \\([日一二三四五六]\\) \\d{1,2}:\\d{2} \\(UTC\\)`;

/**
 * Escape special characters inside a string.
 * @param string {String} - Raw string.
 * @returns {String} - Escaped string.
 */
export function escapeRegex(string: string): string {
	return mw.util.escapeRegExp(string);
}

/**
 * Regex snippet that captures an optional "於/于" followed by the UTC timestamp.
 * @returns {string}
 * @constant
 */
export function atChineseUtcRegex() {
	return "(?:|[於于]" + chineseUtcRegex + ")";
}

/**
 * Regex that matches the current user name followed by an optional Chinese UTC timestamp.
 * Example: 「Username於2023年10月15日 (日) 12:34 (UTC)」.
 * @returns {string}
 * @constant
 */
export function userNameAtChineseUtcRegex() {
	return escapeRegex(state.userName || "") + atChineseUtcRegex();
}

/**
 * Get the current timestamp formatted in the Chinese UTC style.
 * @returns {string} - Example: 「2023年10月15日 (日) 12:34 (UTC)」.
 */
export function getCurrentChineseUtc() {
	const date = new Date();
	return dateToChineseUtc(date);
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
 * Convert a 14-digit UTC timestamp into the Chinese UTC string.
 * @param utc14 {string} - Example: 「20231015123456」.
 * @returns {string} - Example: 「2023年10月15日 (日) 12:34 (UTC)」.
 */
function utc14ToChineseUtc(utc14: string): string {
	const date = parseUtc14(utc14);
	return dateToChineseUtc(date);
}

/**
 * Format a Date object into the Chinese UTC string.
 * @param date {Date} - Source date.
 * @returns {string} - Example: 「2023年10月15日 (日) 12:34 (UTC)」.
 */
function dateToChineseUtc(date: Date): string {
	return date.getUTCFullYear() + "年" + (date.getUTCMonth() + 1) + "月" + date.getUTCDate() + "日 (" + [
		"日", "一", "二", "三", "四", "五", "六",
	][date.getUTCDay()] + ") " + date.getUTCHours().toString().padStart(2, "0") + ":" + date.getUTCMinutes().toString().padStart(2, "0") + " (UTC)";
}

/**
 * Parse a timestamp anchor and return its UTC string.
 * @param timestamp {HTMLElement} - Timestamp element.
 * @returns {null|string} - UTC string or null if parsing fails.
 */
export function parseTimestamp(timestamp: HTMLElement): string | null {
	let utcTimestamp = timestamp.querySelector(".localcomments");
	if (utcTimestamp) {
		return utcTimestamp.getAttribute("title");
	} else {
		let href = timestamp.getAttribute("href");
		let ts_s = (href?.split('#')[1] || '');
		if (ts_s.startsWith('c-')) {
			// Format #1: c-<user>-yyyymmddhhmmss00-<section> or c-<user>-yyyymmddhhmmss00-<user>-yyyymmddhhmmss00
			let ts = (ts_s.match(/-(\d{14})/) || [])[1];
			if (ts) {
				return utc14ToChineseUtc(ts);
			}
			// Format #2: c-<user>-yyyy-mm-ddThh:mm:ss.000Z-<section> or c-<user>-yyyy-mm-ddThh:mm:ss.000Z-<user>-yyyy-mm-ddThh:mm:ss.000Z
			ts = (ts_s.match(/-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z)/) || [])[1];
			if (ts) {
				let date = new Date(ts);
				return dateToChineseUtc(date);
			}
		}
		console.error("[Reaction] Unable to parse timestamp in: " + href);
		return null;
	}
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
