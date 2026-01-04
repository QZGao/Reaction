import { describe, it, expect, beforeAll } from "vitest";

import { findCommentPosition } from "../../src/wikitext/comments";

interface MwMock {
	config: {
		get: (key: string) => unknown;
	};
	msg: (key: string) => string;
}

declare global {
	var mw: MwMock | undefined;
}

beforeAll(() => {
	const namespaceMap = {
		user: 2,
		user_talk: 3,
		special: -1,
		u: 2,
		ut: 3,
	};
	globalThis.mw = {
		config: {
			get: (key: string) => (key === "wgNamespaceIds" ? namespaceMap : undefined),
		},
		msg: (key: string) => {
			if (key === "contributions") {
				return "Contributions";
			}
			return key;
		},
	};
});

describe("wikitext comment locator", () => {
	const sample = [
		"Intro text without signature 10:00, 1 January 2024 (UTC)",
		"First comment. [[User:Alpha|Alpha]] ([[User talk:Alpha|talk]]) 12:21, 31 December 2025 (UTC)",
		"Second comment. [[User:Beta|Beta]] ([[User talk:Beta|talk]]) 12:21, 31 December 2025 (UTC)",
	].join("\n\n");
	const repeated = [
		"Example comment. [[User:Gamma|Gamma]] ([[User talk:Gamma|talk]]) 15:00, 1 January 2024 (UTC)",
		"Another example. [[User:Gamma|Gamma]] ([[User talk:Gamma|talk]]) 15:00, 1 January 2024 (UTC)",
	].join("\n\n");

	it("finds the matching occurrence using author", () => {
		const pos1 = findCommentPosition(sample, "12:21, 31 December 2025 (UTC)", "Alpha");
		const pos2 = findCommentPosition(sample, "12:21, 31 December 2025 (UTC)", "Beta");
		expect(pos1.position).not.toBeNull();
		expect(pos2.position).not.toBeNull();
		expect(pos1.position).not.toBe(pos2.position);
		expect(pos1.position ?? 0).toBeGreaterThan(sample.indexOf("First comment"));
		expect(pos2.position ?? 0).toBeGreaterThan(sample.indexOf("Second comment"));
	});

	it("ignores matches without nearby signatures", () => {
		const pos = findCommentPosition(sample, "10:00, 1 January 2024 (UTC)");
		expect(pos.position).toBeNull();
		expect(pos.reason).toMatch(/no recognizable user links/i);
	});

	it("respects occurrence index when selecting duplicate timestamps", () => {
		const first = findCommentPosition(repeated, "15:00, 1 January 2024 (UTC)", null, 0);
		const second = findCommentPosition(repeated, "15:00, 1 January 2024 (UTC)", null, 1);
		expect(first.position).not.toBeNull();
		expect(second.position).not.toBeNull();
		expect(first.position).not.toBe(second.position);
		expect((first.position ?? 0)).toBeLessThan(second.position ?? 0);
	});
});
