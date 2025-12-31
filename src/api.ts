import state from "./state";
import { escapeRegex, getCurrentChineseUtc, userNameAtChineseUtcRegex } from "./utils";
import { t, tReaction } from "./i18n";

interface RevisionSlot {
    main: {
        "*": string;
    };
}

interface Revision {
    slots: RevisionSlot;
}

interface QueryPage {
    revisions: Revision[];
}

interface RetrieveFullTextResponse {
    query: {
        pageids: string[];
        pages: Record<string, QueryPage>;
    };
}

// MediaWiki API 實例
let apiInstance: mw.Api | null = null;

/**
 * 獲取 MediaWiki API 實例。
 * @returns {mw.Api} - MediaWiki API 實例。
 */
function getApi(): mw.Api {
    if (!apiInstance) {
        apiInstance = new mw.Api({
            ajax: {
                headers: { "User-Agent": `Reaction/${state.version}` }
            }
        });
    }
    return apiInstance;
}

export interface ModifyPageRequest {
    timestamp: string;
    upvote?: string;
    downvote?: string;
    append?: string;
    remove?: string;
}

/**
 * 獲取完整的wikitext。
 * @returns {Promise<string>} 包含完整wikitext的Promise。
 */
async function retrieveFullText(): Promise<string> {
    const response = await getApi().get({
        action: "query",
        titles: state.pageName,
        prop: "revisions",
        rvslots: "*",
        rvprop: "content",
        indexpageids: 1,
    }) as RetrieveFullTextResponse;
    const pageId = response.query.pageids[0];
    const page = response.query.pages[pageId];
    const revision = page?.revisions?.[0];
    const fulltext = revision?.slots?.main?.["*"] ?? "";
    return `${fulltext}\n`;
}

/**
 * 儲存完整的wikitext。
 * @param fulltext {string} - 完整的wikitext。
 * @param summary {string} - 編輯摘要。
 * @returns {Promise<boolean>} - 操作成功與否的Promise。
 */
async function saveFullText(fulltext: string, summary: string): Promise<boolean> {
    try {
        await getApi().postWithToken("edit", {
            action: "edit",
            title: state.pageName,
            text: fulltext,
            summary: summary + " ([[User:SuperGrey/gadgets/Reaction|Reaction]])",
        });
        mw.notify(tReaction("api.notifications.save_success"), {
            title: t("api.titles.success"), type: "success",
        });
        return true;
    } catch (error) {
        console.error(error);
        mw.notify(tReaction("api.notifications.save_failure"), { title: t("api.titles.error"), type: "error" });
        return false;
    }
}


/**
 * 修改頁面內容。
 * @param mod {Object} - 修改內容的物件，包含時間戳（timestamp）、要添加或刪除的反應等（upvote、downvote、append、remove）。
 * @returns {Promise<boolean>} - 操作成功與否的Promise。
 */
export async function modifyPage(mod: ModifyPageRequest): Promise<boolean> {
    let fulltext: string;
    try {
        fulltext = await retrieveFullText();
    } catch (error) {
        console.error(error);
        mw.notify(tReaction("api.notifications.fetch_failure"), { title: t("api.titles.error"), type: "error" });
        return false;
    }

    let newFulltext = fulltext;
    let summary = "";
    try {
        let timestampRegex = new RegExp(`${escapeRegex(mod.timestamp)}`, "g");
        let timestampMatch = fulltext.match(timestampRegex);

        // If the timestamp is not found, throw an error
        if (!timestampMatch || timestampMatch.length === 0) {
            console.log("[Reaction] Unable to find timestamp " + mod.timestamp + " in: " + fulltext);
            throw new Error(tReaction("api.errors.timestamp_missing", [mod.timestamp]));
        }

        // Check if more than one match is found.
        if (timestampMatch.length > 1) {
            console.log("[Reaction] More than one timestamp found: " + timestampMatch.join(", "));
            throw new Error(tReaction("api.errors.timestamp_conflict", [mod.timestamp]));
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
                throw new Error(tReaction("api.errors.reaction_exists"));
            }

            // Add text at the end of that line
            let newText = "{{Reaction|" + mod.append + "|" + state.userName + "於" + getCurrentChineseUtc() + "}}";
            newFulltext = fulltext.slice(0, lineEnd) + " " + newText + fulltext.slice(lineEnd);
            summary = "+ " + mod.append;
        }

        if (newFulltext === fulltext) {
            console.log("[Reaction] Nothing is modified. Could be because using a template inside {{Reaction}}.");
            throw new Error(tReaction("api.errors.no_changes"));
        }

        // 儲存全文。錯誤資訊已在函式內處理。
        return await saveFullText(newFulltext, summary);

    } catch (error: unknown) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        mw.notify(message, { title: t("api.titles.error"), type: "error" });
        return false;
    }
}
