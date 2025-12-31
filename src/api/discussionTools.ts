import { getApi } from "./client";
import state from "../state";
import { formatDateForSignature, normalizeTitle } from "../utils";

interface ThreadItemHTML {
	type: "heading" | "comment";
	id?: string;
	name?: string;
	author?: string;
	timestamp?: string;
	replies?: ThreadItemHTML[];
}

interface DiscussionToolsPageInfoResponse {
	discussiontoolspageinfo?: {
		threaditemshtml?: ThreadItemHTML[];
	};
}

export interface ThreadCommentMetadata {
	id: string;
	name?: string;
	author?: string;
	authorText?: string;
	timestamp?: string;
	signatureTimestamp?: string | null;
	level: number;
	parentId?: string;
}

export interface DiscussionToolsLookup {
	comments: ThreadCommentMetadata[];
	byId: Map<string, ThreadCommentMetadata>;
	byTimestamp: Map<string, ThreadCommentMetadata[]>;
}

export interface DiscussionToolsMatchingState {
	byId: Map<string, ThreadCommentMetadata>;
	byTimestamp: Map<string, ThreadCommentMetadata[]>;
	queue: ThreadCommentMetadata[];
}

let cachedLookup: DiscussionToolsLookup | null = null;
let cachedPage: string | null = null;
let cachedRevision: number | null = null;

interface DiscussionToolsLookupOptions {
	fresh?: boolean;
	page?: string;
	revisionId?: number | null;
}

/**
 * Format an ISO timestamp for use in comment signatures.
 * @param isoTimestamp - ISO timestamp string.
 * @returns Formatted signature timestamp or null.
 */
export function formatSignatureTimestamp(isoTimestamp?: string): string | null {
	if (!isoTimestamp) {
		return null;
	}
	const date = new Date(isoTimestamp);
	if (Number.isNaN(date.getTime())) {
		return null;
	}
	return formatDateForSignature(date);
}

/**
 * Recursively collect comment metadata from thread items.
 * @param items - Thread items array.
 * @param out - Output array for collected comments.
 * @param level - Current nesting level.
 * @param parentId - Parent comment ID.
 */
function collectComments(
	items: ThreadItemHTML[] | undefined,
	out: ThreadCommentMetadata[],
	level = 0,
	parentId?: string,
) {
	if (!items) {
		return;
	}
	for (const item of items) {
		const nextParent = item.id ?? parentId;
		if (item.type === "comment" && item.id) {
			const isoTimestamp = item.timestamp ?? undefined;
			out.push({
				id: item.id,
				name: item.name,
				author: item.author ? normalizeTitle(item.author) : undefined,
				authorText: item.author,
				timestamp: isoTimestamp,
				signatureTimestamp: formatSignatureTimestamp(isoTimestamp),
				level,
				parentId,
			});
		}
		if (item.replies && item.replies.length > 0) {
			collectComments(item.replies, out, level + 1, nextParent);
		}
	}
}

/**
 * Build a DiscussionTools lookup from collected comments.
 * @param comments - Collected comment metadata.
 * @returns DiscussionTools lookup structure.
 */
function buildLookup(comments: ThreadCommentMetadata[]): DiscussionToolsLookup {
	const byId = new Map<string, ThreadCommentMetadata>();
	const byTimestamp = new Map<string, ThreadCommentMetadata[]>();
	for (const comment of comments) {
		byId.set(comment.id, comment);
		if (comment.timestamp) {
			const arr = byTimestamp.get(comment.timestamp) ?? [];
			arr.push(comment);
			byTimestamp.set(comment.timestamp, arr);
		}
	}
	return { comments, byId, byTimestamp };
}

/**
 * Retrieve the DiscussionTools comment lookup for a page/revision.
 * @param options - Lookup options.
 * @returns Promise resolving to the DiscussionTools lookup or null.
 */
export async function getDiscussionToolsLookup(options?: DiscussionToolsLookupOptions): Promise<DiscussionToolsLookup | null> {
	const page = options?.page ?? state.pageName;
	const revisionId = options?.revisionId ?? ((mw.config.get("wgRevisionId") as number | undefined) ?? null);

	if (!options?.fresh && cachedLookup && cachedPage === page && cachedRevision === revisionId) {
		return cachedLookup;
	}

	try {
		const userLang = mw.config.get("wgUserLanguage") as string | undefined;
		const params: Record<string, string | number | boolean | undefined> = {
			action: "discussiontoolspageinfo",
			format: "json",
			prop: "threaditemshtml",
			page,
			formatversion: 2,
			uselang: userLang,
		};
		if (revisionId && revisionId > 0) {
			params.oldid = revisionId;
		}
		const response = await getApi().get(params) as DiscussionToolsPageInfoResponse;
		const threadItems = response.discussiontoolspageinfo?.threaditemshtml;
		if (!threadItems || threadItems.length === 0) {
			cachedLookup = null;
			return null;
		}
		const comments: ThreadCommentMetadata[] = [];
		collectComments(threadItems, comments);
		const lookup = buildLookup(comments);
		cachedLookup = lookup;
		cachedPage = page;
		cachedRevision = revisionId ?? null;
		return lookup;
	} catch (error) {
		console.error("[Reaction] Failed to load DiscussionTools page info.", error);
		return null;
	}
}

/**
 * Create a matching state from the DiscussionTools lookup.
 * @param lookup - DiscussionTools comment lookup.
 * @returns Matching state.
 */
export function createMatchingState(lookup: DiscussionToolsLookup): DiscussionToolsMatchingState {
	const byId = new Map(lookup.byId);
	const byTimestamp = new Map<string, ThreadCommentMetadata[]>();
	for (const [iso, entries] of lookup.byTimestamp.entries()) {
		byTimestamp.set(iso, entries.slice());
	}
	return {
		byId,
		byTimestamp,
		queue: lookup.comments.slice(),
	};
}

/**
 * Dequeue the next available comment from the matching state.
 * @param state - DiscussionTools matching state.
 * @returns Next comment metadata or null.
 */
function dequeueNext(state: DiscussionToolsMatchingState): ThreadCommentMetadata | null {
	while (state.queue.length > 0) {
		const next = state.queue.shift()!;
		if (state.byId.has(next.id)) {
			state.byId.delete(next.id);
			if (next.timestamp) {
				const entries = state.byTimestamp.get(next.timestamp);
				if (entries) {
					const idx = entries.findIndex((item) => item.id === next.id);
					if (idx !== -1) {
						entries.splice(idx, 1);
					}
					if (entries.length === 0) {
						state.byTimestamp.delete(next.timestamp);
					}
				}
			}
			return next;
		}
	}
	return null;
}

/**
 * Match and consume a comment by its ID.
 * @param state - DiscussionTools matching state.
 * @param id - Comment ID.
 * @returns Matched comment metadata or null.
 */
export function matchCommentById(state: DiscussionToolsMatchingState | null, id: string | null): ThreadCommentMetadata | null {
	if (!state || !id) {
		return null;
	}
	const comment = state.byId.get(id);
	if (!comment) {
		return null;
	}
	state.byId.delete(id);
	if (comment.timestamp) {
		const entries = state.byTimestamp.get(comment.timestamp);
		if (entries) {
			const idx = entries.findIndex((item) => item.id === id);
			if (idx !== -1) {
				entries.splice(idx, 1);
			}
			if (entries.length === 0) {
				state.byTimestamp.delete(comment.timestamp);
			}
		}
	}
	return comment;
}

/**
 * Match and consume a comment by its timestamp and optional author.
 * @param state - DiscussionTools matching state.
 * @param isoTimestamp - ISO timestamp string.
 * @param author - Optional author username.
 * @returns Matched comment metadata or null.
 */
export function matchCommentByTimestamp(
	state: DiscussionToolsMatchingState | null,
	isoTimestamp: string | null,
	author?: string | null,
): ThreadCommentMetadata | null {
	if (!state || !isoTimestamp) {
		return null;
	}
	const entries = state.byTimestamp.get(isoTimestamp);
	if (!entries || entries.length === 0) {
		return null;
	}
	if (entries.length === 1) {
		const [comment] = entries;
		matchCommentById(state, comment.id);
		return comment;
	}
	const normalizedAuthor = author ? normalizeTitle(author) : null;
	if (normalizedAuthor) {
		const matched = entries.find((entry) => entry.author === normalizedAuthor);
		if (matched) {
			matchCommentById(state, matched.id);
			return matched;
		}
	}
	return null;
}

/**
 * Consume the next available comment from the matching state.
 * @param state - DiscussionTools matching state.
 * @returns Next comment metadata or null.
 */
export function consumeNextComment(state: DiscussionToolsMatchingState | null): ThreadCommentMetadata | null {
	if (!state) {
		return null;
	}
	return dequeueNext(state);
}
