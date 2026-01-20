import { t } from "../i18n";
import { convertTimestampToUserTimezone } from "../utils";
import { getReactionCommentors, type ReactionCommentorEntry } from "./commentors";
import state, { canReact } from "../state";
import { isVector2022Appearance } from "./cdxPortlet";

const TOOLTIP_CLASS = "reaction-tooltip";
const isMobileSkin = (mw.config.get("skin") as string | undefined) === "minerva";
const tooltipButtons = new WeakSet<HTMLElement>();

let tooltipContainer: HTMLDivElement | null = null;
let tooltipContent: HTMLDivElement | null = null;
let tooltipArrow: HTMLDivElement | null = null;
let activeButton: HTMLElement | null = null;
let hideTimer: number | null = null;
let stylesInjected = false;
let globalListenersBound = false;

const HIDE_DELAY_MS = 120;

/**
 * Attach tooltip interactions to a reaction button.
 * @param button - Reaction button element.
 */
export function attachReactionTooltip(button: HTMLElement): void {
	if (tooltipButtons.has(button)) {
		return;
	}
	if (!button.hasAttribute("data-reaction-commentors")) {
		return;
	}
	ensureTooltipElements();
	if (isMobileSkin) {
		button.addEventListener("click", handleMobileClick, true);
	} else {
		button.addEventListener("mouseenter", handleButtonEnter);
		button.addEventListener("mouseleave", handleButtonLeave);
		button.addEventListener("focus", handleButtonEnter);
		button.addEventListener("blur", () => hideTooltip(true));
	}
	tooltipButtons.add(button);
}

/**
 * Ensure tooltip DOM elements exist.
 */
function ensureTooltipElements(): void {
	if (tooltipContainer) {
		return;
	}
	injectTooltipStyles();
	tooltipContainer = document.createElement("div");
	tooltipContainer.className = TOOLTIP_CLASS;
	tooltipContainer.setAttribute("role", "tooltip");
	tooltipContainer.setAttribute("aria-hidden", "true");

	tooltipArrow = document.createElement("div");
	tooltipArrow.className = `${TOOLTIP_CLASS}__arrow`;
	tooltipContent = document.createElement("div");
	tooltipContent.className = `${TOOLTIP_CLASS}__content`;

	tooltipContainer.appendChild(tooltipArrow);
	tooltipContainer.appendChild(tooltipContent);
	tooltipContainer.addEventListener("mouseenter", cancelHide);
	tooltipContainer.addEventListener("mouseleave", handleTooltipLeave);

	document.body.appendChild(tooltipContainer);
	bindGlobalListeners();
}

/**
 * Inject tooltip CSS styles into the document.
 */
function injectTooltipStyles(): void {
	if (stylesInjected) {
		return;
	}
	stylesInjected = true;
	mw.util.addCSS(`
.${TOOLTIP_CLASS} {
	position: absolute;
	z-index: 1001;
	padding: 3px 10px;
	border-radius: 5px;
	font-size: 0.85em;
	line-height: 1.15;
	max-width: 320px;
	min-width: 180px;
	opacity: 0;
	visibility: hidden;
	transform: translate3d(0, 6px, 0);
	transition: opacity 120ms ease, transform 120ms ease;
	pointer-events: none;
	border: 1px solid var(--border-color-base, #a2a9b1);
	background-color: var(--background-color-base, #fff);
	color: var(--color-base, #202122);
	box-shadow: 0 3px 8px rgba(50, 50, 50, 0.35);
}
.${TOOLTIP_CLASS}--visible {
	opacity: 1;
	visibility: visible;
	transform: translate3d(0, 0, 0);
	pointer-events: auto;
}
.${TOOLTIP_CLASS}__content {
	max-height: 260px;
	overflow-y: auto;
}
.${TOOLTIP_CLASS}__entry {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 6px 0;
}
.${TOOLTIP_CLASS}__entry + .${TOOLTIP_CLASS}__entry {
	border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.${TOOLTIP_CLASS}__user {
	font-weight: 600;
	word-break: break-word;
}
.${TOOLTIP_CLASS}__timestamp {
	font-size: 0.78em;
	color: var(--color-subtle, #54595d);
}
.${TOOLTIP_CLASS}__empty {
	font-size: 0.78em;
	color: var(--color-subtle, #54595d);
	font-style: italic;
}
.${TOOLTIP_CLASS}__hint {
	margin-top: 6px;
	font-size: 0.78em;
	color: var(--color-subtle, #54595d);
}
.${TOOLTIP_CLASS}__arrow {
	position: absolute;
	top: -6px;
	width: 12px;
	height: 12px;
	background-color: var(--background-color-base, #fff);
	transform: rotate(45deg);
	border-radius: 2px;
	box-shadow: -2px -2px 4px rgba(50, 50, 50, 0.2);
	border-left: 1px solid var(--border-color-base, #a2a9b1);
	border-top: 1px solid var(--border-color-base, #a2a9b1);
	pointer-events: none;
}
`);
}

/**
 * Bind global listeners for tooltip interactions.
 */
function bindGlobalListeners(): void {
	if (globalListenersBound) {
		return;
	}
	globalListenersBound = true;
	document.addEventListener("click", handleDocumentInteraction, true);
	document.addEventListener("touchstart", handleDocumentInteraction, true);
	window.addEventListener("scroll", () => hideTooltip(true), true);
	window.addEventListener("resize", () => hideTooltip(true));
}

/**
 * Handle click event on mobile skin.
 * @param event - Click event.
 */
function handleMobileClick(event: Event): void {
	const target = event.currentTarget;
	if (!(target instanceof HTMLElement)) {
		return;
	}
	if (isTooltipVisible() && activeButton === target) {
		hideTooltip(true);
		return;
	}
	if (showTooltip(target)) {
		event.stopImmediatePropagation();
		event.preventDefault();
	}
}

/**
 * Handle mouse enter or focus event on button.
 * @param event - Event object.
 */
function handleButtonEnter(event: Event): void {
	if (!(event.currentTarget instanceof HTMLElement)) {
		return;
	}
	cancelHide();
	showTooltip(event.currentTarget);
}

/**
 * Handle mouse leave event on button.
 */
function handleButtonLeave(): void {
	scheduleHide();
}

/**
 * Handle mouse leave event on tooltip.
 */
function handleTooltipLeave(): void {
	if (isMobileSkin) {
		return;
	}
	scheduleHide();
}

/**
 * Handle document interaction to hide tooltip if necessary.
 * @param event - Event object.
 */
function handleDocumentInteraction(event: Event): void {
	if (!isTooltipVisible()) {
		return;
	}
	const target = event.target;
	if (
		(target instanceof Node && tooltipContainer?.contains(target)) ||
		(target instanceof Node && activeButton?.contains(target))
	) {
		return;
	}
	hideTooltip(true);
}

/**
 * Schedule tooltip hide after delay.
 */
function scheduleHide(): void {
	cancelHide();
	hideTimer = window.setTimeout(() => hideTooltip(), HIDE_DELAY_MS);
}

/**
 * Cancel scheduled tooltip hide.
 */
function cancelHide(): void {
	if (hideTimer !== null) {
		window.clearTimeout(hideTimer);
		hideTimer = null;
	}
}

/**
 * Hide the tooltip.
 * @param immediate - Whether to hide immediately without transition.
 */
function hideTooltip(immediate = false): void {
	cancelHide();
	const tooltip = tooltipContainer;
	if (!tooltip) {
		return;
	}
	tooltip.classList.remove(`${TOOLTIP_CLASS}--visible`);
	tooltip.setAttribute("aria-hidden", "true");
	if (immediate) {
		tooltip.style.left = "-9999px";
		tooltip.style.top = "-9999px";
	}
	activeButton?.removeAttribute("data-reaction-tooltip-visible");
	activeButton = null;
}

/**
 * Check if the tooltip is currently visible.
 * @returns True if visible, false otherwise.
 */
function isTooltipVisible(): boolean {
	return Boolean(tooltipContainer?.classList.contains(`${TOOLTIP_CLASS}--visible`));
}

/**
 * Show the tooltip for a given button.
 * @param button - Reaction button element.
 * @returns True if shown successfully, false otherwise.
 */
function showTooltip(button: HTMLElement): boolean {
	const tooltip = tooltipContainer;
	const content = tooltipContent;
	if (!tooltip || !content) {
		return false;
	}
	const entries = getReactionCommentors(button);
	renderEntries(entries, content);
	positionTooltip(button);
	activeButton = button;
	button.setAttribute("data-reaction-tooltip-visible", "true");
	tooltip.classList.add(`${TOOLTIP_CLASS}--visible`);
	tooltip.setAttribute("aria-hidden", "false");
	return true;
}

/**
 * Render reaction commentor entries into the tooltip content.
 * @param entries - Array of reaction commentor entries.
 * @param container - Tooltip content container element.
 */
function renderEntries(entries: ReactionCommentorEntry[], container: HTMLElement): void {
	container.textContent = "";
	if (!canReact()) {
		if (state.userName && !state.isTempUser) {
			const useAppearance = isVector2022Appearance();
			appendHint(
				container,
				useAppearance
					? "dom.tooltips.enable_reactions_in_appearance"
					: "dom.tooltips.enable_reactions_in_tools",
			);
		} else {
			appendHint(container, "dom.tooltips.login_to_react");
		}
	}
	if (entries.length === 0) {
		const empty = document.createElement("div");
		empty.className = `${TOOLTIP_CLASS}__empty`;
		empty.textContent = t("dom.tooltips.no_reactions");
		container.appendChild(empty);
		return;
	}
	for (const entry of entries) {
		const entryEl = document.createElement("div");
		entryEl.className = `${TOOLTIP_CLASS}__entry`;

		const userLink = document.createElement("a");
		userLink.className = `${TOOLTIP_CLASS}__user userlink`;
		userLink.href = mw.util.getUrl(`User:${entry.user}`);
		userLink.rel = "noopener";
		userLink.target = "_blank";
		const userBdi = document.createElement("bdi"); // For RTL usernames.
		userBdi.textContent = entry.user;
		userLink.appendChild(userBdi);
		entryEl.appendChild(userLink);

		if (entry.timestamp) {
			const timestampEl = document.createElement("span");
			timestampEl.className = `${TOOLTIP_CLASS}__timestamp`;
			timestampEl.textContent = convertTimestampToUserTimezone(entry.timestamp);
			entryEl.appendChild(timestampEl);
		}
		container.appendChild(entryEl);
	}
}

/**
 * Append a hint to the tooltip content.
 * @param container - Tooltip content container element.
 * @param messageKey - Localization key for the hint text.
 */
function appendHint(container: HTMLElement, messageKey: string): void {
	const hint = document.createElement("div");
	hint.className = `${TOOLTIP_CLASS}__hint`;
	hint.textContent = t(messageKey);
	container.appendChild(hint);
}

/**
 * Position the tooltip relative to the button.
 * @param button - Reaction button element.
 */
function positionTooltip(button: HTMLElement): void {
	const tooltip = tooltipContainer;
	if (!tooltip || !tooltipContent) {
		return;
	}
	tooltip.style.left = "0px";
	tooltip.style.top = "0px";
	const rect = button.getBoundingClientRect();
	const scrollLeft = window.pageXOffset ?? document.documentElement.scrollLeft ?? 0;
	const scrollTop = window.pageYOffset ?? document.documentElement.scrollTop ?? 0;
	const viewportWidth = document.documentElement.clientWidth ?? window.innerWidth;

	// Force layout to measure.
	tooltip.style.visibility = "hidden";
	tooltip.classList.add(`${TOOLTIP_CLASS}--visible`);
	const tooltipWidth = tooltip.offsetWidth;
	tooltip.classList.remove(`${TOOLTIP_CLASS}--visible`);
	tooltip.style.visibility = "";

	let left = rect.left + scrollLeft + rect.width / 2 - tooltipWidth / 2;
	const minLeft = scrollLeft + 8;
	const maxLeft = scrollLeft + viewportWidth - tooltipWidth - 8;
	left = Math.min(Math.max(left, minLeft), maxLeft);
	const top = rect.bottom + scrollTop + 8;

	tooltip.style.left = `${left}px`;
	tooltip.style.top = `${top}px`;

	if (tooltipArrow) {
		const relative = rect.left + rect.width / 2 - left;
		const bounded = Math.max(12, Math.min(tooltipWidth - 12, relative));
		tooltipArrow.style.left = `${bounded - tooltipArrow.offsetWidth / 2}px`;
	}
}
