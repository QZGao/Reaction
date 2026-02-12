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
}

export interface SavePageWikitextResult {
	ok: boolean;
	errorCode?: string;
	errorInfo?: string;
}

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
 * Fetch page wikitext plus basic revision metadata.
 * @param title - Optional page title override.
 * @returns Snapshot including content and revision information.
 */
export async function fetchPageWikitextSnapshot(title?: string): Promise<PageWikitextSnapshot> {
	const response = await getApi().get({
		action: "query",
		titles: title ?? state.pageName,
		prop: "revisions",
		rvslots: "*",
		rvprop: "content|ids|timestamp",
		indexpageids: 1,
	}) as RetrieveFullTextResponse;
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
	const response = await getApi().post({
		action: "parse",
		prop: "text",
		contentmodel: "wikitext",
		title: titleContext ?? state.pageName,
		text,
		formatversion: 2,
	}) as ParseTextResponse;
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
	try {
		await getApi().postWithToken("edit", {
			action: "edit",
			title,
			text,
			summary: finalSummary,
		});
		if (notifySuccess) {
			mw.notify(tReaction("api.notifications.save_success"), {
				title: t("default.titles.success"), type: "success",
			});
		}
		return { ok: true };
	} catch (error: unknown) {
		const asRecord = (typeof error === "object" && error !== null) ? error as Record<string, unknown> : null;
		const inner = asRecord?.error;
		const innerRecord = (typeof inner === "object" && inner !== null) ? inner as Record<string, unknown> : null;
		const errorCode = typeof innerRecord?.code === "string"
			? innerRecord.code
			: typeof asRecord?.code === "string"
				? asRecord.code
				: undefined;
		const errorInfo = typeof innerRecord?.info === "string"
			? innerRecord.info
			: typeof asRecord?.message === "string"
				? asRecord.message
				: undefined;
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
