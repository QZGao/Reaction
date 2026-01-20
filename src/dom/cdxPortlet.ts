import state, { setReactionHidden } from "../state";
import { toggleReactionEnabled } from "./buttons";
import { removeLegacyReactionPortlets, setReactionHiddenState } from "./portlet";
import { t } from "../i18n";

export type ReactionAppearanceChoice = "enable" | "disable" | "hide";

export interface ReactionAppearancePortletOptions {
	portletId?: string;
	heading: string;
	labels: {
		enable: string;
		disable: string;
		hideAll: string;
	};
	selected: ReactionAppearanceChoice;
	onChange: (value: ReactionAppearanceChoice) => void;
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
	return Boolean(document.getElementById("vector-appearance"));
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

	const hideVisible = shouldShowHideOption(options.selected);
	hideRadio.wrapper.style.display = hideVisible ? "" : "none";

	const updateHideVisibility = (value: ReactionAppearanceChoice): void => {
		hideRadio.wrapper.style.display = shouldShowHideOption(value) ? "" : "none";
	};

	const handleChange = (value: ReactionAppearanceChoice): void => {
		updateHideVisibility(value);
		options.onChange(value);
	};

	enableRadio.input.addEventListener("change", () => handleChange("enable"));
	disableRadio.input.addEventListener("change", () => handleChange("disable"));
	hideRadio.input.addEventListener("change", () => handleChange("hide"));

	form.append(enableRadio.wrapper, disableRadio.wrapper, hideRadio.wrapper);

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
	if (state.reactionEnabled) {
		return "enable";
	}
	if (state.reactionHidden) {
		return "hide";
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
		},
		selected,
		onChange: (value) => {
			if (value === "enable") {
				setReactionHidden(false);
				setReactionHiddenState(false);
				toggleReactionEnabled(true);
				updateAppearancePortlet();
				return;
			}
			if (value === "disable") {
				setReactionHidden(false);
				setReactionHiddenState(false);
				toggleReactionEnabled(false);
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
					toggleReactionEnabled(false);
				}
				updateAppearancePortlet();
			});
		},
	});
	setReactionHiddenState(state.reactionHidden);
}
