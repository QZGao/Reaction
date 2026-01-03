// Module declarations for virtual imports used in the build.
declare module "*.css" {
	const content: string;
	export default content;
}

declare module "virtual:i18n-catalogues" {
	const catalogues: Record<string, Record<string, string>>;
	export default catalogues;
}

declare module "@vue/compat" {
	export const createApp: typeof import("vue").createApp;
	export const defineComponent: typeof import("vue").defineComponent;
	export const h: typeof import("vue").h;
	export const nextTick: typeof import("vue").nextTick;
	export type App<T = any> = import("vue").App<T>;
	export type DefineComponent = import("vue").DefineComponent;
	export function configureCompat(config: Record<string, boolean>): void;
	export * from "vue";
}
