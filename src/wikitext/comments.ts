import { normalizeTitle } from "../utils";

const SIGNATURE_SCAN_LIMIT = 100;

/**
 * Escape special characters in a string for use in a regular expression.
 * @param text - Input string.
 * @returns Escaped string safe for regex usage.
 */
function escapeRegexLiteral(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a user identifier for consistent matching.
 * @param value - User identifier.
 * @returns Normalized user identifier.
 */
function normalizeUserValue(value: string): string {
	const normalized = normalizeTitle(value.replace(/_/g, " "));
	return normalized.toLowerCase();
}

/**
 * Collect normalized usernames linked in a wikitext snippet.
 * @param snippet - Wikitext snippet.
 * @returns Array of normalized usernames.
 */
function collectLinkedUsers(snippet: string): string[] {
	const users: string[] = [];
	const userLinkRegex = /\[\[\s*(User(?:[ _]talk)?):([^[\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/gi;
	let match: RegExpExecArray | null;
	while ((match = userLinkRegex.exec(snippet)) !== null) {
		const target = match[2] ?? "";
		if (target.includes("/")) {
			continue;
		}
		users.push(normalizeUserValue(target));
	}

	const contribRegex = /\[\[\s*Special:Contributions(?:\/|%2F)([^|\]#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/gi;
	while ((match = contribRegex.exec(snippet)) !== null) {
		const user = match[1] ?? "";
		if (user.includes("/")) {
			continue;
		}
		users.push(normalizeUserValue(user));
	}

	return users;
}

/**
 * Locate the character offset of a specific signed comment occurrence.
 * @param wikitext - Full page wikitext.
 * @param timestamp - Timestamp string to locate.
 * @param author - Optional normalized author name for stricter matching.
 * @param occurrence - Zero-based occurrence index for the timestamp.
 * @returns Character offset of the timestamp or null if not found.
 */
export function findCommentPosition(
	wikitext: string,
	timestamp: string,
	author?: string | null,
	occurrence?: number | null,
): number | null {
	const normalizedAuthor = author ? normalizeUserValue(author) : null;
	const pattern = new RegExp(escapeRegexLiteral(timestamp), "g");
	let match: RegExpExecArray | null;
	let matchIndex = 0;
	while ((match = pattern.exec(wikitext)) !== null) {
		const snippetStart = Math.max(0, match.index - SIGNATURE_SCAN_LIMIT);
		const snippet = wikitext.slice(snippetStart, match.index);
		const users = collectLinkedUsers(snippet);
		if (users.length === 0) {
			continue;
		}
		if (normalizedAuthor && !users.includes(normalizedAuthor)) {
			continue;
		}
		if (occurrence != null) {
			if (matchIndex === occurrence) {
				return match.index;
			}
			matchIndex++;
			continue;
		}
		return match.index;
	}
	return null;
}
