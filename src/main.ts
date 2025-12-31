import { addReactionButtons } from "./dom/buttons";
import { fetchPageWikitext } from "./api/client";

const MAGIC_WORD_SKIP = ["__NOTALK__", "__ARCHIVEDTALK__"];

let skipCache: boolean | null = null;

/**
 * Determine whether the current page should skip Reaction initialization.
 * @returns Promise resolving to true if the page should be skipped.
 */
async function shouldSkipPage(): Promise<boolean> {
	if (skipCache !== null) {
		return skipCache;
	}
	const wikitext = await fetchPageWikitext();
	if (!wikitext) {
		skipCache = false;
		return skipCache;
	}
	const matched = MAGIC_WORD_SKIP.find((word) => wikitext.includes(word));
	if (matched) {
		console.log(`[Reaction] Skipping initialization because ${matched} is present in wikitext.`);
		skipCache = true;
		return skipCache;
	}
	skipCache = false;
	return skipCache;
}

/**
 * Initialization entry point: load required modules and bind events.
 */
async function init() {
	if (await shouldSkipPage()) {
		return;
	}
	mw.loader.load("/w/index.php?title=Template:Reaction/styles.css&action=raw&ctype=text/css", "text/css");
	try {
		await mw.loader.using("ext.discussionTools.init");
	} catch (error) {
		console.error("[Reaction] Failed to load DiscussionTools module.", error);
		return;
	}
	mw.hook("wikipage.content").add(function (container) {
		const roots = container?.get ? container.get() : undefined;
		setTimeout(() => {
			void addReactionButtons(roots && roots.length > 0 ? roots : undefined);
		}, 200);
	});
}

void init();
