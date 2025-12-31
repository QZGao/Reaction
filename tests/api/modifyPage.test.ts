import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

const mockMw = {
	config: {
		get: (key: string) => {
			if (key === "wgUserName") {
				return "TestUser";
			}
			return undefined;
		},
	},
	notify: vi.fn(),
};

vi.stubGlobal("mw", mockMw);

let state: typeof import("../../src/state").default;
let applyPageModification: typeof import("../../src/api/modifyPage").applyPageModification;

import * as i18n from "../../src/i18n";

vi.mock("../../src/utils", () => ({
	escapeRegex: (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
	getCurrentSignatureTimestamp: () => "14:00, 1 January 2024 (UTC)",
}));

vi.mock("../../src/i18n", () => {
	const actual = vi.importActual<typeof i18n>("../../src/i18n");
	return {
		...actual,
		t: vi.fn().mockImplementation((key: string) => key),
		tReaction: vi.fn().mockImplementation((key: string) => key),
	};
});

beforeAll(async () => {
	state = (await import("../../src/state")).default;
	const module = await import("../../src/api/modifyPage");
	applyPageModification = module.applyPageModification;
});

describe("applyPageModification", () => {
	beforeEach(() => {
		state.userName = "TestUser";
	});

	it("upvotes a reaction on a matching line", () => {
		// Expected to upvote 👍 with TestUser, 14:00, 1 January 2024 (UTC)
		// with reformatted Reaction template.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`;
		const result = applyPageModification(base, {
			timestamp: "12:21, 31 December 2025 (UTC)",
			upvote: "👍",
		});
		expect(result.summary).toBe("+ 👍");
		expect(result.fulltext).toContain("{{Reaction|icon=👍|user1=Example|ts1=12:30, 31 December 2025 (UTC)|user2=TestUser|ts2=14:00, 1 January 2024 (UTC)}}");
		expect(result.fulltext).toContain("{{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}");

		// Expected to upvote 😄 with TestUser, 14:00, 1 January 2024 (UTC)
		// with reformatted Reaction template.
		const result2 = applyPageModification(result.fulltext, {
			timestamp: "12:21, 31 December 2025 (UTC)",
			upvote: "😄",
		});
		expect(result2.summary).toBe("+ 😄");
		expect(result2.fulltext).toContain("{{Reaction|icon=👍|user1=Example|ts1=12:30, 31 December 2025 (UTC)|user2=TestUser|ts2=14:00, 1 January 2024 (UTC)}}");
		expect(result2.fulltext).toContain("{{Reaction|icon=😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)|user2=TestUser|ts2=14:00, 1 January 2024 (UTC)}}");
	});

	it("upvotes a reaction that does not exist yet on a matching line", () => {
		// Expected to error when trying to upvote ❤️ which does not exist yet.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`;
		expect(() =>
			applyPageModification(base, {
				timestamp: "12:21, 31 December 2025 (UTC)",
				upvote: "❤️",
			}),
		).toThrow("api.errors.no_changes");
	});

	it("downvotes a reaction on a matching line", () => {
		// Expected to downvote 👍 with TestUser,
		// leaving reformatted Reaction template.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)|TestUser|ts2=11:00, 1 January 2024 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`;
		const result = applyPageModification(base, {
			timestamp: "12:21, 31 December 2025 (UTC)",
			remove: "👍",
		});
		expect(result.summary).toBe("− 👍");
		expect(result.fulltext).not.toContain("TestUser");
		expect(result.fulltext).not.toContain("11:00, 1 January 2024 (UTC)");
		expect(result.fulltext).toContain("{{Reaction|icon=👍|user1=Example|ts1=12:30, 31 December 2025 (UTC)}}");
		expect(result.fulltext).toContain("{{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}");

		// There are two 👍 reactions present with TestUser.
		// Expected to remove both of them from the Reaction template,
		// leaving reformatted Reaction template.
		const base2 = `User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)|TestUser|ts2=11:00, 1 January 2024 (UTC)|user3=TestUser|ts3=13:00, 1 January 2024 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`
		const result2 = applyPageModification(base2, {
			timestamp: "12:21, 31 December 2025 (UTC)",
			remove: "👍",
		});
		expect(result2.summary).toBe("− 👍");
		expect(result2.fulltext).not.toContain("TestUser");
		expect(result2.fulltext).not.toContain("11:00, 1 January 2024 (UTC)");
		expect(result2.fulltext).not.toContain("13:00, 1 January 2024 (UTC)");
		expect(result2.fulltext).toContain("{{Reaction|icon=👍|user1=Example|ts1=12:30, 31 December 2025 (UTC)}}");
		expect(result2.fulltext).toContain("{{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}");
	});

	it("downvotes a reaction that does not exist on a matching line", () => {
		// Expected to error when trying to downvote ❤️ which does not exist.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`;
		expect(() =>
			applyPageModification(base, {
				timestamp: "12:21, 31 December 2025 (UTC)",
				downvote: "❤️",
			}),
		).toThrow("api.errors.no_changes");
	});

	it("appends a reaction to a matching line", () => {
		// Expected to append ❤️ with TestUser, 14:00, 1 January 2024 (UTC)
		// as a new Reaction template.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`;
		const result = applyPageModification(base, {
			timestamp: "12:21, 31 December 2025 (UTC)",
			append: "❤️",
		});
		expect(result.summary).toBe("+ ❤️");
		expect(result.fulltext).toContain("{{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)}}");
		expect(result.fulltext).toContain("{{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}");
		expect(result.fulltext).toContain("{{Reaction|icon=❤️|user1=TestUser|ts1=14:00, 1 January 2024 (UTC)}}");
	});

	it("appends a reaction that already exists on a matching line", () => {
		// Expected to error when trying to append 👍 which already exists.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`;
		expect(() =>
			applyPageModification(base, {
				timestamp: "12:21, 31 December 2025 (UTC)",
				append: "👍",
			}),
		).toThrow("api.errors.reaction_exists");

		// Expected to error when trying to append 😄 which already exists.
		expect(() =>
			applyPageModification(base, {
				timestamp: "12:21, 31 December 2025 (UTC)",
				append: "😄",
			}),
		).toThrow("api.errors.reaction_exists");
	});

	it("removes a reaction on a matching line", () => {
		// Expected to remove entire 👍 Reaction template with TestUser,
		// leaving other Reaction template intact.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|TestUser|ts=12:30, 31 December 2025 (UTC)}} {{Reaction|😄|user1=TestUser|ts1=12:42, 31 December 2025 (UTC)}}`;
		const result = applyPageModification(base, {
			timestamp: "12:21, 31 December 2025 (UTC)",
			downvote: "👍",
		});
		expect(result.summary).toBe("− 👍");
		expect(result.fulltext).toContain("{{Reaction|😄|user1=TestUser|ts1=12:42, 31 December 2025 (UTC)}}");
		expect(result.fulltext).not.toContain("👍");
		expect(result.fulltext).not.toContain("12:30, 31 December 2025 (UTC)");

		// Expected to remove entire 😄 Reaction template with TestUser
		// as it's the last reaction left.
		const result2 = applyPageModification(result.fulltext, {
			timestamp: "12:21, 31 December 2025 (UTC)",
			downvote: "😄",
		});
		expect(result2.summary).toBe("− 😄");
		expect(result2.fulltext).not.toContain("{{Reaction");
		expect(result2.fulltext).not.toContain("😄");
		expect(result2.fulltext).not.toContain("TestUser");
		expect(result2.fulltext).not.toContain("12:42, 31 December 2025 (UTC)");
	});

	it("removes a reaction that does not exist on a matching line", () => {
		// Expected to error when trying to remove ❤️ which does not exist.
		const base =
			`User script test. [[User:SuperGrey|'''<span style="color:#765CAE">Super</span><span style="color:#525252">Grey</span>''']] ([[User talk:SuperGrey|talk]]) 12:21, 31 December 2025 (UTC) {{Reaction|👍|Example|ts=12:30, 31 December 2025 (UTC)}} {{Reaction|😄|user1=SuperGrey|ts1=12:42, 31 December 2025 (UTC)}}`;
		expect(() =>
			applyPageModification(base, {
				timestamp: "12:21, 31 December 2025 (UTC)",
				remove: "❤️",
			}),
		).toThrow("api.errors.no_changes");
	});

	it("throws when timestamp is missing", () => {
		expect(() =>
			applyPageModification("Some text without matching timestamp", {
				timestamp: "13:00, 1 January 2024 (UTC)",
				upvote: "👍",
			}),
		).toThrow("api.errors.timestamp_missing");
	});
});
