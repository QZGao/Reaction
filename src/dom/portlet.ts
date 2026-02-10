import state, { setReactionBlacklist, setReactionHidden } from "../state";
import { t } from "../i18n";
import { persistReactionBlacklistToUserConfig } from "../api/userConfig";
import { toggleReactionEnabledWithFeature } from "../featureLoader";

const REACTION_PORTLET_ID = "reaction-toggle";
const REACTION_HIDE_PORTLET_ID = "reaction-hide-toggle";
const REACTION_BLACKLIST_PORTLET_ID = "reaction-blacklist-toggle";
const HIDE_CLASS = "reaction-hidden";
let hideStylesInjected = false;

function isHiddenMode(): boolean {
	return state.reactionHidden || state.reactionBlacklist;
}

function isEnabledMode(): boolean {
	return state.reactionEnabled && !isHiddenMode();
}

/**
 * Add or update a portlet link in the actions menu (fallback to toolbox).
 * @param portletId - The HTML id attribute for the portlet link.
 * @param label - The text label for the portlet link.
 * @param onClick - Click handler function for the portlet link.
 */
export function addPortletTrigger(portletId: string, label: string, onClick: () => void): void {
	const targets = ['p-cactions', 'p-tb'];
	let li = document.getElementById(portletId) as HTMLLIElement | null;

	if (!li) {
		for (const target of targets) {
			const added = mw.util.addPortletLink(target, '#', label, portletId, label);
			if (added) {
				li = added;
				break;
			}
		}
	}

	if (!li) return;

	const link = li.querySelector('a');

	// Update text/label if present
	if (link) {
		link.textContent = label;
		link.title = label;
		link.href = '#';
	}

	// Remove previous listeners (avoid stacking)
	const cloned = li.cloneNode(true);
	li.replaceWith(cloned);
	const freshLi = document.getElementById(portletId);
	const freshLink = freshLi?.querySelector('a');

	const handler = (event: Event) => {
		event.preventDefault();
		onClick();
	};

	if (freshLink) {
		freshLink.addEventListener('click', handler);
		freshLink.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				onClick();
			}
		});
	} else if (freshLi) {
		freshLi.addEventListener('click', handler);
	}
}

/**
 * Ensure that the CSS styles for hiding reactions are injected.
 */
function ensureHideStyles(): void {
	if (hideStylesInjected) {
		return;
	}
	hideStylesInjected = true;
	mw.util.addCSS(`
html.${HIDE_CLASS} .template-reaction {
	display: none !important;
}
`);
}

/**
 * Set or unset the hidden state CSS class on the document root.
 * @param hidden - Whether reactions should be hidden.
 */
export function setReactionHiddenState(hidden: boolean): void {
	ensureHideStyles();
	const root = document.documentElement;
	if (!root) {
		return;
	}
	root.classList.toggle(HIDE_CLASS, hidden);
}

/**
 * Remove the legacy reaction portlet links if they exist.
 */
export function removeLegacyReactionPortlets(): void {
	document.getElementById(REACTION_PORTLET_ID)?.remove();
	document.getElementById(REACTION_HIDE_PORTLET_ID)?.remove();
	document.getElementById(REACTION_BLACKLIST_PORTLET_ID)?.remove();
}

/**
 * Place the hide reactions portlet link immediately after the toggle portlet link.
 */
function placeHidePortletAfterToggle(): void {
	const hideLi = document.getElementById(REACTION_HIDE_PORTLET_ID);
	const toggleLi = document.getElementById(REACTION_PORTLET_ID);
	if (!hideLi || !toggleLi) {
		return;
	}
	const parent = toggleLi.parentNode;
	if (!parent || parent !== hideLi.parentNode) {
		return;
	}
	if (toggleLi.nextSibling === hideLi) {
		return;
	}
	parent.insertBefore(hideLi, toggleLi.nextSibling);
}

/**
 * Update the reaction toggle portlet link based on the current state.
 */
function updateReactionPortlet(): void {
	const label = isEnabledMode()
		? t("dom.portlets.disable_reaction")
		: t("dom.portlets.enable_reaction");
	addPortletTrigger(REACTION_PORTLET_ID, label, () => {
		const nextEnabled = !isEnabledMode();
		if (nextEnabled) {
			setReactionBlacklist(false);
			persistReactionBlacklistToUserConfig(false);
			setReactionHidden(false);
			setReactionHiddenState(false);
		}
		toggleReactionEnabledWithFeature(nextEnabled);
		updateLegacyReactionPortlets();
	});
}

/**
 * Update the hide reactions portlet link based on the current state.
 */
function updateHidePortlet(): void {
	if (isEnabledMode()) {
		document.getElementById(REACTION_HIDE_PORTLET_ID)?.remove();
		setReactionHidden(false);
		setReactionHiddenState(false);
		return;
	}
	const label = isHiddenMode()
		? t("dom.portlets.unhide_reactions")
		: t("dom.portlets.hide_reactions");
	addPortletTrigger(REACTION_HIDE_PORTLET_ID, label, () => {
		if (!isHiddenMode()) {
			OO.ui.confirm(t("dom.confirm.hide_reactions"), {
				title: t("default.titles.confirm"),
				size: "small",
			}).then((confirmed: boolean) => {
				if (confirmed) {
					setReactionHidden(true);
					setReactionHiddenState(true);
					updateLegacyReactionPortlets();
				}
			});
			return;
		}
		setReactionBlacklist(false);
		persistReactionBlacklistToUserConfig(false);
		setReactionHidden(false);
		setReactionHiddenState(false);
		updateLegacyReactionPortlets();
	});
	placeHidePortletAfterToggle();
	setReactionHiddenState(isHiddenMode());
}

/**
 * Update the "do not receive reactions" legacy portlet link.
 */
function updateBlacklistPortlet(): void {
	if (isEnabledMode() || !isHiddenMode()) {
		document.getElementById(REACTION_BLACKLIST_PORTLET_ID)?.remove();
		return;
	}
	const status = state.reactionBlacklist ? "[x]" : "[ ]";
	const label = `${status} ${t("dom.portlets.blacklist_reactions")}`;
	addPortletTrigger(REACTION_BLACKLIST_PORTLET_ID, label, () => {
		const nextValue = !state.reactionBlacklist;
		if (nextValue) {
			OO.ui.confirm(t("dom.confirm.blacklist_reactions"), {
				title: t("default.titles.confirm"),
				size: "small",
			}).then((confirmed: boolean) => {
				if (!confirmed) {
					return;
				}
				setReactionBlacklist(true);
				setReactionHidden(true);
				setReactionHiddenState(true);
				toggleReactionEnabledWithFeature(false);
				persistReactionBlacklistToUserConfig(true);
				updateLegacyReactionPortlets();
			});
			return;
		}
		setReactionBlacklist(false);
		persistReactionBlacklistToUserConfig(false);
		updateLegacyReactionPortlets();
	});
}

/**
 * Update legacy portlet links for reaction controls.
 */
export function updateLegacyReactionPortlets(): void {
	updateReactionPortlet();
	updateHidePortlet();
	updateBlacklistPortlet();
}
