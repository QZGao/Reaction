import {
	fetchPageWikitextSnapshot,
	savePageWikitext,
	type PageWikitextSnapshot,
	type SavePageWikitextResult,
} from "../api/client";
import { normalizeTitle, parseSignatureTimestampText } from "../utils";
import { resolveDatabaseTitleFromCommentId } from "./commentId";

export const DATABASE_CACHE_TTL_MS = 60_000;
export const DATABASE_PAGE_SOFT_LIMIT_BYTES = 180 * 1024;
const SUPPORTED_SCHEMA_VERSION = 1;
const SHARD_PREFIX = "part-";

const ICON_MAX_LENGTH = 64;
const USER_MAX_LENGTH = 255;
const TIMESTAMP_MAX_LENGTH = 128;
const TIMESTAMP_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHARD_ID_PATTERN = /^part-\d+$/;

const REACTION_READ_ONLY_SAVE_CODES = new Set([
	"noedit",
	"protectedpage",
	"permissiondenied",
	"abusefilter-disallowed",
]);
const REACTION_WRITE_CONFLICT_SAVE_CODES = new Set([
	"editconflict",
	"articleexists",
]);

const RECOVER_AS_EMPTY_PARSE_REASONS = new Set([
	"database_wrapper_invalid",
	"database_json_invalid",
	"database_shard_index_invalid",
]);

type ReactionRecordMap = Record<string, ReactionParticipantRecord>;

interface CachedDatabasePage {
	payload: ReactionDatabasePayload;
	fetchedAt: number;
	snapshot: PageWikitextSnapshot;
}

interface DatabasePageParseFailure {
	reason: string;
	readOnly: true;
}

interface DatabasePageParseSuccess {
	payload: ReactionDatabasePayload;
}

interface ShardLayout {
	shardEntries: Array<{ shardId: string; entries: Record<string, ReactionEntry> }>;
	shardMap: Record<string, string>;
}

interface CombinedEntriesLoadSuccess {
	ok: true;
	title: string;
	entries: Record<string, ReactionEntry>;
	pageSnapshots: Record<string, PageWikitextSnapshot>;
}
type LoadedReactionDatabasePage = Extract<ReactionDatabasePageResult, { ok: true }>;

interface ShardedMutationState {
	basePage: LoadedReactionDatabasePage;
	mappedShardId: string | null;
	workingShardId: string;
	workingShardTitle: string;
	workingShardPage: LoadedReactionDatabasePage;
}

interface ShardedMutationAttemptLoadFailure {
	kind: "load_failure";
	reason: string;
	readOnly: true;
}

interface ShardedMutationAttemptNoChange {
	kind: "no_change";
	entry: ReactionEntry | null;
	reason?: string;
}

interface ShardedMutationAttemptSave {
	kind: "save";
	entry: ReactionEntry | null;
	saveResult: SavePageWikitextResult;
}

type ShardedMutationAttemptResult =
	| ShardedMutationAttemptLoadFailure
	| ShardedMutationAttemptNoChange
	| ShardedMutationAttemptSave;

export interface ReactionParticipantRecord {
	user: string;
	timestamp?: string;
	timestampIso?: string;
}

export type ReactionEntry = Record<string, ReactionParticipantRecord[]>;

export interface ReactionDatabasePayload {
	version: number;
	entries: Record<string, ReactionEntry>;
	sharded?: boolean;
	shards?: string[];
	shardMap?: Record<string, string>;
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
	timestampIso?: string;
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
const pageWriteQueue = new Map<string, Promise<void>>();
const readOnlyReasons = new Map<string, string>();
const malformedCommentIds = new Set<string>();

type ReactionDatabasePageResult =
	| { ok: true; title: string; payload: ReactionDatabasePayload; fromCache: boolean; snapshot: PageWikitextSnapshot }
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
	readOnlyReasons.clear();
	malformedCommentIds.clear();
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
	const trimmed = icon.trim();
	if (!trimmed || trimmed.length > ICON_MAX_LENGTH) {
		return "";
	}
	return trimmed;
}

/**
 * Normalize and validate user text.
 * @param user - Candidate user.
 * @returns Normalized user name or empty string.
 */
function normalizeUser(user: string): string {
	const normalized = normalizeTitle(user);
	if (!normalized || normalized.length > USER_MAX_LENGTH) {
		return "";
	}
	return normalized;
}

/**
 * Normalize and validate timestamp display text.
 * @param timestamp - Candidate timestamp.
 * @returns Normalized timestamp or undefined.
 */
function normalizeTimestamp(timestamp?: string): string | undefined {
	if (!timestamp) {
		return undefined;
	}
	const trimmed = timestamp.trim();
	if (!trimmed || trimmed.length > TIMESTAMP_MAX_LENGTH) {
		return undefined;
	}
	return trimmed;
}

/**
 * Normalize and validate timestamp ISO.
 * @param timestampIso - Candidate ISO timestamp.
 * @returns Normalized ISO timestamp or undefined.
 */
function normalizeTimestampIso(timestampIso?: string): string | undefined {
	if (!timestampIso) {
		return undefined;
	}
	const trimmed = timestampIso.trim();
	if (!TIMESTAMP_ISO_PATTERN.test(trimmed)) {
		return undefined;
	}
	return trimmed;
}

/**
 * Convert Date to UTC second precision ISO string.
 * @param date - Input date.
 * @returns ISO string without milliseconds.
 */
function toIsoSeconds(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Derive ISO timestamp from signature text where possible.
 * @param timestamp - Signature timestamp.
 * @returns UTC ISO string or undefined.
 */
function deriveIsoFromSignatureTimestamp(timestamp?: string): string | undefined {
	if (!timestamp) {
		return undefined;
	}
	const parsed = parseSignatureTimestampText(timestamp);
	if (!parsed) {
		return undefined;
	}
	return toIsoSeconds(parsed);
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
 * Resolve comparable epoch millis for participant.
 * @param participant - Participant record.
 * @returns Epoch millis or null.
 */
function resolveParticipantEpoch(participant: ReactionParticipantRecord): number | null {
	const iso = normalizeTimestampIso(participant.timestampIso);
	if (iso) {
		const parsedIso = new Date(iso);
		if (!Number.isNaN(parsedIso.getTime())) {
			return parsedIso.getTime();
		}
	}
	const parsed = parseSignatureTimestampText(participant.timestamp ?? "");
	return parsed ? parsed.getTime() : null;
}

/**
 * Normalize participant record and derive canonical timestamp fields.
 * @param participant - Input participant.
 * @returns Normalized participant or null when invalid.
 */
function normalizeParticipant(participant: ReactionParticipantRecord): ReactionParticipantRecord | null {
	const user = normalizeUser(participant.user);
	if (!user) {
		return null;
	}
	const timestamp = normalizeTimestamp(participant.timestamp);
	const timestampIso = normalizeTimestampIso(participant.timestampIso)
		?? deriveIsoFromSignatureTimestamp(timestamp);
	return {
		user,
		timestamp,
		timestampIso,
	};
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

	const currentEpoch = resolveParticipantEpoch(current);
	const candidateEpoch = resolveParticipantEpoch(candidate);
	if (currentEpoch !== null && candidateEpoch !== null) {
		return candidateEpoch < currentEpoch ? candidate : current;
	}
	if (currentEpoch === null && candidateEpoch !== null) {
		return candidate;
	}
	if (currentEpoch !== null && candidateEpoch === null) {
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
			const normalized = normalizeParticipant({
				user: typeof rawParticipant.user === "string" ? rawParticipant.user : "",
				timestamp: typeof rawParticipant.timestamp === "string" ? rawParticipant.timestamp : undefined,
				timestampIso: typeof rawParticipant.timestampIso === "string" ? rawParticipant.timestampIso : undefined,
			});
			if (!normalized) {
				return;
			}
			const key = toUserKey(normalized.user);
			const existing = userMap[key];
			userMap[key] = existing ? pickPreferredParticipant(existing, normalized) : normalized;
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
				const aIso = a.timestampIso ?? "";
				const bIso = b.timestampIso ?? "";
				if (aIso !== bIso) {
					return aIso.localeCompare(bIso);
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
 * Validate shard id format.
 * @param shardId - Candidate shard id.
 * @returns True when valid.
 */
function isValidShardId(shardId: string): boolean {
	return SHARD_ID_PATTERN.test(shardId.trim());
}

/**
 * Sort and deduplicate shard IDs deterministically.
 * @param shardIds - Candidate shard IDs.
 * @returns Canonical shard ID list.
 */
function canonicalizeShardIds(shardIds: string[]): string[] {
	const unique = Array.from(new Set(shardIds.filter((shardId) => isValidShardId(shardId))));
	unique.sort((a, b) => {
		const aNum = Number(a.slice(SHARD_PREFIX.length));
		const bNum = Number(b.slice(SHARD_PREFIX.length));
		if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) {
			return aNum - bNum;
		}
		return a.localeCompare(b);
	});
	return unique;
}

/**
 * Check whether payload represents a shard index page.
 * @param payload - Candidate payload.
 * @returns True when payload is sharded index metadata.
 */
function isShardedPayload(payload: ReactionDatabasePayload): boolean {
	return payload.sharded === true
		&& Array.isArray(payload.shards)
		&& payload.shards.length > 0
		&& Boolean(payload.shardMap && typeof payload.shardMap === "object");
}

/**
 * Build a shard page title from base title and shard id.
 * @param baseTitle - Base database title.
 * @param shardId - Shard id.
 * @returns Full shard title.
 */
function buildShardTitle(baseTitle: string, shardId: string): string {
	return `${baseTitle}/${shardId}`;
}

/**
 * Clone entries map.
 * @param entries - Source entries.
 * @returns Shallow-cloned entries map.
 */
function cloneEntries(entries: Record<string, ReactionEntry>): Record<string, ReactionEntry> {
	const result: Record<string, ReactionEntry> = {};
	for (const [commentId, entry] of Object.entries(entries)) {
		result[commentId] = canonicalizeReactionEntry(entry);
	}
	return result;
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
	const canonical: ReactionDatabasePayload = {
		version: payload.version || SUPPORTED_SCHEMA_VERSION,
		entries,
	};

	if (payload.sharded) {
		const shards = canonicalizeShardIds(payload.shards ?? []);
		if (shards.length > 0 && payload.shardMap && typeof payload.shardMap === "object") {
			const shardSet = new Set(shards);
			const shardMap: Record<string, string> = {};
			const mapCommentIds = Object.keys(payload.shardMap).sort((a, b) => a.localeCompare(b));
			mapCommentIds.forEach((commentId) => {
				const shardId = payload.shardMap?.[commentId];
				if (typeof shardId === "string" && shardSet.has(shardId)) {
					shardMap[commentId] = shardId;
				}
			});
			canonical.sharded = true;
			canonical.shards = shards;
			canonical.shardMap = shardMap;
		}
	}

	return canonical;
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
	const record = parsed as {
		version?: unknown;
		entries?: unknown;
		sharded?: unknown;
		shards?: unknown;
		shardMap?: unknown;
	};
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
				const participant = item as { user?: unknown; timestamp?: unknown; timestampIso?: unknown };
				if (typeof participant.user !== "string") {
					return;
				}
				participants.push({
					user: participant.user,
					timestamp: typeof participant.timestamp === "string" ? participant.timestamp : undefined,
					timestampIso: typeof participant.timestampIso === "string" ? participant.timestampIso : undefined,
				});
			});
			entry[icon] = participants;
		}
		entries[commentId] = entry;
	}

	const sharded = record.sharded === true;
	let shards: string[] | undefined;
	let shardMap: Record<string, string> | undefined;
	if (sharded) {
		if (!Array.isArray(record.shards) || !record.shardMap || typeof record.shardMap !== "object") {
			return { readOnly: true, reason: "database_shard_index_invalid" };
		}
		const parsedShards = canonicalizeShardIds(
			record.shards.filter((item): item is string => typeof item === "string"),
		);
		if (parsedShards.length === 0) {
			return { readOnly: true, reason: "database_shard_index_invalid" };
		}
		const shardSet = new Set(parsedShards);
		const rawShardMap = record.shardMap as Record<string, unknown>;
		const parsedMap: Record<string, string> = {};
		for (const [commentId, rawShardId] of Object.entries(rawShardMap)) {
			if (typeof rawShardId !== "string") {
				continue;
			}
			if (!shardSet.has(rawShardId)) {
				continue;
			}
			parsedMap[commentId] = rawShardId;
		}
		shards = parsedShards;
		shardMap = parsedMap;
	}

	return {
		payload: canonicalizeDatabasePayload({
			version,
			entries,
			sharded,
			shards,
			shardMap,
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
 * Compute UTF-8 byte length for a string.
 * @param text - Input text.
 * @returns UTF-8 byte length.
 */
function utf8ByteLength(text: string): number {
	if (typeof TextEncoder !== "undefined") {
		return new TextEncoder().encode(text).length;
	}
	if (typeof Buffer !== "undefined") {
		return Buffer.byteLength(text, "utf8");
	}
	return text.length;
}

/**
 * Measure wrapped payload size in bytes.
 * @param payload - Payload to measure.
 * @returns Wrapped text size in bytes.
 */
function wrappedPayloadSize(payload: ReactionDatabasePayload): number {
	const wrapped = wrapJsonPayloadForDatabasePage(serializePayloadJson(payload));
	return utf8ByteLength(wrapped);
}

/**
 * Split entries into deterministic shards by size.
 * @param entries - Combined entries map.
 * @returns Shard layout.
 */
function splitEntriesIntoShards(entries: Record<string, ReactionEntry>): ShardLayout {
	const commentIds = Object.keys(entries).sort((a, b) => a.localeCompare(b));
	const shardGroups: Array<Record<string, ReactionEntry>> = [];
	let currentGroup: Record<string, ReactionEntry> = {};

	const pushCurrentGroup = (): void => {
		if (Object.keys(currentGroup).length === 0) {
			return;
		}
		shardGroups.push(currentGroup);
		currentGroup = {};
	};

	for (const commentId of commentIds) {
		const candidateGroup = {
			...currentGroup,
			[commentId]: entries[commentId],
		};
		const candidatePayload: ReactionDatabasePayload = {
			version: SUPPORTED_SCHEMA_VERSION,
			entries: candidateGroup,
		};
		const candidateSize = wrappedPayloadSize(candidatePayload);
		if (candidateSize <= DATABASE_PAGE_SOFT_LIMIT_BYTES || Object.keys(currentGroup).length === 0) {
			currentGroup = candidateGroup;
			continue;
		}
		pushCurrentGroup();
		currentGroup = { [commentId]: entries[commentId] };
	}
	pushCurrentGroup();

	const shardEntries: Array<{ shardId: string; entries: Record<string, ReactionEntry> }> = [];
	const shardMap: Record<string, string> = {};
	shardGroups.forEach((group, index) => {
		const shardId = `${SHARD_PREFIX}${index + 1}`;
		const canonicalEntries = canonicalizeDatabasePayload({
			version: SUPPORTED_SCHEMA_VERSION,
			entries: group,
		}).entries;
		shardEntries.push({
			shardId,
			entries: canonicalEntries,
		});
		Object.keys(canonicalEntries).forEach((commentId) => {
			shardMap[commentId] = shardId;
		});
	});

	return {
		shardEntries,
		shardMap,
	};
}

/**
 * Return the next deterministic shard id for a base page.
 * @param shardIds - Existing shard ids.
 * @returns Next shard id.
 */
function allocateNextShardId(shardIds: string[]): string {
	let maxNumber = 0;
	for (const shardId of shardIds) {
		const parsed = Number(shardId.slice(SHARD_PREFIX.length));
		if (!Number.isNaN(parsed) && parsed > maxNumber) {
			maxNumber = parsed;
		}
	}
	return `${SHARD_PREFIX}${maxNumber + 1}`;
}

/**
 * Build canonical shard index payload for a sharded base page.
 * @param shardIds - Shard ids in stable order.
 * @param shardMap - Comment-to-shard mapping.
 * @returns Canonical base payload.
 */
function buildShardIndexPayload(
	shardIds: string[],
	shardMap: Record<string, string>,
): ReactionDatabasePayload {
	return canonicalizeDatabasePayload({
		version: SUPPORTED_SCHEMA_VERSION,
		entries: {},
		sharded: true,
		shards: shardIds,
		shardMap,
	});
}

/**
 * Determine whether a shard payload fits within the configured soft limit.
 * Single-entry shards are allowed to exceed the soft limit because they cannot be split further.
 * @param entries - Candidate shard entries.
 * @returns True when the shard can be persisted.
 */
function canPersistShardEntries(entries: Record<string, ReactionEntry>): boolean {
	return wrappedPayloadSize({
		version: SUPPORTED_SCHEMA_VERSION,
		entries,
	}) <= DATABASE_PAGE_SOFT_LIMIT_BYTES || Object.keys(entries).length <= 1;
}

/**
 * Create a missing-page snapshot for a new shard save.
 * @returns Snapshot representing a missing page.
 */
function makeMissingPageSnapshot(): PageWikitextSnapshot {
	return {
		exists: false,
		text: null,
		revisionId: null,
		revisionTimestamp: null,
	};
}

/**
 * Invalidate cache for base page and its shards.
 * @param baseTitle - Base database title.
 */
function invalidateCacheForBase(baseTitle: string): void {
	const shardPrefix = `${baseTitle}/`;
	for (const key of Array.from(databaseCache.keys())) {
		if (key === baseTitle || key.startsWith(shardPrefix)) {
			databaseCache.delete(key);
		}
	}
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
			snapshot: cached.snapshot,
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
				databaseCache.set(title, { payload, fetchedAt: Date.now(), snapshot });
				clearReadOnly(title);
				return {
					ok: true,
					title,
					payload,
					fromCache: false,
					snapshot,
				};
			}
			const parsed = parseDatabasePageText(snapshot.text);
			if ("readOnly" in parsed) {
				if (RECOVER_AS_EMPTY_PARSE_REASONS.has(parsed.reason)) {
					console.warn(
						"[Reaction] Recovering malformed reaction database page as empty payload.",
						title,
						parsed.reason,
					);
					const payload = makeEmptyPayload();
					databaseCache.set(title, { payload, fetchedAt: Date.now(), snapshot });
					clearReadOnly(title);
					return {
						ok: true,
						title,
						payload,
						fromCache: false,
						snapshot,
					};
				}
				markReadOnly(title, parsed.reason);
				return {
					ok: false,
					title,
					readOnly: true,
					reason: parsed.reason,
				};
			}
			const payload = parsed.payload;
			databaseCache.set(title, { payload, fetchedAt: Date.now(), snapshot });
			clearReadOnly(title);
			return {
				ok: true,
				title,
				payload,
				fromCache: false,
				snapshot,
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

	if (!isShardedPayload(page.payload)) {
		return {
			title,
			entry: page.payload.entries[commentId] ?? null,
			readOnly: isReactionDatabaseReadOnlyTitle(title),
			reason: readOnlyReasons.get(title),
		};
	}

	const shards = page.payload.shards ?? [];
	const preferredShard = page.payload.shardMap?.[commentId];
	const orderedShardIds = preferredShard
		? [preferredShard, ...shards.filter((shardId) => shardId !== preferredShard)]
		: shards.slice();
	for (const shardId of orderedShardIds) {
		const shardTitle = buildShardTitle(title, shardId);
		const shardPage = await loadReactionDatabasePage(shardTitle, options);
		if (!shardPage.ok) {
			return {
				title,
				entry: null,
				readOnly: true,
				reason: shardPage.reason,
			};
		}
		const entry = shardPage.payload.entries[commentId];
		if (entry) {
			return {
				title,
				entry,
				readOnly: false,
			};
		}
	}

	return {
		title,
		entry: null,
		readOnly: false,
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
	options?: {
		notifySuccess?: boolean;
		notifyFailure?: boolean;
		snapshot?: PageWikitextSnapshot;
	},
): Promise<SavePageWikitextResult> {
	const canonicalPayload = canonicalizeDatabasePayload(payload);
	const wrapped = wrapJsonPayloadForDatabasePage(serializePayloadJson(canonicalPayload));
	const result = await savePageWikitext(title, wrapped, summary, {
		notifySuccess: options?.notifySuccess ?? false,
		notifyFailure: options?.notifyFailure ?? true,
		appendBacklink: true,
		baseTimestamp: options?.snapshot?.revisionTimestamp ?? null,
		createOnly: options?.snapshot ? !options.snapshot.exists : false,
	});
	if (result.ok) {
		databaseCache.set(title, {
			payload: canonicalPayload,
			fetchedAt: Date.now(),
			snapshot: {
				exists: true,
				text: wrapped,
				revisionId: null,
				revisionTimestamp: null,
			},
		});
		clearReadOnly(title);
	} else {
		databaseCache.delete(title);
	}
	return result;
}

/**
 * Persist as single-page payload.
 * @param title - Base title.
 * @param entries - Combined entries.
 * @param summary - Edit summary.
 * @param options - Save options.
 * @returns Save result.
 */
async function persistAsSinglePage(
	title: string,
	entries: Record<string, ReactionEntry>,
	summary: string,
	options?: {
		notifySuccess?: boolean;
		notifyFailure?: boolean;
		pageSnapshots?: Record<string, PageWikitextSnapshot>;
	},
): Promise<SavePageWikitextResult> {
	const payload: ReactionDatabasePayload = {
		version: SUPPORTED_SCHEMA_VERSION,
		entries,
	};
	return saveReactionDatabasePage(title, payload, summary, {
		notifySuccess: options?.notifySuccess,
		notifyFailure: options?.notifyFailure,
		snapshot: options?.pageSnapshots?.[title],
	});
}

/**
 * Persist as sharded payload.
 * @param title - Base title.
 * @param layout - Shard layout.
 * @param summary - Edit summary.
 * @param options - Save options.
 * @returns Save result.
 */
async function persistAsShardedPages(
	title: string,
	layout: ShardLayout,
	summary: string,
	options?: {
		notifySuccess?: boolean;
		notifyFailure?: boolean;
		pageSnapshots?: Record<string, PageWikitextSnapshot>;
	},
): Promise<SavePageWikitextResult> {
	for (const shard of layout.shardEntries) {
		const shardTitle = buildShardTitle(title, shard.shardId);
		const shardSave = await saveReactionDatabasePage(
			shardTitle,
			{
				version: SUPPORTED_SCHEMA_VERSION,
				entries: shard.entries,
			},
			summary,
			{
				notifySuccess: false,
				notifyFailure: false,
				snapshot: options?.pageSnapshots?.[shardTitle],
			},
		);
		if (!shardSave.ok) {
			return shardSave;
		}
	}

	const basePayload: ReactionDatabasePayload = {
		version: SUPPORTED_SCHEMA_VERSION,
		entries: {},
		sharded: true,
		shards: layout.shardEntries.map((shard) => shard.shardId),
		shardMap: layout.shardMap,
	};
	const baseSave = await saveReactionDatabasePage(title, basePayload, summary, {
		notifySuccess: options?.notifySuccess,
		notifyFailure: options?.notifyFailure,
		snapshot: options?.pageSnapshots?.[title],
	});
	if (!baseSave.ok) {
		invalidateCacheForBase(title);
	}
	return baseSave;
}

/**
 * Persist combined entries using single-page or sharded strategy.
 * @param title - Base title.
 * @param entries - Combined entries.
 * @param summary - Edit summary.
 * @param options - Save options.
 * @returns Save result.
 */
async function persistCombinedEntries(
	title: string,
	entries: Record<string, ReactionEntry>,
	summary: string,
	options?: {
		notifySuccess?: boolean;
		notifyFailure?: boolean;
		pageSnapshots?: Record<string, PageWikitextSnapshot>;
	},
): Promise<SavePageWikitextResult> {
	const canonicalEntries = canonicalizeDatabasePayload({
		version: SUPPORTED_SCHEMA_VERSION,
		entries,
	}).entries;

	const singlePayload: ReactionDatabasePayload = {
		version: SUPPORTED_SCHEMA_VERSION,
		entries: canonicalEntries,
	};
	if (wrappedPayloadSize(singlePayload) <= DATABASE_PAGE_SOFT_LIMIT_BYTES) {
		return persistAsSinglePage(title, canonicalEntries, summary, options);
	}

	const layout = splitEntriesIntoShards(canonicalEntries);
	const baseIndexPayload: ReactionDatabasePayload = {
		version: SUPPORTED_SCHEMA_VERSION,
		entries: {},
		sharded: true,
		shards: layout.shardEntries.map((shard) => shard.shardId),
		shardMap: layout.shardMap,
	};
	if (wrappedPayloadSize(baseIndexPayload) > DATABASE_PAGE_SOFT_LIMIT_BYTES) {
		return {
			ok: false,
			errorCode: "database_shard_index_too_large",
			errorInfo: "Shard index exceeded page size limit.",
		};
	}

	return persistAsShardedPages(title, layout, summary, options);
}

/**
 * Resolve queue keys for a write so shard-mode operations lock both base and shard titles.
 * @param title - Base database title.
 * @param commentId - DiscussionTools comment id.
 * @returns Ordered queue keys.
 */
async function resolveWriteQueueKeys(title: string, commentId: string): Promise<string[]> {
	const basePage = await loadReactionDatabasePage(title);
	if (!basePage.ok || !isShardedPayload(basePage.payload)) {
		return [title];
	}
	const shardIds = basePage.payload.shards ?? [];
	const shardId = basePage.payload.shardMap?.[commentId] ?? shardIds[shardIds.length - 1];
	if (!shardId) {
		return [title];
	}
	return [title, buildShardTitle(title, shardId)];
}

/**
 * Execute a page mutation in serialized order for one or more queue keys.
 * @param titles - Queue keys to reserve.
 * @param task - Task callback.
 * @returns Task result.
 */
function enqueuePageTask<T>(titles: string[], task: () => Promise<T>): Promise<T> {
	const queueKeys = Array.from(new Set(titles.filter((title) => title.trim().length > 0)));
	queueKeys.sort((a, b) => a.localeCompare(b));
	const previousReservations = queueKeys.map((title) => pageWriteQueue.get(title) ?? Promise.resolve());
	let releaseReservation: (() => void) | null = null;
	const reservation = new Promise<void>((resolve) => {
		releaseReservation = resolve;
	});
	queueKeys.forEach((title) => {
		pageWriteQueue.set(title, reservation);
	});
	const next = Promise.all(previousReservations.map((promise) => promise.catch(() => undefined)))
		.then(task)
		.finally(() => {
			releaseReservation?.();
			queueKeys.forEach((title) => {
				if (pageWriteQueue.get(title) === reservation) {
					pageWriteQueue.delete(title);
				}
			});
		});
	return next;
}

/**
 * Load base page plus the shard currently responsible for a comment mutation.
 * @param title - Base database title.
 * @param commentId - DiscussionTools comment id.
 * @returns Sharded mutation state or read-only load failure.
 */
async function loadShardedMutationState(
	title: string,
	commentId: string,
	basePage: LoadedReactionDatabasePage,
): Promise<ShardedMutationState | ShardedMutationAttemptLoadFailure> {
	if (!isShardedPayload(basePage.payload)) {
		return {
			kind: "load_failure",
			readOnly: true,
			reason: "database_shard_index_invalid",
		};
	}
	const shardIds = basePage.payload.shards ?? [];
	const mappedShardId = basePage.payload.shardMap?.[commentId] ?? null;
	const workingShardId = mappedShardId ?? shardIds[shardIds.length - 1] ?? null;
	if (!workingShardId) {
		return {
			kind: "load_failure",
			readOnly: true,
			reason: "database_shard_index_invalid",
		};
	}
	const workingShardTitle = buildShardTitle(title, workingShardId);
	const workingShardPage = await loadReactionDatabasePage(workingShardTitle, { fresh: true });
	if (!workingShardPage.ok) {
		return {
			kind: "load_failure",
			readOnly: true,
			reason: workingShardPage.reason,
		};
	}
	return {
		basePage,
		mappedShardId,
		workingShardId,
		workingShardTitle,
		workingShardPage,
	};
}

/**
 * Persist a targeted mutation against an already-sharded base page.
 * Existing mapped comments stay in their current shard. New comments go to the last shard if it fits,
 * otherwise they create the next deterministic shard. Base index writes only occur when the mapping changes.
 * @param title - Base database title.
 * @param commentId - DiscussionTools comment id.
 * @param updater - Entry updater callback.
 * @param options - Save options.
 * @returns Sharded mutation attempt result.
 */
async function persistShardedMutationAttempt(
	title: string,
	commentId: string,
	updater: (current: ReactionEntry) => UpdateEntryResult,
	basePage: LoadedReactionDatabasePage,
	options: UpdateCommentEntryOptions,
): Promise<ShardedMutationAttemptResult> {
	const shardedState = await loadShardedMutationState(title, commentId, basePage);
	if ("kind" in shardedState) {
		return shardedState;
	}
	const {
		basePage: shardedBasePage,
		mappedShardId,
		workingShardId,
		workingShardTitle,
		workingShardPage,
	} = shardedState;
	const workingShardEntries = cloneEntries(workingShardPage.payload.entries);
	const storedEntry = workingShardEntries[commentId] ?? null;
	const currentEntry = storedEntry ?? {};
	const updated = updater(currentEntry);

	const storedEntryHasData = hasReactionEntryData(storedEntry);
	const needsMappingAdditionRepair = mappedShardId === null && storedEntryHasData;
	const needsMappingRemovalRepair = mappedShardId !== null && !storedEntryHasData;
	if (!updated.changed && !needsMappingAdditionRepair && !needsMappingRemovalRepair) {
		return {
			kind: "no_change",
			entry: updated.entry,
			reason: updated.reason ?? "no_changes",
		};
	}

	const nextEntry = updated.changed
		? (updated.entry && hasReactionEntryData(updated.entry)
			? canonicalizeReactionEntry(updated.entry)
			: null)
		: (needsMappingAdditionRepair && storedEntry
			? canonicalizeReactionEntry(storedEntry)
			: null);

	if (mappedShardId !== null) {
		if (nextEntry) {
			workingShardEntries[commentId] = nextEntry;
			const shardSave = await saveReactionDatabasePage(
				workingShardTitle,
				{
					version: SUPPORTED_SCHEMA_VERSION,
					entries: workingShardEntries,
				},
				options.summary,
				{
					notifySuccess: options.notifySuccess ?? false,
					notifyFailure: false,
					snapshot: workingShardPage.snapshot,
				},
			);
			return {
				kind: "save",
				entry: nextEntry,
				saveResult: shardSave,
			};
		}

		delete workingShardEntries[commentId];
		if (!needsMappingRemovalRepair) {
			const shardSave = await saveReactionDatabasePage(
				workingShardTitle,
				{
					version: SUPPORTED_SCHEMA_VERSION,
					entries: workingShardEntries,
				},
				options.summary,
				{
					notifySuccess: false,
					notifyFailure: false,
					snapshot: workingShardPage.snapshot,
				},
			);
			if (!shardSave.ok) {
				return {
					kind: "save",
					entry: null,
					saveResult: shardSave,
				};
			}
		}

		const nextShardMap = {
			...(shardedBasePage.payload.shardMap ?? {}),
		};
		delete nextShardMap[commentId];
		const basePayload = buildShardIndexPayload(shardedBasePage.payload.shards ?? [], nextShardMap);
		const baseSave = await saveReactionDatabasePage(title, basePayload, options.summary, {
			notifySuccess: options.notifySuccess ?? false,
			notifyFailure: false,
			snapshot: shardedBasePage.snapshot,
		});
		return {
			kind: "save",
			entry: null,
			saveResult: baseSave,
		};
	}

	if (!nextEntry) {
		return {
			kind: "no_change",
			entry: null,
			reason: updated.reason ?? "no_changes",
		};
	}

	const currentShardIds = shardedBasePage.payload.shards ?? [];
	let targetShardId = workingShardId;
	let targetShardTitle = workingShardTitle;
	let targetShardEntries = cloneEntries(workingShardEntries);
	targetShardEntries[commentId] = nextEntry;
	let targetShardSnapshot = workingShardPage.snapshot;
	if (!canPersistShardEntries(targetShardEntries)) {
		targetShardId = allocateNextShardId(currentShardIds);
		targetShardTitle = buildShardTitle(title, targetShardId);
		targetShardEntries = {
			[commentId]: nextEntry,
		};
		targetShardSnapshot = makeMissingPageSnapshot();
	}

	const nextShardIds = targetShardId === workingShardId
		? currentShardIds.slice()
		: [...currentShardIds, targetShardId];
	const nextShardMap = {
		...(shardedBasePage.payload.shardMap ?? {}),
		[commentId]: targetShardId,
	};
	const basePayload = buildShardIndexPayload(nextShardIds, nextShardMap);
	if (wrappedPayloadSize(basePayload) > DATABASE_PAGE_SOFT_LIMIT_BYTES) {
		return {
			kind: "save",
			entry: nextEntry,
			saveResult: {
				ok: false,
				errorCode: "database_shard_index_too_large",
				errorInfo: "Shard index exceeded page size limit.",
			},
		};
	}

	const baseSave = await saveReactionDatabasePage(title, basePayload, options.summary, {
		notifySuccess: false,
		notifyFailure: false,
		snapshot: shardedBasePage.snapshot,
	});
	if (!baseSave.ok) {
		return {
			kind: "save",
			entry: nextEntry,
			saveResult: baseSave,
		};
	}

	const shardSave = await saveReactionDatabasePage(
		targetShardTitle,
		{
			version: SUPPORTED_SCHEMA_VERSION,
			entries: targetShardEntries,
		},
		options.summary,
		{
			notifySuccess: options.notifySuccess ?? false,
			notifyFailure: false,
			snapshot: targetShardSnapshot,
		},
	);
	return {
		kind: "save",
		entry: nextEntry,
		saveResult: shardSave,
	};
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
	const normalizedUser = normalizeUser(request.user);
	if (!normalizedIcon || !normalizedUser) {
		return { changed: false, entry: canonicalizeReactionEntry(current), reason: "no_changes" };
	}
	const timestamp = normalizeTimestamp(request.timestamp);
	const timestampIso = normalizeTimestampIso(request.timestampIso)
		?? deriveIsoFromSignatureTimestamp(timestamp);
	const entry = canonicalizeReactionEntry(current);
	const bucket = entry[normalizedIcon] ? entry[normalizedIcon].slice() : [];
	const userKey = toUserKey(normalizedUser);

	if (request.action === "append") {
		if (bucket.length > 0) {
			return { changed: false, entry, reason: "reaction_exists" };
		}
		entry[normalizedIcon] = [{ user: normalizedUser, timestamp, timestampIso }];
		return { changed: true, entry: canonicalizeReactionEntry(entry) };
	}

	if (request.action === "upvote") {
		const exists = bucket.some((participant) => toUserKey(participant.user) === userKey);
		if (exists) {
			return { changed: false, entry, reason: "no_changes" };
		}
		bucket.push({
			user: normalizedUser,
			timestamp,
			timestampIso,
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

	const queueKeys = await resolveWriteQueueKeys(title, commentId);
	return enqueuePageTask(queueKeys, async () => {
		for (let attempt = 0; attempt < 3; attempt++) {
			const basePage = await loadReactionDatabasePage(title, { fresh: true });
			if (!basePage.ok) {
				return {
					ok: false,
					title,
					entry: null,
					readOnly: true,
					reason: basePage.reason,
				};
			}

			if (isShardedPayload(basePage.payload)) {
				const shardedAttempt = await persistShardedMutationAttempt(title, commentId, updater, basePage, options);
				if (shardedAttempt.kind === "load_failure") {
					return {
						ok: false,
						title,
						entry: null,
						readOnly: true,
						reason: shardedAttempt.reason,
					};
				}
				if (shardedAttempt.kind === "no_change") {
					return {
						ok: false,
						title,
						entry: shardedAttempt.entry,
						readOnly: isReactionDatabaseReadOnlyTitle(title),
						reason: shardedAttempt.reason ?? "no_changes",
					};
				}

				if (shardedAttempt.saveResult.ok) {
					return {
						ok: true,
						title,
						entry: shardedAttempt.entry,
						readOnly: false,
					};
				}

				invalidateCacheForBase(title);

				if (
					shardedAttempt.saveResult.errorCode
					&& REACTION_WRITE_CONFLICT_SAVE_CODES.has(shardedAttempt.saveResult.errorCode)
					&& attempt < 2
				) {
					const backoff = 150 * (2 ** attempt) + Math.floor(Math.random() * 120);
					await delay(backoff);
					continue;
				}
				if (isReadOnlySaveError(shardedAttempt.saveResult)) {
					markReadOnly(title, shardedAttempt.saveResult.errorCode ?? "database_write_readonly");
					return {
						ok: false,
						title,
						entry: null,
						readOnly: true,
						reason: shardedAttempt.saveResult.errorCode ?? "database_write_readonly",
					};
				}
				return {
					ok: false,
					title,
					entry: null,
					readOnly: false,
					reason: shardedAttempt.saveResult.errorCode ?? "database_write_failed",
				};
			}

			const combined: CombinedEntriesLoadSuccess = {
				ok: true,
				title,
				entries: cloneEntries(basePage.payload.entries),
				pageSnapshots: {
					[title]: basePage.snapshot,
				},
			};

			const currentEntry = combined.entries[commentId] ?? {};
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
			const nextEntries = cloneEntries(combined.entries);
			if (updated.entry && hasReactionEntryData(updated.entry)) {
				nextEntries[commentId] = canonicalizeReactionEntry(updated.entry);
			} else {
				delete nextEntries[commentId];
			}

			const saveResult = await persistCombinedEntries(title, nextEntries, options.summary, {
				notifySuccess: options.notifySuccess,
				notifyFailure: false,
				pageSnapshots: combined.pageSnapshots,
			});
			if (saveResult.ok) {
				return {
					ok: true,
					title,
					entry: nextEntries[commentId] ?? null,
					readOnly: false,
				};
			}

			invalidateCacheForBase(title);

			if (saveResult.errorCode && REACTION_WRITE_CONFLICT_SAVE_CODES.has(saveResult.errorCode) && attempt < 2) {
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
