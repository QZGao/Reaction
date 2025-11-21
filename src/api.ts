import state from "./state";
import {escapeRegex, getCurrentChineseUtc, userNameAtChineseUtcRegex} from "./utils";


declare var mw: any;

// MediaWiki API 實例
let _api: any = null;

function getApi() {
    if (!_api) {
        _api = new mw.Api({'User-Agent': 'Reaction/1.0.0'});
    }
    return _api;
}

/**
 * 獲取完整的wikitext。
 * @returns {Promise<string>} 包含完整wikitext的Promise。
 */
async function retrieveFullText() {
    let response = await getApi().get({
        action: 'query', titles: state.pageName, prop: 'revisions', rvslots: '*', rvprop: 'content', indexpageids: 1,
    });
    let fulltext = response.query.pages[response.query.pageids[0]].revisions[0].slots.main['*'];
    return fulltext + "\n";
}

/**
 * 儲存完整的wikitext。
 * @param fulltext {string} - 完整的wikitext。
 * @param summary {string} - 編輯摘要。
 * @returns {Promise<boolean>} - 操作成功與否的Promise。
 */
async function saveFullText(fulltext, summary) {
    try {
        await getApi().postWithToken('edit', {
            action: 'edit',
            title: state.pageName,
            text: fulltext,
            summary: summary + " ([[User:SuperGrey/gadgets/Reaction|Reaction]])",
        });
        mw.notify(state.convByVar({hant: "[Reaction] 儲存成功！", hans: "[Reaction] 保存成功！"}), {
            title: "成功", type: "success",
        });
        return true;
    } catch (e) {
        console.error(e);
        mw.notify(state.convByVar({
            hant: "[Reaction] 失敗！無法儲存頁面。", hans: "[Reaction] 失败！无法保存页面。",
        }), {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
        return false;
    }
}


/**
 * 修改頁面內容。
 * @param mod {Object} - 修改內容的物件，包含時間戳（timestamp）、要添加或刪除的反應等（upvote、downvote、append、remove）。
 * @returns {Promise<boolean>} - 操作成功與否的Promise。
 */
export async function modifyPage(mod) {
    let fulltext;
    try {
        fulltext = await retrieveFullText();
    } catch (e) {
        console.error(e);
        mw.notify(state.convByVar({
            hant: "[Reaction] 失敗！無法獲取頁面內容。", hans: "[Reaction] 失败！无法获取页面内容。",
        }), {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
        return false;
    }

    let newFulltext;
    let summary = "";
    try {
        let timestampRegex = new RegExp(`${escapeRegex(mod.timestamp)}`, "g");
        let timestampMatch = fulltext.match(timestampRegex);

        // If the timestamp is not found, throw an error
        if (!timestampMatch || timestampMatch.length === 0) {
            console.log("[Reaction] Unable to find timestamp " + mod.timestamp + " in: " + fulltext);
            throw new Error("[Reaction] " + state.convByVar({
                hant: "原文中找不到時間戳：", hans: "原文中找不到时间戳：",
            }) + mod.timestamp);
        }

        // Check if more than one match is found.
        if (timestampMatch.length > 1) {
            console.log("[Reaction] More than one timestamp found: " + timestampMatch);
            throw new Error("[Reaction] " + state.convByVar({
                hant: "原文中找到多個相同的時間戳，小工具無法處理：", hans: "原文中找到多个相同的时间戳，小工具无法处理：",
            }) + mod.timestamp + state.convByVar({
                hant: "。請手動編輯。", hans: "。请手动编辑。",
            }));
        }

        let pos = fulltext.search(timestampRegex);
        console.log("[Reaction] Found timestamp " + mod.timestamp + " at position " + pos);

        if (mod.remove) {
            let regex = new RegExp(` *\\{\\{ *[Rr]eact(?:ion|) *\\| *${escapeRegex(mod.remove)} *\\| *${userNameAtChineseUtcRegex()} *}}`, "g");
            // console.log(regex);

            // Find this after the timestamp, but before the next newline
            let lineEnd = fulltext.indexOf("\n", pos);
            let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
            let newTimestamp2LineEnd = timestamp2LineEnd.replace(regex, "");
            newFulltext = fulltext.slice(0, pos) + newTimestamp2LineEnd + fulltext.slice(lineEnd);
            summary = "− " + mod.remove;
        } else if (mod.downvote) {
            let regex = new RegExp(`\\{\\{ *[Rr]eact(?:ion|) *\\| *${escapeRegex(mod.downvote)} *(|\\|[^}]*?)\\| *${userNameAtChineseUtcRegex()} *(|\\|[^}]*?)}}`, "g");
            // console.log(regex);

            // Find this after the timestamp, but before the next newline
            let lineEnd = fulltext.indexOf("\n", pos);
            let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
            let newTimestamp2LineEnd = timestamp2LineEnd.replace(regex, `{{Reaction|${mod.downvote}$1$2}}`);
            newFulltext = fulltext.slice(0, pos) + newTimestamp2LineEnd + fulltext.slice(lineEnd);
            summary = "− " + mod.downvote;
        } else if (mod.upvote) {
            let regex = new RegExp(`\\{\\{ *[Rr]eact(?:ion|) *\\| *${escapeRegex(mod.upvote)}([^}]*?)}}`, "g");
            // console.log(regex);

            // Find this after the timestamp, but before the next newline
            let lineEnd = fulltext.indexOf("\n", pos);
            let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
            let newTimestamp2LineEnd = timestamp2LineEnd.replace(regex, `{{Reaction|${mod.upvote}$1|${state.userName}於${getCurrentChineseUtc()}}}`);
            newFulltext = fulltext.slice(0, pos) + newTimestamp2LineEnd + fulltext.slice(lineEnd);
            summary = "+ " + mod.upvote;
        } else if (mod.append) {
            let regex = new RegExp(`\\{\\{ *[Rr]eact(?:ion|) *\\| *${escapeRegex(mod.append)}([^}]*?)}}`, "g");
            // console.log(regex);

            let lineEnd = fulltext.indexOf("\n", pos);
            let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
            // If the reaction already exists, then error
            if (regex.test(timestamp2LineEnd)) {
                console.log("[Reaction] Reaction of " + mod.append + " already exists in: " + timestamp2LineEnd);
                throw new Error("[Reaction] " + state.convByVar({
                    hant: "原文中已經有這個反應！", hans: "原文中已经有这个反应！",
                }));
            }

            // Add text at the end of that line
            let newText = "{{Reaction|" + mod.append + "|" + state.userName + "於" + getCurrentChineseUtc() + "}}";
            newFulltext = fulltext.slice(0, lineEnd) + " " + newText + fulltext.slice(lineEnd);
            summary = "+ " + mod.append;
        }

        if (newFulltext === fulltext) {
            console.log("[Reaction] Nothing is modified. Could be because using a template inside {{Reaction}}.");
            throw new Error("[Reaction] " + state.convByVar({
                hant: "原文未被修改。可能是因為使用了嵌套模板；請手動編輯。",
                hans: "原文未被修改。可能是因为使用了嵌套模板；请手动编辑。",
            }));
        }

        // 儲存全文。錯誤資訊已在函式內處理。
        return await saveFullText(newFulltext, summary);

    } catch (e) {
        console.error(e);
        mw.notify(e.message, {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
        return false;
    }
}
