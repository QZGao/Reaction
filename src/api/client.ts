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

// MediaWiki API instance cache
let apiInstance: mw.Api | null = null;

/**
 * Retrieve the shared MediaWiki API instance.
 * @returns MediaWiki API instance.
 */
export function getApi(): mw.Api {
	if (!apiInstance) {
		apiInstance = new mw.Api({
			ajax: {
				headers: { "User-Agent": `Reaction/${state.version}` }
			}
		});
	}
	return apiInstance;
}

/**
 * Fetch the complete wikitext for the current page.
 * @returns Promise resolving to the page wikitext.
 */
export async function retrieveFullText(): Promise<string> {
	const response = await getApi().get({
		action: "query",
		titles: state.pageName,
		prop: "revisions",
		rvslots: "*",
		rvprop: "content",
		indexpageids: 1,
	}) as RetrieveFullTextResponse;
	const pageId = response.query.pageids[0];
	const page = response.query.pages[pageId];
	const revision = page?.revisions?.[0];
	const fulltext = revision?.slots?.main?.["*"] ?? "";
	return `${fulltext}\n`;
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
			summary: summary + " ([[User:SuperGrey/gadgets/Reaction|Reaction]])",
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
