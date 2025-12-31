import state from "../state";
import { getCurrentSignatureTimestamp, parseTimestamp } from "../utils";
import { modifyPage, type ModifyPageRequest } from "../api/modifyPage";
import { t, tReaction } from "../i18n";
import {
	getReactionCommentors,
	setReactionCommentors,
	hasUserReacted,
	removeUserFromEntries,
} from "./commentors";

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
				const newCount = count - 1;
				counter.innerText = newCount.toString();
				button.setAttribute("data-reaction-count", newCount.toString());
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
			button.setAttribute("data-reaction-count", newCount.toString());

			const commentEntries = getReactionCommentors(button);
			commentEntries.push({ user: state.userName ?? "", timestamp: getCurrentSignatureTimestamp() });
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
			const entry = { user: state.userName ?? "", timestamp: getCurrentSignatureTimestamp() };
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

type ReactionRoot = Document | DocumentFragment | Element;

/**
 * Process a reaction root element to bind reaction buttons and add "new reaction" controls.
 * @param root {ReactionRoot} - Root element to process.
 * @returns {number} - Number of "new reaction" buttons inserted.
 */
function processReactionRoot(root: ReactionRoot): number {
	const timestamps = root.querySelectorAll<HTMLAnchorElement>("a.ext-discussiontools-init-timestamplink");
	const replyButtons = root.querySelectorAll<HTMLSpanElement>("span.ext-discussiontools-init-replylink-buttons");
	const pairCount = Math.min(timestamps.length, replyButtons.length);

	// Find all reaction buttons between the timestamp and reply areas.
	for (let i = 0; i < pairCount; i++) {
		const timestamp = timestamps[i];
		const replyButton = replyButtons[i];
		let button = timestamp.nextElementSibling as HTMLElement | null;
		while (button && button !== replyButton) {
			if (button.classList.contains("template-reaction") && button.hasAttribute("data-reaction-commentors")) {
				_buttonTimestamps.set(button, timestamp);
				bindEvent2ReactionButton(button);
			}
			button = button.nextElementSibling as HTMLElement | null;
		}
	}

	let insertedButtons = 0;
	for (let i = 0; i < pairCount; i++) {
		const replyButton = replyButtons[i];
		const timestamp = timestamps[i] ?? null;
		if (replyButton instanceof HTMLElement && insertNewReactionBefore(replyButton, timestamp)) {
			insertedButtons++;
		}
	}

	insertedButtons += processConvenientDiscussionMenus(root);
	return insertedButtons;
}

const TIMESTAMP_SELECTOR = [
	"a.ext-discussiontools-init-timestamplink",
	"a.cd-comment-button-label.cd-comment-button",
	"a[data-mw-comment-timestamp]",
].join(", ");

/**
 * Resolve the timestamp element associated with a node.
 * @param node {HTMLElement} - Node within the comment block.
 * @returns {HTMLElement | null} - Timestamp element or null if not found.
 */
function resolveTimestampForNode(node: HTMLElement): HTMLElement | null {
	const existing = _buttonTimestamps.get(node);
	if (existing) {
		return existing;
	}

	// Walk backwards through siblings to inherit the mapping.
	let sibling = node.previousElementSibling as HTMLElement | null;
	while (sibling) {
		const siblingTimestamp = _buttonTimestamps.get(sibling);
		if (siblingTimestamp) {
			_buttonTimestamps.set(node, siblingTimestamp);
			return siblingTimestamp;
		}
		if (sibling.matches?.(TIMESTAMP_SELECTOR)) {
			_buttonTimestamps.set(node, sibling);
			return sibling;
		}
		sibling = sibling.previousElementSibling as HTMLElement | null;
	}

	// Fall back to scanning the Convenient Discussions comment container.
	const commentContainer = node.closest(".cd-comment-part, li, dd, p");
	const timestamp = commentContainer?.querySelector<HTMLElement>(TIMESTAMP_SELECTOR);
	if (timestamp) {
		_buttonTimestamps.set(node, timestamp);
		return timestamp;
	}
	return null;
}

/**
 * Insert a "new reaction" button before a target element.
 * @param target {HTMLElement} - Target element to insert before.
 * @param timestamp {HTMLElement | null} - Optional timestamp element to associate.
 * @returns {boolean} - True if insertion was successful, false otherwise.
 */
function insertNewReactionBefore(target: HTMLElement, timestamp?: HTMLElement | null): boolean {
	if (!target.parentNode) {
		return false;
	}
	const previousSibling = target.previousElementSibling as HTMLElement | null;
	if (previousSibling?.classList.contains("reaction-new")) {
		return false;
	}

	const reactionButton = NewReactionButton();
	const timestampElement = timestamp ?? resolveTimestampForNode(target);
	if (!timestampElement) {
		console.warn("[Reaction] Unable to determine timestamp for new reaction button target.", target);
		return false;
	}

	_buttonTimestamps.set(reactionButton, timestampElement);
	target.parentNode.insertBefore(reactionButton, target);
	return true;
}

/**
 * Process Convenient Discussions comment menus to insert "new reaction" buttons.
 * @param root {ReactionRoot} - Root element to process.
 * @returns {number} - Number of buttons inserted.
 */
function processConvenientDiscussionMenus(root: ReactionRoot): number {
	const commentParts = Array.from(root.querySelectorAll(".cd-comment-part")).filter(
		(node): node is HTMLElement => node instanceof HTMLElement,
	);
	let inserted = 0;
	for (const comment of commentParts) {
		const menuWrapper = comment.querySelector<HTMLElement>(".cd-comment-menu-wrapper");
		if (!menuWrapper) {
			continue;
		}
		const timestamp = comment.querySelector<HTMLElement>(TIMESTAMP_SELECTOR);
		if (insertNewReactionBefore(menuWrapper, timestamp ?? null)) {
			inserted++;
		}
	}
	return inserted;
}

/**
 * Entry point that wires reaction buttons into the page.
 * @param containers {ReactionRoot | ReactionRoot[] | null | undefined} Optional subset of the DOM to process.
 */
export function addReactionButtons(containers?: ReactionRoot | ReactionRoot[] | null) {
	const roots: ReactionRoot[] = [];
	if (!containers) {
		roots.push(document);
	} else if (Array.isArray(containers)) {
		for (const root of containers) {
			if (root) {
				roots.push(root);
			}
		}
	} else {
		roots.push(containers);
	}

	let totalInserted = 0;
	for (const root of roots) {
		totalInserted += processReactionRoot(root);
		const reactionButtons = Array.from(root.querySelectorAll(".template-reaction[data-reaction-commentors]"));
		for (const element of reactionButtons) {
			if (!(element instanceof HTMLElement)) {
				continue;
			}
			if (!_buttonTimestamps.has(element)) {
				const timestampElement = resolveTimestampForNode(element);
				if (!timestampElement) {
					console.warn("[Reaction] Unable to find timestamp for reaction button.", element);
					continue;
				}
			}
			bindEvent2ReactionButton(element);
		}
	}
	console.log(`[Reaction] Added ${totalInserted} new reaction buttons.`);
}
