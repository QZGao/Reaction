import state, { setReactionBlacklist } from "../state";
import { fetchPageWikitext, getApi } from "./client";
import { t, tReaction } from "../i18n";
import { normalizeTitle } from "../titleUtils";

const REACTION_CONFIG_VAR = "ujsReactionConfig";
const REACTION_BLACKLIST_SESSION_STORAGE_KEY = "reaction.blacklistByUser";
const blacklistLookupPromises = new Map<string, Promise<boolean>>();

/**
 * Get the current user's Reaction config subpage title.
 * @returns User config title or null when user is not logged in.
 */
function getUserConfigTitle(): string | null {
	if (!state.userName) {
		return null;
	}
	return `User:${state.userName}/Reaction-config.js`;
}

/**
 * Build Reaction config JS payload.
 * @param blacklist - Blacklist flag to serialize.
 * @returns Config script text.
 */
function buildConfigText(blacklist: boolean): string {
	return `${REACTION_CONFIG_VAR} = {\n\tblacklist: ${blacklist}\n};\n`;
}

/**
 * Build the Reaction config subpage title for a specific user.
 * @param userName - Target user name.
 * @returns User config page title.
 */
function getUserConfigTitleFor(userName: string): string {
	return `User:${userName}/Reaction-config.js`;
}

/**
 * Parse blacklist flag from config script text.
 * @param source - Raw config page content.
 * @returns Parsed blacklist value; false when missing.
 */
function parseBlacklistFromConfigText(source: string): boolean {
	const match = source.match(/\bblacklist\s*:\s*(true|false)\b/i);
	if (!match) {
		return false;
	}
	return match[1].toLowerCase() === "true";
}

/**
 * Read the session cache map for target-user blacklist status.
 * @returns Mapping of normalized user names to blacklist flags.
 */
function readSessionBlacklistMap(): Record<string, boolean> {
	if (typeof window === "undefined" || !("sessionStorage" in window)) {
		return {};
	}
	const raw = window.sessionStorage.getItem(REACTION_BLACKLIST_SESSION_STORAGE_KEY);
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const result: Record<string, boolean> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "boolean") {
				result[key] = value;
			}
		}
		return result;
	} catch {
		return {};
	}
}

/**
 * Persist target-user blacklist map into sessionStorage.
 * @param map - Mapping of normalized user names to blacklist flags.
 */
function writeSessionBlacklistMap(map: Record<string, boolean>): void {
	if (typeof window === "undefined" || !("sessionStorage" in window)) {
		return;
	}
	window.sessionStorage.setItem(REACTION_BLACKLIST_SESSION_STORAGE_KEY, JSON.stringify(map));
}

/**
 * Insert or replace `ujsReactionConfig` block in config page text.
 * @param source - Existing config page content.
 * @param blacklist - Blacklist flag to write.
 * @returns Updated page text.
 */
function upsertConfigBlock(source: string, blacklist: boolean): string {
	const nextBlock = buildConfigText(blacklist).trim();
	const assignmentRegex = new RegExp(`${REACTION_CONFIG_VAR}\\s*=\\s*\\{[\\s\\S]*?\\}\\s*;?`, "m");

	if (assignmentRegex.test(source)) {
		return source.replace(assignmentRegex, nextBlock);
	}

	const trimmed = source.trimEnd();
	if (!trimmed) {
		return `${nextBlock}\n`;
	}
	return `${trimmed}\n\n${nextBlock}\n`;
}

let persistChain: Promise<void> = Promise.resolve();

/**
 * Persist blacklist state to User:<username>/Reaction-config.js.
 * Requests are serialized to prevent edit collisions from rapid toggling.
 * @param blacklist - Whether reactions are blacklisted.
 */
export function persistReactionBlacklistToUserConfig(blacklist: boolean): void {
	const title = getUserConfigTitle();
	if (!title) {
		return;
	}

	persistChain = persistChain
		.catch(() => undefined)
		.then(async () => {
			try {
				const existing = await fetchPageWikitext(title);
				const nextText = upsertConfigBlock(existing ?? "", blacklist);
				await getApi().postWithToken("edit", {
					action: "edit",
					title,
					text: nextText,
					summary: `Update Reaction config: blacklist=${blacklist} ([[meta:Reaction|Reaction]])`,
				});
			} catch (error) {
				console.error("[Reaction] Failed to persist Reaction-config.js.", error);
				mw.notify(tReaction("api.notifications.save_failure"), { title: t("default.titles.error"), type: "error" });
			}
		});
}

/**
 * Resolve whether a target user blacklists reactions from others.
 * Result is cached in sessionStorage as user->boolean and deduplicated in-flight.
 * @param userName - Target user name.
 * @returns Whether the target user blacklists reactions.
 */
export function resolveReactionBlacklistForUser(
	userName: string,
	options?: { fresh?: boolean },
): Promise<boolean> {
	const normalizedUser = normalizeTitle(userName);
	if (!normalizedUser) {
		return Promise.resolve(false);
	}
	if (!options?.fresh) {
		const sessionMap = readSessionBlacklistMap();
		if (Object.prototype.hasOwnProperty.call(sessionMap, normalizedUser)) {
			return Promise.resolve(Boolean(sessionMap[normalizedUser]));
		}
	}
	const pending = blacklistLookupPromises.get(normalizedUser);
	if (pending) {
		return pending;
	}

	const lookupPromise = (async () => {
		try {
			const source = await fetchPageWikitext(getUserConfigTitleFor(normalizedUser));
			const blacklisted = source ? parseBlacklistFromConfigText(source) : false;
			const nextMap = readSessionBlacklistMap();
			nextMap[normalizedUser] = blacklisted;
			writeSessionBlacklistMap(nextMap);
			return blacklisted;
		} catch (error) {
			console.error("[Reaction] Failed to read target Reaction-config.js.", error);
			const nextMap = readSessionBlacklistMap();
			nextMap[normalizedUser] = false;
			writeSessionBlacklistMap(nextMap);
			return false;
		} finally {
			blacklistLookupPromises.delete(normalizedUser);
		}
	})();

	blacklistLookupPromises.set(normalizedUser, lookupPromise);
	return lookupPromise;
}

/**
 * Sync current user's blacklist state from User:<username>/Reaction-config.js.
 * Fresh lookup is used so startup reflects the actual user config page.
 */
export async function syncCurrentUserBlacklistFromUserConfig(): Promise<void> {
	if (!state.userName) {
		return;
	}
	const blacklisted = await resolveReactionBlacklistForUser(state.userName, { fresh: true });
	setReactionBlacklist(blacklisted);
}
