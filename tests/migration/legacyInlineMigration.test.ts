import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPageWikitextSnapshotMock = vi.fn();
const savePageWikitextMock = vi.fn();
const getDiscussionToolsLookupMock = vi.fn();
const findCommentPositionMock = vi.fn();
const mergeReactionEntryForCommentMock = vi.fn();

vi.mock("../../src/state", () => ({
	default: {
		pageName: "Talk:Example",
	},
}));

vi.mock("../../src/api/client", () => ({
	fetchPageWikitextSnapshot: fetchPageWikitextSnapshotMock,
	savePageWikitext: savePageWikitextMock,
}));

vi.mock("../../src/api/discussionTools", () => ({
	getDiscussionToolsLookup: getDiscussionToolsLookupMock,
}));

vi.mock("../../src/wikitext/comments", () => ({
	findCommentPosition: findCommentPositionMock,
}));

vi.mock("../../src/reactionData/store", () => ({
	hasReactionEntryData: (entry: unknown) => {
		if (!entry || typeof entry !== "object") {
			return false;
		}
		return Object.values(entry as Record<string, unknown>).some((value) => Array.isArray(value) && value.length > 0);
	},
	mergeReactionEntryForComment: mergeReactionEntryForCommentMock,
}));

describe("legacyInlineMigration", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchPageWikitextSnapshotMock.mockReset();
		savePageWikitextMock.mockReset();
		getDiscussionToolsLookupMock.mockReset();
		findCommentPositionMock.mockReset();
		mergeReactionEntryForCommentMock.mockReset();
	});

	it("migrates trailing inline templates and cleans source once", async () => {
		const source = "Comment [[User:Example|Example]] 10:00, 1 January 2026 (UTC) {{Reaction|icon=👍|user1=Foo|ts1=10:01, 1 January 2026 (UTC)}}";
		fetchPageWikitextSnapshotMock.mockResolvedValue({
			exists: true,
			text: source,
			revisionId: 1,
			revisionTimestamp: "2026-01-01T10:00:00Z",
		});
		getDiscussionToolsLookupMock.mockResolvedValue({
			comments: [
				{
					id: "c-Example-20260101100000-topic",
					signatureTimestamp: "10:00, 1 January 2026 (UTC)",
					authorText: "Example",
				},
			],
		});
		findCommentPositionMock.mockReturnValue({
			position: source.indexOf("10:00, 1 January 2026 (UTC)"),
		});
		mergeReactionEntryForCommentMock.mockResolvedValue({
			ok: true,
		});
		savePageWikitextMock.mockResolvedValue({
			ok: true,
		});

		const { runLegacyInlineMigrationOnce } = await import("../../src/migration/legacyInlineMigration");
		await runLegacyInlineMigrationOnce();
		await runLegacyInlineMigrationOnce();

		expect(mergeReactionEntryForCommentMock).toHaveBeenCalledTimes(1);
		expect(savePageWikitextMock).toHaveBeenCalledTimes(1);
		const [, cleanedSource] = savePageWikitextMock.mock.calls[0] as [string, string];
		expect(cleanedSource).not.toContain("{{Reaction");
	});
});

