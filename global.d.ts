declare global {
	interface UjsReactionConfig {
		blacklist?: boolean;
	}

	interface Window {
		ujsReactionConfirmedRequired?: boolean;
		ujsReactionConfig?: UjsReactionConfig;
	}
}

export { };
