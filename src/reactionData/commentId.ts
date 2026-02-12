import { normalizeTitle } from "../utils";

const COMMENT_ID_PATTERN = /^c-(?<owner>.+?)-(?<ts>\d{14})(?:-|$)/;
const DATABASE_TITLE_PREFIX = "Wikipedia:Reactions/data";

export interface ParsedCommentId {
	owner: string;
	monthKey: string;
	timestamp: string;
}

/**
 * Parse a DiscussionTools comment id into owner and month key.
 * @param commentId - DiscussionTools comment id.
 * @returns Parsed comment id metadata or null when malformed.
 */
export function parseCommentIdForDatabase(commentId: string): ParsedCommentId | null {
	const match = commentId.match(COMMENT_ID_PATTERN);
	if (!match?.groups) {
		return null;
	}
	const owner = normalizeTitle(match.groups.owner ?? "");
	const timestamp = match.groups.ts ?? "";
	if (!owner || timestamp.length !== 14) {
		return null;
	}
	return {
		owner,
		monthKey: timestamp.slice(0, 6),
		timestamp,
	};
}

/**
 * Build the centralized database page title for a parsed comment id.
 * @param parsed - Parsed comment id metadata.
 * @returns Database page title.
 */
export function buildDatabaseTitle(parsed: ParsedCommentId): string {
	return `${DATABASE_TITLE_PREFIX}/${parsed.owner}/${parsed.monthKey}`;
}

/**
 * Resolve the centralized database page title for a comment id.
 * @param commentId - DiscussionTools comment id.
 * @returns Database page title or null when malformed.
 */
export function resolveDatabaseTitleFromCommentId(commentId: string): string | null {
	const parsed = parseCommentIdForDatabase(commentId);
	if (!parsed) {
		return null;
	}
	return buildDatabaseTitle(parsed);
}

