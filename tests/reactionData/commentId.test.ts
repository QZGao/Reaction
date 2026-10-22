import { beforeEach, describe, expect, it } from "vitest";

import {
	buildDatabaseTitle,
	parseCommentIdForDatabase,
	resolveProjectNamespacePrefix,
	resolveDatabaseTitleFromCommentId,
} from "../../src/reactionData/commentId";

describe("reactionData/commentId", () => {
	beforeEach(() => {
		(globalThis as { mw?: unknown }).mw = {
			config: {
				get: (key: string) => key === "wgFormattedNamespaces"
					? { 4: "Wikipedia" }
					: undefined,
			},
		};
	});

	it("parses owner and month key from a standard comment id", () => {
		const parsed = parseCommentIdForDatabase("c-SuperGrey-20260211013500-LuciferianThomas-20260211012700");
		expect(parsed).not.toBeNull();
		expect(parsed?.owner).toBe("SuperGrey");
		expect(parsed?.monthKey).toBe("202602");
	});

	it("normalizes owner segment when building titles", () => {
		const parsed = parseCommentIdForDatabase("c-Example User-20260101121212-topic");
		expect(parsed).not.toBeNull();
		expect(parsed?.owner).toBe("Example_User");
		if (!parsed) {
			return;
		}
		expect(buildDatabaseTitle(parsed)).toBe("Wikipedia:Reactions/data/Example_User/202601");
	});

	it("resolves local namespace-4 prefix when available", () => {
		expect(resolveProjectNamespacePrefix()).toBe("Wikipedia");
	});

	it("falls back to Project namespace when mw namespace config is missing", () => {
		(globalThis as { mw?: unknown }).mw = {
			config: {
				get: () => undefined,
			},
		};
		expect(resolveProjectNamespacePrefix()).toBe("Project");
	});

	it("returns null for malformed comment ids", () => {
		expect(parseCommentIdForDatabase("invalid-id")).toBeNull();
		expect(resolveDatabaseTitleFromCommentId("c-User-no-timestamp")).toBeNull();
	});

	it("resolves database title for valid ids", () => {
		const title = resolveDatabaseTitleFromCommentId("c-SuperGrey-20260210031200-後續討論");
		expect(title).toBe("Wikipedia:Reactions/data/SuperGrey/202602");
	});
});
