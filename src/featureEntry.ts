import { addReactionButtons, toggleReactionEnabled } from "./dom/buttons";

const FEATURE_BOOTSTRAP_GUARD_KEY = "__REACTION_FEATURE_BOOTSTRAPPED__";

let discussionToolsHookBound = false;

/**
 * Ensure DiscussionTools hooks and fallback scanning are attached once.
 */
export async function bootstrapFeatureRuntime(): Promise<void> {
	const globalState = globalThis as typeof globalThis & {
		[FEATURE_BOOTSTRAP_GUARD_KEY]?: boolean;
	};
	if (globalState[FEATURE_BOOTSTRAP_GUARD_KEY]) {
		return;
	}
	globalState[FEATURE_BOOTSTRAP_GUARD_KEY] = true;

	mw.loader.load("/w/index.php?title=Template:Reaction/styles.css&action=raw&ctype=text/css", "text/css");
	try {
		await mw.loader.using("ext.discussionTools.init");
	} catch (error) {
		console.error("[Reaction] Failed to load DiscussionTools module.", error);
		globalState[FEATURE_BOOTSTRAP_GUARD_KEY] = false;
		return;
	}
	if (!discussionToolsHookBound) {
		discussionToolsHookBound = true;
		mw.hook("wikipage.content").add(function (container) {
			const roots = container?.get ? container.get() : undefined;
			setTimeout(() => {
				void addReactionButtons(roots && roots.length > 0 ? roots : undefined);
			}, 200);
		});
	}

	// Fallback for cases where the hook fires before this gadget loads.
	setTimeout(() => {
		void addReactionButtons(document);
	}, 0);
}

const FEATURE_API_GLOBAL_KEY = "__REACTION_FEATURE_API__";

type ReactionFeatureApi = {
	bootstrapFeatureRuntime: typeof bootstrapFeatureRuntime;
	toggleReactionEnabled: typeof toggleReactionEnabled;
};

const globalState = globalThis as typeof globalThis & {
	[FEATURE_API_GLOBAL_KEY]?: ReactionFeatureApi;
};

globalState[FEATURE_API_GLOBAL_KEY] = {
	bootstrapFeatureRuntime,
	toggleReactionEnabled,
};
