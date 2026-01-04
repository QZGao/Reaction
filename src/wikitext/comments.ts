import { normalizeTitle } from "../utils";

const SIGNATURE_SCAN_LIMIT = 255; // matches the on-wiki signature length guideline (255 bytes)
const USER_NAMESPACE_ID = 2;
const USER_TALK_NAMESPACE_ID = 3;
const SPECIAL_NAMESPACE_ID = -1;

type NamespaceMap = Record<string, number>;

/**
 * Retrieve the MediaWiki namespace ID map.
 * @returns Namespace ID map.
 */
function getNamespaceMap(): NamespaceMap {
	const map = mw.config.get("wgNamespaceIds");
	if (!map || typeof map !== "object") {
		return Object.create(null) as NamespaceMap;
	}
	return map as NamespaceMap;
}

/**
 * Get all namespace names for a given ID, including fallbacks.
 * @param targetId - Target namespace ID.
 * @param fallbacks - Fallback namespace names.
 * @returns Array of namespace names.
 */
function getNamespaceNames(targetId: number, fallbacks: string[]): string[] {
	const map = getNamespaceMap();
	const names = new Set<string>(fallbacks);
	for (const [name, id] of Object.entries(map)) {
		if (id === targetId) {
			names.add(name);
		}
	}
	return Array.from(names).filter((name) => name.trim().length > 0);
}

/**
 * Escape a namespace name for regex usage.
 * @param name - Namespace name.
 * @returns Escaped namespace name.
 */
function escapeNamespaceName(name: string): string {
	if (!name) {
		return "";
	}
	const normalized = name.trim();
	if (!normalized) {
		return "";
	}
	const placeholder = "\u0000";
	const collapsed = normalized.replace(/[ _]+/g, placeholder);
	const escaped = collapsed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return escaped.replace(new RegExp(placeholder, "g"), "[ _]");
}

/**
 * Build a regex pattern for a given namespace ID.
 * @param targetId - Target namespace ID.
 * @param fallbacks - Fallback namespace names.
 * @returns Regex pattern string.
 */
function buildNamespacePattern(targetId: number, fallbacks: string[]): string {
	const tokens = getNamespaceNames(targetId, fallbacks)
		.map((name) => escapeNamespaceName(name))
		.filter((token) => token.length > 0);
	if (tokens.length === 0) {
		return "";
	}
	// Longer tokens first so alternation prefers the most specific match.
	tokens.sort((a, b) => b.length - a.length);
	return `(?:${tokens.join("|")})`;
}

/**
 * Get possible localized names for the "Contributions" special page.
 * @returns Array of "Contributions" page names.
 */
function getContributionsNames(): string[] {
	const names = new Set<string>(["contributions"]);
	if (typeof mw.msg === "function") {
		const localized = mw.msg("contributions");
		if (localized && typeof localized === "string") {
			names.add(localized.trim());
		}
	}
	return Array.from(names).filter((name) => name.length > 0);
}

/**
 * Build a regex pattern for the "Contributions" special page.
 * @returns Regex pattern string.
 */
function buildContributionsPattern(): string {
	const names = getContributionsNames()
		.map((name) => escapeNamespaceName(name))
		.filter((token) => token.length > 0);
	if (names.length === 0) {
		return "";
	}
	names.sort((a, b) => b.length - a.length);
	return `(?:${names.join("|")})`;
}

let cachedUserLinkRegex: RegExp | null = null;
let cachedContributionLinkRegex: RegExp | null = null;

/**
 * Get the regex for matching user links.
 * @returns User link regex.
 */
function getUserLinkRegex(): RegExp {
	if (cachedUserLinkRegex) {
		return cachedUserLinkRegex;
	}
	const userPattern = buildNamespacePattern(USER_NAMESPACE_ID, ["user", "u"]);
	const talkPattern = buildNamespacePattern(USER_TALK_NAMESPACE_ID, ["user_talk", "user talk", "ut"]);
	const combined = [userPattern, talkPattern].filter(Boolean).join("|");
	const pattern =
		combined.length > 0
			? combined
			: "(?:user(?:[ _]talk)?)"; // fallback if namespace lookup fails entirely
	cachedUserLinkRegex = new RegExp(
		`\\[\\[\\s*(?:${pattern})\\s*:\\s*([^[\\]|#]+)(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`,
		"gi",
	);
	return cachedUserLinkRegex;
}

/**
 * Get the regex for matching contribution links.
 * @returns Contribution link regex.
 */
function getContributionLinkRegex(): RegExp {
	if (cachedContributionLinkRegex) {
		return cachedContributionLinkRegex;
	}
	const specialPattern = buildNamespacePattern(SPECIAL_NAMESPACE_ID, ["special"]);
	const contributionsPattern = buildContributionsPattern();
	if (!specialPattern || !contributionsPattern) {
		cachedContributionLinkRegex = new RegExp("a^", "g"); // never matches
		return cachedContributionLinkRegex;
	}
	const pattern = `\\[\\[\\s*(?:${specialPattern})\\s*:\\s*(?:${contributionsPattern})\\s*(?:\\/|%2F)([^|\\]#]+)(?:#[^|\\]]*)?(?:\\|[^\\]]*)?\\]\\]`;
	cachedContributionLinkRegex = new RegExp(pattern, "gi");
	return cachedContributionLinkRegex;
}

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
	const userLinkRegex = getUserLinkRegex();
	userLinkRegex.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = userLinkRegex.exec(snippet)) !== null) {
		const target = match[1] ?? "";
		if (target.includes("/")) {
			continue;
		}
		users.push(normalizeUserValue(target));
	}

	const contribRegex = getContributionLinkRegex();
	contribRegex.lastIndex = 0;
	while ((match = contribRegex.exec(snippet)) !== null) {
		const target = match[1] ?? "";
		if (target.includes("/")) {
			continue;
		}
		users.push(normalizeUserValue(target));
	}

	return users;
}

export interface CommentPositionSearchResult {
	position: number | null;
	reason?: string;
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
): CommentPositionSearchResult {
	const normalizedAuthor = author ? normalizeUserValue(author) : null;
	const pattern = new RegExp(escapeRegexLiteral(timestamp), "g");
	let match: RegExpExecArray | null;
	let matchIndex = 0;
	let totalMatches = 0;
	let matchesWithUsers = 0;
	let matchesWithMatchingAuthor = 0;
	while ((match = pattern.exec(wikitext)) !== null) {
		totalMatches++;
		const snippetStart = Math.max(0, match.index - SIGNATURE_SCAN_LIMIT);
		const snippet = wikitext.slice(snippetStart, match.index);
		const users = collectLinkedUsers(snippet);
		if (users.length === 0) {
			continue;
		}
		matchesWithUsers++;
		if (normalizedAuthor && !users.includes(normalizedAuthor)) {
			continue;
		}
		matchesWithMatchingAuthor++;
		if (occurrence != null) {
			if (matchIndex === occurrence) {
				return { position: match.index };
			}
			matchIndex++;
			continue;
		}
		return { position: match.index };
	}
	if (totalMatches === 0) {
		return { position: null, reason: "timestamp not found in wikitext" };
	}
	if (matchesWithUsers === 0) {
		return {
			position: null,
			reason: `timestamp found ${totalMatches} time(s) but no recognizable user links within ${SIGNATURE_SCAN_LIMIT} characters before it`,
		};
	}
	if (normalizedAuthor && matchesWithMatchingAuthor === 0) {
		return {
			position: null,
			reason: `timestamp found but none of the signatures matched author "${normalizedAuthor}"`,
		};
	}
	if (occurrence != null) {
		return {
			position: null,
			reason: `timestamp occurrence ${occurrence} not found (matched ${matchIndex} occurrence(s))`,
		};
	}
	return {
		position: null,
		reason: "timestamp matched signatures but no exact position could be determined",
	};
}
