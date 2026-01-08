import pkg from "../package.json";

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
}

export const state = new State();
export default state;
