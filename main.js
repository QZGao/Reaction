// Main page: [[User:SuperGrey/gadgets/Reaction]]

const ReactionTools = {
    /**
     * 處理反應按鈕的點擊事件，轉發到相應的處理函式。
     * @param button {HTMLElement} - 反應按鈕元素。
     */
    handleReactionClick: function (button) {
        if (button.classList.contains("reaction-new")) {
            // 對於「新反應」按鈕，轉換為可編輯狀態。
            this.addNewReaction(button);
        } else {
        	if (button.getAttribute("data-reaction-icon-invalid")) {
				// 如果反應圖示無效，不處理。
				mw.notify(this.convByVar({
					hant: "[Reaction] 反應圖示無效，小工具無法處理。", hans: "[Reaction] 反应图示无效，小工具无法处理。",
				}), {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
				console.error("[Reaction] Invalid reaction icon.");
				return;
			}

            if (typeof window.ujsReactionConfirmedRequired !== "undefined" && window.ujsReactionConfirmedRequired) {
                // （手賤者專用）點擊普通反應按鈕時，確認是否要追加或取消反應。
                let confirmMessage;
                if (button.classList.contains("reaction-reacted")) {
                    confirmMessage = this.convByVar({
                        hant: "[Reaction] 確定要取消這個反應嗎？", hans: "[Reaction] 确定要取消这个反应吗？",
                    });
                } else {
                    confirmMessage = this.convByVar({
                        hant: "[Reaction] 確定要追加這個反應嗎？", hans: "[Reaction] 确定要追加这个反应吗？",
                    });
                }
                OO.ui.confirm(confirmMessage, {
                    title: this.convByVar({hant: "確認", hans: "确认"}), size: "small",
                }).then((confirmed) => {
                    if (confirmed) {
                        this.toggleReaction(button);
                    }
                });
            } else {
                // （預設）不需要確認，直接切換反應狀態。
                this.toggleReaction(button);
            }
        }
    },

    /**
     * 切換普通反應按鈕（非「新反應」）的反應狀態。
     * @param button {HTMLElement} - 反應按鈕元素。
     */
    toggleReaction: function (button) {
        if (button.classList.contains("reaction-reacted")) {
            if (!button.getAttribute("data-reaction-commentors").includes(this.userName)) {
                mw.notify(this.convByVar({
                    hant: "[Reaction] 失敗！不能取消並未做出的反應。", hans: "[Reaction] 失败！不能取消并未做出的反应。",
                }), {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
                console.log("[Reaction] Should not happen! " + this.userName + " should be in " + button.getAttribute("data-reaction-commentors"));
                return;
            }
            let buttonIcon = button.querySelector(".reaction-icon");
            let buttonCounter = button.querySelector(".reaction-counter");
            let count = parseInt(button.getAttribute("data-reaction-count") || buttonCounter.innerText);
            let mod;
            if (count > 1) {
                mod = {
                    timestamp: this.parseTimestamp(this._buttonTimestamps.get(button)),
                    downvote: button.getAttribute("data-reaction-icon").trim() || buttonIcon.innerText.trim(),
                };
            } else {
                mod = {
                    timestamp: this.parseTimestamp(this._buttonTimestamps.get(button)),
                    remove: button.getAttribute("data-reaction-icon").trim() || buttonIcon.innerText.trim(),
                };
            }

            this.modifyPage(mod).then((response) => {
                if (response) {
                    // 外觀上取消反應
                    button.classList.remove("reaction-reacted");
                    if (count > 1) {
                        buttonCounter.innerText = (count - 1).toString();

                        // Update the data-reaction-commentors attribute
                        let dataCommentors = button.getAttribute("data-reaction-commentors") + "/";  // Add a trailing slash to make it easier to replace
                        dataCommentors = dataCommentors.replace(new RegExp(this.userNameAtChineseUtcRegex() + "/", "g"), "");
                        dataCommentors = dataCommentors.slice(0, -1);  // Remove the trailing slash
                        button.setAttribute("data-reaction-commentors", dataCommentors);

                        let buttonTitle = button.getAttribute("title");
                        if (buttonTitle) {
                            buttonTitle = buttonTitle.replace(new RegExp(this.userNameAtChineseUtcRegex(), "g"), "");
                            let trailingSemicolonRegex = new RegExp("；" + this.atChineseUtcRegex() + "回[應应]了[這这][條条]留言$", "g");
                            // console.log(trailingSemicolonRegex);
                            buttonTitle = buttonTitle.replace(trailingSemicolonRegex, "");
                            let trailingCommaRegex = new RegExp("、​" + this.atChineseUtcRegex() + "(|、​.+?)(回[應应]了[這这][條条]留言)$", "g");
                            // console.log(trailingCommaRegex);
                            buttonTitle = buttonTitle.replace(trailingCommaRegex, "$1$2");
                            buttonTitle = buttonTitle.replace(new RegExp("^" + this.atChineseUtcRegex() + "、​"), "");  // Remove leading comma
                            button.setAttribute("title", buttonTitle);
                        }
                    } else {
                        button.parentNode.removeChild(button);
                    }
                }
            });
        } else {
            if (button.getAttribute("data-reaction-commentors").includes(this.userName)) {
                mw.notify(this.convByVar({
                    hant: "[Reaction] 失敗！不能重複做出反應。", hans: "[Reaction] 失败！不能重复做出反应。",
                }), {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
                console.log("[Reaction] Should not happen! " + this.userName + " should not be in " + button.getAttribute("data-reaction-commentors"));
                return;
            }
            let buttonIcon = button.querySelector(".reaction-icon");
            let mod = {
                timestamp: this.parseTimestamp(this._buttonTimestamps.get(button)),
                upvote: button.getAttribute("data-reaction-icon").trim() || buttonIcon.innerText.trim(),
            };

            this.modifyPage(mod).then((response) => {
                if (response) {
                    // 外觀上添加反應
                    button.classList.add("reaction-reacted");
                    let buttonCounter = button.querySelector(".reaction-counter");
                    let count = parseInt(buttonCounter.innerText);
                    buttonCounter.innerText = (count + 1).toString();

                    // Update the data-reaction-commentors attribute
                    let dataCommentors = button.getAttribute("data-reaction-commentors");
                    if (dataCommentors) {
                        dataCommentors += "/" + this.userName + "於" + this.getCurrentChineseUtc();
                    } else {
                        dataCommentors = this.userName + "於" + this.getCurrentChineseUtc();
                    }
                    button.setAttribute("data-reaction-commentors", dataCommentors);
                    let buttonTitle = button.getAttribute("title");
                    if (buttonTitle) {
                        buttonTitle += "；";
                    } else {
                        buttonTitle = "";
                    }
                    buttonTitle += this.userName + this.convByVar({
                        hant: "於", hans: "于",
                    }) + this.getCurrentChineseUtc() + this.convByVar({
                        hant: "回應了這條留言", hans: "回应了这条留言",
                    });
                    button.setAttribute("title", buttonTitle);
                }
            });
        }
    },

    /**
     * 取消新反應按鈕的編輯狀態。
     * @param button {HTMLElement} - 「新反應」按鈕元素。
     * @param event {MouseEvent|false} - 滑鼠點擊事件，false 表示不是瀏覽器觸發所以無需取消
     */
    cancelNewReaction: function (button, event) {
        if (event) {
            event.stopPropagation();
        }

        // Remove event handlers using the stored bound function reference.
        let saveButton = button.querySelector(".reaction-save");
        const saveButtonClickHandler = this._handlerRegistry.get(saveButton);
        if (saveButtonClickHandler) {
            saveButton.removeEventListener("click", saveButtonClickHandler);
            // Remove the reference from the registry.
            this._handlerRegistry.delete(saveButton);
        }
        let cancelButton = button.querySelector(".reaction-cancel");
        const cancelButtonClickHandler = this._handlerRegistry.get(cancelButton);
        if (cancelButtonClickHandler) {
            cancelButton.removeEventListener("click", cancelButtonClickHandler);
            // Remove the reference from the registry.
            this._handlerRegistry.delete(cancelButton);
        }

        // Restore the add new reaction button to the original state
        let buttonIcon = button.querySelector(".reaction-icon");
        buttonIcon.textContent = "+";
        let buttonCounter = button.querySelector(".reaction-counter");
        buttonCounter.innerText = this.convByVar({hant: "反應", hans: "反应"});

        // Restore the original event handler
        // Create the bound function and store it in the WeakMap.
        if (this._handlerRegistry.has(button)) {
            console.error("[Reaction] Not possible! The event handler should not be registered yet.");
            return;
        }
        const buttonClickHandler = this.handleReactionClick.bind(this, button);
        this._handlerRegistry.set(button, buttonClickHandler);
        button.addEventListener("click", buttonClickHandler);
    },

    /**
     * 儲存新的反應，並更新按鈕的狀態。
     * @param button {HTMLElement} - 「新反應」按鈕元素。
     * @param event {MouseEvent|false} - 滑鼠點擊事件，false 表示不是瀏覽器觸發所以無需取消
     */
    saveNewReaction: function (button, event) {
        if (event) {
            event.stopPropagation();
        }

        let input = button.querySelector(".reaction-icon input");
        if (!input.value.trim()) {
            mw.notify(this.convByVar({
                hant: "[Reaction] 反應內容不能為空！", hans: "[Reaction] 反应内容不能为空！",
            }), {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            return;
        }

        // Save the new reaction
        let timestamp = this.parseTimestamp(this._buttonTimestamps.get(button));
        if (!timestamp) {
            mw.notify(this.convByVar({
                hant: "[Reaction] 失敗！無法獲取時間戳。", hans: "[Reaction] 失败！无法获取时间戳。",
            }), {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            return;
        }
        let mod = {
            timestamp: timestamp, append: input.value.trim(),
        };
        this.modifyPage(mod).then((response) => {
            if (response) {
                // Change the icon to the new reaction
                button.classList.remove("reaction-new");
                button.classList.add("reaction-reacted");
                let buttonIcon = button.querySelector(".reaction-icon");
                buttonIcon.textContent = input.value;
                let buttonCounter = button.querySelector(".reaction-counter");
                buttonCounter.textContent = "1";
                button.setAttribute("title", this.userName + this.convByVar({
                    hant: "於", hans: "于",
                }) + this.getCurrentChineseUtc() + this.convByVar({
                    hant: "回應了這條留言", hans: "回应了这条留言",
                }));
                button.setAttribute("data-reaction-commentors", this.userName);

                // Remove event handlers using the stored bound function reference.
                let saveButton = button.querySelector(".reaction-save");
                const saveButtonClickHandler = this._handlerRegistry.get(saveButton);
                if (saveButtonClickHandler) {
                    saveButton.removeEventListener("click", saveButtonClickHandler);
                    // Remove the reference from the registry.
                    this._handlerRegistry.delete(saveButton);
                }
                let cancelButton = button.querySelector(".reaction-cancel");
                const cancelButtonClickHandler = this._handlerRegistry.get(cancelButton);
                if (cancelButtonClickHandler) {
                    cancelButton.removeEventListener("click", cancelButtonClickHandler);
                    // Remove the reference from the registry.
                    this._handlerRegistry.delete(cancelButton);
                }

                // Add new reaction button after the old button
                let newReactionButton = this.NewReactionButton();
                button.parentNode.insertBefore(newReactionButton, button.nextSibling);
                this._buttonTimestamps.set(newReactionButton, this._buttonTimestamps.get(button));  // Store the timestamp for the new button

                // Restore the original event handler
                // Create the bound function and store it in the WeakMap.
                if (this._handlerRegistry.has(button)) {
                    console.error("Not possible! The event handler should not be registered yet.");
                    return;
                }
                const buttonClickHandler = this.handleReactionClick.bind(this, button);
                this._handlerRegistry.set(button, buttonClickHandler);
                button.addEventListener("click", buttonClickHandler);
            }
        });
    },

    /**
     * 解析14位數字格式的UTC日期字串，並返回對應的Date物件。
     * @param utc14 {string} - 14位數字格式的UTC日期字串，例如「20231015123456」。
     * @returns {Date} - 對應的Date物件。
     */
    parseUtc14: function (utc14) {
        // Extract year, month, day, hour, minute, and second from the string
        const year = Number(utc14.slice(0, 4));
        const month = Number(utc14.slice(4, 6)) - 1; // JavaScript months are 0-indexed
        const day = Number(utc14.slice(6, 8));
        const hour = Number(utc14.slice(8, 10));
        const minute = Number(utc14.slice(10, 12));
        const second = Number(utc14.slice(12, 14));

        // Create a Date object from UTC values
        return new Date(Date.UTC(year, month, day, hour, minute, second));
    },

    /**
     * 生成中文格式的UTC日期字串。
     * @param utc14 {string} - 14位數字格式的UTC日期字串，例如「20231015123456」。
     * @returns {string} - 中文格式的UTC日期字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
     */
    utc14ToChineseUtc: function (utc14) {
        const date = this.parseUtc14(utc14);
        return this.dateToChineseUtc(date);
    },

    /**
     * 解析中文格式的UTC日期字串，並返回對應的Date物件。
     * @param chineseUtcDate {string} - 中文格式的UTC日期字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
     * @returns {null|Date} - 對應的Date物件，或null（如果無法解析）。
     */
    parseChineseUtc: function (chineseUtcDate) {
        const match = chineseUtcDate.match(new RegExp('^' + this.chineseUtcCaptureRegex + '$'));
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
    },

    /**
     * 將Date物件轉換為中文格式的UTC日期字串。
     * @param date {Date} - Date物件。
     * @returns {string} - 中文格式的UTC日期字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
     */
    dateToChineseUtc: function (date) {
        return date.getUTCFullYear() + "年" + (date.getUTCMonth() + 1) + "月" + date.getUTCDate() + "日 (" + [
            "日", "一", "二", "三", "四", "五", "六",
        ][date.getUTCDay()] + ") " + date.getUTCHours().toString().padStart(2, "0") + ":" + date.getUTCMinutes().toString().padStart(2, "0") + " (UTC)";
    },

    /**
     * 解析時間戳，並返回對應的UTC日期字串。
     * @param timestamp {HTMLElement} - 時間戳元素。
     * @returns {null|string} - 對應的UTC日期字串，或null（如果無法解析）。
     */
    parseTimestamp: function (timestamp) {
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
                    return this.utc14ToChineseUtc(ts);
                }
                // 格式2：c-<使用者名>-yyyy-mm-ddThh:mm:ss.000Z-<段落標題> 或 c-<使用者名>-yyyy-mm-ddThh:mm:ss.000Z-<使用者名>-yyyy-mm-ddThh:mm:ss.000Z
                ts = (ts_s.match(/-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z)/) || [])[1];
                if (ts) {
                    let date = new Date(ts);
                    return this.dateToChineseUtc(date);
                }
            }
            console.error("[Reaction] Unable to parse timestamp in: " + href);
            return null;
        }
    },

    /**
     * 獲取完整的wikitext。
     * @returns {Promise<string>} 包含完整wikitext的Promise。
     */
    retrieveFullText: async function () {
        if (!this.api) {
            this.api = new mw.Api({userAgent: 'Reaction/1.0.0'});
        }
        let response = await this.api.get({
            action: 'query', titles: this.pageName, prop: 'revisions', rvslots: '*', rvprop: 'content', indexpageids: 1,
        });
        let fulltext = response.query.pages[response.query.pageids[0]].revisions[0].slots.main['*'];
        return fulltext + "\n";
    },

    /**
     * 儲存完整的wikitext。
     * @param fulltext {string} - 完整的wikitext。
     * @param summary {string} - 編輯摘要。
     * @returns {Promise<boolean>} - 操作成功與否的Promise。
     */
    saveFullText: async function (fulltext, summary) {
        try {
            if (!this.api) {
                this.api = new mw.Api({userAgent: 'Reaction/1.0.0'});
            }
            await this.api.postWithToken('edit', {
                action: 'edit',
                title: this.pageName,
                text: fulltext,
                summary: summary + " ([[User:SuperGrey/gadgets/Reaction|Reaction]])",
            });
            mw.notify(this.convByVar({hant: "[Reaction] 儲存成功！", hans: "[Reaction] 保存成功！"}), {
                title: "成功", type: "success",
            });
            return true;
        } catch (e) {
            console.error(e);
            mw.notify(this.convByVar({
                hant: "[Reaction] 失敗！無法儲存頁面。", hans: "[Reaction] 失败！无法保存页面。",
            }), {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            return false;
        }
    },

    /**
     * 將字串中的特殊字符轉義。
     * @param string {String} - 字串
     * @returns {String} - 轉義後的字串
     */
    escapeRegex: function (string) {
        return mw.util.escapeRegExp(string);
    },

    /**
     * 修改頁面內容。
     * @param mod {Object} - 修改內容的物件，包含時間戳（timestamp）、要添加或刪除的反應等（upvote、downvote、append、remove）。
     * @returns {Promise<boolean>} - 操作成功與否的Promise。
     */
    modifyPage: async function (mod) {
        let fulltext;
        try {
            fulltext = await this.retrieveFullText();
        } catch (e) {
            console.error(e);
            mw.notify(this.convByVar({
                hant: "[Reaction] 失敗！無法獲取頁面內容。", hans: "[Reaction] 失败！无法获取页面内容。",
            }), {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            return false;
        }

        let newFulltext;
        let summary = "";
        try {
            let timestampRegex = new RegExp(`${this.escapeRegex(mod.timestamp)}`, "g");
            let timestampMatch = fulltext.match(timestampRegex);

            // If the timestamp is not found, throw an error
            if (!timestampMatch || timestampMatch.length === 0) {
                console.log("[Reaction] Unable to find timestamp " + mod.timestamp + " in: " + fulltext);
                throw new Error("[Reaction] " + this.convByVar({
                    hant: "原文中找不到時間戳：", hans: "原文中找不到时间戳：",
                }) + mod.timestamp);
            }

            // Check if more than one match is found.
            if (timestampMatch.length > 1) {
                console.log("[Reaction] More than one timestamp found: " + timestampMatch);
                throw new Error("[Reaction] " + this.convByVar({
                    hant: "原文中找到多個相同的時間戳，小工具無法處理：",
                    hans: "原文中找到多个相同的时间戳，小工具无法处理：",
                }) + mod.timestamp + this.convByVar({
					hant: "。請手動編輯。", hans: "。请手动编辑。",
				}));
            }

            let pos = fulltext.search(timestampRegex);
            console.log("[Reaction] Found timestamp " + mod.timestamp + " at position " + pos);

            if (mod.remove) {
                let regex = new RegExp(` *\\{\\{ *[Rr]eact(?:ion|) *\\| *${this.escapeRegex(mod.remove)} *\\| *${this.userNameAtChineseUtcRegex()} *}}`, "g");
                // console.log(regex);

                // Find this after the timestamp, but before the next newline
                let lineEnd = fulltext.indexOf("\n", pos);
                let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
                let newTimestamp2LineEnd = timestamp2LineEnd.replace(regex, "");
                newFulltext = fulltext.slice(0, pos) + newTimestamp2LineEnd + fulltext.slice(lineEnd);
                summary = "− " + mod.remove;
            } else if (mod.downvote) {
                let regex = new RegExp(`\\{\\{ *[Rr]eact(?:ion|) *\\| *${this.escapeRegex(mod.downvote)} *(|\\|[^}]*?)\\| *${this.userNameAtChineseUtcRegex()} *(|\\|[^}]*?)}}`, "g");
                // console.log(regex);

                // Find this after the timestamp, but before the next newline
                let lineEnd = fulltext.indexOf("\n", pos);
                let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
                let newTimestamp2LineEnd = timestamp2LineEnd.replace(regex, `{{Reaction|${mod.downvote}$1$2}}`);
                newFulltext = fulltext.slice(0, pos) + newTimestamp2LineEnd + fulltext.slice(lineEnd);
                summary = "− " + mod.downvote;
            } else if (mod.upvote) {
                let regex = new RegExp(`\\{\\{ *[Rr]eact(?:ion|) *\\| *${this.escapeRegex(mod.upvote)}([^}]*?)}}`, "g");
                // console.log(regex);

                // Find this after the timestamp, but before the next newline
                let lineEnd = fulltext.indexOf("\n", pos);
                let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
                let newTimestamp2LineEnd = timestamp2LineEnd.replace(regex, `{{Reaction|${mod.upvote}$1|${this.userName}於${this.getCurrentChineseUtc()}}}`);
                newFulltext = fulltext.slice(0, pos) + newTimestamp2LineEnd + fulltext.slice(lineEnd);
                summary = "+ " + mod.upvote;
            } else if (mod.append) {
                let regex = new RegExp(`\\{\\{ *[Rr]eact(?:ion|) *\\| *${this.escapeRegex(mod.append)}([^}]*?)}}`, "g");
                // console.log(regex);

                let lineEnd = fulltext.indexOf("\n", pos);
                let timestamp2LineEnd = fulltext.slice(pos, lineEnd);
                // If the reaction already exists, then error
                if (regex.test(timestamp2LineEnd)) {
                    console.log("[Reaction] Reaction of " + mod.append + " already exists in: " + timestamp2LineEnd);
                    throw new Error("[Reaction] " + this.convByVar({
                        hant: "原文中已經有這個反應！", hans: "原文中已经有这个反应！",
                    }));
                }

                // Add text at the end of that line
                let newText = "{{Reaction|" + mod.append + "|" + this.userName + "於" + this.getCurrentChineseUtc() + "}}";
                newFulltext = fulltext.slice(0, lineEnd) + " " + newText + fulltext.slice(lineEnd);
                summary = "+ " + mod.append;
            }

            if (newFulltext === fulltext) {
                console.log("[Reaction] Nothing is modified. Could be because using a template inside {{Reaction}}.");
                throw new Error("[Reaction] " + this.convByVar({
                    hant: "原文未被修改。可能是因為使用了嵌套模板；請手動編輯。", hans: "原文未被修改。可能是因为使用了嵌套模板；请手动编辑。",
                }));
            }

            // 儲存全文。錯誤資訊已在函式內處理。
            return await this.saveFullText(newFulltext, summary);

        } catch (e) {
            console.error(e);
            mw.notify(e.message, {title: this.convByVar({hant: "錯誤", hans: "错误"}), type: "error"});
            return false;
        }
    },

    /**
     * 創建一個可調整大小的輸入框。
     * @param text {string} - 預設文字。
     * @param parent {HTMLElement} - 父元素。輸入框（以及隱藏的寬度計算器）將被添加到這個元素中。
     * @returns {HTMLInputElement} - 可調整大小的輸入框。
     * @constructor
     */
    ResizableInput: function (text = "", parent = document.body) {
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
    },

    /**
     * 將「新反應」按鈕轉換為可編輯狀態，並加入「儲存」和「取消」選單。
     * @param button {HTMLElement} - 「新反應」按鈕元素。
     */
    addNewReaction: function (button) {
        // Remove event handlers using the stored bound function reference.
        // Retrieve the handler reference from the WeakMap.
        const buttonClickHandler = this._handlerRegistry.get(button);
        if (buttonClickHandler) {
            button.removeEventListener("click", buttonClickHandler);
            // Remove the reference from the registry.
            this._handlerRegistry.delete(button);
        }

        // Change the icon to a textbox
        let buttonIcon = button.querySelector(".reaction-icon");
        buttonIcon.textContent = "";  // Clear the icon
        let input = this.ResizableInput("👍", buttonIcon);
        input.focus();
        input.select();
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                ReactionTools.saveNewReaction(button, false);
            } else if (event.key === "Escape") {
                ReactionTools.cancelNewReaction(button, false);
            }
        });

        let buttonCounter = button.querySelector(".reaction-counter");
        let saveButton = document.createElement("span");
        saveButton.className = "reaction-save";
        saveButton.innerText = this.convByVar({hant: "儲存", hans: "保存"});
        if (this._handlerRegistry.has(saveButton)) {
            return;
        }
        const saveButtonClickHandler = this.saveNewReaction.bind(this, button);  // Create bound functions and store them in the WeakMap.
        this._handlerRegistry.set(saveButton, saveButtonClickHandler);
        saveButton.addEventListener("click", saveButtonClickHandler);

        let cancelButton = document.createElement("span");
        cancelButton.className = "reaction-cancel";
        cancelButton.innerText = this.convByVar({hant: "取消", hans: "取消"});
        if (this._handlerRegistry.has(cancelButton)) {
            return;
        }
        const cancelButtonClickHandler = this.cancelNewReaction.bind(this, button);  // Create bound functions and store them in the WeakMap.
        this._handlerRegistry.set(cancelButton, cancelButtonClickHandler);
        cancelButton.addEventListener("click", cancelButtonClickHandler);

        buttonCounter.innerText = "";
        buttonCounter.appendChild(saveButton);
        buttonCounter.appendChild(document.createTextNode(" | "));
        buttonCounter.appendChild(cancelButton);
    },

    /**
     * 創建一個「新反應」按鈕。
     * @returns {HTMLSpanElement} - 「新反應」按鈕元素。
     * @constructor
     */
    NewReactionButton: function () {
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
        buttonCounter.innerText = this.convByVar({hant: "反應", hans: "反应"});
        buttonCounterContainer.appendChild(buttonCounter);
        buttonContent.appendChild(buttonIconContainer);
        buttonContent.appendChild(buttonCounterContainer);
        button.appendChild(buttonContent);

        // Create the bound function and store it in the WeakMap.
        let buttonClickHandler = this.handleReactionClick.bind(this, button);
        this._handlerRegistry.set(button, buttonClickHandler);
        button.addEventListener("click", buttonClickHandler);
        return button;
    },

    /**
     * 綁定事件到普通反應按鈕（非「新反應」）。
     * @param button {HTMLElement} - 反應按鈕元素。
     */
    bindEvent2ReactionButton: function (button) {
        // Create the bound function and store it in the WeakMap.
        if (this._handlerRegistry.has(button)) {
            return;
        }
        let buttonClickHandler = this.handleReactionClick.bind(this, button);
        this._handlerRegistry.set(button, buttonClickHandler);
        button.addEventListener("click", buttonClickHandler);

        // Check if the user has reacted to this
        let reacted = false;
        for (const commentor of button.getAttribute("data-reaction-commentors").split("/")) {
            // Either username or username於chineseUtc
            let regex = new RegExp('^' + this.userNameAtChineseUtcRegex() + '$');
            // console.log(regex);
            if (regex.test(commentor)) {
                reacted = true;
                break;
            }
        }
        if (reacted) {
            button.classList.add("reaction-reacted");
        }
    },

    /**
     * 在每個回覆按鈕前添加「新反應」按鈕。
     */
    addNewReactionButtons: function () {
        if (document.querySelector('#reaction-finished-loading')) {
            return;
        }

        // Add a "New Reaction" button before each reply button
        for (let i = 0; i < this.replyButtons.length; i++) {
            let reactionButton = this.NewReactionButton();
            let timestamp = this.timestamps[i];
            this._buttonTimestamps.set(reactionButton, timestamp);  // Store the timestamp for the new button

            // Insert the button before the reply button
            let replyButton = this.replyButtons[i];
            replyButton.parentNode.insertBefore(reactionButton, replyButton);
        }
        console.log(`[Reaction] Added ${this.replyButtons.length} new reaction buttons.`);

        let finishedLoading = document.createElement('div');
        finishedLoading.id = "reaction-finished-loading";
        finishedLoading.style.display = "none";  // Hide the loading indicator
        document.querySelector('#mw-content-text .mw-parser-output').appendChild(finishedLoading);
    },

    /**
     * 載入所需的CSS和HanAssist模組。
     * @returns {Promise<void>} - 載入完成的Promise。
     */
    importDependencies: async function () {
        mw.loader.load('/w/index.php?title=Template:Reaction/styles.css&action=raw&ctype=text/css', 'text/css');
        await mw.loader.using('ext.gadget.HanAssist', function (require) {
            const {convByVar} = require('ext.gadget.HanAssist');
            ReactionTools.convByVar = convByVar;
        });
    },

    /**
     * 初始化函式，載入所需的模組和事件綁定。
     */
    init: function () {
        this.importDependencies().then(() => {
            this.timestamps = document.querySelectorAll("a.ext-discussiontools-init-timestamplink");
            this.replyButtons = document.querySelectorAll("span.ext-discussiontools-init-replylink-buttons");

            // 尋找時間戳與回覆按鈕之間的所有反應按鈕
            for (let i = 0; i < this.timestamps.length; i++) {
                let timestamp = this.timestamps[i];
                let replyButton = this.replyButtons[i];
                let button = timestamp.nextElementSibling;
                while (button && button !== replyButton) {
                    if (button.classList.contains("template-reaction") && button.attributes["data-reaction-commentors"]) {
                        this._buttonTimestamps.set(button, timestamp);
                        this.bindEvent2ReactionButton(button);
                    }
                    button = button.nextElementSibling;
                }
            }

            mw.hook('wikipage.content').add(function () {
                setTimeout(() => ReactionTools.addNewReactionButtons(), 200);
            });
        });
    },

    /**
     * 事件處理函式註冊表。WeakMap用於儲存事件處理函式的引用，以便在需要時可以移除它們。
     * @type {WeakMap<HTMLElement, Function>}
     * @private
     */
    _handlerRegistry: new WeakMap(),

    /**
     * 按鈕對應的時間戳。WeakMap用於儲存按鈕與時間戳之間的關聯。
     * @type {WeakMap<HTMLElement, HTMLElement>}
     * @private
     */
    _buttonTimestamps: new WeakMap(),

    /**
     * 時間戳列表，包含所有的時間戳元素。
     * @type {HTMLElement[]}
     */
    timestamps: [],

    /**
     * 回覆按鈕列表，包含所有的回覆按鈕元素（與時間戳一一對應）。
     * @type {HTMLElement[]}
     */
    replyButtons: [],

    /**
     * 使用者名稱，從MediaWiki配置中獲取。
     * @type {string}
     * @constant
     */
    userName: mw.config.get('wgUserName'),

    /**
     * 頁面名稱，從MediaWiki配置中獲取。
     * @type {string}
     * @constant
     */
    pageName: mw.config.get('wgPageName'),

    /**
     * 簡繁轉換函式，從HanAssist模組中獲取。
     * @type {function}
     */
    convByVar: null,

    /**
     * 正則表達式，用於匹配中文格式的UTC時間戳。
     * @type {string}
     * @constant
     */
    chineseUtcRegex: `\\d{4}年\\d{1,2}月\\d{1,2}日 \\([日一二三四五六]\\) \\d{1,2}:\\d{2} \\(UTC\\)`,

    /**
     * 正則表達式，用於匹配並捕獲中文格式的UTC時間戳。
     * @type {string}
     * @constant
     */
    chineseUtcCaptureRegex: `(\\d{4})年(\\d{1,2})月(\\d{1,2})日 \\(([日一二三四五六])\\) (\\d{1,2}):(\\d{2}) \\(UTC\\)`,

    /**
     * 正則表達式，用於匹配「於」或「于」後的UTC時間戳。
     * @returns {string}
     * @constant
     */
    atChineseUtcRegex: function () {
        return "(?:|[於于]" + this.chineseUtcRegex + ")";
    },

    /**
     * 正則表達式，用於匹配使用者名稱和時間戳。
     * 格式為「使用者名稱於2023年10月15日 (日) 12:34 (UTC)」。
     * @returns {string}
     * @constant
     */
    userNameAtChineseUtcRegex: function () {
        return this.escapeRegex(this.userName) + this.atChineseUtcRegex();
    },

    /**
     * 獲取當前的中文格式UTC時間字串。
     * @returns {string} - 當前的中文格式UTC時間字串，例如「2023年10月15日 (日) 12:34 (UTC)」。
     */
    getCurrentChineseUtc: function () {
        const date = new Date();
        return this.dateToChineseUtc(date);
    },

    /**
     * MediaWiki API實例，用於與MediaWiki進行交互。
     * @type {mw.Api}
     */
    api: null,
};

ReactionTools.init();
