import state from "./state";
import {addReactionButtons} from "./dom";
import { t, tReaction } from "./i18n";

/**
 * 初始化函式，載入所需的模組和事件綁定。
 */
async function init() {
    mw.loader.load('/w/index.php?title=Template:Reaction/styles.css&action=raw&ctype=text/css', 'text/css');
    try {
        await state.initHanAssist();
        mw.hook('wikipage.content').add(function () {
            setTimeout(() => addReactionButtons(), 200);
        });
    } catch (error) {
        console.error(error);
        mw.notify(tReaction("main.notifications.hanassist_failed"), { title: t("main.titles.error"), type: "error" });
    }
}

void init();
