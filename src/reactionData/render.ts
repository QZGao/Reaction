import { parseWikitextToHtml } from "../api/client";
import { serializeReactionTemplate, type ReactionTemplateData } from "../wikitext/reactionTemplates";
import type { ReactionEntry } from "./store";

/**
 * Convert a reaction entry to deterministic Reaction template wikitext.
 * @param entry - Reaction entry.
 * @returns Wikitext representation for parse API.
 */
export function reactionEntryToWikitext(entry: ReactionEntry): string {
	const templates: string[] = [];
	const icons = Object.keys(entry).sort((a, b) => a.localeCompare(b));
	icons.forEach((icon) => {
		const participants = entry[icon] ?? [];
		if (participants.length === 0) {
			return;
		}
		const data: ReactionTemplateData = {
			icon,
			participants: participants.map((participant) => ({
				user: participant.user,
				timestamp: participant.timestamp,
			})),
			extraParams: [],
		};
		templates.push(serializeReactionTemplate(data));
	});
	return templates.join(" ");
}

/**
 * Parse HTML response and extract reaction button elements.
 * @param html - Parse API HTML payload.
 * @returns Array of reaction button nodes.
 */
function extractReactionButtonsFromHtml(html: string): HTMLElement[] {
	const container = document.createElement("div");
	container.innerHTML = html;
	const nodes = Array.from(container.querySelectorAll<HTMLElement>(".template-reaction[data-reaction-commentors]"));
	return nodes.map((node) => node.cloneNode(true) as HTMLElement);
}

/**
 * Render a reaction entry into reaction button elements using parse API.
 * @param entry - Reaction entry.
 * @param titleContext - Optional title context for parser.
 * @returns Reaction button nodes.
 */
export async function renderReactionEntryButtons(
	entry: ReactionEntry,
	titleContext?: string,
): Promise<HTMLElement[]> {
	const wikitext = reactionEntryToWikitext(entry);
	if (!wikitext.trim()) {
		return [];
	}
	const html = await parseWikitextToHtml(wikitext, titleContext);
	return extractReactionButtonsFromHtml(html);
}

