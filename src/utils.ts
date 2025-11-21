import state from "./state";


declare var mw: any;
/**
 * 正則表達式，用於匹配中文格式的UTC時間戳。
 * @type {string}
 * @constant
 */
const chineseUtcRegex = `\\d{4}年\\d{1,2}月\\d{1,2}日 \\([日一二三四五六]\\) \\d{1,2}:\\d{2} \\(UTC\\)`;

/**
 * 正則表達式，用於匹配並捕獲中文格式的UTC時間戳。
 * @type {string}
 * @constant
 */
const chineseUtcCaptureRegex = `(\\d{4})年(\\d{1,2})月(\\d{1,2})日 \\(([日一二三四五六])\\) (\\d{1,2}):(\\d{2}) \\(UTC\\)`;


/**
 * 將字串中的特殊字符轉義。
 * @param string {String} - 字串
 * @returns {String} - 轉義後的字串
 */
export function escapeRegex(string) {
    return mw.util.escapeRegExp(string);
}

/**
 * 正則表達式，用於匹配「於」或「于」後的UTC時間戳。
 * @returns {string}
 * @constant
 */
export function atChineseUtcRegex() {
    return "(?:|[於于]" + chineseUtcRegex + ")";
}

/**
 * 正則表達式，用於匹配使用者名稱和時間戳。
 * 格式為「使用者名稱於2023年10月15日 (日) 12:34 (UTC)」。
 * @returns {string}
 * @constant
 */
export function userNameAtChineseUtcRegex() {
    return escapeRegex(state.userName) + atChineseUtcRegex();
}

/**
 * 獲取當前的中文格式UTC時間字串。
 * @returns {string} - 當前的中文格式UTC時間字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
 */
export function getCurrentChineseUtc() {
    const date = new Date();
    return dateToChineseUtc(date);
}


/**
 * 解析14位數字格式的UTC日期字串，並返回對應的Date物件。
 * @param utc14 {string} - 14位數字格式的UTC日期字串，例如「20231015123456」。
 * @returns {Date} - 對應的Date物件。
 */
function parseUtc14(utc14) {
    // Extract year, month, day, hour, minute, and second from the string
    const year = Number(utc14.slice(0, 4));
    const month = Number(utc14.slice(4, 6)) - 1; // JavaScript months are 0-indexed
    const day = Number(utc14.slice(6, 8));
    const hour = Number(utc14.slice(8, 10));
    const minute = Number(utc14.slice(10, 12));
    const second = Number(utc14.slice(12, 14));

    // Create a Date object from UTC values
    return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * 生成中文格式的UTC日期字串。
 * @param utc14 {string} - 14位數字格式的UTC日期字串，例如「20231015123456」。
 * @returns {string} - 中文格式的UTC日期字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
 */
function utc14ToChineseUtc(utc14) {
    const date = parseUtc14(utc14);
    return dateToChineseUtc(date);
}

/**
 * 解析中文格式的UTC日期字串，並返回對應的Date物件。
 * @param chineseUtcDate {string} - 中文格式的UTC日期字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
 * @returns {null|Date} - 對應的Date物件，或null（如果無法解析）。
 */
function parseChineseUtc(chineseUtcDate) {
    const match = chineseUtcDate.match(new RegExp('^' + chineseUtcCaptureRegex + '$'));
    if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1; // JavaScript months are 0-indexed
        const day = parseInt(match[3]);
        const hour = parseInt(match[5]);
        const minute = parseInt(match[6]);
        return new Date(Date.UTC(year, month, day, hour, minute));
    } else {
        console.error("[Reaction] Unable to parse Chinese UTC date: " + chineseUtcDate);
        return null;
    }
}

/**
 * 將Date物件轉換為中文格式的UTC日期字串。
 * @param date {Date} - Date物件。
 * @returns {string} - 中文格式的UTC日期字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
 */
function dateToChineseUtc(date) {
    return date.getUTCFullYear() + "年" + (date.getUTCMonth() + 1) + "月" + date.getUTCDate() + "日 (" + [
        "日", "一", "二", "三", "四", "五", "六",
    ][date.getUTCDay()] + ") " + date.getUTCHours().toString().padStart(2, "0") + ":" + date.getUTCMinutes().toString().padStart(2, "0") + " (UTC)";
}

/**
 * 解析時間戳，並返回對應的UTC日期字串。
 * @param timestamp {HTMLElement} - 時間戳元素。
 * @returns {null|string} - 對應的UTC日期字串，或null（如果無法解析）。
 */
export function parseTimestamp(timestamp) {
    let utcTimestamp = timestamp.querySelector(".localcomments");
    if (utcTimestamp) {
        return utcTimestamp.getAttribute("title");
    } else {
        let href = timestamp.getAttribute("href");
        let ts_s = (href.split('#')[1] || '');
        if (ts_s.startsWith('c-')) {
            // 格式1: c-<使用者名>-yyyymmddhhmmss00-<段落標題> 或 c-<使用者名>-yyyymmddhhmmss00-<使用者名>-yyyymmddhhmmss00
            let ts = (ts_s.match(/-(\d{14})/) || [])[1];
            if (ts) {
                return utc14ToChineseUtc(ts);
            }
            // 格式2：c-<使用者名>-yyyy-mm-ddThh:mm:ss.000Z-<段落標題> 或 c-<使用者名>-yyyy-mm-ddThh:mm:ss.000Z-<使用者名>-yyyy-mm-ddThh:mm:ss.000Z
            ts = (ts_s.match(/-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z)/) || [])[1];
            if (ts) {
                let date = new Date(ts);
                return dateToChineseUtc(date);
            }
        }
        console.error("[Reaction] Unable to parse timestamp in: " + href);
        return null;
    }
}
