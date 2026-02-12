import {
	fetchPageWikitextSnapshot,
	savePageWikitext,
	type SavePageWikitextResult,
} from "../api/client";
import { normalizeTitle, parseSignatureTimestampText } from "../utils";
import { resolveDatabaseTitleFromCommentId } from "./commentId";

export const DATABASE_CACHE_TTL_MS = 60_000;
const SUPPORTED_SCHEMA_VERSION = 1;

const REACTION_READ_ONLY_SAVE_CODES = new Set([
	"noedit",
	"protectedpage",
	"permissiondenied",
	"abusefilter-disallowed",
]);

type ReactionRecordMap = Record<string, ReactionParticipantRecord>;

interface CachedDatabasePage {
	payload: ReactionDatabasePayload;
	fetchedAt: number;
}

interface DatabasePageParseFailure {
	reason: string;
	readOnly: true;
}

interface DatabasePageParseSuccess {
	payload: ReactionDatabasePayload;
}

export interface ReactionParticipantRecord {
	user: string;
	timestamp?: string;
}

export type ReactionEntry = Record<string, ReactionParticipantRecord[]>;

export interface ReactionDatabasePayload {
	version: number;
	entries: Record<string, ReactionEntry>;
}

export interface ReactionDatabaseEntryResult {
	title: string | null;
	entry: ReactionEntry | null;
	readOnly: boolean;
	reason?: string;
}

export interface ReactionMutationRequest {
	commentId: string;
	action: "upvote" | "append" | "remove";
	icon: string;
	user: string;
	timestamp?: string;
	notifySuccess?: boolean;
	notifyFailure?: boolean;
}

export interface ReactionMutationResult {
	ok: boolean;
	title: string | null;
	entry: ReactionEntry | null;
	readOnly: boolean;
	reason?: string;
}

interface UpdateCommentEntryOptions {
	notifySuccess?: boolean;
	notifyFailure?: boolean;
	summary: string;
}

const databaseCache = new Map<string, CachedDatabasePage>();
const inFlightLoads = new Map<string, Promise<ReactionDatabasePageResult>>();
const pageWriteQueue = new Map<string, Promise<unknown>>();
const readOnlyReasons = new Map<string, string>();
const malformedCommentIds = new Set<string>();

type ReactionDatabasePageResult =
	| { ok: true; title: string; payload: ReactionDatabasePayload; fromCache: boolean }
	| { ok: false; title: string; reason: string; readOnly: true };

interface UpdateEntryResult {
	changed: boolean;
	entry: ReactionEntry | null;
	reason?: string;
}

/**
 * Clear in-memory database caches.
 */
export function clearReactionDatabaseCache(): void {
	databaseCache.clear();
	inFlightLoads.clear();
}

/**
 * Check whether a database title is currently marked read-only.
 * @param title - Database page title.
 * @returns True when the title is read-only in the current session.
 */
export function isReactionDatabaseReadOnlyTitle(title: string): boolean {
	return readOnlyReasons.has(title);
}

/**
 * Mark a title as read-only for current session.
 * @param title - Database page title.
 * @param reason - Reason for read-only state.
 */
function markReadOnly(title: string, reason: string): void {
	readOnlyReasons.set(title, reason);
}

/**
 * Remove read-only marker for a title.
 * @param title - Database page title.
 */
function clearReadOnly(title: string): void {
	readOnlyReasons.delete(title);
}

/**
 * Resolve and validate icon text.
 * @param icon - Reaction icon.
 * @returns Trimmed icon or empty string.
 */
function normalizeIcon(icon: string): string {
	return icon.trim();
}

/**
 * Resolve normalized user key for dedupe.
 * @param user - User name.
 * @returns Lower-cased normalized key.
 */
function toUserKey(user: string): string {
	return normalizeTitle(user).toLowerCase();
}

/**
 * Determine if a timestamp value is non-empty.
 * @param timestamp - Timestamp value.
 * @returns True when non-empty.
 */
function hasTimestamp(timestamp?: string): boolean {
	return Boolean(timestamp && timestamp.trim().length > 0);
}

/**
 * Decide whether candidate participant is preferred over current record.
 * @param current - Existing record.
 * @param candidate - Candidate record.
 * @returns Preferred record.
 */
function pickPreferredParticipant(
	current: ReactionParticipantRecord,
	candidate: ReactionParticipantRecord,
): ReactionParticipantRecord {
	const currentHasTs = hasTimestamp(current.timestamp);
	const candidateHasTs = hasTimestamp(candidate.timestamp);
	if (!currentHasTs && candidateHasTs) {
		return candidate;
	}
	if (currentHasTs && !candidateHasTs) {
		return current;
	}
	if (!currentHasTs && !candidateHasTs) {
		return current;
	}

	const currentParsed = parseSignatureTimestampText(current.timestamp ?? "");
	const candidateParsed = parseSignatureTimestampText(candidate.timestamp ?? "");
	if (currentParsed && candidateParsed) {
		return candidateParsed.getTime() < currentParsed.getTime() ? candidate : current;
	}
	if (!currentParsed && candidateParsed) {
		return candidate;
	}
	if (currentParsed && !candidateParsed) {
		return current;
	}

	const currentTs = current.timestamp ?? "";
	const candidateTs = candidate.timestamp ?? "";
	return candidateTs < currentTs ? candidate : current;
}

/**
 * Determine whether an entry has any stored participants.
 * @param entry - Entry to inspect.
 * @returns True when non-empty.
 */
export function hasReactionEntryData(entry: ReactionEntry | null | undefined): boolean {
	if (!entry) {
		return false;
	}
	for (const participants of Object.values(entry)) {
		if (Array.isArray(participants) && participants.length > 0) {
			return true;
		}
	}
	return false;
}

/**
 * Canonicalize a reaction entry according to dedupe and ordering rules.
 * @param entry - Raw entry.
 * @returns Canonicalized entry.
 */
export function canonicalizeReactionEntry(entry: ReactionEntry): ReactionEntry {
	const iconToUsers = new Map<string, ReactionRecordMap>();
	for (const [rawIcon, rawParticipants] of Object.entries(entry ?? {})) {
		const icon = normalizeIcon(rawIcon);
		if (!icon || !Array.isArray(rawParticipants)) {
			continue;
		}
		const userMap = iconToUsers.get(icon) ?? {};
		rawParticipants.forEach((rawParticipant) => {
			if (!rawParticipant || typeof rawParticipant !== "object") {
				return;
			}
			const user = typeof rawParticipant.user === "string" ? normalizeTitle(rawParticipant.user) : "";
			if (!user) {
				return;
			}
			const timestamp = hasTimestamp(rawParticipant.timestamp)
				? rawParticipant.timestamp?.trim()
				: undefined;
			const key = toUserKey(user);
			const candidate: ReactionParticipantRecord = { user, timestamp };
			const existing = userMap[key];
			userMap[key] = existing ? pickPreferredParticipant(existing, candidate) : candidate;
		});
		if (Object.keys(userMap).length > 0) {
			iconToUsers.set(icon, userMap);
		}
	}

	const sortedIcons = Array.from(iconToUsers.keys()).sort((a, b) => a.localeCompare(b));
	const result: ReactionEntry = {};
	sortedIcons.forEach((icon) => {
		const userMap = iconToUsers.get(icon);
		if (!userMap) {
			return;
		}
		const participants = Object.values(userMap)
			.sort((a, b) => {
				const userCompare = toUserKey(a.user).localeCompare(toUserKey(b.user));
				if (userCompare !== 0) {
					return userCompare;
				}
				return (a.timestamp ?? "").localeCompare(b.timestamp ?? "");
			});
		if (participants.length > 0) {
			result[icon] = participants;
		}
	});
	return result;
}

/**
 * Merge two entries and canonicalize the merged result.
 * @param base - Base entry.
 * @param incoming - Incoming entry.
 * @returns Canonical merged entry.
 */
export function mergeReactionEntries(base: ReactionEntry, incoming: ReactionEntry): ReactionEntry {
	const merged: ReactionEntry = {};
	for (const [icon, participants] of Object.entries(base ?? {})) {
		merged[icon] = participants.slice();
	}
	for (const [icon, participants] of Object.entries(incoming ?? {})) {
		const current = merged[icon] ?? [];
		merged[icon] = [...current, ...participants];
	}
	return canonicalizeReactionEntry(merged);
}

/**
 * Canonicalize database payload and ensure stable key ordering.
 * @param payload - Raw payload.
 * @returns Canonical payload.
 */
export function canonicalizeDatabasePayload(payload: ReactionDatabasePayload): ReactionDatabasePayload {
	const entries: Record<string, ReactionEntry> = {};
	const commentIds = Object.keys(payload.entries ?? {}).sort((a, b) => a.localeCompare(b));
	commentIds.forEach((commentId) => {
		const canonicalEntry = canonicalizeReactionEntry(payload.entries[commentId] ?? {});
		if (hasReactionEntryData(canonicalEntry)) {
			entries[commentId] = canonicalEntry;
		}
	});
	return {
		version: payload.version || SUPPORTED_SCHEMA_VERSION,
		entries,
	};
}

/**
 * Serialize payload JSON with stable formatting.
 * @param payload - Database payload.
 * @returns Pretty JSON string.
 */
function serializePayloadJson(payload: ReactionDatabasePayload): string {
	return JSON.stringify(canonicalizeDatabasePayload(payload), null, 2);
}

/**
 * Extract JSON text from a database page wikitext payload.
 * @param pageText - Raw page text.
 * @returns JSON text or null when wrapper is missing/ambiguous.
 */
export function extractJsonPayloadFromDatabasePage(pageText: string): string | null {
	const syntaxRegex = /<syntaxhighlight\b([^>]*)>([\s\S]*?)<\/syntaxhighlight>/gi;
	const matches: Array<{ attrs: string; body: string; start: number; end: number }> = [];
	let match: RegExpExecArray | null;
	while ((match = syntaxRegex.exec(pageText)) !== null) {
		matches.push({
			attrs: match[1] ?? "",
			body: match[2] ?? "",
			start: match.index,
			end: match.index + match[0].length,
		});
	}
	if (matches.length !== 1) {
		return null;
	}
	const [only] = matches;
	if (!isJsonSyntaxHighlightAttrs(only.attrs)) {
		return null;
	}
	const before = pageText.slice(0, only.start).trim();
	const after = pageText.slice(only.end).trim();
	if (before || after) {
		return null;
	}
	return only.body.trim();
}

/**
 * Wrap JSON text in canonical syntaxhighlight wrapper.
 * @param jsonText - Pretty JSON text.
 * @returns Wrapped wikitext string.
 */
export function wrapJsonPayloadForDatabasePage(jsonText: string): string {
	return `<syntaxhighlight lang="json">\n${jsonText.trim()}\n</syntaxhighlight>`;
}

/**
 * Check if syntaxhighlight attributes declare JSON language.
 * @param attrs - Raw opening tag attributes.
 * @returns True when lang is json.
 */
function isJsonSyntaxHighlightAttrs(attrs: string): boolean {
	const langMatch = attrs.match(/\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
	if (!langMatch) {
		return false;
	}
	const lang = (langMatch[1] ?? langMatch[2] ?? langMatch[3] ?? "").trim().toLowerCase();
	return lang === "json";
}

/**
 * Parse a raw page text into a canonical payload.
 * @param pageText - Raw page text.
 * @returns Parse result object.
 */
function parseDatabasePageText(pageText: string): DatabasePageParseSuccess | DatabasePageParseFailure {
	const jsonPayload = extractJsonPayloadFromDatabasePage(pageText);
	if (!jsonPayload) {
		return { readOnly: true, reason: "database_wrapper_invalid" };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonPayload);
	} catch {
		return { readOnly: true, reason: "database_json_invalid" };
	}
	if (!parsed || typeof parsed !== "object") {
		return { readOnly: true, reason: "database_json_invalid" };
	}
	const record = parsed as { version?: unknown; entries?: unknown };
	const version = typeof record.version === "number" ? record.version : SUPPORTED_SCHEMA_VERSION;
	if (version > SUPPORTED_SCHEMA_VERSION) {
		return { readOnly: true, reason: "database_version_unsupported" };
	}
	const rawEntries = (record.entries && typeof record.entries === "object")
		? record.entries as Record<string, unknown>
		: {};
	const entries: Record<string, ReactionEntry> = {};
	for (const [commentId, rawEntry] of Object.entries(rawEntries)) {
		if (!rawEntry || typeof rawEntry !== "object") {
			continue;
		}
		const iconMap = rawEntry as Record<string, unknown>;
		const entry: ReactionEntry = {};
		for (const [icon, rawParticipants] of Object.entries(iconMap)) {
			if (!Array.isArray(rawParticipants)) {
				continue;
			}
			const participants: ReactionParticipantRecord[] = [];
			rawParticipants.forEach((item) => {
				if (!item || typeof item !== "object") {
					return;
				}
				const participant = item as { user?: unknown; timestamp?: unknown };
				if (typeof participant.user !== "string") {
					return;
				}
				participants.push({
					user: participant.user,
					timestamp: typeof participant.timestamp === "string" ? participant.timestamp : undefined,
				});
			});
			entry[icon] = participants;
		}
		entries[commentId] = entry;
	}
	return {
		payload: canonicalizeDatabasePayload({
			version,
			entries,
		}),
	};
}

/**
 * Build initial empty payload.
 * @returns Empty payload.
 */
function makeEmptyPayload(): ReactionDatabasePayload {
	return {
		version: SUPPORTED_SCHEMA_VERSION,
		entries: {},
	};
}

/**
 * Load and parse a centralized reaction database page.
 * @param title - Database page title.
 * @param options - Load options.
 * @returns Parsed page result or read-only failure.
 */
export async function loadReactionDatabasePage(
	title: string,
	options?: { fresh?: boolean },
): Promise<ReactionDatabasePageResult> {
	const useCache = !options?.fresh;
	const now = Date.now();
	const cached = databaseCache.get(title);
	if (useCache && cached && now - cached.fetchedAt <= DATABASE_CACHE_TTL_MS) {
		return {
			ok: true,
			title,
			payload: cached.payload,
			fromCache: true,
		};
	}

	const inFlight = inFlightLoads.get(title);
	if (inFlight) {
		return inFlight;
	}

	const loadPromise = (async (): Promise<ReactionDatabasePageResult> => {
		try {
			const snapshot = await fetchPageWikitextSnapshot(title);
			if (!snapshot.exists || snapshot.text === null) {
				const payload = makeEmptyPayload();
				databaseCache.set(title, { payload, fetchedAt: Date.now() });
				clearReadOnly(title);
				return {
					ok: true,
					title,
					payload,
					fromCache: false,
				};
			}
			const parsed = parseDatabasePageText(snapshot.text);
			if ("readOnly" in parsed) {
				markReadOnly(title, parsed.reason);
				return {
					ok: false,
					title,
					readOnly: true,
					reason: parsed.reason,
				};
			}
			const payload = parsed.payload;
			databaseCache.set(title, { payload, fetchedAt: Date.now() });
			clearReadOnly(title);
			return {
				ok: true,
				title,
				payload,
				fromCache: false,
			};
		} catch (error) {
			console.error("[Reaction] Failed to load reaction database page.", title, error);
			markReadOnly(title, "database_load_failed");
			return {
				ok: false,
				title,
				readOnly: true,
				reason: "database_load_failed",
			};
		}
	})();

	inFlightLoads.set(title, loadPromise);
	try {
		return await loadPromise;
	} finally {
		if (inFlightLoads.get(title) === loadPromise) {
			inFlightLoads.delete(title);
		}
	}
}

/**
 * Retrieve a comment entry from centralized storage.
 * @param commentId - DiscussionTools comment id.
 * @param options - Read options.
 * @returns Entry lookup result.
 */
export async function getReactionEntryForComment(
	commentId: string,
	options?: { fresh?: boolean },
): Promise<ReactionDatabaseEntryResult> {
	const title = resolveDatabaseTitleFromCommentId(commentId);
	if (!title) {
		if (!malformedCommentIds.has(commentId)) {
			malformedCommentIds.add(commentId);
			console.warn("[Reaction] Malformed comment id for reaction database:", commentId);
		}
		return {
			title: null,
			entry: null,
			readOnly: true,
			reason: "malformed_comment_id",
		};
	}
	const page = await loadReactionDatabasePage(title, options);
	if (!page.ok) {
		return {
			title,
			entry: null,
			readOnly: true,
			reason: page.reason,
		};
	}
	return {
		title,
		entry: page.payload.entries[commentId] ?? null,
		readOnly: isReactionDatabaseReadOnlyTitle(title),
		reason: readOnlyReasons.get(title),
	};
}

/**
 * Persist payload for a database page.
 * @param title - Database page title.
 * @param payload - Payload to save.
 * @param summary - Edit summary.
 * @param options - Save options.
 * @returns Save result.
 */
export async function saveReactionDatabasePage(
	title: string,
	payload: ReactionDatabasePayload,
	summary: string,
	options?: { notifySuccess?: boolean; notifyFailure?: boolean },
): Promise<SavePageWikitextResult> {
	const wrapped = wrapJsonPayloadForDatabasePage(serializePayloadJson(payload));
	const result = await savePageWikitext(title, wrapped, summary, {
		notifySuccess: options?.notifySuccess ?? false,
		notifyFailure: options?.notifyFailure ?? true,
		appendBacklink: true,
	});
	if (result.ok) {
		databaseCache.set(title, {
			payload: canonicalizeDatabasePayload(payload),
			fetchedAt: Date.now(),
		});
		clearReadOnly(title);
	} else {
		databaseCache.delete(title);
	}
	return result;
}

/**
 * Execute a page mutation in serialized order for a database title.
 * @param title - Database page title.
 * @param task - Task callback.
 * @returns Task result.
 */
function enqueuePageTask<T>(title: string, task: () => Promise<T>): Promise<T> {
	const previous = pageWriteQueue.get(title) ?? Promise.resolve();
	const next = previous
		.catch(() => undefined)
		.then(task);
	pageWriteQueue.set(title, next);
	void next.finally(() => {
		if (pageWriteQueue.get(title) === next) {
			pageWriteQueue.delete(title);
		}
	});
	return next;
}

/**
 * Sleep helper used for retry backoff.
 * @param ms - Milliseconds.
 * @returns Promise that resolves after timeout.
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		globalThis.setTimeout(resolve, ms);
	});
}

/**
 * Return true when a save error should mark a page read-only.
 * @param result - Save result.
 * @returns True when the error implies read-only write state.
 */
function isReadOnlySaveError(result: SavePageWikitextResult): boolean {
	const code = result.errorCode ?? "";
	return REACTION_READ_ONLY_SAVE_CODES.has(code);
}

/**
 * Apply a reaction mutation to the current entry.
 * @param current - Current entry.
 * @param request - Mutation request.
 * @returns Mutation result.
 */
function applyMutationToEntry(current: ReactionEntry, request: ReactionMutationRequest): UpdateEntryResult {
	const normalizedIcon = normalizeIcon(request.icon);
	const normalizedUser = normalizeTitle(request.user);
	if (!normalizedIcon || !normalizedUser) {
		return { changed: false, entry: canonicalizeReactionEntry(current), reason: "no_changes" };
	}
	const entry = canonicalizeReactionEntry(current);
	const bucket = entry[normalizedIcon] ? entry[normalizedIcon].slice() : [];
	const userKey = toUserKey(normalizedUser);

	if (request.action === "append") {
		if (bucket.length > 0) {
			return { changed: false, entry, reason: "reaction_exists" };
		}
		entry[normalizedIcon] = [{ user: normalizedUser, timestamp: request.timestamp?.trim() || undefined }];
		return { changed: true, entry: canonicalizeReactionEntry(entry) };
	}

	if (request.action === "upvote") {
		const exists = bucket.some((participant) => toUserKey(participant.user) === userKey);
		if (exists) {
			return { changed: false, entry, reason: "no_changes" };
		}
		bucket.push({
			user: normalizedUser,
			timestamp: request.timestamp?.trim() || undefined,
		});
		entry[normalizedIcon] = bucket;
		return { changed: true, entry: canonicalizeReactionEntry(entry) };
	}

	const filtered = bucket.filter((participant) => toUserKey(participant.user) !== userKey);
	if (filtered.length === bucket.length) {
		return { changed: false, entry, reason: "no_changes" };
	}
	if (filtered.length === 0) {
		delete entry[normalizedIcon];
	} else {
		entry[normalizedIcon] = filtered;
	}
	return { changed: true, entry: canonicalizeReactionEntry(entry) };
}

/**
 * Update a comment entry using serialized per-page writes.
 * @param commentId - DiscussionTools comment id.
 * @param updater - Entry updater callback.
 * @param options - Save options.
 * @returns Mutation result.
 */
async function updateCommentEntry(
	commentId: string,
	updater: (current: ReactionEntry) => UpdateEntryResult,
	options: UpdateCommentEntryOptions,
): Promise<ReactionMutationResult> {
	const title = resolveDatabaseTitleFromCommentId(commentId);
	if (!title) {
		if (!malformedCommentIds.has(commentId)) {
			malformedCommentIds.add(commentId);
			console.warn("[Reaction] Malformed comment id for reaction database write:", commentId);
		}
		return {
			ok: false,
			title: null,
			entry: null,
			readOnly: true,
			reason: "malformed_comment_id",
		};
	}

	return enqueuePageTask(title, async () => {
		for (let attempt = 0; attempt < 3; attempt++) {
			const page = await loadReactionDatabasePage(title, { fresh: true });
			if (!page.ok) {
				return {
					ok: false,
					title,
					entry: null,
					readOnly: true,
					reason: page.reason,
				};
			}
			const payload: ReactionDatabasePayload = {
				version: page.payload.version,
				entries: { ...page.payload.entries },
			};
			const currentEntry = payload.entries[commentId] ?? {};
			const updated = updater(currentEntry);
			if (!updated.changed) {
				return {
					ok: false,
					title,
					entry: updated.entry,
					readOnly: isReactionDatabaseReadOnlyTitle(title),
					reason: updated.reason ?? "no_changes",
				};
			}
			if (updated.entry && hasReactionEntryData(updated.entry)) {
				payload.entries[commentId] = canonicalizeReactionEntry(updated.entry);
			} else {
				delete payload.entries[commentId];
			}
			const canonicalPayload = canonicalizeDatabasePayload(payload);
			const saveResult = await saveReactionDatabasePage(title, canonicalPayload, options.summary, {
				notifySuccess: options.notifySuccess,
				notifyFailure: options.notifyFailure,
			});
			if (saveResult.ok) {
				return {
					ok: true,
					title,
					entry: canonicalPayload.entries[commentId] ?? null,
					readOnly: false,
				};
			}
			if (saveResult.errorCode === "editconflict" && attempt < 2) {
				const backoff = 150 * (2 ** attempt) + Math.floor(Math.random() * 120);
				await delay(backoff);
				continue;
			}
			if (isReadOnlySaveError(saveResult)) {
				markReadOnly(title, saveResult.errorCode ?? "database_write_readonly");
				return {
					ok: false,
					title,
					entry: null,
					readOnly: true,
					reason: saveResult.errorCode ?? "database_write_readonly",
				};
			}
			return {
				ok: false,
				title,
				entry: null,
				readOnly: false,
				reason: saveResult.errorCode ?? "database_write_failed",
			};
		}
		return {
			ok: false,
			title,
			entry: null,
			readOnly: false,
			reason: "database_write_failed",
		};
	});
}

/**
 * Apply add/remove mutations for a single comment entry.
 * @param request - Mutation request.
 * @returns Mutation result.
 */
export async function mutateReactionEntryForComment(
	request: ReactionMutationRequest,
): Promise<ReactionMutationResult> {
	const summaryPrefix = request.action === "remove" ? "−" : "+";
	const summary = `${summaryPrefix} ${request.icon}`;
	return updateCommentEntry(
		request.commentId,
		(current) => applyMutationToEntry(current, request),
		{
			summary,
			notifySuccess: request.notifySuccess ?? true,
			notifyFailure: request.notifyFailure ?? true,
		},
	);
}

/**
 * Merge a fragment entry into the target comment entry.
 * @param commentId - DiscussionTools comment id.
 * @param fragment - Fragment entry to merge.
 * @param summary - Edit summary.
 * @param options - Save options.
 * @returns Mutation result.
 */
export async function mergeReactionEntryForComment(
	commentId: string,
	fragment: ReactionEntry,
	summary: string,
	options?: { notifySuccess?: boolean; notifyFailure?: boolean },
): Promise<ReactionMutationResult> {
	return updateCommentEntry(
		commentId,
		(current) => {
			const merged = mergeReactionEntries(current, fragment);
			const currentCanonical = canonicalizeReactionEntry(current);
			const changed = JSON.stringify(currentCanonical) !== JSON.stringify(merged);
			return {
				changed,
				entry: merged,
				reason: changed ? undefined : "no_changes",
			};
		},
		{
			summary,
			notifySuccess: options?.notifySuccess ?? false,
			notifyFailure: options?.notifyFailure ?? false,
		},
	);
}
