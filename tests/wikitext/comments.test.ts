import { describe, it, expect } from "vitest";

import { findCommentPosition } from "../../src/wikitext/comments";

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
		expect(pos1).not.toBeNull();
		expect(pos2).not.toBeNull();
		expect(pos1).not.toBe(pos2);
		expect(pos1).toBeGreaterThan(sample.indexOf("First comment"));
		expect(pos2).toBeGreaterThan(sample.indexOf("Second comment"));
	});

	it("ignores matches without nearby signatures", () => {
		const pos = findCommentPosition(sample, "10:00, 1 January 2024 (UTC)");
		expect(pos).toBeNull();
	});

	it("respects occurrence index when selecting duplicate timestamps", () => {
		const first = findCommentPosition(repeated, "15:00, 1 January 2024 (UTC)", null, 0);
		const second = findCommentPosition(repeated, "15:00, 1 January 2024 (UTC)", null, 1);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(first).not.toBe(second);
		expect(first).toBeLessThan(second ?? 0);
	});
});
