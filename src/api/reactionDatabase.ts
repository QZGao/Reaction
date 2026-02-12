import state from "../state";
import { getCurrentSignatureTimestamp } from "../utils";
import { t, tReaction } from "../i18n";
import {
	mutateReactionEntryForComment,
	type ReactionEntry,
	type ReactionMutationRequest,
} from "../reactionData/store";

export interface ModifyReactionRequest {
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

export interface ModifyReactionResult {
	success: boolean;
	readOnly: boolean;
	reason?: string;
	entry?: ReactionEntry | null;
}

/**
 * Map mutation reason to user-visible message.
 * @param reason - Mutation failure reason.
 * @returns Localized message.
 */
function toFailureMessage(reason?: string): string {
	switch (reason) {
		case "reaction_exists":
			return tReaction("api.errors.reaction_exists");
		case "no_changes":
			return tReaction("api.errors.no_changes");
		case "malformed_comment_id":
			return tReaction("api.errors.timestamp_missing", ["comment-id"]);
		case "database_wrapper_invalid":
		case "database_json_invalid":
		case "database_version_unsupported":
		case "database_load_failed":
		case "database_write_readonly":
			return "[Reaction] Reaction database page is read-only or invalid.";
		default:
			return tReaction("api.notifications.save_failure");
	}
}

/**
 * Convert UI modification request into storage mutation request.
 * @param mod - UI-level request.
 * @returns Mutation request or null when invalid.
 */
function buildMutationRequest(mod: ModifyReactionRequest): ReactionMutationRequest | null {
	const commentId = mod.commentId?.trim();
	if (!commentId || !state.userName) {
		return null;
	}
	if (mod.remove || mod.downvote) {
		const icon = (mod.remove ?? mod.downvote ?? "").trim();
		if (!icon) {
			return null;
		}
		return {
			commentId,
			action: "remove",
			icon,
			user: state.userName,
			notifySuccess: true,
			notifyFailure: true,
		};
	}
	if (mod.upvote) {
		const icon = mod.upvote.trim();
		if (!icon) {
			return null;
		}
		return {
			commentId,
			action: "upvote",
			icon,
			user: state.userName,
			timestamp: getCurrentSignatureTimestamp(),
			notifySuccess: true,
			notifyFailure: true,
		};
	}
	if (mod.append) {
		const icon = mod.append.trim();
		if (!icon) {
			return null;
		}
		return {
			commentId,
			action: "append",
			icon,
			user: state.userName,
			timestamp: getCurrentSignatureTimestamp(),
			notifySuccess: true,
			notifyFailure: true,
		};
	}
	return null;
}

/**
 * Persist a reaction mutation to centralized storage.
 * @param mod - UI-level reaction request.
 * @returns Mutation result.
 */
export async function modifyReactionInDatabase(mod: ModifyReactionRequest): Promise<ModifyReactionResult> {
	const mutation = buildMutationRequest(mod);
	if (!mutation) {
		const message = toFailureMessage("no_changes");
		mw.notify(message, { title: t("default.titles.error"), type: "error" });
		return {
			success: false,
			readOnly: false,
			reason: "no_changes",
			entry: null,
		};
	}
	const result = await mutateReactionEntryForComment(mutation);
	if (!result.ok) {
		const message = toFailureMessage(result.reason);
		mw.notify(message, { title: t("default.titles.error"), type: "error" });
		return {
			success: false,
			readOnly: result.readOnly,
			reason: result.reason,
			entry: result.entry ?? null,
		};
	}
	return {
		success: true,
		readOnly: false,
		entry: result.entry ?? null,
	};
}

