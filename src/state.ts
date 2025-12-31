import pkg from "../package.json";

interface HanAssistDictionary {
	[key: string]: string | undefined;
	hant?: string;
	hans?: string;
}

type HanAssistConverter = (langDict: HanAssistDictionary) => string;

/**
 * Global state container for the gadget.
 */
class State {
	/**
	 * Logged-in user name from MediaWiki configuration.
	 */
	userName: string | null = mw.config.get("wgUserName");

	/**
	 * Current page title from MediaWiki configuration.
	 */
	pageName: string = mw.config.get("wgPageName");

	/**
	 * HanAssist converter; defaults to returning traditional text or an error string.
	 */
	convByVar: HanAssistConverter = (langDict) => langDict?.hant ?? langDict?.hans ?? "繁簡轉換未初始化，且 langDict 無效！";

	/**
	 * Gadget version from package.json for display/debugging.
	 */
	version: string = pkg.version;

	async initHanAssist(): Promise<void> {
		const requireHanAssist = await mw.loader.using("ext.gadget.HanAssist");
		const moduleExports = requireHanAssist("ext.gadget.HanAssist") as { convByVar?: HanAssistConverter } | undefined;
		if (typeof moduleExports?.convByVar === "function") {
			this.convByVar = moduleExports.convByVar;
		}
	}
}

export const state = new State();
export default state;
