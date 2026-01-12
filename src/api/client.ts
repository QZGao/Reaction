import state from "../state";
import { t, tReaction } from "../i18n";

interface RevisionSlot {
	main: {
		"*": string;
	};
}

interface Revision {
	slots: RevisionSlot;
}

interface QueryPage {
	revisions: Revision[];
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
 * Fetch the current page wikitext.
 * @param title - Optional page title override.
 * @returns Raw page wikitext or null if unavailable.
 */
export async function fetchPageWikitext(title?: string): Promise<string | null> {
	const response = await getApi().get({
		action: "query",
		titles: title ?? state.pageName,
		prop: "revisions",
		rvslots: "*",
		rvprop: "content",
		indexpageids: 1,
	}) as RetrieveFullTextResponse;
	const pageId = response.query.pageids[0];
	const page = response.query.pages[pageId];
	const revision = page?.revisions?.[0];
	const slot = revision?.slots?.main;
	const content = slot?.["*"] ?? (slot as { content?: string } | undefined)?.content ?? null;
	return typeof content === "string" ? content : null;
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
 * Save a full wikitext snapshot.
 * @param fulltext - Wikitext payload to save.
 * @param summary - Edit summary.
 * @returns Promise indicating success.
 */
export async function saveFullText(fulltext: string, summary: string): Promise<boolean> {
	try {
		await getApi().postWithToken("edit", {
			action: "edit",
			title: state.pageName,
			text: fulltext,
			summary: summary + " ([[meta:Reaction|Reaction]])",
		});
		mw.notify(tReaction("api.notifications.save_success"), {
			title: t("default.titles.success"), type: "success",
		});
		return true;
	} catch (error) {
		console.error(error);
		mw.notify(tReaction("api.notifications.save_failure"), { title: t("default.titles.error"), type: "error" });
		return false;
	}
}
