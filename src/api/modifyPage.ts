import state from "../state";
import { escapeRegex, getCurrentSignatureTimestamp } from "../utils";
import { t, tReaction } from "../i18n";
import { retrieveFullText, saveFullText } from "./client";
import { addReactionToLine, appendReactionTemplate, removeReactionFromLine } from "../wikitext/reactionTemplates";

export interface ModifyPageRequest {
	timestamp: string;
	upvote?: string;
	downvote?: string;
	append?: string;
	remove?: string;
}

interface PageModificationResult {
	fulltext: string;
	summary: string;
}

/**
 * Apply the requested modification to an existing page text.
 * @param fulltext - Current page text.
 * @param mod - Modification instructions.
 * @returns Modified text plus edit summary.
 */
export function applyPageModification(fulltext: string, mod: ModifyPageRequest): PageModificationResult {
	const timestampRegex = new RegExp(`${escapeRegex(mod.timestamp)}`, "g");
	const timestampMatch = fulltext.match(timestampRegex);
	if (!timestampMatch || timestampMatch.length === 0) {
		console.log("[Reaction] Unable to find timestamp " + mod.timestamp + " in: " + fulltext);
		throw new Error(tReaction("api.errors.timestamp_missing", [mod.timestamp]));
	}
	if (timestampMatch.length > 1) {
		console.log("[Reaction] More than one timestamp found: " + timestampMatch.join(", "));
		throw new Error(tReaction("api.errors.timestamp_conflict", [mod.timestamp]));
	}

	const pos = fulltext.search(timestampRegex);
	let lineEnd = fulltext.indexOf("\n", pos);
	if (lineEnd === -1) {
		lineEnd = fulltext.length;
	}
	let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
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

	const newFulltext = fulltext.slice(0, pos) + timestamp2LineEnd + fulltext.slice(lineEnd);
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
	} catch (error) {
		console.error(error);
		mw.notify(tReaction("api.notifications.fetch_failure"), { title: t("default.titles.error"), type: "error" });
		return false;
	}

	try {
		console.log("[Reaction] Applying page modification:", mod);
		const { fulltext: newFulltext, summary } = applyPageModification(fulltext, mod);
		return await saveFullText(newFulltext, summary);
	} catch (error: unknown) {
		console.error(error);
		const message = error instanceof Error ? error.message : String(error);
		mw.notify(message, { title: t("default.titles.error"), type: "error" });
		return false;
	}
}
