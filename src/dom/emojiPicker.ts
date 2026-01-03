import {
	createCompatApp,
	defineCompatComponent,
	compatRender,
	compatNextTick,
	type CompatApp,
} from "../vueCompat";
import { Picker, EmojiIndex } from "emoji-mart-vue-fast";
import customEmojis from "../emojis/customEmojis";
import type { PickerProps, EmojiIndex as EmojiIndexType } from "emoji-mart-vue-fast";
import emojiData from "emoji-mart-vue-fast/data/all.json";
import emojiMartStyles from "emoji-mart-vue-fast/css/emoji-mart.css";

const PICKER_MARGIN_PX = 8;
const PICKER_CLASS = "reaction-emoji-picker";
const STYLE_ELEMENT_ID = "reaction-emoji-picker-styles";
const customEmojiTextMap: Record<string, string> = customEmojis.reduce<Record<string, string>>((acc, emoji) => {
	const key = emoji.short_names?.[0];
	if (key && typeof emoji.text === "string" && emoji.text.length > 0) {
		acc[key] = emoji.text;
	}
	return acc;
}, {});

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
	custom?: EmojiSelection[];
}) => EmojiIndexType;

let pickerApp: PickerAppHandle | null = null;
let pickerContainer: HTMLDivElement | null = null;
let currentAnchor: HTMLElement | null = null;
let currentInput: HTMLInputElement | null = null;
let emojiIndex: EmojiIndexType | null = null;
let styleElement: HTMLStyleElement | null = null;
let pendingAnimationFrame = 0;
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
		emojiIndex = new (EmojiIndex as EmojiIndexConstructor)(emojiData, {
			custom: customEmojis,
		});
	}
	return emojiIndex;
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
	const dataIndex: EmojiIndexType = ensureEmojiIndex();
	const onSelect: (emoji: EmojiSelection) => void = (emoji: EmojiSelection) => {
		const value = getCustomEmojiText(emoji) ?? emoji?.native ?? emoji?.colons ?? "";
		if (!value || !currentInput) {
			return;
		}
		currentInput.value = value;
		const inputEvent = new Event("input", { bubbles: true });
		currentInput.dispatchEvent(inputEvent);
		currentInput.focus({ preventScroll: true });
	};

	const pickerProps: PickerProps = {
		data: dataIndex,
		custom: customEmojis,
		native: true,
		showPreview: false,
		i18n: {},
		perLine: 8,
		emojiSize: 24,
		emojiTooltip: true,
		skin: null,
		onSelect,
	};
	const hostComponent = defineCompatComponent(() => {
		return () => compatRender(Picker, pickerProps);
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
