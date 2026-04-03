import state from "../state";
import { getDiscussionToolsLookup } from "../api/discussionTools";
import { fetchPageWikitextSnapshot, savePageWikitext } from "../api/client";
import { findCommentPosition } from "../wikitext/comments";
import { findReactionTemplates } from "../wikitext/reactionTemplates";
import {
	hasReactionEntryData,
	mergeReactionEntryForComment,
	type ReactionEntry,
} from "../reactionData/store";

interface MigrationTask {
	commentId: string;
	rangeStart: number;
	rangeEnd: number;
	fragment: ReactionEntry;
}

let migrationPromise: Promise<void> | null = null;

/**
 * Convert template matches into a reaction entry fragment.
 * @param matches - Template matches from trailing line segment.
 * @returns Reaction entry fragment.
 */
function templatesToEntry(matches: ReturnType<typeof findReactionTemplates>): ReactionEntry {
	const fragment: ReactionEntry = {};
	matches.forEach((match) => {
		const icon = match.data.icon.trim();
		if (!icon) {
			return;
		}
		const participants = fragment[icon] ?? [];
		match.data.participants.forEach((participant) => {
			const user = participant.user.trim();
			if (!user) {
				return;
			}
			participants.push({
				user,
				timestamp: participant.timestamp?.trim() || undefined,
			});
		});
		if (participants.length > 0) {
			fragment[icon] = participants;
		}
	});
	return fragment;
}

/**
 * Check whether templates fully occupy a trailing segment.
 * @param content - Trim-left trailing segment.
 * @param matches - Template matches.
 * @returns True when templates cover the full segment (ignoring spaces).
 */
function isPureTemplateTrail(content: string, matches: ReturnType<typeof findReactionTemplates>): boolean {
	if (matches.length === 0) {
		return false;
	}
	let cursor = 0;
	for (const match of matches) {
		if (content.slice(cursor, match.start).trim().length > 0) {
			return false;
		}
		cursor = match.end;
	}
	return content.slice(cursor).trim().length === 0;
}

/**
 * Build migration task for a comment line when trailing inline reactions are detected.
 * @param fulltext - Full page source text.
 * @param position - Signature timestamp position.
 * @param signature - Signature timestamp text.
 * @param commentId - DiscussionTools comment id.
 * @returns Migration task or null.
 */
function buildTaskForComment(
	fulltext: string,
	position: number,
	signature: string,
	commentId: string,
): MigrationTask | null {
	const lineStart = fulltext.lastIndexOf("\n", position - 1) + 1;
	const lineEndRaw = fulltext.indexOf("\n", position);
	const lineEnd = lineEndRaw === -1 ? fulltext.length : lineEndRaw;
	const line = fulltext.slice(lineStart, lineEnd);
	const signatureOffsetInLine = position - lineStart;
	const signatureEnd = signatureOffsetInLine + signature.length;
	if (signatureEnd < 0 || signatureEnd > line.length) {
		return null;
	}
	const afterSignature = line.slice(signatureEnd);
	const leading = (afterSignature.match(/^[ \t]*/) ?? [""])[0].length;
	const content = afterSignature.slice(leading);
	if (!content.trim()) {
		return null;
	}
	const matches = findReactionTemplates(content);
	if (!isPureTemplateTrail(content, matches)) {
		return null;
	}
	const fragment = templatesToEntry(matches);
	if (!hasReactionEntryData(fragment)) {
		return null;
	}
	return {
		commentId,
		rangeStart: lineStart + signatureEnd,
		rangeEnd: lineEnd,
		fragment,
	};
}

/**
 * Remove persisted inline segments from source text.
 * @param source - Original source text.
 * @param ranges - Ranges to remove.
 * @returns Updated source text.
 */
function removeRangesFromSource(source: string, ranges: Array<{ start: number; end: number }>): string {
	const sorted = ranges
		.slice()
		.sort((a, b) => b.start - a.start);
	let updated = source;
	for (const range of sorted) {
		updated = updated.slice(0, range.start) + updated.slice(range.end);
	}
	return updated;
}

/**
 * Run one full-page migration from trailing inline templates to centralized DB pages.
 */
async function runLegacyInlineMigration(): Promise<void> {
	const sourceSnapshot = await fetchPageWikitextSnapshot(state.pageName);
	if (!sourceSnapshot.exists || sourceSnapshot.text == null || sourceSnapshot.text.length === 0) {
		return;
	}
	const source = sourceSnapshot.text;
	const lookup = await getDiscussionToolsLookup({ fresh: true });
	if (!lookup || lookup.comments.length === 0) {
		return;
	}

	const tasks: MigrationTask[] = [];
	const occurrenceByTimestamp = new Map<string, number>();
	const seenRanges = new Set<string>();

	for (const comment of lookup.comments) {
		const signature = comment.signatureTimestamp;
		if (!signature || !comment.id) {
			continue;
		}
		const occurrence = occurrenceByTimestamp.get(signature) ?? 0;
		occurrenceByTimestamp.set(signature, occurrence + 1);
		const located = findCommentPosition(
			source,
			signature,
			comment.authorText ?? comment.author ?? null,
			occurrence,
		);
		if (located.position == null) {
			continue;
		}
		const task = buildTaskForComment(source, located.position, signature, comment.id);
		if (!task) {
			continue;
		}
		const key = `${task.rangeStart}:${task.rangeEnd}`;
		if (seenRanges.has(key)) {
			continue;
		}
		seenRanges.add(key);
		tasks.push(task);
	}

	if (tasks.length === 0) {
		return;
	}

	const persistedRanges: Array<{ start: number; end: number }> = [];
	for (const task of tasks) {
		const merged = await mergeReactionEntryForComment(
			task.commentId,
			task.fragment,
			"Migrate legacy inline reactions to centralized storage",
			{
				notifySuccess: false,
				notifyFailure: false,
			},
		);
		if (!merged.ok && merged.reason !== "no_changes") {
			console.warn(
				"[Reaction] Legacy migration skipped comment due DB write failure.",
				task.commentId,
				merged.reason,
			);
			continue;
		}
		persistedRanges.push({ start: task.rangeStart, end: task.rangeEnd });
	}

	if (persistedRanges.length === 0) {
		return;
	}

	const cleaned = removeRangesFromSource(source, persistedRanges);
	if (cleaned === source) {
		return;
	}
	const sourceSave = await savePageWikitext(
		state.pageName,
		cleaned,
		"Migrate legacy inline reactions to centralized storage",
		{
			notifySuccess: false,
			notifyFailure: false,
			appendBacklink: true,
			baseTimestamp: sourceSnapshot.revisionTimestamp,
		},
	);
	if (!sourceSave.ok) {
		console.warn("[Reaction] Legacy inline source cleanup failed; migration stays idempotent on rerun.", sourceSave.errorCode);
	}
}

/**
 * Run migration once per page session.
 * @returns Promise that resolves when migration attempt completes.
 */
export function runLegacyInlineMigrationOnce(): Promise<void> {
	if (!migrationPromise) {
		migrationPromise = runLegacyInlineMigration().catch((error: unknown) => {
			console.error("[Reaction] Legacy inline migration failed.", error);
		});
	}
	return migrationPromise;
}
