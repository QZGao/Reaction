import state from "./state";
import {addReactionButtons} from "./dom";

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
        mw.notify(state.convByVar({
            hant: "[Reaction] 失敗！簡繁轉換模組未能載入。", hans: "[Reaction] 失败！简繁转换模组未能载入。",
        }), { title: state.convByVar({ hant: "錯誤", hans: "错误" }), type: "error" });
    }
}

void init();
