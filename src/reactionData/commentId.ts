import { normalizeTitle } from "../utils";

const COMMENT_ID_PATTERN = /^c-(?<owner>.+?)-(?<ts>\d{14})(?:-|$)/;
const DEFAULT_PROJECT_NAMESPACE = "Project";

export interface ParsedCommentId {
	owner: string;
	monthKey: string;
	timestamp: string;
}

/**
 * Resolve local project namespace prefix (namespace 4) from MediaWiki config.
 * @returns Normalized project namespace name.
 */
export function resolveProjectNamespacePrefix(): string {
	const mwGlobal = (globalThis as { mw?: typeof mw }).mw;
	const rawMap = mwGlobal?.config?.get("wgFormattedNamespaces");
	if (rawMap && typeof rawMap === "object") {
		const map = rawMap as Record<string, unknown>;
		const value = map["4"];
		if (typeof value === "string" && value.trim().length > 0) {
			return normalizeTitle(value);
		}
	}
	return DEFAULT_PROJECT_NAMESPACE;
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
	const projectNamespace = resolveProjectNamespacePrefix();
	return `${projectNamespace}:Reactions/data/${parsed.owner}/${parsed.monthKey}`;
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
