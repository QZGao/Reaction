import state, { setReactionBlacklist, setReactionHidden } from "../state";
import { removeLegacyReactionPortlets, setReactionHiddenState } from "./portlet";
import { t } from "../i18n";
import { persistReactionBlacklistToUserConfig } from "../api/userConfig";
import { toggleReactionEnabledWithFeature } from "../featureLoader";

export type ReactionAppearanceChoice = "enable" | "disable" | "hide";

export interface ReactionAppearancePortletOptions {
	portletId?: string;
	heading: string;
	labels: {
		enable: string;
		disable: string;
		hideAll: string;
		blacklist: string;
	};
	selected: ReactionAppearanceChoice;
	onChange: (value: ReactionAppearanceChoice) => void;
	onBlacklistChange: (value: boolean) => void;
}

const DEFAULT_PORTLET_ID = "reaction-appearance-portlet";
const INPUT_GROUP_NAME = "reaction-appearance-group";

/**
 * Check if the current skin is Vector 2022 with appearance portlet.
 * @returns True if the current skin is Vector 2022 and has the appearance portlet.
 */
export function isVector2022Appearance(): boolean {
	const skin = mw.config.get("skin") as string | undefined;
	if (skin !== "vector-2022") {
		return false;
	}
	return Boolean(document.getElementById("vector-appearance") || document.getElementById("vector-appearance-dropdown-checkbox"));
}

/**
 * Check if an element is visible in the DOM.
 * @param element - The HTMLElement to check.
 * @returns True if the element is visible; otherwise, false.
 */
function isElementVisible(element: HTMLElement): boolean {
	const style = window.getComputedStyle(element);
	if (style.display === "none" || style.visibility === "hidden") {
		return false;
	}
	if (element.getAttribute("aria-hidden") === "true") {
		return false;
	}
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) {
		return false;
	}
	return true;
}

/**
 * Open the Vector 2022 appearance panel if it is not already visible.
 * @returns True if the panel was opened or already visible; otherwise, false.
 */
export function openVectorAppearancePanel(): boolean {
	const appearance = document.getElementById("vector-appearance");
	if (appearance && isElementVisible(appearance)) {
		appearance.scrollIntoView({ behavior: "smooth", block: "center" });
		return true;
	}

	const checkbox = document.getElementById("vector-appearance-dropdown-checkbox");
	if (checkbox instanceof HTMLInputElement) {
		const expanded = checkbox.getAttribute("aria-expanded");
		if (expanded !== "true" || !checkbox.checked) {
			const label = document.getElementById("vector-appearance-dropdown-label");
			if (label instanceof HTMLElement) {
				label.click();
			}
		}
	}

	let attempts = 0;
	const maxAttempts = 10;
	const poll = () => {
		const opened = document.getElementById("vector-appearance");
		if (opened && isElementVisible(opened)) {
			opened.scrollIntoView({ behavior: "smooth", block: "center" });
			return;
		}
		attempts += 1;
		if (attempts < maxAttempts) {
			requestAnimationFrame(poll);
		} else {
			console.log("[Reaction] Appearance panel did not open in time.");
		}
	};
	requestAnimationFrame(poll);
	return true;
}

/**
 * Create a radio button element for the reaction appearance portlet.
 * @param groupName - The name attribute for the radio group.
 * @param id - The id attribute for the radio input.
 * @param value - The value attribute for the radio input.
 * @param label - The text label for the radio option.
 * @param checked - Whether the radio input is checked.
 * @returns An object containing the wrapper div and the input element.
 */
function createRadio(
	groupName: string,
	id: string,
	value: ReactionAppearanceChoice,
	label: string,
	checked: boolean,
): { wrapper: HTMLDivElement; input: HTMLInputElement } {
	const wrapper = document.createElement("div");
	wrapper.className = "cdx-radio";

	const input = document.createElement("input");
	input.type = "radio";
	input.name = groupName;
	input.id = id;
	input.value = value;
	input.className = "cdx-radio__input";
	input.checked = checked;

	const icon = document.createElement("span");
	icon.className = "cdx-radio__icon";

	const labelEl = document.createElement("label");
	labelEl.className = "cdx-label cdx-radio__label";
	labelEl.htmlFor = id;

	const labelText = document.createElement("span");
	labelText.className = "cdx-label__label__text";
	labelText.textContent = label;

	labelEl.appendChild(labelText);
	wrapper.append(input, icon, labelEl);

	return { wrapper, input };
}

/**
 * Create a checkbox element for the reaction appearance portlet.
 * @param id - The id attribute for the checkbox input.
 * @param label - The text label for the checkbox.
 * @param checked - Whether the checkbox is checked.
 * @returns An object containing the wrapper div and the input element.
 */
function createCheckbox(
	id: string,
	label: string,
	checked: boolean,
): { wrapper: HTMLDivElement; input: HTMLInputElement } {
	const wrapper = document.createElement("div");
	wrapper.className = "cdx-checkbox";

	const input = document.createElement("input");
	input.type = "checkbox";
	input.id = id;
	input.className = "cdx-checkbox__input";
	input.checked = checked;

	const icon = document.createElement("span");
	icon.className = "cdx-checkbox__icon";

	const labelEl = document.createElement("label");
	labelEl.className = "cdx-label cdx-checkbox__label";
	labelEl.htmlFor = id;

	const labelText = document.createElement("span");
	labelText.className = "cdx-label__label__text";
	labelText.textContent = label;

	labelEl.appendChild(labelText);
	wrapper.append(input, icon, labelEl);

	return { wrapper, input };
}

/**
 * Build the skeleton structure for the reaction appearance portlet.
 * @param portletId - The HTML id attribute for the portlet.
 * @param heading - The heading text for the portlet.
 * @returns An object containing the portlet div and the form element.
 */
function buildPortletSkeleton(portletId: string, heading: string): {
	portlet: HTMLDivElement;
	form: HTMLFormElement;
} {
	const portlet = document.createElement("div");
	portlet.className = "mw-portlet vector-menu";
	portlet.id = portletId;

	const headingEl = document.createElement("div");
	headingEl.className = "vector-menu-heading";
	headingEl.textContent = heading;

	const content = document.createElement("div");
	content.className = "vector-menu-content";

	const list = document.createElement("ul");
	list.className = "vector-menu-content-list";

	const item = document.createElement("li");
	item.className = "mw-list-item mw-list-item-js";

	const wrapper = document.createElement("div");
	const form = document.createElement("form");

	wrapper.appendChild(form);
	item.appendChild(wrapper);
	list.appendChild(item);
	content.appendChild(list);
	portlet.append(headingEl, content);

	return { portlet, form };
}

/**
 * Determine whether to show the "hide all reactions" option.
 * @param selected - The currently selected reaction appearance choice.
 * @returns True if the "hide all reactions" option should be shown.
 */
function shouldShowHideOption(selected: ReactionAppearanceChoice): boolean {
	return selected === "disable" || selected === "hide";
}

/**
 * Determine whether to show the reaction blacklist option.
 * @param selected - The currently selected reaction appearance choice.
 * @returns True if the reaction blacklist option should be shown.
 */
function shouldShowBlacklistOption(selected: ReactionAppearanceChoice): boolean {
	return selected === "hide";
}

/**
 * Add or update the reaction appearance portlet in the interface.
 * @param options - Configuration options for the portlet.
 */
export function upsertReactionAppearancePortlet(options: ReactionAppearancePortletOptions): void {
	const appearance = document.getElementById("vector-appearance");
	if (!appearance) {
		return;
	}

	const portletId = options.portletId ?? DEFAULT_PORTLET_ID;
	const { portlet, form } = buildPortletSkeleton(portletId, options.heading);

	const enableRadio = createRadio(
		INPUT_GROUP_NAME,
		`${portletId}-enable`,
		"enable",
		options.labels.enable,
		options.selected === "enable",
	);
	const disableRadio = createRadio(
		INPUT_GROUP_NAME,
		`${portletId}-disable`,
		"disable",
		options.labels.disable,
		options.selected === "disable",
	);
	const hideRadio = createRadio(
		INPUT_GROUP_NAME,
		`${portletId}-hide`,
		"hide",
		options.labels.hideAll,
		options.selected === "hide",
	);
	const blacklistCheckbox = createCheckbox(
		`${portletId}-blacklist`,
		options.labels.blacklist,
		state.reactionBlacklist,
	);

	const hideVisible = shouldShowHideOption(options.selected);
	hideRadio.wrapper.style.display = hideVisible ? "" : "none";
	blacklistCheckbox.wrapper.style.display = shouldShowBlacklistOption(options.selected) ? "" : "none";

	const updateHideVisibility = (value: ReactionAppearanceChoice): void => {
		hideRadio.wrapper.style.display = shouldShowHideOption(value) ? "" : "none";
		blacklistCheckbox.wrapper.style.display = shouldShowBlacklistOption(value) ? "" : "none";
	};

	const handleChange = (value: ReactionAppearanceChoice): void => {
		updateHideVisibility(value);
		options.onChange(value);
	};

	enableRadio.input.addEventListener("change", () => handleChange("enable"));
	disableRadio.input.addEventListener("change", () => handleChange("disable"));
	hideRadio.input.addEventListener("change", () => handleChange("hide"));
	blacklistCheckbox.input.addEventListener("change", () => {
		const nextValue = blacklistCheckbox.input.checked;
		if (nextValue) {
			OO.ui.confirm(t("dom.confirm.blacklist_reactions"), {
				title: t("default.titles.confirm"),
				size: "small",
			}).then((confirmed: boolean) => {
				if (confirmed) {
					options.onBlacklistChange(true);
				} else {
					blacklistCheckbox.input.checked = false;
				}
			});
			return;
		}
		options.onBlacklistChange(false);
	});

	form.append(enableRadio.wrapper, disableRadio.wrapper, hideRadio.wrapper, blacklistCheckbox.wrapper);

	const existing = document.getElementById(portletId);
	if (existing && existing.parentNode) {
		existing.replaceWith(portlet);
	} else {
		appearance.appendChild(portlet);
	}
}

/**
 * Resolve the current reaction appearance selection based on state.
 * @returns The resolved ReactionAppearanceChoice.
 */
function resolveAppearanceSelection(): ReactionAppearanceChoice {
	if (state.reactionBlacklist || state.reactionHidden) {
		return "hide";
	}
	if (state.reactionEnabled) {
		return "enable";
	}
	return "disable";
}

/**
 * Update the reaction appearance portlet based on the current state.
 */
export function updateAppearancePortlet(): void {
	if (!isVector2022Appearance()) {
		return;
	}
	removeLegacyReactionPortlets();
	const selected = resolveAppearanceSelection();
	upsertReactionAppearancePortlet({
		heading: t("dom.appearance.heading"),
		labels: {
			enable: t("dom.appearance.enable"),
			disable: t("dom.appearance.disable"),
			hideAll: t("dom.appearance.hide_all"),
			blacklist: t("dom.appearance.blacklist"),
		},
		selected,
		onChange: (value) => {
			if (value === "enable") {
				setReactionBlacklist(false);
				persistReactionBlacklistToUserConfig(false);
				setReactionHidden(false);
				setReactionHiddenState(false);
				toggleReactionEnabledWithFeature(true);
				updateAppearancePortlet();
				return;
			}
			if (value === "disable") {
				setReactionBlacklist(false);
				persistReactionBlacklistToUserConfig(false);
				setReactionHidden(false);
				setReactionHiddenState(false);
				toggleReactionEnabledWithFeature(false);
				updateAppearancePortlet();
				return;
			}
			OO.ui.confirm(t("dom.confirm.hide_reactions"), {
				title: t("default.titles.confirm"),
				size: "small",
			}).then((confirmed: boolean) => {
				if (confirmed) {
					setReactionHidden(true);
					setReactionHiddenState(true);
					toggleReactionEnabledWithFeature(false);
				}
				updateAppearancePortlet();
			});
		},
		onBlacklistChange: (value) => {
			setReactionBlacklist(value);
			persistReactionBlacklistToUserConfig(value);
			if (value) {
				setReactionHidden(true);
				setReactionHiddenState(true);
				toggleReactionEnabledWithFeature(false);
			}
			updateAppearancePortlet();
		},
	});
	setReactionHiddenState(state.reactionHidden || state.reactionBlacklist);
}
