/**
 * Structured representation of a reaction participant.
 */
export interface ReactionParticipant {
	user: string;
	timestamp?: string;
}

/**
 * Structured data extracted from a Reaction template.
 */
export interface ReactionTemplateData {
	icon: string;
	participants: ReactionParticipant[];
	extraParams: Array<{ key: string; value: string }>;
}

/**
 * Reaction template match information when scanning wikitext.
 */
export interface ReactionTemplateMatch {
	start: number;
	end: number;
	text: string;
	data: ReactionTemplateData;
}

/**
 * Normalize an icon string by trimming whitespace.
 * @param icon - Raw icon string.
 * @returns Normalized icon string.
 */
export function normalizeIcon(icon: string | undefined): string {
	return (icon ?? "").trim();
}

/**
 * Parse a legacy participant entry.
 * @param entry - Raw participant string.
 * @returns Parsed ReactionParticipant object.
 */
export function parseLegacyParticipant(entry: string): ReactionParticipant {
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
 * Split template parameters while respecting nested structures.
 * @param input - Raw template parameter string.
 * @returns Array of individual parameter strings.
 */
export function splitTemplateParameters(input: string): string[] {
	const parts: string[] = [];
	let current = "";
	let braceDepth = 0;
	let bracketDepth = 0;
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		const next = input[i + 1];
		if (char === "{" && next === "{") {
			braceDepth++;
			current += "{{";
			i++;
			continue;
		}
		if (char === "}" && next === "}") {
			if (braceDepth > 0) {
				braceDepth--;
			}
			current += "}}";
			i++;
			continue;
		}
		if (char === "[" && next === "[") {
			bracketDepth++;
			current += "[[";
			i++;
			continue;
		}
		if (char === "]" && next === "]") {
			if (bracketDepth > 0) {
				bracketDepth--;
			}
			current += "]]";
			i++;
			continue;
		}
		if (char === "|" && braceDepth === 0 && bracketDepth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

/**
 * Consume the icon parameter from a list of template parameters.
 * @param params - Array of template parameter strings.
 * @returns Object containing the icon value and whether it was positional.
 */
export function consumeIconParameter(params: string[]): { icon: string; positional: boolean } {
	if (params.length === 0) {
		return { icon: "", positional: false };
	}
	const first = params[0]?.trim() ?? "";
	if (first === "") {
		params.shift();
		return { icon: "", positional: true };
	}
	const eqIndex = first.indexOf("=");
	if (eqIndex === -1) {
		params.shift();
		return { icon: first, positional: true };
	}
	const key = first.slice(0, eqIndex).trim().toLowerCase();
	if (key === "icon") {
		const value = first.slice(eqIndex + 1).trim();
		params.shift();
		return { icon: value, positional: false };
	}
	for (let i = 1; i < params.length; i++) {
		const candidate = params[i]?.trim() ?? "";
		if (!candidate) {
			continue;
		}
		const candidateEq = candidate.indexOf("=");
		if (candidateEq === -1) {
			continue;
		}
		const candidateKey = candidate.slice(0, candidateEq).trim().toLowerCase();
		if (candidateKey === "icon") {
			const value = candidate.slice(candidateEq + 1).trim();
			params.splice(i, 1);
			return { icon: value, positional: false };
		}
	}
	return { icon: "", positional: false };
}

/**
 * Parse a Reaction template text into structured data.
 * @param templateText - Raw template text.
 * @returns Parsed ReactionTemplateData or null if invalid.
 */
export function parseReactionTemplateText(templateText: string): ReactionTemplateData | null {
	const trimmed = templateText.trim();
	if (!trimmed.startsWith("{{") || !trimmed.endsWith("}}")) {
		return null;
	}
	const inner = trimmed.slice(2, -2);
	const params = splitTemplateParameters(inner);
	if (params.length === 0) {
		return null;
	}
	const templateName = params.shift()?.trim().toLowerCase() ?? "";
	if (templateName !== "reaction" && templateName !== "react") {
		return null;
	}
	const { icon: rawIcon, positional: iconConsumesPositionalSlot } = consumeIconParameter(params);
	const icon = rawIcon.trim();
	const participants: ReactionParticipant[] = [];
	const extraParams: Array<{ key: string; value: string }> = [];
	const userMap: Record<number, string> = {};
	const timestampMap: Record<number, string> = {};
	const legacyEntries: string[] = [];

	params.forEach((param) => {
		const trimmedParam = param.trim();
		if (!trimmedParam) {
			return;
		}
		const eqIndex = trimmedParam.indexOf("=");
		if (eqIndex > -1) {
			const key = trimmedParam.slice(0, eqIndex).trim();
			const value = trimmedParam.slice(eqIndex + 1).trim();
			const userMatch = key.match(/^user(\d+)$/i);
			if (userMatch) {
				userMap[Number(userMatch[1])] = value;
				return;
			}
			const numericMatch = key.match(/^\d+$/);
			if (numericMatch) {
				const numericIndex = Number(numericMatch[0]);
				const participantIndex = iconConsumesPositionalSlot ? numericIndex - 1 : numericIndex;
				if (participantIndex >= 1 && userMap[participantIndex] == null) {
					userMap[participantIndex] = value;
				}
				return;
			}
			const tsMatch = key.match(/^(?:ts|timestamp)(\d*)$/i);
			if (tsMatch) {
				const rawIndex = tsMatch[1];
				const targetIndex = rawIndex ? Number(rawIndex) : 1;
				timestampMap[targetIndex] = value;
				return;
			}
			extraParams.push({ key, value });
		} else {
			legacyEntries.push(trimmedParam);
		}
	});

	if (legacyEntries.length > 0) {
		const usedIndexes = new Set<number>(Object.keys(userMap).map(Number));
		let nextIndex = 1;
		legacyEntries.forEach((legacy) => {
			const parsed = parseLegacyParticipant(legacy);
			if (!parsed.user) {
				return;
			}
			while (usedIndexes.has(nextIndex)) {
				nextIndex++;
			}
			userMap[nextIndex] = parsed.user;
			if (parsed.timestamp && timestampMap[nextIndex] == null) {
				timestampMap[nextIndex] = parsed.timestamp;
			}
			usedIndexes.add(nextIndex);
			nextIndex++;
		});
	}

	const indexes = Array.from(new Set([...Object.keys(userMap), ...Object.keys(timestampMap)].map(Number))).sort((a, b) => a - b);
	indexes.forEach((index) => {
		const user = userMap[index];
		if (user) {
			participants.push({
				user,
				timestamp: timestampMap[index],
			});
		}
	});

	return { icon, participants, extraParams };
}

/**
 * Serialize ReactionTemplateData back into template text.
 * @param data - Structured ReactionTemplateData.
 * @returns Serialized template text.
 */
export function serializeReactionTemplate(data: ReactionTemplateData): string {
	const params: string[] = [];
	const icon = data.icon.trim();
	if (icon) {
		params.push(`icon=${icon}`);
	}
	data.extraParams.forEach(({ key, value }) => {
		params.push(`${key}=${value}`);
	});
	data.participants.forEach((participant, index) => {
		const idx = index + 1;
		params.push(`user${idx}=${participant.user}`);
		if (participant.timestamp) {
			params.push(`ts${idx}=${participant.timestamp}`);
		}
	});
	const serializedParams = params.join("|");
	return `{{Reaction${serializedParams ? `|${serializedParams}` : ""}}}`;
}

/**
 * Find the end index of a template starting from a given position.
 * @param text - Full text.
 * @param startIndex - Starting index of the template (position of "{{").
 * @returns Index of the character after the closing "}}" or -1 if not found.
 */
export function findTemplateEnd(text: string, startIndex: number): number {
	let depth = 0;
	for (let i = startIndex; i < text.length - 1; i++) {
		const pair = text.slice(i, i + 2);
		if (pair === "{{") {
			depth++;
			i++;
			continue;
		}
		if (pair === "}}") {
			depth--;
			i++;
			if (depth === 0) {
				return i + 1;
			}
		}
	}
	return -1;
}

/**
 * Find all Reaction templates in a line of text.
 * @param line - Line of text.
 * @returns Array of ReactionTemplateMatch objects.
 */
export function findReactionTemplates(line: string): ReactionTemplateMatch[] {
	const matches: ReactionTemplateMatch[] = [];
	let index = 0;
	while (index < line.length) {
		const openIndex = line.indexOf("{{", index);
		if (openIndex === -1) {
			break;
		}
		const prefix = line.slice(openIndex);
		if (!/^\{\{\s*[Rr]eact(?:ion|)\b/.test(prefix)) {
			index = openIndex + 2;
			continue;
		}
		const endIndex = findTemplateEnd(line, openIndex);
		if (endIndex === -1) {
			break;
		}
		const raw = line.slice(openIndex, endIndex);
		const data = parseReactionTemplateText(raw);
		if (data) {
			matches.push({ start: openIndex, end: endIndex, text: raw, data });
		}
		index = endIndex;
	}
	return matches;
}

/**
 * Replace a range of text in a line with a replacement string.
 * @param line - Line of text.
 * @param start - Start index of the range to replace.
 * @param end - End index of the range to replace.
 * @param replacement - Replacement string.
 * @returns Modified line of text.
 */
function replaceRange(line: string, start: number, end: number, replacement: string): string {
	return line.slice(0, start) + replacement + line.slice(end);
}

/**
 * Remove a Reaction template from a line of text, adjusting surrounding spaces.
 * @param line - Line of text.
 * @param start - Start index of the template.
 * @param end - End index of the template.
 * @returns Modified line of text.
 */
function removeTemplateFromLine(line: string, start: number, end: number): string {
	let before = line.slice(0, start);
	let after = line.slice(end);
	const trailingSpaces = before.match(/[ \t]+$/);
	if (trailingSpaces) {
		before = before.slice(0, -trailingSpaces[0].length);
	}
	const leadingSpaces = after.match(/^[ \t]+/);
	if (leadingSpaces) {
		after = after.slice(leadingSpaces[0].length);
	}
	const needsSpace = before.length > 0 && after.length > 0 && !before.endsWith(" ") && !after.startsWith(" ");
	return before + (needsSpace ? " " : "") + after;
}

/**
 * Find a Reaction template by its icon.
 * @param templates - Array of ReactionTemplateMatch objects.
 * @param icon - Icon string to search for.
 * @returns Matching ReactionTemplateMatch or undefined if not found.
 */
export function findTemplateByIcon(templates: ReactionTemplateMatch[], icon: string | undefined): ReactionTemplateMatch | undefined {
	if (!icon) {
		return undefined;
	}
	const normalized = normalizeIcon(icon);
	return templates.find((template) => normalizeIcon(template.data.icon) === normalized);
}

/**
 * Remove a reaction from a line of text.
 * @param line - Line of text.
 * @param icon - Icon string of the reaction to remove.
 * @param userName - User name of the participant to remove.
 * @returns Object containing modified text and whether a change was made.
 */
export function removeReactionFromLine(line: string, icon: string | undefined, userName: string | null): { text: string; modified: boolean } {
	if (!icon || !userName) {
		return { text: line, modified: false };
	}
	const templates = findReactionTemplates(line);
	const target = findTemplateByIcon(templates, icon);
	if (!target) {
		return { text: line, modified: false };
	}
	const originalLength = target.data.participants.length;
	target.data.participants = target.data.participants.filter((participant) => participant.user !== userName);
	if (target.data.participants.length === originalLength) {
		return { text: line, modified: false };
	}
	if (target.data.participants.length === 0) {
		return {
			text: removeTemplateFromLine(line, target.start, target.end),
			modified: true,
		};
	}
	const serialized = serializeReactionTemplate(target.data);
	return {
		text: replaceRange(line, target.start, target.end, serialized),
		modified: true,
	};
}

/**
 * Add a reaction to a line of text.
 * @param line - Line of text.
 * @param icon - Icon string of the reaction to add.
 * @param userName - User name of the participant to add.
 * @param timestamp - Timestamp string for the participant.
 * @returns Object containing modified text and whether a change was made.
 */
export function addReactionToLine(
	line: string,
	icon: string | undefined,
	userName: string | null,
	timestamp: string
): { text: string; modified: boolean } {
	if (!icon || !userName) {
		return { text: line, modified: false };
	}
	const templates = findReactionTemplates(line);
	const target = findTemplateByIcon(templates, icon);
	if (!target) {
		return { text: line, modified: false };
	}
	if (target.data.participants.some((participant) => participant.user === userName)) {
		return { text: line, modified: false };
	}
	target.data.participants.push({ user: userName, timestamp });
	const serialized = serializeReactionTemplate(target.data);
	return {
		text: replaceRange(line, target.start, target.end, serialized),
		modified: true,
	};
}

/**
 * Append a new Reaction template to a line of text.
 * @param line - Line of text.
 * @param icon - Icon string of the reaction to append.
 * @param userName - User name of the participant to add.
 * @param timestamp - Timestamp string for the participant.
 * @returns Object containing modified text and whether a change was made.
 */
export function appendReactionTemplate(
	line: string,
	icon: string | undefined,
	userName: string | null,
	timestamp: string
): { text: string; modified: boolean } {
	if (!icon || !userName) {
		return { text: line, modified: false };
	}
	const templates = findReactionTemplates(line);
	if (findTemplateByIcon(templates, icon)) {
		return { text: line, modified: false };
	}
	const template: ReactionTemplateData = {
		icon: icon.trim(),
		participants: [{ user: userName, timestamp }],
		extraParams: [],
	};
	const serialized = serializeReactionTemplate(template);
	const needsSpace = line.length > 0 && !/\s$/.test(line);
	return {
		text: `${line}${needsSpace ? " " : ""}${serialized}`,
		modified: true,
	};
}
