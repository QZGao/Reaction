import pkg from "../package.json";

const REACTION_STORAGE_KEY = "reaction.enabled";
const REACTION_HIDE_STORAGE_KEY = "reaction.hidden";
const REACTION_BLACKLIST_STORAGE_KEY = "reaction.blacklist";

/**
 * Check whether a value is a plain object record.
 * @param value - Value to check.
 * @returns True when value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Read blacklist config from global `ujsReactionConfig` safely.
 * @returns Blacklist flag from global config, or null when unavailable.
 */
function readGlobalBlacklistConfig(): boolean | null {
	if (typeof window === "undefined") {
		return null;
	}
	const globalObject = window as unknown as Record<string, unknown>;
	const rawConfig = globalObject["ujsReactionConfig"];
	if (!isRecord(rawConfig)) {
		return null;
	}
	const rawBlacklist = rawConfig["blacklist"];
	return typeof rawBlacklist === "boolean" ? rawBlacklist : null;
}

/**
 * Write blacklist config to global `ujsReactionConfig` safely.
 * @param blacklisted - Whether reactions are blacklisted.
 */
function writeGlobalBlacklistConfig(blacklisted: boolean): void {
	if (typeof window === "undefined") {
		return;
	}
	const globalObject = window as unknown as Record<string, unknown>;
	const rawConfig = globalObject["ujsReactionConfig"];
	const baseConfig = isRecord(rawConfig) ? rawConfig : {};
	globalObject["ujsReactionConfig"] = {
		...baseConfig,
		blacklist: blacklisted,
	};
}

/**
 * Load the reaction modification enabled state from localStorage.
 * Defaults to false if not set.
 * @returns Whether reaction modifications are enabled.
 */
function loadReactionEnabled(): boolean {
	if (typeof window === "undefined" || !("localStorage" in window)) {
		return false;
	}
	const stored = window.localStorage.getItem(REACTION_STORAGE_KEY);
	if (stored == null) {
		return false;
	}
	return stored === "true";
}

/**
 * Load the reaction hidden state from localStorage.
 * Defaults to false if not set.
 * @returns Whether reactions are hidden.
 */
function loadReactionHidden(): boolean {
	if (typeof window === "undefined" || !("localStorage" in window)) {
		return false;
	}
	const stored = window.localStorage.getItem(REACTION_HIDE_STORAGE_KEY);
	if (stored == null) {
		return false;
	}
	return stored === "true";
}

/**
 * Load the reaction blacklist state from localStorage or global config.
 * Global config takes precedence and is synced back to localStorage.
 * @returns Whether reactions from others are blacklisted.
 */
function loadReactionBlacklist(): boolean {
	const configured = readGlobalBlacklistConfig();
	if (configured !== null) {
		if ("localStorage" in window) {
			window.localStorage.setItem(REACTION_BLACKLIST_STORAGE_KEY, String(configured));
		}
		return configured;
	}
	if (typeof window === "undefined") {
		return false;
	}
	if (!("localStorage" in window)) {
		return false;
	}
	const stored = window.localStorage.getItem(REACTION_BLACKLIST_STORAGE_KEY);
	if (stored == null) {
		return false;
	}
	return stored === "true";
}

/**
 * Persist the reaction modification enabled state to localStorage.
 * @param enabled - Whether reaction modifications are enabled.
 */
function persistReactionEnabled(enabled: boolean): void {
	if (typeof window === "undefined" || !("localStorage" in window)) {
		return;
	}
	window.localStorage.setItem(REACTION_STORAGE_KEY, String(enabled));
}

/**
 * Persist the reaction hidden state to localStorage.
 * @param hidden - Whether reactions are hidden.
 */
function persistReactionHidden(hidden: boolean): void {
	if (typeof window === "undefined" || !("localStorage" in window)) {
		return;
	}
	window.localStorage.setItem(REACTION_HIDE_STORAGE_KEY, String(hidden));
}

/**
 * Persist the reaction blacklist state to localStorage and global config object.
 * @param blacklisted - Whether reactions from others are blacklisted.
 */
function persistReactionBlacklist(blacklisted: boolean): void {
	if (typeof window === "undefined") {
		return;
	}
	if ("localStorage" in window) {
		window.localStorage.setItem(REACTION_BLACKLIST_STORAGE_KEY, String(blacklisted));
	}
	writeGlobalBlacklistConfig(blacklisted);
}

/**
 * Global state container for the gadget.
 */
class State {
	/**
	 * Logged-in user name from MediaWiki configuration.
	 */
	userName: string | null = mw.config.get("wgUserName");
	/**
	 * Temporary account flag from MediaWiki configuration.
	 */
	isTempUser: boolean = Boolean(mw.config.get("wgUserIsTemp"));

	/**
	 * Current page title from MediaWiki configuration.
	 */
	pageName: string = mw.config.get("wgPageName");

	/**
	 * Gadget version from package.json for display/debugging.
	 */
	version: string = pkg.version;

	/**
	 * Whether reaction modifications are enabled for this session.
	 */
	reactionEnabled: boolean = loadReactionEnabled();

	/**
	 * Whether reactions are hidden for this session.
	 */
	reactionHidden: boolean = loadReactionHidden();

	/**
	 * Whether receiving reactions from others is disabled.
	 */
	reactionBlacklist: boolean = loadReactionBlacklist();
}

export const state = new State();
export default state;

/**
 * Check if the current user can modify reactions.
 * @returns True if the user can modify reactions.
 */
export function canReact(): boolean {
	return Boolean(state.userName) && !state.isTempUser && state.reactionEnabled;
}

/**
 * Enable or disable reaction modifications.
 * @param enabled - Whether to enable reaction modifications.
 */
export function setReactionEnabled(enabled: boolean): void {
	state.reactionEnabled = enabled;
	persistReactionEnabled(enabled);
}

/**
 * Hide or show reaction elements.
 * @param hidden - Whether reactions are hidden.
 */
export function setReactionHidden(hidden: boolean): void {
	state.reactionHidden = hidden;
	persistReactionHidden(hidden);
}

/**
 * Set whether receiving reactions from others is disabled.
 * @param blacklisted - Whether reactions are blacklisted.
 */
export function setReactionBlacklist(blacklisted: boolean): void {
	state.reactionBlacklist = blacklisted;
	persistReactionBlacklist(blacklisted);
}
