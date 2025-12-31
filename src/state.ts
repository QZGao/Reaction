import pkg from "../package.json";

interface HanAssistDictionary {
	[key: string]: string | undefined;
	hant?: string;
	hans?: string;
}

type HanAssistConverter = (langDict: HanAssistDictionary) => string;

/**
 * 全局狀態管理。
 */
class State {
	/**
	 * 使用者名稱，從MediaWiki配置中獲取。
	 */
	userName: string | null = mw.config.get("wgUserName");

	/**
	 * 頁面名稱，從MediaWiki配置中獲取。
	 */
	pageName: string = mw.config.get("wgPageName");

	/**
	 * 簡繁轉換函式，預設回傳繁體文本或錯誤訊息。
	 */
	convByVar: HanAssistConverter = (langDict) => langDict?.hant ?? langDict?.hans ?? "繁簡轉換未初始化，且 langDict 無效！";

	/**
	 * 版本號，用於在元件與頁面中顯示當前版本。
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
