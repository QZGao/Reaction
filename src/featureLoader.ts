import state, { setReactionEnabled } from "./state";
import { t } from "./i18n";

const FEATURE_API_GLOBAL_KEY = "__REACTION_FEATURE_API__";
const FEATURE_LOAD_TIMEOUT_MS = 12000;
const FEATURE_POLL_INTERVAL_MS = 50;

type ReactionFeatureApi = {
	bootstrapFeatureRuntime: () => Promise<void>;
	toggleReactionEnabled: (enabled: boolean) => void;
};

let featureLoadPromise: Promise<ReactionFeatureApi> | null = null;
let featureBootstrapped = false;

/**
 * Handle feature bundle load failures with shared logging and user notification.
 * @param error - Original load/bootstrap failure.
 */
function handleFeatureLoadError(error: unknown): void {
	console.error("[Reaction] Failed to load Reaction feature bundle.", error);
	setReactionEnabled(false);
	mw.notify("Reaction feature bundle failed to load.", { title: t("default.titles.error"), type: "error" });
}

/**
 * Read the feature API exported by the lazy-loaded feature bundle.
 * @returns Feature API object when available and valid; otherwise null.
 */
function getFeatureApi(): ReactionFeatureApi | null {
	const globalObj = globalThis as Record<string, unknown>;
	const api = globalObj[FEATURE_API_GLOBAL_KEY];
	if (!api || typeof api !== "object") {
		return null;
	}
	const candidate = api as Partial<ReactionFeatureApi>;
	if (typeof candidate.bootstrapFeatureRuntime !== "function") {
		return null;
	}
	if (typeof candidate.toggleReactionEnabled !== "function") {
		return null;
	}
	return candidate as ReactionFeatureApi;
}

/**
 * Determine whether a script URL corresponds to the base Reaction bundle, based on naming patterns.
 * @param url - Script URL to evaluate.
 * @returns True if the URL matches expected base Reaction bundle patterns; otherwise false.
 */
function isBaseReactionBundleUrl(url: string): boolean {
	return /(?:^|\/)(?:Gadget-)?Reaction\.js(?:[?#]|$|&)/i.test(url);
}

/**
 * Insert "-feature" before the trailing ".js" in a file name.
 * @param fileName - Source JavaScript file name.
 * @returns File name rewritten to the feature bundle variant.
 */
function appendFeatureSuffix(fileName: string): string {
	return fileName.replace(/\.js$/i, "-feature.js");
}

/**
 * Convert a source script URL into the corresponding feature script URL.
 * Handles both `?title=...` URLs and path-based `.js` URLs.
 * @param sourceUrl - URL of the currently loaded base Reaction script.
 * @returns URL for the feature script, or null when conversion is not possible.
 */
function toFeatureScriptUrl(sourceUrl: string): string | null {
	try {
		const parsed = new URL(sourceUrl, window.location.href);
		const title = parsed.searchParams.get("title");
		if (title && /\.js$/i.test(title)) {
			parsed.searchParams.set("title", appendFeatureSuffix(title));
			return parsed.toString();
		}
		const pathName = parsed.pathname;
		if (/\.js$/i.test(pathName)) {
			parsed.pathname = appendFeatureSuffix(pathName);
			return parsed.toString();
		}
	} catch {
		if (/\.js(\?|#|$)/i.test(sourceUrl)) {
			return sourceUrl.replace(/\.js(\?|#|$)/i, "-feature.js$1");
		}
	}
	return null;
}

/**
 * Detect the URL of the currently loaded base Reaction script from document scripts.
 * @returns Matched Reaction script URL, or null when unavailable.
 */
function detectCurrentReactionScriptUrl(): string | null {
	const currentScript = document.currentScript;
	if (currentScript instanceof HTMLScriptElement && currentScript.src && isBaseReactionBundleUrl(currentScript.src)) {
		return currentScript.src;
	}

	const scripts = Array.from(document.getElementsByTagName("script"));
	for (let i = scripts.length - 1; i >= 0; i -= 1) {
		const src = scripts[i].src;
		if (!src) {
			continue;
		}
		if (isBaseReactionBundleUrl(src)) {
			return src;
		}
	}
	return null;
}

/**
 * Resolve the feature script URL from the currently loaded Reaction script URL.
 * @returns Feature script URL, or null when unresolved.
 */
function resolveFeatureScriptUrl(): string | null {
	const sourceUrl = detectCurrentReactionScriptUrl();
	if (!sourceUrl) {
		return null;
	}
	return toFeatureScriptUrl(sourceUrl);
}

/**
 * Poll for the feature API until it becomes available or times out.
 * @param timeoutMs - Maximum wait time in milliseconds.
 * @returns Promise resolving to the feature API when ready.
 */
function waitForFeatureApi(timeoutMs: number): Promise<ReactionFeatureApi> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const timer = window.setInterval(() => {
			const api = getFeatureApi();
			if (api) {
				window.clearInterval(timer);
				resolve(api);
				return;
			}
			if (Date.now() - startedAt >= timeoutMs) {
				window.clearInterval(timer);
				reject(new Error("Timed out while waiting for Reaction feature bundle."));
			}
		}, FEATURE_POLL_INTERVAL_MS);
	});
}

/**
 * Trigger loading of the feature bundle and wait for its global API registration.
 * @returns Promise resolving to the loaded feature API.
 */
function loadFeatureBundle(): Promise<ReactionFeatureApi> {
	const featureUrl = resolveFeatureScriptUrl();
	if (!featureUrl) {
		return Promise.reject(new Error("Unable to resolve Reaction feature script URL from current script."));
	}
	mw.loader.load(featureUrl, "text/javascript");
	return waitForFeatureApi(FEATURE_LOAD_TIMEOUT_MS);
}

/**
 * Ensure the feature API is loaded, reusing in-flight requests.
 * @returns Promise resolving to the feature API.
 */
async function ensureFeatureApiLoaded(): Promise<ReactionFeatureApi> {
	const existing = getFeatureApi();
	if (existing) {
		return existing;
	}
	if (!featureLoadPromise) {
		featureLoadPromise = loadFeatureBundle().catch((error) => {
			featureLoadPromise = null;
			throw error;
		});
	}
	return featureLoadPromise;
}

/**
 * Ensure feature runtime bootstrap is executed once after the feature API loads.
 * @returns Promise resolving to the initialized feature API.
 */
async function ensureFeatureBootstrapped(): Promise<ReactionFeatureApi> {
	const api = await ensureFeatureApiLoaded();
	if (!featureBootstrapped) {
		await api.bootstrapFeatureRuntime();
		featureBootstrapped = true;
	}
	return api;
}

/**
 * Enable or disable reaction interactions while loading the heavy feature bundle lazily.
 * @param enabled - Whether to enable reaction interactions.
 */
export function toggleReactionEnabledWithFeature(enabled: boolean): void {
	setReactionEnabled(enabled);
	if (!enabled) {
		const api = getFeatureApi();
		if (api) {
			api.toggleReactionEnabled(false);
		}
		return;
	}
	void ensureFeatureBootstrapped()
		.then((api) => {
			api.toggleReactionEnabled(true);
		})
		.catch(handleFeatureLoadError);
}

/**
 * Start the feature runtime if current state requires reaction interactions.
 * Loads and initializes the feature bundle only when reactions are currently active.
 */
export function bootstrapFeatureForCurrentState(): void {
	if (state.reactionHidden || state.reactionBlacklist) {
		return;
	}
	void ensureFeatureBootstrapped()
		.then((api) => {
			api.toggleReactionEnabled(state.reactionEnabled);
		})
		.catch(handleFeatureLoadError);
}
