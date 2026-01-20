import {
	createCompatApp,
	defineCompatComponent,
	compatRender,
	compatNextTick,
	type CompatApp,
} from "../vueCompat";
import { Picker, EmojiIndex } from "emoji-mart-vue-fast";
import { getCustomEmojis, getCustomEmojiTextMap } from "../emojis/customEmojis";
import seedRecentEmojis from "../emojis/seedRecentEmojis";
import type { PickerProps, EmojiIndex as EmojiIndexType } from "emoji-mart-vue-fast";
import emojiData from "emoji-mart-vue-fast/data/all.json";
import emojiMartStyles from "emoji-mart-vue-fast/css/emoji-mart.css";
import { ref, type Ref, type ComponentPublicInstance } from "vue";
import { getLocale, resolveEmojiI18nData, t, type EmojiI18nData } from "../i18n";

const PICKER_MARGIN_PX = 8;
const PICKER_CLASS = "reaction-emoji-picker";
const STYLE_ELEMENT_ID = "reaction-emoji-picker-styles";
const customEmojiTextMap = getCustomEmojiTextMap();
const REACTION_VISIBILITY_NOTICE_KEY = "emojiPicker.notice.reaction_visibility";

/**
 * Get the text representation for a custom emoji selection.
 * @param selection - Selected emoji.
 * @returns Text representation or undefined.
 */
function getCustomEmojiText(selection: EmojiSelection | null | undefined): string | undefined {
	if (!selection?.id) {
		return undefined;
	}
	return customEmojiTextMap[selection.id];
}

/**
 * Create i18n messages for the emoji picker.
 * @returns I18n messages object.
 */
function createPickerI18nMessages(): PickerProps["i18n"] {
	return {
		search: t("emojiPicker.i18n.search"),
		notfound: t("emojiPicker.i18n.notfound"),
		categories: {
			search: t("emojiPicker.i18n.categories.search"),
			recent: t("emojiPicker.i18n.categories.recent"),
			smileys: t("emojiPicker.i18n.categories.smileys"),
			people: t("emojiPicker.i18n.categories.people"),
			nature: t("emojiPicker.i18n.categories.nature"),
			foods: t("emojiPicker.i18n.categories.foods"),
			activity: t("emojiPicker.i18n.categories.activity"),
			places: t("emojiPicker.i18n.categories.places"),
			objects: t("emojiPicker.i18n.categories.objects"),
			symbols: t("emojiPicker.i18n.categories.symbols"),
			flags: t("emojiPicker.i18n.categories.flags"),
			custom: t("emojiPicker.i18n.categories.custom"),
		},
	};
}

interface EmojiSelection {
	id?: string;
	native?: string;
	colons?: string;
}

interface PickerAppHandle {
	mount: (container: HTMLElement) => void;
	unmount: () => void;
}

type EmojiIndexConstructor = new (data: typeof emojiData, options?: {
	include?: string[];
	exclude?: string[];
	custom?: EmojiSelection[];
	emojiI18n?: EmojiI18nData;
}) => EmojiIndexType;

interface PickerSearchSlotProps {
	data: EmojiIndexType;
	i18n?: {
		search?: string;
	};
	autoFocus?: boolean;
	onSearch?: (value: string) => void;
	onArrowLeft?: (event: KeyboardEvent) => void;
	onArrowRight?: () => void;
	onArrowDown?: () => void;
	onArrowUp?: (event: KeyboardEvent) => void;
	onEnter?: () => void;
	onTextSelect?: (event: Event) => void;
}

let pickerApp: PickerAppHandle | null = null;
let pickerContainer: HTMLDivElement | null = null;
let currentAnchor: HTMLElement | null = null;
let currentInput: HTMLInputElement | null = null;
let emojiIndex: EmojiIndexType | null = null;
let styleElement: HTMLStyleElement | null = null;
let pendingAnimationFrame = 0;
let pendingIndexRefresh = 0;
let documentClickListener: ((event: MouseEvent) => void) | null = null;

/**
 * Ensure that necessary styles for the emoji picker are injected into the document.
 */
function ensureStylesInjected(): void {
	if (styleElement || typeof document === "undefined") {
		return;
	}
	const root = document.head || document.body || document.documentElement;
	if (!root) {
		return;
	}
	styleElement = document.createElement("style");
	styleElement.id = STYLE_ELEMENT_ID;
	styleElement.textContent = `
${emojiMartStyles}
.${PICKER_CLASS} {
	position: absolute;
	z-index: 10010;
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
	border-radius: 8px;
	background: #fff;
}
.${PICKER_CLASS}__notice {
	position: absolute;
	right: 10px;
	top: 86px;
	font-size: 0.72em;
	color: #72777d;
	pointer-events: none;
}
`;
	root.appendChild(styleElement);
}

/**
 * Get the current vertical scroll position.
 * @returns Scroll top in pixels.
 */
function getScrollTop(): number {
	return window.scrollY ?? document.documentElement?.scrollTop ?? 0;
}

/**
 * Get the current horizontal scroll position.
 * @returns Scroll left in pixels.
 */
function getScrollLeft(): number {
	return window.scrollX ?? document.documentElement?.scrollLeft ?? 0;
}

/**
 * Ensure that the emoji index is initialized.
 * @returns Emoji index instance.
 */
function ensureEmojiIndex(): EmojiIndexType {
	if (!emojiIndex) {
		emojiIndex = buildEmojiIndex();
	}
	return emojiIndex;
}

/**
 * Build a fresh emoji index.
 * @returns Emoji index instance.
 */
function buildEmojiIndex(): EmojiIndexType {
	seedFrequentlyUsed();
	const locale = getLocale();
	const emojiI18n = resolveEmojiI18nData(getLocale()) ?? undefined;
	return new (EmojiIndex as EmojiIndexConstructor)(emojiData, {
		exclude: ["flags"],
		custom: getCustomEmojis(locale),
		emojiI18n,
	});
}

/**
 * Rebuild the emoji index to refresh recent items.
 * @returns Emoji index instance.
 */
function refreshEmojiIndex(): EmojiIndexType {
	emojiIndex = buildEmojiIndex();
	return emojiIndex;
}

/**
 * Seed the emoji-mart frequently used list for first-time users.
 */
function seedFrequentlyUsed(): void {
	if (typeof window === "undefined" || !("localStorage" in window)) {
		return;
	}
	const storage = window.localStorage;
	const frequentlyKey = "emoji-mart.frequently";
	if (storage.getItem(frequentlyKey)) {
		return;
	}
	const seeded = seedRecentEmojis;
	if (!seeded.length) {
		return;
	}
	const frequencyMap: Record<string, number> = {};
	const length = seeded.length;
	for (let i = 0; i < length; i += 1) {
		frequencyMap[seeded[i]] = Math.floor((length - i) / 4) + 1;
	}
	storage.setItem(frequentlyKey, JSON.stringify(frequencyMap));
	storage.setItem("emoji-mart.last", JSON.stringify(seeded[0]));
}

/**
 * Schedule a refresh of the emoji index after selection updates.
 * @param onRefresh - Callback to receive the refreshed index.
 */
function scheduleEmojiIndexRefresh(onRefresh: (index: EmojiIndexType) => void): void {
	if (typeof window === "undefined") {
		onRefresh(refreshEmojiIndex());
		return;
	}
	if (pendingIndexRefresh) {
		window.cancelAnimationFrame(pendingIndexRefresh);
	}
	pendingIndexRefresh = window.requestAnimationFrame(() => {
		pendingIndexRefresh = 0;
		onRefresh(refreshEmojiIndex());
	});
}

/**
 * Cleanup any pending animation frame for position updates.
 */
function cleanupAnimationFrame(): void {
	if (pendingAnimationFrame) {
		window.cancelAnimationFrame(pendingAnimationFrame);
		pendingAnimationFrame = 0;
	}
}

/**
 * Handle clicks outside the emoji picker to hide it.
 * @param event - Mouse event.
 */
function handleDocumentClick(event: MouseEvent): void {
	if (!pickerContainer) {
		return;
	}
	const target = event.target as Node | null;
	if (!target) {
		return;
	}
	const clickedInsidePicker = pickerContainer.contains(target);
	const clickedAnchor = currentAnchor?.contains(target) ?? false;
	const clickedInput = currentInput ? currentInput === target || currentInput.contains(target) : false;
	if (!clickedInsidePicker && !clickedAnchor && !clickedInput) {
		hideEmojiPicker();
	}
}

/**
 * Attach a document-level listener to detect outside clicks.
 */
function attachDocumentClickListener(): void {
	if (documentClickListener || typeof document === "undefined") {
		return;
	}
	documentClickListener = handleDocumentClick;
	document.addEventListener("mousedown", documentClickListener, true);
}

/**
 * Detach the document-level outside click listener.
 */
function detachDocumentClickListener(): void {
	if (!documentClickListener || typeof document === "undefined") {
		return;
	}
	document.removeEventListener("mousedown", documentClickListener, true);
	documentClickListener = null;
}

/**
 * Schedule a position update for the emoji picker.
 */
function schedulePositionUpdate(): void {
	cleanupAnimationFrame();
	pendingAnimationFrame = window.requestAnimationFrame(() => {
		pendingAnimationFrame = 0;
		if (currentAnchor && pickerContainer) {
			updatePickerPosition(currentAnchor, pickerContainer);
		}
	});
}

/**
 * Handle viewport changes to reposition the picker.
 */
function handleViewportChange(): void {
	if (!pickerContainer || !currentAnchor) {
		return;
	}
	schedulePositionUpdate();
}

/**
 * Attach event listeners for viewport changes.
 */
function attachViewportListeners(): void {
	window.addEventListener("scroll", handleViewportChange, true);
	window.addEventListener("resize", handleViewportChange, true);
}

/**
 * Detach event listeners for viewport changes.
 */
function detachViewportListeners(): void {
	window.removeEventListener("scroll", handleViewportChange, true);
	window.removeEventListener("resize", handleViewportChange, true);
	cleanupAnimationFrame();
}

/**
 * Destroy the emoji picker and clean up resources.
 */
function destroyPicker(): void {
	if (pickerApp) {
		pickerApp.unmount();
		pickerApp = null;
	}
	if (pickerContainer) {
		pickerContainer.remove();
		pickerContainer = null;
	}
	currentAnchor = null;
	currentInput = null;
	detachViewportListeners();
	detachDocumentClickListener();
	if (pendingIndexRefresh && typeof window !== "undefined") {
		window.cancelAnimationFrame(pendingIndexRefresh);
		pendingIndexRefresh = 0;
	}
}

type PickerPlacement = "bottom" | "top" | "right" | "left";

/**
 * Clamp a value between a minimum and maximum.
 * @param value - Value to clamp.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns Clamped value.
 */
function clamp(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}

/**
 * Select the best placement for the emoji picker.
 * @param anchorRect - Bounding rect of the anchor element.
 * @param pickerRect - Bounding rect of the picker element.
 * @param viewportWidth - Width of the viewport.
 * @param viewportHeight - Height of the viewport.
 * @returns Selected placement.
 */
function selectPlacement(
	anchorRect: DOMRect,
	pickerRect: DOMRect,
	viewportWidth: number,
	viewportHeight: number,
): PickerPlacement {
	const placements: PickerPlacement[] = [];
	if (anchorRect.bottom + PICKER_MARGIN_PX + pickerRect.height <= viewportHeight) {
		placements.push("bottom");
	}
	if (anchorRect.top - PICKER_MARGIN_PX - pickerRect.height >= 0) {
		placements.push("top");
	}
	if (anchorRect.right + PICKER_MARGIN_PX + pickerRect.width <= viewportWidth) {
		placements.push("right");
	}
	if (anchorRect.left - PICKER_MARGIN_PX - pickerRect.width >= 0) {
		placements.push("left");
	}
	if (placements.length === 0) {
		return "bottom";
	}
	return placements[0];
}

/**
 * Calculate the position for the emoji picker based on placement.
 * @param placement - Selected placement.
 * @param anchorRect - Bounding rect of the anchor element.
 * @param pickerRect - Bounding rect of the picker element.
 * @param viewportWidth - Width of the viewport.
 * @param viewportHeight - Height of the viewport.
 * @returns Top and left position for the picker.
 */
function positionForPlacement(
	placement: PickerPlacement,
	anchorRect: DOMRect,
	pickerRect: DOMRect,
	viewportWidth: number,
	viewportHeight: number,
): { top: number; left: number } {
	switch (placement) {
		case "top": {
			const top = anchorRect.top - pickerRect.height - PICKER_MARGIN_PX;
			const left = clamp(
				anchorRect.left,
				PICKER_MARGIN_PX,
				viewportWidth - pickerRect.width - PICKER_MARGIN_PX,
			);
			return { top, left };
		}
		case "right": {
			const left = anchorRect.right + PICKER_MARGIN_PX;
			const top = clamp(
				anchorRect.top,
				PICKER_MARGIN_PX,
				viewportHeight - pickerRect.height - PICKER_MARGIN_PX,
			);
			return { top, left };
		}
		case "left": {
			const left = anchorRect.left - pickerRect.width - PICKER_MARGIN_PX;
			const top = clamp(
				anchorRect.top,
				PICKER_MARGIN_PX,
				viewportHeight - pickerRect.height - PICKER_MARGIN_PX,
			);
			return { top, left };
		}
		case "bottom":
		default: {
			const top = anchorRect.bottom + PICKER_MARGIN_PX;
			const left = clamp(
				anchorRect.left,
				PICKER_MARGIN_PX,
				viewportWidth - pickerRect.width - PICKER_MARGIN_PX,
			);
			return { top, left };
		}
	}
}

/**
 * Update the position of the emoji picker relative to the anchor element.
 * @param anchor - Anchor element.
 * @param container - Picker container element.
 */
function updatePickerPosition(anchor: HTMLElement, container: HTMLElement): void {
	const anchorRect = anchor.getBoundingClientRect();
	const pickerRect = container.getBoundingClientRect();
	const viewportWidth = document.documentElement?.clientWidth ?? window.innerWidth;
	const viewportHeight = document.documentElement?.clientHeight ?? window.innerHeight;
	const placement = selectPlacement(anchorRect, pickerRect, viewportWidth, viewportHeight);
	const { top, left } = positionForPlacement(placement, anchorRect, pickerRect, viewportWidth, viewportHeight);
	const scrollTop = getScrollTop();
	const scrollLeft = getScrollLeft();
	container.style.top = `${top + scrollTop}px`;
	container.style.left = `${left + scrollLeft}px`;
}

/**
 * Create and configure the emoji picker application.
 * @returns Picker application handle.
 */
function createPickerApp(): PickerAppHandle {
	const hostComponent = defineCompatComponent(() => {
		const searchValue = ref("");
		const dataIndex = ref<EmojiIndexType>(ensureEmojiIndex());
		const onSelect: (emoji: EmojiSelection) => void = (emoji: EmojiSelection) => {
			const value = getCustomEmojiText(emoji) ?? emoji?.native ?? emoji?.colons ?? "";
			if (!value || !currentInput) {
				return;
			}
			currentInput.value = value;
			const inputEvent = new Event("input", { bubbles: true });
			currentInput.dispatchEvent(inputEvent);
			currentInput.focus({ preventScroll: true });
			scheduleEmojiIndexRefresh((nextIndex) => {
				dataIndex.value = nextIndex;
			});
		};
		const renderSearchSlot = createSearchSlotRenderer(searchValue);
		return () =>
			compatRender(
				Picker,
				{
					data: dataIndex.value,
					custom: getCustomEmojis(getLocale()),
					native: true,
					autoFocus: false,
					showSearch: true,
					showPreview: false,
					showCategories: true,
					i18n: createPickerI18nMessages(),
					perLine: 10,
					emojiSize: 24,
					emojiTooltip: true,
					skin: null,
					onSelect,
					infiniteScroll: false,
				} as PickerProps,
				{
					searchTemplate: (slotProps: PickerSearchSlotProps) => renderSearchSlot(slotProps),
				},
			);
	});
	const app: CompatApp<Element> = createCompatApp(hostComponent);
	const handle: PickerAppHandle = {
		mount(container: HTMLElement) {
			app.mount(container);
		},
		unmount() {
			app.unmount();
		},
	};
	return handle;
}

/**
 * Create a renderer for the picker's search slot.
 * @param searchValue - Reactive search term reference.
 * @returns Slot renderer function.
 */
function createSearchSlotRenderer(searchValue: Ref<string>) {
	let hasAutoFocused = false;
	return (slotProps: PickerSearchSlotProps) => {
		const placeholder = slotProps.i18n?.search || "Search";
		const shouldAutoFocus = slotProps.autoFocus ?? false;
		const setInputRef = (element: Element | ComponentPublicInstance | null): void => {
			if (!shouldAutoFocus || !(element instanceof HTMLInputElement)) {
				return;
			}
			if (hasAutoFocused) {
				return;
			}
			hasAutoFocused = true;
			requestAnimationFrame(() => {
				element.focus({ preventScroll: true });
				element.select();
			});
		};
		const handleInput = (event: Event): void => {
			const target = event.target as HTMLInputElement | null;
			const value = target?.value ?? "";
			searchValue.value = value;
			slotProps.onSearch?.(value);
		};
		const handleKeydown = (event: KeyboardEvent): void => {
			switch (event.key) {
				case "ArrowLeft":
					slotProps.onArrowLeft?.(event);
					break;
				case "ArrowRight":
					slotProps.onArrowRight?.();
					break;
				case "ArrowDown":
					slotProps.onArrowDown?.();
					break;
				case "ArrowUp":
					slotProps.onArrowUp?.(event);
					break;
				case "Enter":
					slotProps.onEnter?.();
					break;
				default:
					break;
			}
		};
		const handleSelect = (event: Event): void => {
			slotProps.onTextSelect?.(event);
		};

		return compatRender("div", { class: "emoji-mart-search" }, [
			compatRender("input", {
				type: "text",
				placeholder,
				autofocus: shouldAutoFocus,
				value: searchValue.value,
				onInput: handleInput,
				onKeydown: handleKeydown,
				onSelect: handleSelect,
				ref: setInputRef,
			}),
			compatRender(
				"span",
				{ class: "hidden", id: "emoji-picker-search-description" },
				"Use the left, right, up and down arrow keys to navigate the emoji search results.",
			),
		]);
	};
}

/**
 * Mount the emoji picker to the document.
 * @param anchor - Anchor element.
 * @param input - Input element to receive the selected emoji.
 */
async function mountPicker(anchor: HTMLElement, input: HTMLInputElement): Promise<void> {
	if (!document.body) {
		return;
	}
	destroyPicker();
	ensureStylesInjected();
	currentAnchor = anchor;
	currentInput = input;
	pickerContainer = document.createElement("div");
	pickerContainer.className = PICKER_CLASS;
	document.body.appendChild(pickerContainer);
	const appHandle = createPickerApp();
	pickerApp = appHandle;
	appHandle.mount(pickerContainer);
	const notice = document.createElement("div");
	notice.className = `${PICKER_CLASS}__notice`;
	notice.textContent = t(REACTION_VISIBILITY_NOTICE_KEY);
	pickerContainer.appendChild(notice);
	await compatNextTick(() => undefined);
	updatePickerPosition(anchor, pickerContainer);
	attachViewportListeners();
	attachDocumentClickListener();
}

/**
 * Show the emoji picker anchored to the specified element.
 * @param anchor - Anchor element.
 * @param input - Input element to receive the selected emoji.
 */
export async function showEmojiPicker(anchor: HTMLElement, input: HTMLInputElement): Promise<void> {
	await mountPicker(anchor, input);
}

/**
 * Hide the emoji picker if it is currently shown for the specified anchor.
 * @param anchor - Anchor element.
 */
export function hideEmojiPicker(anchor?: HTMLElement | null): void {
	if (anchor && anchor !== currentAnchor) {
		return;
	}
	destroyPicker();
}

/**
 * Reposition the emoji picker if it is currently shown for the specified anchor.
 * @param anchor - Anchor element.
 */
export function repositionEmojiPicker(anchor?: HTMLElement | null): void {
	if (!pickerContainer || !currentAnchor) {
		return;
	}
	if (anchor && anchor !== currentAnchor) {
		return;
	}
	updatePickerPosition(currentAnchor, pickerContainer);
}
