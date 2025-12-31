import state from "./state";
import { atChineseUtcRegex, getCurrentChineseUtc, parseTimestamp, userNameAtChineseUtcRegex } from "./utils";
import { modifyPage, type ModifyPageRequest } from "./api";

/**
 * 事件處理函式註冊表。WeakMap用於儲存事件處理函式的引用，以便在需要時可以移除它們。
 * @type {WeakMap<HTMLElement, Function>}
 * @private
 */
const _handlerRegistry = new WeakMap<HTMLElement, EventListener>();

/**
 * 按鈕對應的時間戳。WeakMap用於儲存按鈕與時間戳之間的關聯。
 * @type {WeakMap<HTMLElement, HTMLElement>}
 * @private
 */
const _buttonTimestamps = new WeakMap<HTMLElement, HTMLElement>();

function removeRegisteredHandler(element: HTMLElement | null): void {
    if (!element) {
        return;
    }
    const handler = _handlerRegistry.get(element);
    if (handler) {
        element.removeEventListener("click", handler);
        _handlerRegistry.delete(element);
    }
}

function getButtonParts(button: HTMLElement): { icon: HTMLElement; counter: HTMLElement } | null {
    const icon = button.querySelector<HTMLElement>(".reaction-icon");
    const counter = button.querySelector<HTMLElement>(".reaction-counter");
    if (!icon || !counter) {
        console.error("[Reaction] Missing icon or counter on reaction button.", button);
        return null;
    }
    return { icon, counter };
}

function getReactionLabel(button: HTMLElement, icon: HTMLElement): string {
    const configuredIcon = button.getAttribute("data-reaction-icon")?.trim();
    if (configuredIcon) {
        return configuredIcon;
    }
    return icon.textContent?.trim() ?? "";
}

function getTimestampString(button: HTMLElement): string | null {
    const timestampElement = _buttonTimestamps.get(button);
    if (!timestampElement) {
        console.error("[Reaction] Missing timestamp mapping for button.", button);
        return null;
    }
    const parsedTimestamp = parseTimestamp(timestampElement);
    if (!parsedTimestamp) {
        console.error("[Reaction] Unable to parse timestamp from timestamp element.", timestampElement);
    }
    return parsedTimestamp;
}


/**
 * 處理反應按鈕的點擊事件，轉發到相應的處理函式。
 * @param button {HTMLElement} - 反應按鈕元素。
 */
function handleReactionClick(button: HTMLElement) {
    if (button.classList.contains("reaction-new")) {
        // 對於「新反應」按鈕，轉換為可編輯狀態。
        addNewReaction(button);
    } else {
        if (button.getAttribute("data-reaction-icon-invalid")) {
            // 如果反應圖示無效，不處理。
            mw.notify(state.convByVar({
                hant: "[Reaction] 反應圖示無效，小工具無法處理。", hans: "[Reaction] 反应图示无效，小工具无法处理。",
            }), { title: state.convByVar({ hant: "錯誤", hans: "错误" }), type: "error" });
            console.error("[Reaction] Invalid reaction icon.");
            return;
        }

        if (window?.ujsReactionConfirmedRequired) {
            // （手賤者專用）點擊普通反應按鈕時，確認是否要追加或取消反應。
            let confirmMessage;
            if (button.classList.contains("reaction-reacted")) {
                confirmMessage = state.convByVar({
                    hant: "[Reaction] 確定要取消這個反應嗎？", hans: "[Reaction] 确定要取消这个反应吗？",
                });
            } else {
                confirmMessage = state.convByVar({
                    hant: "[Reaction] 確定要追加這個反應嗎？", hans: "[Reaction] 确定要追加这个反应吗？",
                });
            }
            OO.ui.confirm(confirmMessage, {
                title: state.convByVar({ hant: "確認", hans: "确认" }), size: "small",
            }).then((confirmed: boolean) => {
                if (confirmed) {
                    toggleReaction(button);
                }
            });
        } else {
            // （預設）不需要確認，直接切換反應狀態。
            toggleReaction(button);
        }
    }
}

/**
 * 切換普通反應按鈕（非「新反應」）的反應狀態。
 * @param button {HTMLElement} - 反應按鈕元素。
 */
function toggleReaction(button: HTMLElement) {
    const parts = getButtonParts(button);
    if (!parts) {
        return;
    }
    const { icon, counter } = parts;
    const timestamp = getTimestampString(button);
    if (!timestamp) {
        mw.notify(state.convByVar({
            hant: "[Reaction] 失敗！無法獲取時間戳。", hans: "[Reaction] 失败！无法获取时间戳。",
        }), { title: state.convByVar({ hant: "錯誤", hans: "错误" }), type: "error" });
        return;
    }
    const counterValue = button.getAttribute("data-reaction-count") ?? counter.innerText;
    const count = Number.parseInt(counterValue, 10) || 0;
    const reactionLabel = getReactionLabel(button, icon);

    if (button.classList.contains("reaction-reacted")) {
        if (!button.getAttribute("data-reaction-commentors")?.includes(state.userName || "")) {
            mw.notify(state.convByVar({
                hant: "[Reaction] 失敗！不能取消並未做出的反應。", hans: "[Reaction] 失败！不能取消并未做出的反应。",
            }), { title: state.convByVar({ hant: "錯誤", hans: "错误" }), type: "error" });
            console.log("[Reaction] Should not happen! " + state.userName + " should be in " + button.getAttribute("data-reaction-commentors"));
            return;
        }

        const mod: ModifyPageRequest = { timestamp };
        if (count > 1) {
            mod.downvote = reactionLabel;
        } else {
            mod.remove = reactionLabel;
        }

        void modifyPage(mod).then((response) => {
            if (!response) {
                return;
            }
            button.classList.remove("reaction-reacted");
            if (count > 1) {
                counter.innerText = (count - 1).toString();

                let dataCommentors = `${button.getAttribute("data-reaction-commentors") ?? ""}/`;
                dataCommentors = dataCommentors.replace(new RegExp(userNameAtChineseUtcRegex() + "/", "g"), "");
                dataCommentors = dataCommentors.slice(0, -1);
                button.setAttribute("data-reaction-commentors", dataCommentors);

                let buttonTitle = button.getAttribute("title");
                if (buttonTitle) {
                    buttonTitle = buttonTitle.replace(new RegExp(userNameAtChineseUtcRegex(), "g"), "");
                    let trailingSemicolonRegex = new RegExp("；" + atChineseUtcRegex() + "回[應应]了[這这][條条]留言$", "g");
                    buttonTitle = buttonTitle.replace(trailingSemicolonRegex, "");
                    let trailingCommaRegex = new RegExp("、​" + atChineseUtcRegex() + "(|、​.+?)(回[應应]了[這这][條条]留言)$", "g");
                    buttonTitle = buttonTitle.replace(trailingCommaRegex, "$1$2");
                    buttonTitle = buttonTitle.replace(new RegExp("^" + atChineseUtcRegex() + "、​"), "");
                    button.setAttribute("title", buttonTitle);
                }
            } else {
                button.parentNode?.removeChild(button);
            }
        });
    } else {
        if (state.userName && button.getAttribute("data-reaction-commentors")?.includes(state.userName)) {
            mw.notify(state.convByVar({
                hant: "[Reaction] 失敗！不能重複做出反應。", hans: "[Reaction] 失败！不能重复做出反应。",
            }), { title: state.convByVar({ hant: "錯誤", hans: "错误" }), type: "error" });
            console.log("[Reaction] Should not happen! " + state.userName + " should not be in " + button.getAttribute("data-reaction-commentors"));
            return;
        }
        const mod: ModifyPageRequest = {
            timestamp,
            upvote: reactionLabel,
        };

        void modifyPage(mod).then((response) => {
            if (!response) {
                return;
            }
            button.classList.add("reaction-reacted");
            const newCount = Number.parseInt(counter.innerText, 10) + 1;
            counter.innerText = newCount.toString();

            let dataCommentors = button.getAttribute("data-reaction-commentors");
            const userName = state.userName ?? "";
            const comment = `${userName}於${getCurrentChineseUtc()}`;
            if (dataCommentors) {
                dataCommentors += `/${comment}`;
            } else {
                dataCommentors = comment;
            }
            button.setAttribute("data-reaction-commentors", dataCommentors);

            let buttonTitle = button.getAttribute("title");
            if (buttonTitle) {
                buttonTitle += "；";
            } else {
                buttonTitle = "";
            }
            buttonTitle += userName + state.convByVar({
                hant: "於", hans: "于",
            }) + getCurrentChineseUtc() + state.convByVar({
                hant: "回應了這條留言", hans: "回应了这条留言",
            });
            button.setAttribute("title", buttonTitle);
        });
    }
}

/**
 * 取消新反應按鈕的編輯狀態。
 * @param button {HTMLElement} - 「新反應」按鈕元素。
 * @param event {MouseEvent|false} - 滑鼠點擊事件，false 表示不是瀏覽器觸發所以無需取消
 */
function cancelNewReaction(button: HTMLElement, event: MouseEvent | false) {
    if (event) {
        event.stopPropagation();
    }

    removeRegisteredHandler(button.querySelector<HTMLElement>(".reaction-save"));
    removeRegisteredHandler(button.querySelector<HTMLElement>(".reaction-cancel"));

    // Restore the add new reaction button to the original state
    let buttonIcon = button.querySelector<HTMLElement>(".reaction-icon");
    if (buttonIcon) {
        buttonIcon.textContent = "+";
    }
    let buttonCounter = button.querySelector<HTMLElement>(".reaction-counter");
    if (buttonCounter) {
        buttonCounter.innerText = state.convByVar({ hant: "反應", hans: "反应" });
    }

    // Restore the original event handler
    // Create the bound function and store it in the WeakMap.
    if (_handlerRegistry.has(button)) {
        console.error("[Reaction] Not possible! The event handler should not be registered yet.");
        return;
    }
    const buttonClickHandler: EventListener = () => handleReactionClick(button);
    _handlerRegistry.set(button, buttonClickHandler);
    button.addEventListener("click", buttonClickHandler);
}

/**
 * 儲存新的反應，並更新按鈕的狀態。
 * @param button {HTMLElement} - 「新反應」按鈕元素。
 * @param event {MouseEvent|false} - 滑鼠點擊事件，false 表示不是瀏覽器觸發所以無需取消
 */
function saveNewReaction(button: HTMLElement, event: MouseEvent | false) {
    if (event) {
        event.stopPropagation();
    }

    let input = button.querySelector<HTMLInputElement>(".reaction-icon input");
    if (!input) {
        console.error("[Reaction] Missing input element inside reaction icon.");
        return;
    }
    if (!input.value.trim()) {
        mw.notify(state.convByVar({
            hant: "[Reaction] 反應內容不能為空！", hans: "[Reaction] 反应内容不能为空！",
        }), { title: state.convByVar({ hant: "錯誤", hans: "错误" }), type: "error" });
        return;
    }

    // Save the new reaction
    let timestampElement = _buttonTimestamps.get(button);
    let timestamp = timestampElement ? parseTimestamp(timestampElement) : null;
    if (!timestamp) {
        mw.notify(state.convByVar({
            hant: "[Reaction] 失敗！無法獲取時間戳。", hans: "[Reaction] 失败！无法获取时间戳。",
        }), { title: state.convByVar({ hant: "錯誤", hans: "错误" }), type: "error" });
        return;
    }
    let mod: ModifyPageRequest = {
        timestamp: timestamp, append: input.value.trim(),
    };
    void modifyPage(mod).then((response) => {
        if (response) {
            // Change the icon to the new reaction
            button.classList.remove("reaction-new");
            button.classList.add("reaction-reacted");
            const parts = getButtonParts(button);
            if (!parts) {
                return;
            }
            const { icon, counter } = parts;
            icon.textContent = input.value;
            counter.textContent = "1";
            button.setAttribute("title", state.userName + state.convByVar({
                hant: "於", hans: "于",
            }) + getCurrentChineseUtc() + state.convByVar({
                hant: "回應了這條留言", hans: "回应了这条留言",
            }));
            button.setAttribute("data-reaction-commentors", state.userName ?? "");

            // Remove event handlers using the stored bound function reference.
            removeRegisteredHandler(button.querySelector<HTMLElement>(".reaction-save"));
            removeRegisteredHandler(button.querySelector<HTMLElement>(".reaction-cancel"));

            // Add new reaction button after the old button
            let newReactionButton = NewReactionButton();
            button.parentNode?.insertBefore(newReactionButton, button.nextSibling);
            if (timestampElement) {
                _buttonTimestamps.set(newReactionButton, timestampElement);  // Store the timestamp for the new button
            }

            // Restore the original event handler
            // Create the bound function and store it in the WeakMap.
            if (_handlerRegistry.has(button)) {
                console.error("Not possible! The event handler should not be registered yet.");
                return;
            }
            const buttonClickHandler: EventListener = () => handleReactionClick(button);
            _handlerRegistry.set(button, buttonClickHandler);
            button.addEventListener("click", buttonClickHandler);
        }
    });
}


/**
 * 創建一個可調整大小的輸入框。
 * @param text {string} - 預設文字。
 * @param parent {HTMLElement} - 父元素。輸入框（以及隱藏的寬度計算器）將被添加到這個元素中。
 * @returns {HTMLInputElement} - 可調整大小的輸入框。
 * @constructor
 */
function ResizableInput(text: string = "", parent: HTMLElement = document.body || document.createElement("div")): HTMLInputElement {
    let input = document.createElement("input");
    input.value = text;
    input.style.width = "1em";
    input.style.background = "transparent";
    input.style.border = "0";
    input.style.boxSizing = "content-box";
    parent.appendChild(input);

    // Hidden width calculator
    let hiddenInput = document.createElement("span");
    hiddenInput.style.position = "absolute";
    hiddenInput.style.top = "0";
    hiddenInput.style.left = "0";
    hiddenInput.style.visibility = "hidden";
    hiddenInput.style.height = "0";
    hiddenInput.style.overflow = "scroll";
    hiddenInput.style.whiteSpace = "pre";
    parent.appendChild(hiddenInput);

    const inputStyles = window.getComputedStyle(input);
    const mirroredProperties = [
        "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-transform",
    ];
    mirroredProperties.forEach((prop) => {
        const value = inputStyles.getPropertyValue(prop);
        hiddenInput.style.setProperty(prop, value || "");
    });

    function inputResize() {
        hiddenInput.innerText = input.value || input.placeholder || text;
        const width = hiddenInput.scrollWidth;
        input.style.width = (width + 2) + "px";
    }

    input.addEventListener("input", inputResize);
    inputResize();
    return input;
}

/**
 * 將「新反應」按鈕轉換為可編輯狀態，並加入「儲存」和「取消」選單。
 * @param button {HTMLElement} - 「新反應」按鈕元素。
 */
function addNewReaction(button: HTMLElement) {
    // Remove event handlers using the stored bound function reference.
    // Retrieve the handler reference from the WeakMap.
    removeRegisteredHandler(button);

    // Change the icon to a textbox
    let buttonIcon = button.querySelector<HTMLElement>(".reaction-icon");
    if (buttonIcon) {
        buttonIcon.textContent = "";  // Clear the icon
        let input = ResizableInput("👍", buttonIcon);
        input.focus();
        input.select();
        input.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                saveNewReaction(button, false);
            } else if (event.key === "Escape") {
                cancelNewReaction(button, false);
            }
        });
    }

    let buttonCounter = button.querySelector<HTMLElement>(".reaction-counter");
    if (buttonCounter) {
        let saveButton = document.createElement("span");
        saveButton.className = "reaction-save";
        saveButton.innerText = state.convByVar({ hant: "儲存", hans: "保存" });
        if (_handlerRegistry.has(saveButton)) {
            return;
        }
        const saveButtonClickHandler: EventListener = (evt) => saveNewReaction(button, evt as MouseEvent);
        _handlerRegistry.set(saveButton, saveButtonClickHandler);
        saveButton.addEventListener("click", saveButtonClickHandler);

        let cancelButton = document.createElement("span");
        cancelButton.className = "reaction-cancel";
        cancelButton.innerText = state.convByVar({ hant: "取消", hans: "取消" });
        if (_handlerRegistry.has(cancelButton)) {
            return;
        }
        const cancelButtonClickHandler: EventListener = (evt) => cancelNewReaction(button, evt as MouseEvent);
        _handlerRegistry.set(cancelButton, cancelButtonClickHandler);
        cancelButton.addEventListener("click", cancelButtonClickHandler);

        buttonCounter.innerText = "";
        buttonCounter.appendChild(saveButton);
        buttonCounter.appendChild(document.createTextNode(" | "));
        buttonCounter.appendChild(cancelButton);
    }
}

/**
 * 創建一個「新反應」按鈕。
 * @returns {HTMLSpanElement} - 「新反應」按鈕元素。
 * @constructor
 */
function NewReactionButton() {
    let button = document.createElement("span");
    button.className = "reactionable template-reaction reaction-new";
    let buttonContent = document.createElement("span");
    buttonContent.className = "reaction-content";
    let buttonIconContainer = document.createElement("span");
    buttonIconContainer.className = "reaction-icon-container";
    let buttonIcon = document.createElement("span");
    buttonIcon.className = "reaction-icon";
    buttonIcon.innerText = "+";
    buttonIconContainer.appendChild(buttonIcon);
    let buttonCounterContainer = document.createElement("span");
    buttonCounterContainer.className = "reaction-counter-container";
    let buttonCounter = document.createElement("span");
    buttonCounter.className = "reaction-counter";
    buttonCounter.innerText = state.convByVar({ hant: "反應", hans: "反应" });
    buttonCounterContainer.appendChild(buttonCounter);
    buttonContent.appendChild(buttonIconContainer);
    buttonContent.appendChild(buttonCounterContainer);
    button.appendChild(buttonContent);

    // Create the bound function and store it in the WeakMap.
    const buttonClickHandler: EventListener = () => handleReactionClick(button);
    _handlerRegistry.set(button, buttonClickHandler);
    button.addEventListener("click", buttonClickHandler);
    return button;
}

/**
 * 綁定事件到普通反應按鈕（非「新反應」）。
 * @param button {HTMLElement} - 反應按鈕元素。
 */
function bindEvent2ReactionButton(button: HTMLElement) {
    // Create the bound function and store it in the WeakMap.
    if (_handlerRegistry.has(button)) {
        return;
    }
    let buttonClickHandler: EventListener = () => handleReactionClick(button);
    _handlerRegistry.set(button, buttonClickHandler);
    button.addEventListener("click", buttonClickHandler);

    // Check if the user has reacted to this
    let reacted = false;
    for (const commentor of button.getAttribute("data-reaction-commentors")?.split("/") || []) {
        // Either username or username於chineseUtc
        let regex = new RegExp('^' + userNameAtChineseUtcRegex() + '$');
        // console.log(regex);
        if (regex.test(commentor)) {
            reacted = true;
            break;
        }
    }
    if (reacted) {
        button.classList.add("reaction-reacted");
    }
}

/**
 * 處理回應按鈕 主程式。
 */
export function addReactionButtons() {
    if (document.querySelector('#reaction-finished-loading')) {
        return;
    }

    const timestamps = document.querySelectorAll<HTMLAnchorElement>("a.ext-discussiontools-init-timestamplink");
    const replyButtons = document.querySelectorAll<HTMLSpanElement>("span.ext-discussiontools-init-replylink-buttons");

    // 尋找時間戳與回覆按鈕之間的所有反應按鈕
    for (let i = 0; i < timestamps.length; i++) {
        let timestamp = timestamps[i];
        let replyButton = replyButtons[i];
        let button = timestamp.nextElementSibling as HTMLElement | null;
        while (button && button !== replyButton) {
            if (button.classList.contains("template-reaction") && button.hasAttribute("data-reaction-commentors")) {
                _buttonTimestamps.set(button, timestamp);
                bindEvent2ReactionButton(button);
            }
            button = button.nextElementSibling as HTMLElement | null;
        }
    }

    // Add a "New Reaction" button before each reply button
    for (let i = 0; i < replyButtons.length; i++) {
        let reactionButton = NewReactionButton();
        let timestamp = timestamps[i];
        _buttonTimestamps.set(reactionButton, timestamp);  // Store the timestamp for the new button

        // Insert the button before the reply button
        let replyButton = replyButtons[i];
        replyButton.parentNode?.insertBefore(reactionButton, replyButton);
    }
    console.log(`[Reaction] Added ${replyButtons.length} new reaction buttons.`);

    let finishedLoading = document.createElement('div');
    finishedLoading.id = "reaction-finished-loading";
    finishedLoading.style.display = "none";  // Hide the loading indicator
    document.querySelector('#mw-content-text .mw-parser-output')?.appendChild(finishedLoading);
}
