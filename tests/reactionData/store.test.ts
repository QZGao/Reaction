import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPageWikitextSnapshotMock = vi.fn();
const savePageWikitextMock = vi.fn();

vi.mock("../../src/api/client", () => ({
	fetchPageWikitextSnapshot: fetchPageWikitextSnapshotMock,
	savePageWikitext: savePageWikitextMock,
}));

vi.mock("../../src/utils", () => ({
	normalizeTitle: (value: string) => String(value ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/ /g, "_"),
	parseSignatureTimestampText: () => null,
}));

describe("reactionData/store", () => {
	beforeEach(() => {
		fetchPageWikitextSnapshotMock.mockReset();
		savePageWikitextMock.mockReset();
	});

	it("extracts and wraps syntaxhighlight JSON payload", async () => {
		const { extractJsonPayloadFromDatabasePage, wrapJsonPayloadForDatabasePage } = await import("../../src/reactionData/store");
		const wrapped = `<syntaxhighlight lang="json">\n{"version":1,"entries":{}}\n</syntaxhighlight>`;
		expect(extractJsonPayloadFromDatabasePage(wrapped)).toBe('{"version":1,"entries":{}}');
		expect(extractJsonPayloadFromDatabasePage("plain text")).toBeNull();
		expect(wrapJsonPayloadForDatabasePage('{"version":1,"entries":{}}'))
			.toContain("<syntaxhighlight lang=\"json\">");
	});

	it("canonicalizes duplicate users per icon", async () => {
		const { canonicalizeReactionEntry } = await import("../../src/reactionData/store");
		const canonical = canonicalizeReactionEntry({
			"👍": [
				{ user: "Example User" },
				{ user: "Example_User", timestamp: "ts2" },
			],
		});
		expect(canonical["👍"]).toHaveLength(1);
		expect(canonical["👍"]?.[0]?.user).toBe("Example_User");
		expect(canonical["👍"]?.[0]?.timestamp).toBe("ts2");
	});

	it("loads missing database pages as empty payloads", async () => {
		fetchPageWikitextSnapshotMock.mockResolvedValue({
			exists: false,
			text: null,
			revisionId: null,
			revisionTimestamp: null,
		});
		const { loadReactionDatabasePage } = await import("../../src/reactionData/store");
		const result = await loadReactionDatabasePage("Wikipedia:Reactions/data/Test/202602", { fresh: true });
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.payload.entries).toEqual({});
	});

	it("marks invalid wrappers as read-only", async () => {
		fetchPageWikitextSnapshotMock.mockResolvedValue({
			exists: true,
			text: "invalid-content",
			revisionId: 1,
			revisionTimestamp: "2026-02-11T00:00:00Z",
		});
		const { loadReactionDatabasePage } = await import("../../src/reactionData/store");
		const result = await loadReactionDatabasePage("Wikipedia:Reactions/data/Test/202602", { fresh: true });
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.reason).toBe("database_wrapper_invalid");
	});

	it("mutates and saves a comment entry with syntaxhighlight wrapper", async () => {
		fetchPageWikitextSnapshotMock.mockResolvedValue({
			exists: false,
			text: null,
			revisionId: null,
			revisionTimestamp: null,
		});
		savePageWikitextMock.mockResolvedValue({ ok: true });
		const { mutateReactionEntryForComment } = await import("../../src/reactionData/store");
		const result = await mutateReactionEntryForComment({
			commentId: "c-TestUser-20260211013500-topic",
			action: "upvote",
			icon: "👍",
			user: "Example User",
			timestamp: "10:00, 1 January 2026 (UTC)",
			notifySuccess: false,
			notifyFailure: false,
		});
		expect(result.ok).toBe(true);
		expect(savePageWikitextMock).toHaveBeenCalledTimes(1);
		const [, savedText] = savePageWikitextMock.mock.calls[0] as [string, string];
		expect(savedText).toContain("<syntaxhighlight lang=\"json\">");
		expect(savedText).toContain("\"c-TestUser-20260211013500-topic\"");
	});
});

