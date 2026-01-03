import {
	createCompatApp,
	defineCompatComponent,
	compatRender,
	compatNextTick,
	type CompatApp,
} from "../vueCompat";
import { Picker, EmojiIndex } from "emoji-mart-vue-fast";
import type { PickerProps, EmojiIndex as EmojiIndexType } from "emoji-mart-vue-fast";
import emojiData from "emoji-mart-vue-fast/data/all.json";
import emojiMartStyles from "emoji-mart-vue-fast/css/emoji-mart.css";

const PICKER_MARGIN_PX = 8;
const PICKER_CLASS = "reaction-emoji-picker";
const STYLE_ELEMENT_ID = "reaction-emoji-picker-styles";

interface EmojiSelection {
	native?: string;
	colons?: string;
}

interface PickerAppHandle {
	mount: (container: HTMLElement) => void;
	unmount: () => void;
}

type EmojiIndexConstructor = new (data: typeof emojiData) => EmojiIndexType;

let pickerApp: PickerAppHandle | null = null;
let pickerContainer: HTMLDivElement | null = null;
let currentAnchor: HTMLElement | null = null;
let currentInput: HTMLInputElement | null = null;
let emojiIndex: EmojiIndexType | null = null;
let styleElement: HTMLStyleElement | null = null;
let pendingAnimationFrame = 0;

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
		emojiIndex = new (EmojiIndex as EmojiIndexConstructor)(emojiData);
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

	let top = anchorRect.bottom + PICKER_MARGIN_PX;
	let left = anchorRect.left;

	if (top + pickerRect.height > viewportHeight - PICKER_MARGIN_PX) {
		top = anchorRect.top - pickerRect.height - PICKER_MARGIN_PX;
	}
	if (top < PICKER_MARGIN_PX) {
		top = PICKER_MARGIN_PX;
	}

	if (left + pickerRect.width > viewportWidth - PICKER_MARGIN_PX) {
		left = viewportWidth - pickerRect.width - PICKER_MARGIN_PX;
	}
	if (left < PICKER_MARGIN_PX) {
		left = PICKER_MARGIN_PX;
	}

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
		const value = emoji?.native ?? emoji?.colons ?? "";
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
