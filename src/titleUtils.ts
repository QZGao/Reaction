/**
 * Normalize a wiki page title by collapsing whitespace and converting spaces to underscores.
 * @param title - Raw page title text.
 * @returns Normalized title string.
 */
export function normalizeTitle(title: string): string {
	return String(title ?? "").replace(/\s+/g, " ").trim().replace(/ /g, "_");
}

/**
 * Encode a normalized wiki page title for use in URLs, keeping slashes/colons readable.
 * @param title - Normalized title.
 * @returns URL-safe title string.
 */
export function encodeTitle(title: string): string {
	return encodeURIComponent(title).replace(/%2F/g, "/").replace(/%3A/gi, ":");
}
