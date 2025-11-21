import state from "./state";
import {addReactionButtons} from "./dom";

declare var mw: any;

/**
 * 初始化函式，載入所需的模組和事件綁定。
 */
function init() {
    mw.loader.load('/w/index.php?title=Template:Reaction/styles.css&action=raw&ctype=text/css', 'text/css');
    state.initHanAssist().then(() => {
        mw.hook('wikipage.content').add(function () {
            setTimeout(() => addReactionButtons(), 200);
        });
    });
}

init();
