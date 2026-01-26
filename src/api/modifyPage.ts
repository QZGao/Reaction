import state from "../state";
import { getCurrentSignatureTimestamp, normalizeTitle } from "../utils";
import { t, tReaction } from "../i18n";
import { retrieveFullText, saveFullText } from "./client";
import { addReactionToLine, appendReactionTemplate, removeReactionFromLine } from "../wikitext/reactionTemplates";
import { findCommentPosition } from "../wikitext/comments";
import {
	getDiscussionToolsLookup,
	formatSignatureTimestamp,
	type DiscussionToolsLookup,
	type ThreadCommentMetadata,
} from "./discussionTools";

export interface ModifyPageRequest {
	timestamp: string;
	author?: string | null;
	commentId?: string | null;
	commentName?: string | null;
	commentAuthor?: string | null;
	commentTimestamp?: string | null;
	timestampOccurrence?: number | null;
	upvote?: string;
	downvote?: string;
	append?: string;
	remove?: string;
}

interface PageModificationResult {
	fulltext: string;
	summary: string;
}

interface ResolvedCommentContext {
	timestamp?: string | null;
	author?: string | null;
	occurrence?: number | null;
}

/**
 * Normalize a user identifier by normalizing the title.
 * @param value - User identifier.
 * @returns Normalized user identifier or null.
 */
function normalizeUserIdentifier(value?: string | null): string | null {
	if (!value) {
		return null;
	}
	return normalizeTitle(value);
}

/**
 * Select the fallback timestamp from the modification request.
 * @param mod - Modification request.
 * @returns Selected timestamp.
 */
function selectTimestampFallback(mod: ModifyPageRequest): string {
	return formatSignatureTimestamp(mod.commentTimestamp ?? undefined) ?? mod.timestamp;
}

/**
 * Find the matching comment in the DiscussionTools lookup.
 * @param lookup - DiscussionTools comment lookup.
 * @param mod - Modification request.
 * @returns Matching comment metadata or null.
 */
function findLookupComment(lookup: DiscussionToolsLookup, mod: ModifyPageRequest): ThreadCommentMetadata | null {
	if (mod.commentId) {
		const comment = lookup.byId.get(mod.commentId);
		if (comment) {
			return comment;
		}
	}
	if (mod.commentName) {
		const byName = lookup.comments.find((entry) => entry.name === mod.commentName);
		if (byName) {
			return byName;
		}
	}
	const isoTimestamp = mod.commentTimestamp ?? null;
	if (isoTimestamp) {
		const entries = lookup.byTimestamp.get(isoTimestamp);
		if (entries && entries.length > 0) {
			if (entries.length === 1) {
				return entries[0];
			}
			const normalized = normalizeUserIdentifier(mod.commentAuthor ?? mod.author ?? null);
			if (normalized) {
				const matched = entries.find((entry) => entry.author === normalized);
				if (matched) {
					return matched;
				}
			}
			return entries[0];
		}
	}
	return null;
}

/**
 * Compute the occurrence index of a comment with the same timestamp.
 * @param lookup - DiscussionTools comment lookup.
 * @param target - Target comment metadata.
 * @returns Occurrence index or null.
 */
function computeTimestampOccurrence(
	lookup: DiscussionToolsLookup,
	target: ThreadCommentMetadata,
): number | null {
	if (!target.signatureTimestamp) {
		return null;
	}
	let occurrence = 0;
	for (const comment of lookup.comments) {
		if (comment.signatureTimestamp !== target.signatureTimestamp) {
			continue;
		}
		if (comment.id === target.id) {
			return occurrence;
		}
		occurrence++;
	}
	return null;
}

/**
 * Resolve the comment context for the modification request.
 * @param mod - Modification request.
 * @returns Resolved comment context or null.
 */
async function resolveCommentContext(mod: ModifyPageRequest): Promise<ResolvedCommentContext | null> {
	try {
		const lookup = await getDiscussionToolsLookup({ fresh: true });
		if (!lookup) {
			return null;
		}
		const comment = findLookupComment(lookup, mod);
		if (!comment) {
			return null;
		}
		return {
			timestamp: comment.signatureTimestamp ?? formatSignatureTimestamp(comment.timestamp),
			author: comment.authorText ?? comment.author ?? null,
			occurrence: computeTimestampOccurrence(lookup, comment),
		};
	} catch (error: unknown) {
		console.error(
			"[Reaction] Failed to resolve DiscussionTools comment context.",
			error instanceof Error ? error : String(error),
		);
		return null;
	}
}

/**
 * Apply the requested modification to an existing page text.
 * @param fulltext - Current page text.
 * @param mod - Modification instructions.
 * @returns Modified text plus edit summary.
 */
export function applyPageModification(fulltext: string, mod: ModifyPageRequest): PageModificationResult {
	const locateResult = findCommentPosition(
		fulltext,
		mod.timestamp,
		mod.author ?? null,
		mod.timestampOccurrence ?? null,
	);
	const position = locateResult.position;
	if (position === null) {
		const reason = locateResult.reason ? ` Reason: ${locateResult.reason}.` : "";
		console.error(`[Reaction] Unable to locate timestamp ${mod.timestamp}.${reason}`);
		const baseMessage = tReaction("api.errors.timestamp_missing", [mod.timestamp]);
		const errorMessage = locateResult.reason ? locateResult.reason : baseMessage;
		throw new Error(errorMessage);
	}

	let lineEnd = fulltext.indexOf("\n", position);
	if (lineEnd === -1) {
		lineEnd = fulltext.length;
	}
	let timestamp2LineEnd = fulltext.slice(position, lineEnd);
	let summary = "";

	if (mod.remove) {
		const result = removeReactionFromLine(timestamp2LineEnd, mod.remove, state.userName);
		timestamp2LineEnd = result.text;
		if (result.modified) {
			summary = "− " + mod.remove;
		}
	} else if (mod.downvote) {
		const result = removeReactionFromLine(timestamp2LineEnd, mod.downvote, state.userName);
		timestamp2LineEnd = result.text;
		if (result.modified) {
			summary = "− " + mod.downvote;
		}
	} else if (mod.upvote) {
		const result = addReactionToLine(timestamp2LineEnd, mod.upvote, state.userName, getCurrentSignatureTimestamp());
		timestamp2LineEnd = result.text;
		if (result.modified) {
			summary = "+ " + mod.upvote;
		}
	} else if (mod.append) {
		const result = appendReactionTemplate(timestamp2LineEnd, mod.append, state.userName, getCurrentSignatureTimestamp());
		if (!result.modified) {
			console.log("[Reaction] Reaction of " + mod.append + " already exists in: " + timestamp2LineEnd);
			throw new Error(tReaction("api.errors.reaction_exists"));
		}
		timestamp2LineEnd = result.text;
		summary = "+ " + mod.append;
	}

	const newFulltext = fulltext.slice(0, position) + timestamp2LineEnd + fulltext.slice(lineEnd);
	if (newFulltext === fulltext) {
		console.log("[Reaction] Nothing is modified. Could be because using a template inside {{Reaction}}.");
		throw new Error(tReaction("api.errors.no_changes"));
	}

	return { fulltext: newFulltext, summary };
}

/**
 * Modify the page content according to the requested change set.
 * @param mod - Fields describing the change (timestamp plus upvote/downvote/append/remove instructions).
 * @returns Promise indicating success.
 */
export async function modifyPage(mod: ModifyPageRequest): Promise<boolean> {
	let fulltext: string;
	try {
		fulltext = await retrieveFullText();
	} catch (error: unknown) {
		console.error(error instanceof Error ? error : String(error));
		mw.notify(tReaction("api.notifications.fetch_failure"), { title: t("default.titles.error"), type: "error" });
		return false;
	}

	try {
		console.log("[Reaction] Applying page modification:", mod);
		const resolved = await resolveCommentContext(mod);
		const resolvedTimestamp = resolved?.timestamp ?? selectTimestampFallback(mod);
		const resolvedAuthor = resolved?.author ?? mod.commentAuthor ?? mod.author ?? null;
		const enrichedMod: ModifyPageRequest = {
			...mod,
			timestamp: resolvedTimestamp,
			author: resolvedAuthor,
			timestampOccurrence: resolved?.occurrence ?? null,
		};
		const { fulltext: newFulltext, summary } = applyPageModification(fulltext, enrichedMod);
		return await saveFullText(newFulltext, summary);
	} catch (error: unknown) {
		console.error(error instanceof Error ? error : String(error));
		const message = error instanceof Error ? error.message : String(error);
		mw.notify(message, { title: t("default.titles.error"), type: "error" });
		return false;
	}
}
