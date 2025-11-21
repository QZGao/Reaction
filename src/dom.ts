import state from "./state";
import {atChineseUtcRegex, getCurrentChineseUtc, parseTimestamp, userNameAtChineseUtcRegex} from "./utils";
import {modifyPage} from "./api";

declare var mw: any;
declare var OO: any;
declare var window: any;


/**
 * 事件處理函式註冊表。WeakMap用於儲存事件處理函式的引用，以便在需要時可以移除它們。
 * @type {WeakMap<HTMLElement, Function>}
 * @private
 */
const _handlerRegistry = new WeakMap();

/**
 * 按鈕對應的時間戳。WeakMap用於儲存按鈕與時間戳之間的關聯。
 * @type {WeakMap<HTMLElement, HTMLElement>}
 * @private
 */
const _buttonTimestamps = new WeakMap();

/**
 * 時間戳列表，包含所有的時間戳元素。
 * @type {HTMLElement[]}
 */
let timestamps: NodeListOf<HTMLElement> = null;

/**
 * 回覆按鈕列表，包含所有的回覆按鈕元素（與時間戳一一對應）。
 * @type {HTMLElement[]}
 */
let replyButtons: NodeListOf<HTMLElement> = null;


/**
 * 處理反應按鈕的點擊事件，轉發到相應的處理函式。
 * @param button {HTMLElement} - 反應按鈕元素。
 */
function handleReactionClick(button) {
    if (button.classList.contains("reaction-new")) {
        // 對於「新反應」按鈕，轉換為可編輯狀態。
        addNewReaction(button);
    } else {
        if (button.getAttribute("data-reaction-icon-invalid")) {
            // 如果反應圖示無效，不處理。
            mw.notify(state.convByVar({
                hant: "[Reaction] 反應圖示無效，小工具無法處理。", hans: "[Reaction] 反应图示无效，小工具无法处理。",
            }), {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            console.error("[Reaction] Invalid reaction icon.");
            return;
        }

        if (typeof window.ujsReactionConfirmedRequired !== "undefined" && window.ujsReactionConfirmedRequired) {
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
                title: state.convByVar({hant: "確認", hans: "确认"}), size: "small",
            }).then((confirmed) => {
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
function toggleReaction(button) {
    if (button.classList.contains("reaction-reacted")) {
        if (!button.getAttribute("data-reaction-commentors").includes(state.userName)) {
            mw.notify(state.convByVar({
                hant: "[Reaction] 失敗！不能取消並未做出的反應。", hans: "[Reaction] 失败！不能取消并未做出的反应。",
            }), {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            console.log("[Reaction] Should not happen! " + state.userName + " should be in " + button.getAttribute("data-reaction-commentors"));
            return;
        }
        let buttonIcon = button.querySelector(".reaction-icon");
        let buttonCounter = button.querySelector(".reaction-counter");
        let count = parseInt(button.getAttribute("data-reaction-count") || buttonCounter.innerText);
        let mod;
        if (count > 1) {
            mod = {
                timestamp: parseTimestamp(_buttonTimestamps.get(button)),
                downvote: button.getAttribute("data-reaction-icon").trim() || buttonIcon.innerText.trim(),
            };
        } else {
            mod = {
                timestamp: parseTimestamp(_buttonTimestamps.get(button)),
                remove: button.getAttribute("data-reaction-icon").trim() || buttonIcon.innerText.trim(),
            };
        }

        modifyPage(mod).then((response) => {
            if (response) {
                // 外觀上取消反應
                button.classList.remove("reaction-reacted");
                if (count > 1) {
                    buttonCounter.innerText = (count - 1).toString();

                    // Update the data-reaction-commentors attribute
                    let dataCommentors = button.getAttribute("data-reaction-commentors") + "/";  // Add a trailing slash to make it easier to replace
                    dataCommentors = dataCommentors.replace(new RegExp(userNameAtChineseUtcRegex() + "/", "g"), "");
                    dataCommentors = dataCommentors.slice(0, -1);  // Remove the trailing slash
                    button.setAttribute("data-reaction-commentors", dataCommentors);

                    let buttonTitle = button.getAttribute("title");
                    if (buttonTitle) {
                        buttonTitle = buttonTitle.replace(new RegExp(userNameAtChineseUtcRegex(), "g"), "");
                        let trailingSemicolonRegex = new RegExp("；" + atChineseUtcRegex() + "回[應应]了[這这][條条]留言$", "g");
                        // console.log(trailingSemicolonRegex);
                        buttonTitle = buttonTitle.replace(trailingSemicolonRegex, "");
                        let trailingCommaRegex = new RegExp("、​" + atChineseUtcRegex() + "(|、​.+?)(回[應应]了[這这][條条]留言)$", "g");
                        // console.log(trailingCommaRegex);
                        buttonTitle = buttonTitle.replace(trailingCommaRegex, "$1$2");
                        buttonTitle = buttonTitle.replace(new RegExp("^" + atChineseUtcRegex() + "、​"), "");  // Remove leading comma
                        button.setAttribute("title", buttonTitle);
                    }
                } else {
                    button.parentNode.removeChild(button);
                }
            }
        });
    } else {
        if (button.getAttribute("data-reaction-commentors").includes(state.userName)) {
            mw.notify(state.convByVar({
                hant: "[Reaction] 失敗！不能重複做出反應。", hans: "[Reaction] 失败！不能重复做出反应。",
            }), {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            console.log("[Reaction] Should not happen! " + state.userName + " should not be in " + button.getAttribute("data-reaction-commentors"));
            return;
        }
        let buttonIcon = button.querySelector(".reaction-icon");
        let mod = {
            timestamp: parseTimestamp(_buttonTimestamps.get(button)),
            upvote: button.getAttribute("data-reaction-icon").trim() || buttonIcon.innerText.trim(),
        };

        modifyPage(mod).then((response) => {
            if (response) {
                // 外觀上添加反應
                button.classList.add("reaction-reacted");
                let buttonCounter = button.querySelector(".reaction-counter");
                let count = parseInt(buttonCounter.innerText);
                buttonCounter.innerText = (count + 1).toString();

                // Update the data-reaction-commentors attribute
                let dataCommentors = button.getAttribute("data-reaction-commentors");
                if (dataCommentors) {
                    dataCommentors += "/" + state.userName + "於" + getCurrentChineseUtc();
                } else {
                    dataCommentors = state.userName + "於" + getCurrentChineseUtc();
                }
                button.setAttribute("data-reaction-commentors", dataCommentors);
                let buttonTitle = button.getAttribute("title");
                if (buttonTitle) {
                    buttonTitle += "；";
                } else {
                    buttonTitle = "";
                }
                buttonTitle += state.userName + state.convByVar({
                    hant: "於", hans: "于",
                }) + getCurrentChineseUtc() + state.convByVar({
                    hant: "回應了這條留言", hans: "回应了这条留言",
                });
                button.setAttribute("title", buttonTitle);
            }
        });
    }
}

/**
 * 取消新反應按鈕的編輯狀態。
 * @param button {HTMLElement} - 「新反應」按鈕元素。
 * @param event {MouseEvent|false} - 滑鼠點擊事件，false 表示不是瀏覽器觸發所以無需取消
 */
function cancelNewReaction(button, event) {
    if (event) {
        event.stopPropagation();
    }

    // Remove event handlers using the stored bound function reference.
    let saveButton = button.querySelector(".reaction-save");
    const saveButtonClickHandler = _handlerRegistry.get(saveButton);
    if (saveButtonClickHandler) {
        saveButton.removeEventListener("click", saveButtonClickHandler);
        // Remove the reference from the registry.
        _handlerRegistry.delete(saveButton);
    }
    let cancelButton = button.querySelector(".reaction-cancel");
    const cancelButtonClickHandler = _handlerRegistry.get(cancelButton);
    if (cancelButtonClickHandler) {
        cancelButton.removeEventListener("click", cancelButtonClickHandler);
        // Remove the reference from the registry.
        _handlerRegistry.delete(cancelButton);
    }

    // Restore the add new reaction button to the original state
    let buttonIcon = button.querySelector(".reaction-icon");
    buttonIcon.textContent = "+";
    let buttonCounter = button.querySelector(".reaction-counter");
    buttonCounter.innerText = state.convByVar({hant: "反應", hans: "反应"});

    // Restore the original event handler
    // Create the bound function and store it in the WeakMap.
    if (_handlerRegistry.has(button)) {
        console.error("[Reaction] Not possible! The event handler should not be registered yet.");
        return;
    }
    const buttonClickHandler = handleReactionClick.bind(this, button);
    _handlerRegistry.set(button, buttonClickHandler);
    button.addEventListener("click", buttonClickHandler);
}

/**
 * 儲存新的反應，並更新按鈕的狀態。
 * @param button {HTMLElement} - 「新反應」按鈕元素。
 * @param event {MouseEvent|false} - 滑鼠點擊事件，false 表示不是瀏覽器觸發所以無需取消
 */
function saveNewReaction(button, event) {
    if (event) {
        event.stopPropagation();
    }

    let input = button.querySelector(".reaction-icon input");
    if (!input.value.trim()) {
        mw.notify(state.convByVar({
            hant: "[Reaction] 反應內容不能為空！", hans: "[Reaction] 反应内容不能为空！",
        }), {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
        return;
    }

    // Save the new reaction
    let timestamp = parseTimestamp(_buttonTimestamps.get(button));
    if (!timestamp) {
        mw.notify(state.convByVar({
            hant: "[Reaction] 失敗！無法獲取時間戳。", hans: "[Reaction] 失败！无法获取时间戳。",
        }), {title: state.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
        return;
    }
    let mod = {
        timestamp: timestamp, append: input.value.trim(),
    };
    modifyPage(mod).then((response) => {
        if (response) {
            // Change the icon to the new reaction
            button.classList.remove("reaction-new");
            button.classList.add("reaction-reacted");
            let buttonIcon = button.querySelector(".reaction-icon");
            buttonIcon.textContent = input.value;
            let buttonCounter = button.querySelector(".reaction-counter");
            buttonCounter.textContent = "1";
            button.setAttribute("title", state.userName + state.convByVar({
                hant: "於", hans: "于",
            }) + getCurrentChineseUtc() + state.convByVar({
                hant: "回應了這條留言", hans: "回应了这条留言",
            }));
            button.setAttribute("data-reaction-commentors", state.userName);

            // Remove event handlers using the stored bound function reference.
            let saveButton = button.querySelector(".reaction-save");
            const saveButtonClickHandler = _handlerRegistry.get(saveButton);
            if (saveButtonClickHandler) {
                saveButton.removeEventListener("click", saveButtonClickHandler);
                // Remove the reference from the registry.
                _handlerRegistry.delete(saveButton);
            }
            let cancelButton = button.querySelector(".reaction-cancel");
            const cancelButtonClickHandler = _handlerRegistry.get(cancelButton);
            if (cancelButtonClickHandler) {
                cancelButton.removeEventListener("click", cancelButtonClickHandler);
                // Remove the reference from the registry.
                _handlerRegistry.delete(cancelButton);
            }

            // Add new reaction button after the old button
            let newReactionButton = NewReactionButton();
            button.parentNode.insertBefore(newReactionButton, button.nextSibling);
            _buttonTimestamps.set(newReactionButton, _buttonTimestamps.get(button));  // Store the timestamp for the new button

            // Restore the original event handler
            // Create the bound function and store it in the WeakMap.
            if (_handlerRegistry.has(button)) {
                console.error("Not possible! The event handler should not be registered yet.");
                return;
            }
            const buttonClickHandler = handleReactionClick.bind(this, button);
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
function ResizableInput(text = "", parent = document.body) {
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
    [
        "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "textTransform",
    ].forEach(prop => {
        hiddenInput.style[prop] = inputStyles[prop];
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
function addNewReaction(button) {
    // Remove event handlers using the stored bound function reference.
    // Retrieve the handler reference from the WeakMap.
    const buttonClickHandler = _handlerRegistry.get(button);
    if (buttonClickHandler) {
        button.removeEventListener("click", buttonClickHandler);
        // Remove the reference from the registry.
        _handlerRegistry.delete(button);
    }

    // Change the icon to a textbox
    let buttonIcon = button.querySelector(".reaction-icon");
    buttonIcon.textContent = "";  // Clear the icon
    let input = ResizableInput("👍", buttonIcon);
    input.focus();
    input.select();
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            saveNewReaction(button, false);
        } else if (event.key === "Escape") {
            cancelNewReaction(button, false);
        }
    });

    let buttonCounter = button.querySelector(".reaction-counter");
    let saveButton = document.createElement("span");
    saveButton.className = "reaction-save";
    saveButton.innerText = state.convByVar({hant: "儲存", hans: "保存"});
    if (_handlerRegistry.has(saveButton)) {
        return;
    }
    const saveButtonClickHandler = saveNewReaction.bind(this, button);  // Create bound functions and store them in the WeakMap.
    _handlerRegistry.set(saveButton, saveButtonClickHandler);
    saveButton.addEventListener("click", saveButtonClickHandler);

    let cancelButton = document.createElement("span");
    cancelButton.className = "reaction-cancel";
    cancelButton.innerText = state.convByVar({hant: "取消", hans: "取消"});
    if (_handlerRegistry.has(cancelButton)) {
        return;
    }
    const cancelButtonClickHandler = cancelNewReaction.bind(this, button);  // Create bound functions and store them in the WeakMap.
    _handlerRegistry.set(cancelButton, cancelButtonClickHandler);
    cancelButton.addEventListener("click", cancelButtonClickHandler);

    buttonCounter.innerText = "";
    buttonCounter.appendChild(saveButton);
    buttonCounter.appendChild(document.createTextNode(" | "));
    buttonCounter.appendChild(cancelButton);
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
    buttonCounter.innerText = state.convByVar({hant: "反應", hans: "反应"});
    buttonCounterContainer.appendChild(buttonCounter);
    buttonContent.appendChild(buttonIconContainer);
    buttonContent.appendChild(buttonCounterContainer);
    button.appendChild(buttonContent);

    // Create the bound function and store it in the WeakMap.
    let buttonClickHandler = handleReactionClick.bind(this, button);
    _handlerRegistry.set(button, buttonClickHandler);
    button.addEventListener("click", buttonClickHandler);
    return button;
}

/**
 * 綁定事件到普通反應按鈕（非「新反應」）。
 * @param button {HTMLElement} - 反應按鈕元素。
 */
function bindEvent2ReactionButton(button) {
    // Create the bound function and store it in the WeakMap.
    if (_handlerRegistry.has(button)) {
        return;
    }
    let buttonClickHandler = handleReactionClick.bind(this, button);
    _handlerRegistry.set(button, buttonClickHandler);
    button.addEventListener("click", buttonClickHandler);

    // Check if the user has reacted to this
    let reacted = false;
    for (const commentor of button.getAttribute("data-reaction-commentors").split("/")) {
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

    timestamps = document.querySelectorAll("a.ext-discussiontools-init-timestamplink");
    replyButtons = document.querySelectorAll("span.ext-discussiontools-init-replylink-buttons");

    // 尋找時間戳與回覆按鈕之間的所有反應按鈕
    for (let i = 0; i < timestamps.length; i++) {
        let timestamp = timestamps[i];
        let replyButton = replyButtons[i];
        let button = timestamp.nextElementSibling;
        while (button && button !== replyButton) {
            if (button.classList.contains("template-reaction") && button.attributes["data-reaction-commentors"]) {
                _buttonTimestamps.set(button, timestamp);
                bindEvent2ReactionButton(button);
            }
            button = button.nextElementSibling;
        }
    }

    // Add a "New Reaction" button before each reply button
    for (let i = 0; i < replyButtons.length; i++) {
        let reactionButton = NewReactionButton();
        let timestamp = timestamps[i];
        _buttonTimestamps.set(reactionButton, timestamp);  // Store the timestamp for the new button

        // Insert the button before the reply button
        let replyButton = replyButtons[i];
        replyButton.parentNode.insertBefore(reactionButton, replyButton);
    }
    console.log(`[Reaction] Added ${replyButtons.length} new reaction buttons.`);

    let finishedLoading = document.createElement('div');
    finishedLoading.id = "reaction-finished-loading";
    finishedLoading.style.display = "none";  // Hide the loading indicator
    document.querySelector('#mw-content-text .mw-parser-output').appendChild(finishedLoading);
}