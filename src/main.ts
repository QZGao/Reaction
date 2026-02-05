import { addReactionButtons } from "./dom/buttons";
import { fetchPageProperties, doesPageExist } from "./api/client";
import { isVector2022Appearance, updateAppearancePortlet } from "./dom/cdxPortlet";
import { updateLegacyReactionPortlets } from "./dom/portlet";

const PAGE_NAME_WHITELIST: string[] = [
	"Wikipedia:新条目推荐/候选",
];

interface MagicWordDescriptor {
	property: string;
	labels: string[];
}

const MAGIC_WORD_SKIP: MagicWordDescriptor[] = [
	{ property: "notalk", labels: ["__NOTALK__"] },
	{ property: "archivedtalk", labels: ["__ARCHIVEDTALK__", "__已存档讨论__"] },
];

let skipCache: boolean | null = null;
let modulePresenceCache: boolean | null = null;
const INIT_GUARD_KEY = "__REACTION_INIT_STARTED__";

/**
 * Check if Module:Reaction exists on the wiki.
 * @returns Promise resolving to true if the module exists.
 */
async function isReactionModuleAvailable(): Promise<boolean> {
	if (modulePresenceCache !== null) {
		return modulePresenceCache;
	}
	try {
		modulePresenceCache = await doesPageExist("Module:Reaction");
		if (!modulePresenceCache) {
			console.warn("[Reaction] Module:Reaction is missing; skipping initialization.");
		}
	} catch (error) {
		console.error("[Reaction] Failed to verify Module:Reaction availability.", error);
		modulePresenceCache = true;
	}
	return modulePresenceCache;
}

/**
 * Determine whether the current page should skip Reaction initialization.
 * @returns Promise resolving to true if the page should be skipped.
 */
async function shouldSkipPage(): Promise<boolean> {
	if (skipCache !== null) {
		return skipCache;
	}
	const pageName = mw.config.get("wgPageName");
	if (PAGE_NAME_WHITELIST.includes(pageName)) {
		skipCache = false;
		return skipCache;
	}
	const namespaceNumber = mw.config.get("wgNamespaceNumber") as number | null | undefined;
	const skippedNamespaces = new Set([
		-2, // Media
		-1, // Special
		0,  // Main
		6,  // File
		8,  // MediaWiki
		10, // Template
		12, // Help
		14  // Category
	]);
	if (namespaceNumber != null && skippedNamespaces.has(namespaceNumber)) {
		skipCache = true;
		return skipCache;
	}
	const contentModel = mw.config.get("wgPageContentModel") as string | null | undefined;
	if (contentModel && contentModel !== "wikitext") {
		skipCache = true;
		return skipCache;
	}
	const hasReactionModule = await isReactionModuleAvailable();
	if (!hasReactionModule) {
		skipCache = true;
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
	if (isVector2022Appearance()) {
		updateAppearancePortlet();
	} else {
		updateLegacyReactionPortlets();
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

	// Fallback for cases where the hook fires before this gadget loads.
	setTimeout(() => {
		void addReactionButtons(document);
	}, 0);
}

const globalState = globalThis as typeof globalThis & {
	[INIT_GUARD_KEY]?: boolean;
};

if (globalState[INIT_GUARD_KEY]) {
	console.warn("[Reaction] Initialization skipped because it already ran.");
} else {
	globalState[INIT_GUARD_KEY] = true;
	void init();
}
