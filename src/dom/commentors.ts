import { t } from "../i18n";

/**
 * Structured representation of a reaction participant entry.
 */
export interface ReactionCommentorEntry {
	user: string;
	timestamp?: string;
}

/**
 * Parse a legacy commentor string into a structured entry.
 * @param entry - Raw legacy string such as "User於Timestamp".
 * @returns Structured entry with user and optional timestamp.
 */
export function parseLegacyCommentor(entry: string): ReactionCommentorEntry {
	const trimmed = entry.trim();
	if (!trimmed) {
		return { user: "" };
	}
	const match = trimmed.match(/^(.*?)[於于]\s*(.+)$/);
	if (match) {
		return {
			user: match[1].trim(),
			timestamp: match[2].trim(),
		};
	}
	return { user: trimmed };
}

/**
 * Format a structured commentor entry back to the legacy string form.
 * @param entry - Structured entry.
 * @returns Legacy string representation.
 */
export function formatLegacyCommentor(entry: ReactionCommentorEntry): string {
	return entry.timestamp ? `${entry.user}於${entry.timestamp}` : entry.user;
}

/**
 * Format an entry for tooltip display using localization.
 * @param entry - Structured entry.
 * @returns Tooltip-ready string.
 */
export function formatReactionTitleEntry(entry: ReactionCommentorEntry): string {
	if (entry.timestamp) {
		return t("dom.reactions.comment_stamp", [entry.user, entry.timestamp]);
	}
	return entry.user;
}

/**
 * Build the tooltip title for a reaction button.
 * @param entries - List of structured entries.
 * @returns Localized tooltip string.
 */
export function buildReactionTitle(entries: ReactionCommentorEntry[]): string {
	if (entries.length === 0) {
		return t("dom.tooltips.no_reactions");
	}
	const list = entries.map((entry) => formatReactionTitleEntry(entry)).join(t("dom.reactions.list_separator"));
	return t("dom.tooltips.reacted_to_comment", [list]);
}

/**
 * Parse a JSON-encoded list of commentor entries.
 * @param json - JSON string from the DOM attribute.
 * @returns Structured entries or null if parsing fails.
 */
export function parseCommentorJson(json: string | null): ReactionCommentorEntry[] | null {
	if (!json) {
		return null;
	}
	try {
		const parsed = JSON.parse(json) as unknown;
		if (Array.isArray(parsed)) {
			const entries: ReactionCommentorEntry[] = [];
			parsed.forEach((item) => {
				if (item && typeof item === "object") {
					const record = item as { user?: unknown; timestamp?: unknown };
					if (typeof record.user === "string") {
						entries.push({
							user: record.user,
							timestamp: typeof record.timestamp === "string" && record.timestamp ? record.timestamp : undefined,
						});
					}
				}
			});
			return entries;
		}
	} catch {
		// ignore malformed data
	}
	return null;
}

/**
 * Retrieve reaction participants from a button element, falling back to legacy attributes.
 * @param button - Reaction button element.
 * @returns Structured list of entries.
 */
export function getReactionCommentors(button: HTMLElement): ReactionCommentorEntry[] {
	const jsonEntries = parseCommentorJson(button.getAttribute("data-reaction-commentors-json"));
	if (jsonEntries && jsonEntries.length > 0) {
		return jsonEntries;
	}
	const raw = button.getAttribute("data-reaction-commentors");
	if (!raw) {
		return [];
	}
	return raw.split("/").map(parseLegacyCommentor).filter((entry) => entry.user);
}

/**
 * Persist reaction participant entries back to DOM data attributes.
 * @param button - Reaction button element.
 * @param entries - Structured entries to store.
 */
export function setReactionCommentors(button: HTMLElement, entries: ReactionCommentorEntry[]): void {
	if (entries.length === 0) {
		button.removeAttribute("data-reaction-commentors");
		button.removeAttribute("data-reaction-commentors-json");
		button.setAttribute("title", buildReactionTitle(entries));
		return;
	}
	button.setAttribute("data-reaction-commentors-json", JSON.stringify(entries));
	button.setAttribute("data-reaction-commentors", entries.map(formatLegacyCommentor).join("/"));
	button.setAttribute("title", buildReactionTitle(entries));
}

/**
 * Determine whether the given user already reacted.
 * @param entries - Structured entries.
 * @param userName - Target user name.
 * @returns True if the user is present.
 */
export function hasUserReacted(entries: ReactionCommentorEntry[], userName: string | null): boolean {
	if (!userName) {
		return false;
	}
	return entries.some((entry) => entry.user === userName);
}

/**
 * Remove a user's entry from the participant list.
 * @param entries - Structured entries.
 * @param userName - User name to remove.
 * @returns Updated entries list.
 */
export function removeUserFromEntries(entries: ReactionCommentorEntry[], userName: string | null): ReactionCommentorEntry[] {
	if (!userName) {
		return entries;
	}
	const index = entries.findIndex((entry) => entry.user === userName);
	if (index === -1) {
		return entries;
	}
	const updated = entries.slice();
	updated.splice(index, 1);
	return updated;
}
