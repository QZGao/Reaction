import {
	createApp as compatCreateApp,
	defineComponent as compatDefineComponent,
	h as compatH,
	nextTick as compatNextTick,
} from "vue";
import type { App as VueApp, DefineComponent as VueDefineComponent } from "vue";

type VueCreateApp = typeof import("vue").createApp;
type VueDefineComponentFn = typeof import("vue").defineComponent;
type VueRenderFn = typeof import("vue").h;
type VueNextTickFn = typeof import("vue").nextTick;

const createAppTyped: VueCreateApp = compatCreateApp;
const defineComponentTyped: VueDefineComponentFn = compatDefineComponent;
const renderTyped: VueRenderFn = compatH;
const nextTickTyped: VueNextTickFn = compatNextTick;

export { createAppTyped as createCompatApp };
export { defineComponentTyped as defineCompatComponent };
export { renderTyped as compatRender };
export { nextTickTyped as compatNextTick };

export type CompatApp<T = Element> = VueApp<T>;
export type CompatDefineComponent = VueDefineComponent;
