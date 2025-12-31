import state from "./state";
import { getCurrentChineseUtc, parseTimestamp } from "./utils";
import { modifyPage, type ModifyPageRequest } from "./api";
import { t, tReaction } from "./i18n";

/**
 * Registry for reaction event handlers. WeakMap stores handler references so they can be removed later.
 * @type {WeakMap<HTMLElement, Function>}
 * @private
 */
const _handlerRegistry = new WeakMap<HTMLElement, EventListener>();

/**
 * Tracks the timestamp node associated with each button via WeakMap.
 * @type {WeakMap<HTMLElement, HTMLElement>}
 * @private
 */
const _buttonTimestamps = new WeakMap<HTMLElement, HTMLElement>();

interface ReactionCommentorEntry {
	user: string;
	timestamp?: string;
}

/**
 * Remove the registered event handler from an element and delete it from the registry.
 * @param element {HTMLElement | null} - Element to remove the handler from.
 */
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

/**
 * Extract the icon and counter elements from a reaction button.
 * @param button {HTMLElement} - Reaction button element.
 * @returns {{icon: HTMLElement, counter: HTMLElement} | null} - Object containing icon and counter elements, or null if missing.
 */
function getButtonParts(button: HTMLElement): { icon: HTMLElement; counter: HTMLElement } | null {
	const icon = button.querySelector<HTMLElement>(".reaction-icon");
	const counter = button.querySelector<HTMLElement>(".reaction-counter");
	if (!icon || !counter) {
		console.error("[Reaction] Missing icon or counter on reaction button.", button);
		return null;
	}
	return { icon, counter };
}

/**
 * Get the reaction label from the button, prioritizing configured data attribute.
 * @param button {HTMLElement} - Reaction button element.
 * @param icon {HTMLElement} - Icon element within the button.
 * @returns {string} - Reaction label.
 */
function getReactionLabel(button: HTMLElement, icon: HTMLElement): string {
	const configuredIcon = button.getAttribute("data-reaction-icon")?.trim();
	if (configuredIcon) {
		return configuredIcon;
	}
	return icon.textContent?.trim() ?? "";
}

/**
 * Get the timestamp string associated with a reaction button.
 * @param button {HTMLElement} - Reaction button element.
 * @returns {string | null} - Timestamp string or null if not found/parsable.
 */
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
 * Parse a legacy commentor entry string into a structured object.
 * @param entry - Legacy commentor entry string.
 * @returns Parsed ReactionCommentorEntry object.
 */
function parseLegacyCommentor(entry: string): ReactionCommentorEntry {
	const trimmed = entry.trim();
	if (!trimmed) {
		return { user: "" };
	}
	const match = trimmed.match(/^(.*?)[於于]\s*(.+)$/);
	if (match) {
		return {
			user: match[1].trim(),
			timestamp: match[2].trim(),
		};
	}
	return { user: trimmed };
}

/**
 * Format a ReactionCommentorEntry into a legacy string representation.
 * @param entry - ReactionCommentorEntry object.
 * @returns Formatted legacy string.
 */
function formatLegacyCommentor(entry: ReactionCommentorEntry): string {
	return entry.timestamp ? `${entry.user}於${entry.timestamp}` : entry.user;
}

/**
 * Format a ReactionCommentorEntry for display in tooltips.
 * @param entry - ReactionCommentorEntry object.
 * @returns Formatted string for tooltip.
 */
function formatReactionTitleEntry(entry: ReactionCommentorEntry): string {
	if (entry.timestamp) {
		return t("dom.reactions.comment_stamp", [entry.user, entry.timestamp]);
	}
	return entry.user;
}

/**
 * Build the tooltip title for a reaction button based on its commentors.
 * @param entries - Array of ReactionCommentorEntry objects.
 * @returns Constructed tooltip title string.
 */
function buildReactionTitle(entries: ReactionCommentorEntry[]): string {
	if (entries.length === 0) {
		return t("dom.tooltips.no_reactions");
	}
	const list = entries.map((entry) => formatReactionTitleEntry(entry)).join(t("dom.reactions.list_separator"));
	return t("dom.tooltips.reacted_to_comment", [list]);
}

/**
 * Parse JSON-encoded commentor entries from a data attribute.
 * @param json - JSON string from data attribute.
 * @returns Array of ReactionCommentorEntry objects or null if parsing fails.
 */
function parseCommentorJson(json: string | null): ReactionCommentorEntry[] | null {
	if (!json) {
		return null;
	}
	try {
		const parsed = JSON.parse(json) as unknown;
		if (Array.isArray(parsed)) {
			const entries: ReactionCommentorEntry[] = [];
			parsed.forEach((item) => {
				if (item && typeof item === "object") {
					const record = item as { user?: unknown; timestamp?: unknown };
					if (typeof record.user === "string") {
						entries.push({
							user: record.user,
							timestamp: typeof record.timestamp === "string" && record.timestamp ? record.timestamp : undefined,
						});
					}
				}
			});
			return entries;
		}
	} catch {
		// ignore malformed data
	}
	return null;
}

/**
 * Get the reaction commentors from a button element.
 * @param button - Reaction button element.
 * @returns Array of ReactionCommentorEntry objects.
 */
function getReactionCommentors(button: HTMLElement): ReactionCommentorEntry[] {
	const jsonEntries = parseCommentorJson(button.getAttribute("data-reaction-commentors-json"));
	if (jsonEntries && jsonEntries.length > 0) {
		return jsonEntries;
	}
	const raw = button.getAttribute("data-reaction-commentors");
	if (!raw) {
		return [];
	}
	return raw.split("/").map(parseLegacyCommentor).filter((entry) => entry.user);
}

/**
 * Set the reaction commentors on a button element.
 * @param button - Reaction button element.
 * @param entries - Array of ReactionCommentorEntry objects.
 */
function setReactionCommentors(button: HTMLElement, entries: ReactionCommentorEntry[]): void {
	if (entries.length === 0) {
		button.removeAttribute("data-reaction-commentors");
		button.removeAttribute("data-reaction-commentors-json");
		button.setAttribute("title", buildReactionTitle(entries));
		return;
	}
	button.setAttribute("data-reaction-commentors-json", JSON.stringify(entries));
	button.setAttribute("data-reaction-commentors", entries.map(formatLegacyCommentor).join("/"));
	button.setAttribute("title", buildReactionTitle(entries));
}

/**
 * Check if the user has reacted based on commentor entries.
 * @param entries - Array of ReactionCommentorEntry objects.
 * @param userName - User name to check.
 * @returns True if the user has reacted, false otherwise.
 */
function hasUserReacted(entries: ReactionCommentorEntry[], userName: string | null): boolean {
	if (!userName) {
		return false;
	}
	return entries.some((entry) => entry.user === userName);
}

/**
 * Remove a user from the commentor entries.
 * @param entries - Array of ReactionCommentorEntry objects.
 * @param userName - User name to remove.
 * @returns Updated array of ReactionCommentorEntry objects.
 */
function removeUserFromEntries(entries: ReactionCommentorEntry[], userName: string | null): ReactionCommentorEntry[] {
	if (!userName) {
		return entries;
	}
	const index = entries.findIndex((entry) => entry.user === userName);
	if (index === -1) {
		return entries;
	}
	const updated = entries.slice();
	updated.splice(index, 1);
	return updated;
}

/**
 * Dispatch click events from any reaction button to the appropriate handler.
 * @param button {HTMLElement} - Reaction button element.
 */
function handleReactionClick(button: HTMLElement) {
	if (button.classList.contains("reaction-new")) {
		// For "new reaction" buttons, enter editable mode.
		addNewReaction(button);
	} else {
		if (button.getAttribute("data-reaction-icon-invalid")) {
			// Ignore buttons with invalid icons.
			mw.notify(tReaction("dom.notify.invalid_icon"), { title: t("default.titles.error"), type: "error" });
			console.error("[Reaction] Invalid reaction icon.");
			return;
		}

		if (window?.ujsReactionConfirmedRequired) {
			// Optional confirmation for users who prefer manual prompts before toggling reactions.
			const confirmMessage = button.classList.contains("reaction-reacted") ? tReaction("dom.confirm.remove") : tReaction("dom.confirm.add");
			OO.ui.confirm(confirmMessage, {
				title: t("default.titles.confirm"), size: "small",
			}).then((confirmed: boolean) => {
				if (confirmed) {
					toggleReaction(button);
				}
			});
		} else {
			// Default behavior skips confirmation and toggles immediately.
			toggleReaction(button);
		}
	}
}

/**
 * Toggle a standard reaction button (not the "new reaction" button).
 * @param button {HTMLElement} - Reaction button element.
 */
function toggleReaction(button: HTMLElement) {
	const parts = getButtonParts(button);
	if (!parts) {
		return;
	}
	const { icon, counter } = parts;
	const timestamp = getTimestampString(button);
	if (!timestamp) {
		mw.notify(tReaction("dom.errors.missing_timestamp"), { title: t("default.titles.error"), type: "error" });
		return;
	}
	const counterValue = button.getAttribute("data-reaction-count") ?? counter.innerText;
	const count = Number.parseInt(counterValue, 10) || 0;
	const reactionLabel = getReactionLabel(button, icon);

	if (button.classList.contains("reaction-reacted")) {
		if (!hasUserReacted(getReactionCommentors(button), state.userName)) {
			mw.notify(tReaction("dom.errors.unowned_reaction"), { title: t("default.titles.error"), type: "error" });
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
				const existingEntries = getReactionCommentors(button);
				const updatedEntries = removeUserFromEntries(existingEntries, state.userName);
				setReactionCommentors(button, updatedEntries);
			} else {
				button.parentNode?.removeChild(button);
			}
		});
	} else {
		if (hasUserReacted(getReactionCommentors(button), state.userName)) {
			mw.notify(tReaction("dom.errors.duplicate_reaction"), { title: t("default.titles.error"), type: "error" });
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

			const commentEntries = getReactionCommentors(button);
			commentEntries.push({ user: state.userName ?? "", timestamp: getCurrentChineseUtc() });
			setReactionCommentors(button, commentEntries);
		});
	}
}

/**
 * Cancel editing mode for the "new reaction" button.
 * @param button {HTMLElement} - The "new reaction" button element.
 * @param event {MouseEvent|false} - Mouse event or false when synthetic; non-browser triggers don't need cancellation.
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
		buttonCounter.innerText = t("dom.reactions.label");
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
 * Save a newly created reaction and update the button state.
 * @param button {HTMLElement} - The "new reaction" button element.
 * @param event {MouseEvent|false} - Mouse event or false when synthetic; non-browser triggers don't need cancellation.
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
		mw.notify(tReaction("dom.errors.input_empty"), { title: t("default.titles.error"), type: "error" });
		return;
	}

	// Save the new reaction
	let timestampElement = _buttonTimestamps.get(button);
	let timestamp = timestampElement ? parseTimestamp(timestampElement) : null;
	if (!timestamp) {
		mw.notify(tReaction("dom.errors.missing_timestamp"), { title: t("default.titles.error"), type: "error" });
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
			const entry = { user: state.userName ?? "", timestamp: getCurrentChineseUtc() };
			setReactionCommentors(button, [entry]);

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
 * Create a resizable input field.
 * @param text {string} - Default text.
 * @param parent {HTMLElement} - Parent node where the input (and hidden width calculator) will be added.
 * @returns {HTMLInputElement} - Resizable input field.
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
 * Convert the "new reaction" button into editable mode with save/cancel options.
 * @param button {HTMLElement} - The "new reaction" button element.
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
		saveButton.innerText = t("default.actions.save");
		if (_handlerRegistry.has(saveButton)) {
			return;
		}
		const saveButtonClickHandler: EventListener = (evt) => saveNewReaction(button, evt as MouseEvent);
		_handlerRegistry.set(saveButton, saveButtonClickHandler);
		saveButton.addEventListener("click", saveButtonClickHandler);

		let cancelButton = document.createElement("span");
		cancelButton.className = "reaction-cancel";
		cancelButton.innerText = t("default.actions.cancel");
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
 * Create a "new reaction" button element.
 * @returns {HTMLSpanElement} - Newly created button element.
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
	buttonCounter.innerText = t("dom.reactions.label");
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
 * Bind event handling to a regular reaction button (not the "new reaction" control).
 * @param button {HTMLElement} - Reaction button element.
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
	if (hasUserReacted(getReactionCommentors(button), state.userName)) {
		button.classList.add("reaction-reacted");
	}
}

/**
 * Entry point that wires reaction buttons into the page.
 */
export function addReactionButtons() {
	if (document.querySelector('#reaction-finished-loading')) {
		return;
	}

	const timestamps = document.querySelectorAll<HTMLAnchorElement>("a.ext-discussiontools-init-timestamplink");
	const replyButtons = document.querySelectorAll<HTMLSpanElement>("span.ext-discussiontools-init-replylink-buttons");

	// Find all reaction buttons between the timestamp and reply areas.
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
