import state from "../state";
import { t, tReaction } from "../i18n";

interface RevisionSlot {
	main: {
		"*": string;
	};
}

interface Revision {
	slots: RevisionSlot;
	revid?: number;
	timestamp?: string;
}

interface QueryPage {
	revisions?: Revision[];
	missing?: boolean;
	invalid?: boolean;
}

interface RetrieveFullTextResponse {
	query: {
		pageids: string[];
		pages: Record<string, QueryPage>;
	};
}

interface ParsePropertiesResponse {
	parse?: {
		properties?: Record<string, unknown>;
	};
}

interface ParseTextResponse {
	parse?: {
		text?: string | { "*": string };
	};
}

interface QueryInfoPage {
	missing?: boolean;
	invalid?: boolean;
	title: string;
}

interface QueryInfoResponse {
	query?: {
		pages?: QueryInfoPage[];
	};
}

export interface PageWikitextSnapshot {
	exists: boolean;
	text: string | null;
	revisionId: number | null;
	revisionTimestamp: string | null;
}

export interface SavePageWikitextOptions {
	notifySuccess?: boolean;
	notifyFailure?: boolean;
	appendBacklink?: boolean;
	baseTimestamp?: string | null;
	startTimestamp?: string | null;
	createOnly?: boolean;
}

export interface SavePageWikitextResult {
	ok: boolean;
	errorCode?: string;
	errorInfo?: string;
}

const API_READ_TIMEOUT_MS = 8_000;
const API_WRITE_TIMEOUT_MS = 12_000;
const API_READ_PARSE_MAX_RETRIES = 2;
const RETRYABLE_API_ERROR_CODES = new Set([
	"timeout",
	"http",
	"ajax",
	"network",
	"abort",
]);
const RETRYABLE_API_TEXT_STATUSES = new Set([
	"timeout",
	"error",
	"abort",
]);

// MediaWiki API instance cache
let apiInstance: mw.Api | null = null;

/**
 * Retrieve the shared MediaWiki API instance.
 * @returns MediaWiki API instance.
 */
export function getApi(): mw.Api {
	if (!apiInstance) {
		apiInstance = new mw.Api({ userAgent: `Reaction/${state.version}` });
	}
	return apiInstance;
}

/**
 * Return true when a value is an object record.
 * @param value - Value to inspect.
 * @returns True when the value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Convert a date into MediaWiki-compatible UTC second precision ISO text.
 * @param date - Input date.
 * @returns ISO text without milliseconds.
 */
function toIsoSeconds(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Create a structured timeout error for API requests.
 * @param label - Operation label for diagnostics.
 * @param timeoutMs - Timeout in milliseconds.
 * @returns Timeout error object with API-style code.
 */
function createTimeoutError(label: string, timeoutMs: number): Error & { code: string } {
	const error = new Error(`${label} timed out after ${timeoutMs} ms.`) as Error & { code: string };
	error.code = "timeout";
	return error;
}

/**
 * Normalize arbitrary API rejection payloads into a structured error code.
 * @param error - Unknown rejection payload.
 * @returns Error code when present.
 */
function extractApiErrorCode(error: unknown): string | undefined {
	if (typeof error === "string") {
		return error;
	}
	if (Array.isArray(error)) {
		for (const item of error) {
			const code = extractApiErrorCode(item);
			if (code) {
				return code;
			}
		}
		return undefined;
	}
	if (!isRecord(error)) {
		return undefined;
	}
	if (typeof error.code === "string") {
		return error.code;
	}
	const inner = isRecord(error.error) ? error.error : null;
	return typeof inner?.code === "string" ? inner.code : undefined;
}

/**
 * Normalize arbitrary API rejection payloads into a human-readable error detail.
 * @param error - Unknown rejection payload.
 * @returns Error detail when present.
 */
function extractApiErrorInfo(error: unknown): string | undefined {
	if (typeof error === "string") {
		return error;
	}
	if (error instanceof Error) {
		return error.message;
	}
	if (Array.isArray(error)) {
		for (const item of error) {
			const info = extractApiErrorInfo(item);
			if (info) {
				return info;
			}
		}
		return undefined;
	}
	if (!isRecord(error)) {
		return undefined;
	}
	const inner = isRecord(error.error) ? error.error : null;
	if (typeof inner?.info === "string") {
		return inner.info;
	}
	if (typeof error.info === "string") {
		return error.info;
	}
	if (typeof error.message === "string") {
		return error.message;
	}
	return undefined;
}

/**
 * Extract jQuery textStatus/exception fields from API rejection payloads.
 * @param error - Unknown rejection payload.
 * @returns Transport status when present.
 */
function extractApiTransportStatus(error: unknown): string | undefined {
	if (Array.isArray(error)) {
		for (const item of error) {
			const status = extractApiTransportStatus(item);
			if (status) {
				return status;
			}
		}
		return undefined;
	}
	if (!isRecord(error)) {
		return undefined;
	}
	if (typeof error.textStatus === "string") {
		return error.textStatus;
	}
	if (typeof error.exception === "string") {
		return error.exception;
	}
	return undefined;
}

/**
 * Normalize arbitrary rejection payloads into Error instances for Promise rejection safety.
 * @param error - Unknown rejection payload.
 * @returns Error instance preserving key API diagnostics where possible.
 */
function normalizeApiError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	const wrapped = new Error(extractApiErrorInfo(error) ?? "Reaction API request failed.") as Error & {
		code?: string;
		textStatus?: string;
		exception?: string;
		error?: unknown;
	};
	const code = extractApiErrorCode(error);
	if (code) {
		wrapped.code = code;
	}
	const transportStatus = extractApiTransportStatus(error);
	if (transportStatus) {
		wrapped.textStatus = transportStatus;
		wrapped.exception = transportStatus;
	}
	if (isRecord(error) && "error" in error) {
		wrapped.error = error.error;
	}
	return wrapped;
}

/**
 * Determine whether an API failure looks like a retryable transport issue.
 * @param error - Unknown rejection payload.
 * @returns True when the failure is likely transient.
 */
function isRetryableTransportError(error: unknown): boolean {
	const code = extractApiErrorCode(error)?.toLowerCase();
	if (code && RETRYABLE_API_ERROR_CODES.has(code)) {
		return true;
	}
	const transportStatus = extractApiTransportStatus(error)?.toLowerCase();
	if (transportStatus && RETRYABLE_API_TEXT_STATUSES.has(transportStatus)) {
		return true;
	}
	const info = extractApiErrorInfo(error) ?? "";
	return /network|failed to fetch|timed out|timeout|temporar/i.test(info);
}

/**
 * Wrap an API request with a hard timeout.
 * @param request - Request promise/thenable.
 * @param timeoutMs - Timeout in milliseconds.
 * @param label - Operation label for diagnostics.
 * @returns Promise that rejects on timeout.
 */
function withTimeout<T>(request: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = globalThis.setTimeout(() => {
			reject(createTimeoutError(label, timeoutMs));
		}, timeoutMs);
		Promise.resolve(request)
			.then((value) => {
				globalThis.clearTimeout(timer);
				resolve(value);
			})
			.catch((error: unknown) => {
				globalThis.clearTimeout(timer);
				reject(normalizeApiError(error));
			});
	});
}

/**
 * Execute an API request with timeout and retry handling for transient failures.
 * @param execute - Callback that starts the request.
 * @param timeoutMs - Timeout in milliseconds.
 * @param maxRetries - Number of retries after the first attempt.
 * @param label - Operation label for diagnostics.
 * @returns Request result.
 */
async function requestWithRetry<T>(
	execute: () => PromiseLike<T>,
	timeoutMs: number,
	maxRetries: number,
	label: string,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await withTimeout(execute(), timeoutMs, label);
		} catch (error: unknown) {
			lastError = error;
			if (attempt >= maxRetries || !isRetryableTransportError(error)) {
				throw error;
			}
		}
	}
	throw lastError;
}

/**
 * Fetch page wikitext plus basic revision metadata.
 * @param title - Optional page title override.
 * @returns Snapshot including content and revision information.
 */
export async function fetchPageWikitextSnapshot(title?: string): Promise<PageWikitextSnapshot> {
	const response = await requestWithRetry(
		() => getApi().get({
			action: "query",
			titles: title ?? state.pageName,
			prop: "revisions",
			rvslots: "*",
			rvprop: "content|ids|timestamp",
			indexpageids: 1,
		}),
		API_READ_TIMEOUT_MS,
		API_READ_PARSE_MAX_RETRIES,
		"Reaction page read",
	) as RetrieveFullTextResponse;
	const pageId = response.query.pageids[0];
	const page = response.query.pages[pageId];
	if (!page || page.missing || page.invalid) {
		return {
			exists: false,
			text: null,
			revisionId: null,
			revisionTimestamp: null,
		};
	}
	const revision = page?.revisions?.[0];
	const slot = revision?.slots?.main;
	const content = slot?.["*"] ?? (slot as { content?: string } | undefined)?.content ?? null;
	return {
		exists: true,
		text: typeof content === "string" ? content : null,
		revisionId: typeof revision?.revid === "number" ? revision.revid : null,
		revisionTimestamp: typeof revision?.timestamp === "string" ? revision.timestamp : null,
	};
}

/**
 * Fetch the current page wikitext.
 * @param title - Optional page title override.
 * @returns Raw page wikitext or null if unavailable.
 */
export async function fetchPageWikitext(title?: string): Promise<string | null> {
	const snapshot = await fetchPageWikitextSnapshot(title);
	return snapshot.text;
}

/**
 * Fetch page property names (including magic words) from the parse API.
 * @param title - Optional page title override.
 * @returns Set of property names or null if unavailable.
 */
export async function fetchPageProperties(title?: string): Promise<Set<string> | null> {
	const response = await getApi().get({
		action: "parse",
		page: title ?? state.pageName,
		prop: "properties",
		formatversion: 2,
	}) as ParsePropertiesResponse;
	const properties = response.parse?.properties;
	if (!properties || typeof properties !== "object") {
		return null;
	}
	const names = Object.keys(properties);
	if (names.length === 0) {
		return new Set();
	}
	return new Set(names.map((name) => name.toLowerCase()));
}

/**
 * Determine whether a given page exists.
 * @param title - Page title to check.
 * @returns True if the page exists, false otherwise.
 */
export async function doesPageExist(title: string): Promise<boolean> {
	const response = await getApi().get({
		action: "query",
		titles: title,
		prop: "info",
		formatversion: 2,
	}) as QueryInfoResponse;
	const page = response.query?.pages?.[0];
	if (!page) {
		return false;
	}
	return !page.missing && !page.invalid;
}

/**
 * Fetch the complete wikitext for the current page.
 * @returns Promise resolving to the page wikitext.
 */
export async function retrieveFullText(): Promise<string> {
	const fulltext = await fetchPageWikitext();
	return `${fulltext ?? ""}\n`;
}

/**
 * Parse arbitrary wikitext into HTML using MediaWiki parse API.
 * @param text - Wikitext payload to parse.
 * @param titleContext - Optional title context for template expansion.
 * @returns Parsed HTML string.
 */
export async function parseWikitextToHtml(text: string, titleContext?: string): Promise<string> {
	const response = await requestWithRetry(
		() => getApi().post({
			action: "parse",
			prop: "text",
			contentmodel: "wikitext",
			title: titleContext ?? state.pageName,
			text,
			formatversion: 2,
		}),
		API_READ_TIMEOUT_MS,
		API_READ_PARSE_MAX_RETRIES,
		"Reaction parse request",
	) as ParseTextResponse;
	const parsedText = response.parse?.text;
	if (typeof parsedText === "string") {
		return parsedText;
	}
	const legacyText = parsedText && typeof parsedText === "object"
		? (parsedText as { "*": unknown })["*"]
		: null;
	if (typeof legacyText === "string") {
		return legacyText;
	}
	throw new Error("Parse API did not return HTML text.");
}

/**
 * Save raw wikitext to an arbitrary page title.
 * @param title - Target page title.
 * @param text - Wikitext payload.
 * @param summary - Edit summary prefix.
 * @param options - Save behavior options.
 * @returns Save result, including API error code when available.
 */
export async function savePageWikitext(
	title: string,
	text: string,
	summary: string,
	options?: SavePageWikitextOptions,
): Promise<SavePageWikitextResult> {
	const notifySuccess = options?.notifySuccess ?? true;
	const notifyFailure = options?.notifyFailure ?? true;
	const appendBacklink = options?.appendBacklink ?? true;
	const finalSummary = appendBacklink ? `${summary} ([[meta:Reaction|Reaction]])` : summary;
	const baseTimestamp = options?.baseTimestamp ?? undefined;
	const createOnly = options?.createOnly === true;
	const startTimestamp = (baseTimestamp || createOnly)
		? (options?.startTimestamp ?? toIsoSeconds(new Date()))
		: undefined;
	try {
		await withTimeout(
			getApi().postWithToken("edit", {
				action: "edit",
				title,
				text,
				summary: finalSummary,
				basetimestamp: baseTimestamp,
				starttimestamp: startTimestamp,
				createonly: createOnly ? true : undefined,
			}),
			API_WRITE_TIMEOUT_MS,
			"Reaction page save",
		);
		if (notifySuccess) {
			mw.notify(tReaction("api.notifications.save_success"), {
				title: t("default.titles.success"), type: "success",
			});
		}
		return { ok: true };
	} catch (error: unknown) {
		const errorCode = extractApiErrorCode(error);
		const errorInfo = extractApiErrorInfo(error);
		console.error(error);
		if (notifyFailure) {
			mw.notify(tReaction("api.notifications.save_failure"), { title: t("default.titles.error"), type: "error" });
		}
		return {
			ok: false,
			errorCode,
			errorInfo,
		};
	}
}

/**
 * Save a full wikitext snapshot.
 * @param fulltext - Wikitext payload to save.
 * @param summary - Edit summary.
 * @returns Promise indicating success.
 */
export async function saveFullText(fulltext: string, summary: string): Promise<boolean> {
	const result = await savePageWikitext(state.pageName, fulltext, summary, {
		notifySuccess: true,
		notifyFailure: true,
		appendBacklink: true,
	});
	return result.ok;
}
