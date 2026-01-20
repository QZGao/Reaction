import pkg from "../package.json";

const REACTION_STORAGE_KEY = "reaction.enabled";
const REACTION_HIDE_STORAGE_KEY = "reaction.hidden";

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
