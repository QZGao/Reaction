import state from "./state";
import { escapeRegex, getCurrentChineseUtc } from "./utils";
import { t, tReaction } from "./i18n";

interface RevisionSlot {
	main: {
		"*": string;
	};
}

interface Revision {
	slots: RevisionSlot;
}

interface QueryPage {
	revisions: Revision[];
}

interface RetrieveFullTextResponse {
	query: {
		pageids: string[];
		pages: Record<string, QueryPage>;
	};
}

// MediaWiki API 實例
let apiInstance: mw.Api | null = null;

/**
 * 獲取 MediaWiki API 實例。
 * @returns {mw.Api} - MediaWiki API 實例。
 */
function getApi(): mw.Api {
	if (!apiInstance) {
		apiInstance = new mw.Api({
			ajax: {
				headers: { "User-Agent": `Reaction/${state.version}` }
			}
		});
	}
	return apiInstance;
}

export interface ModifyPageRequest {
	timestamp: string;
	upvote?: string;
	downvote?: string;
	append?: string;
	remove?: string;
}

interface ReactionParticipant {
	user: string;
	timestamp?: string;
}

interface ReactionTemplateData {
	icon: string;
	participants: ReactionParticipant[];
	extraParams: Array<{ key: string; value: string }>;
}

interface ReactionTemplateMatch {
	start: number;
	end: number;
	text: string;
	data: ReactionTemplateData;
}

function normalizeIcon(icon: string | undefined): string {
	return (icon ?? "").trim();
}

function parseLegacyParticipant(entry: string): ReactionParticipant {
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

function splitTemplateParameters(input: string): string[] {
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

function consumeIconParameter(params: string[]): { icon: string; positional: boolean } {
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

function parseReactionTemplateText(templateText: string): ReactionTemplateData | null {
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

	const indexes = Array.from(new Set([...Object.keys(userMap), ...Object.keys(timestampMap)].map(Number))).sort(
		(a, b) => a - b
	);
	indexes.forEach((index) => {
		const user = userMap[index];
		if (user) {
			participants.push({
				user,
				timestamp: timestampMap[index],
			});
		}
	});
	legacyEntries.forEach((legacy) => {
		const parsed = parseLegacyParticipant(legacy);
		if (parsed.user) {
			participants.push(parsed);
		}
	});

	return { icon, participants, extraParams };
}

function serializeReactionTemplate(data: ReactionTemplateData): string {
	const parts: string[] = ["{{Reaction", data.icon];
	data.extraParams.forEach(({ key, value }) => {
		parts.push(`${key}=${value}`);
	});
	data.participants.forEach((participant, index) => {
		const idx = index + 1;
		parts.push(`user${idx}=${participant.user}`);
		if (participant.timestamp) {
			parts.push(`ts${idx}=${participant.timestamp}`);
		}
	});
	parts.push("}}");
	return parts.join("|");
}

function findTemplateEnd(text: string, startIndex: number): number {
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

function findReactionTemplates(line: string): ReactionTemplateMatch[] {
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

function replaceRange(line: string, start: number, end: number, replacement: string): string {
	return line.slice(0, start) + replacement + line.slice(end);
}

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

function findTemplateByIcon(templates: ReactionTemplateMatch[], icon: string | undefined): ReactionTemplateMatch | undefined {
	if (!icon) {
		return undefined;
	}
	const normalized = normalizeIcon(icon);
	return templates.find((template) => normalizeIcon(template.data.icon) === normalized);
}

function removeReactionFromLine(line: string, icon: string | undefined, userName: string | null): { text: string; modified: boolean } {
	if (!icon || !userName) {
		return { text: line, modified: false };
	}
	const templates = findReactionTemplates(line);
	const target = findTemplateByIcon(templates, icon);
	if (!target) {
		return { text: line, modified: false };
	}
	const index = target.data.participants.findIndex((participant) => participant.user === userName);
	if (index === -1) {
		return { text: line, modified: false };
	}
	target.data.participants.splice(index, 1);
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

function addReactionToLine(
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

function appendReactionTemplate(
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

/**
 * 獲取完整的wikitext。
 * @returns {Promise<string>} 包含完整wikitext的Promise。
 */
async function retrieveFullText(): Promise<string> {
	const response = await getApi().get({
		action: "query",
		titles: state.pageName,
		prop: "revisions",
		rvslots: "*",
		rvprop: "content",
		indexpageids: 1,
	}) as RetrieveFullTextResponse;
	const pageId = response.query.pageids[0];
	const page = response.query.pages[pageId];
	const revision = page?.revisions?.[0];
	const fulltext = revision?.slots?.main?.["*"] ?? "";
	return `${fulltext}\n`;
}

/**
 * 儲存完整的wikitext。
 * @param fulltext {string} - 完整的wikitext。
 * @param summary {string} - 編輯摘要。
 * @returns {Promise<boolean>} - 操作成功與否的Promise。
 */
async function saveFullText(fulltext: string, summary: string): Promise<boolean> {
	try {
		await getApi().postWithToken("edit", {
			action: "edit",
			title: state.pageName,
			text: fulltext,
			summary: summary + " ([[User:SuperGrey/gadgets/Reaction|Reaction]])",
		});
		mw.notify(tReaction("api.notifications.save_success"), {
			title: t("api.titles.success"), type: "success",
		});
		return true;
	} catch (error) {
		console.error(error);
		mw.notify(tReaction("api.notifications.save_failure"), { title: t("api.titles.error"), type: "error" });
		return false;
	}
}


/**
 * 修改頁面內容。
 * @param mod {Object} - 修改內容的物件，包含時間戳（timestamp）、要添加或刪除的反應等（upvote、downvote、append、remove）。
 * @returns {Promise<boolean>} - 操作成功與否的Promise。
 */
export async function modifyPage(mod: ModifyPageRequest): Promise<boolean> {
	let fulltext: string;
	try {
		fulltext = await retrieveFullText();
	} catch (error) {
		console.error(error);
		mw.notify(tReaction("api.notifications.fetch_failure"), { title: t("api.titles.error"), type: "error" });
		return false;
	}

	let newFulltext = fulltext;
	let summary = "";
	try {
		let timestampRegex = new RegExp(`${escapeRegex(mod.timestamp)}`, "g");
		let timestampMatch = fulltext.match(timestampRegex);

		// If the timestamp is not found, throw an error
		if (!timestampMatch || timestampMatch.length === 0) {
			console.log("[Reaction] Unable to find timestamp " + mod.timestamp + " in: " + fulltext);
			throw new Error(tReaction("api.errors.timestamp_missing", [mod.timestamp]));
		}

		// Check if more than one match is found.
		if (timestampMatch.length > 1) {
			console.log("[Reaction] More than one timestamp found: " + timestampMatch.join(", "));
			throw new Error(tReaction("api.errors.timestamp_conflict", [mod.timestamp]));
		}

		let pos = fulltext.search(timestampRegex);
		console.log("[Reaction] Found timestamp " + mod.timestamp + " at position " + pos);

		let lineEnd = fulltext.indexOf("\n", pos);
		if (lineEnd === -1) {
			lineEnd = fulltext.length;
		}
		let timestamp2LineEnd = fulltext.slice(pos, lineEnd);

		if (mod.remove) {
			const result = removeReactionFromLine(timestamp2LineEnd, mod.remove, state.userName);
			timestamp2LineEnd = result.text;
			if (result.modified) {
				summary = "− " + mod.remove;
			}
		} else if (mod.downvote) {
			const result = removeReactionFromLine(timestamp2LineEnd, mod.downvote, state.userName);
			timestamp2LineEnd = result.text;
			if (result.modified) {
				summary = "− " + mod.downvote;
			}
		} else if (mod.upvote) {
			const result = addReactionToLine(timestamp2LineEnd, mod.upvote, state.userName, getCurrentChineseUtc());
			timestamp2LineEnd = result.text;
			if (result.modified) {
				summary = "+ " + mod.upvote;
			}
		} else if (mod.append) {
			const result = appendReactionTemplate(timestamp2LineEnd, mod.append, state.userName, getCurrentChineseUtc());
			if (!result.modified) {
				console.log("[Reaction] Reaction of " + mod.append + " already exists in: " + timestamp2LineEnd);
				throw new Error(tReaction("api.errors.reaction_exists"));
			}
			timestamp2LineEnd = result.text;
			summary = "+ " + mod.append;
		}

		newFulltext = fulltext.slice(0, pos) + timestamp2LineEnd + fulltext.slice(lineEnd);

		if (newFulltext === fulltext) {
			console.log("[Reaction] Nothing is modified. Could be because using a template inside {{Reaction}}.");
			throw new Error(tReaction("api.errors.no_changes"));
		}

		// 儲存全文。錯誤資訊已在函式內處理。
		return await saveFullText(newFulltext, summary);

	} catch (error: unknown) {
		console.error(error);
		const message = error instanceof Error ? error.message : String(error);
		mw.notify(message, { title: t("api.titles.error"), type: "error" });
		return false;
	}
}
