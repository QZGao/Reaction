import { addReactionButtons } from "./dom/buttons";
import { fetchPageProperties } from "./api/client";

interface MagicWordDescriptor {
	property: string;
	labels: string[];
}

const MAGIC_WORD_SKIP: MagicWordDescriptor[] = [
	{ property: "notalk", labels: ["__NOTALK__"] },
	{ property: "archivedtalk", labels: ["__ARCHIVEDTALK__", "__已存档讨论__"] },
];

let skipCache: boolean | null = null;

/**
 * Determine whether the current page should skip Reaction initialization.
 * @returns Promise resolving to true if the page should be skipped.
 */
async function shouldSkipPage(): Promise<boolean> {
	if (skipCache !== null) {
		return skipCache;
	}
	let propertyNames: Set<string> | null = null;
	try {
		propertyNames = await fetchPageProperties();
	} catch (error) {
		console.error("[Reaction] Failed to fetch page info for magic word detection.", error);
	}
	if (!propertyNames || propertyNames.size === 0) {
		skipCache = false;
		return skipCache;
	}
	const matched = MAGIC_WORD_SKIP.find((word) => propertyNames.has(word.property));
	if (matched) {
		const label = matched.labels[0] ?? matched.property;
		console.log(`[Reaction] Skipping initialization because ${label} is present in page info.`);
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
