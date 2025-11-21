declare var mw: any;

/**
 * 全局狀態管理。
 */
class State {
    /**
     * 使用者名稱，從MediaWiki配置中獲取。
     * @type {string}
     * @constant
     */
    userName: string = mw.config.get('wgUserName');

    /**
     * 頁面名稱，從MediaWiki配置中獲取。
     * @type {string}
     * @constant
     */
    pageName: string = mw.config.get('wgPageName');

    // 簡繁轉換
    convByVar = function (langDict: any) {
        if (langDict && langDict.hant) {
            return langDict.hant; // 預設返回繁體中文
        }
        return "繁簡轉換未初始化，且 langDict 無效！";
    };

    async initHanAssist(): Promise<void> {
        let require = await mw.loader.using('ext.gadget.HanAssist');
        const {convByVar} = require('ext.gadget.HanAssist');
        if (typeof convByVar === 'function') {
            this.convByVar = convByVar;
        }
    }
}

export const state = new State();
export default state;