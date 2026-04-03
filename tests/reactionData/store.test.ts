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
		vi.resetModules();
		vi.useRealTimers();
		fetchPageWikitextSnapshotMock.mockReset();
		savePageWikitextMock.mockReset();
		(globalThis as { mw?: unknown }).mw = {
			config: {
				get: (key: string) => key === "wgFormattedNamespaces"
					? { 4: "Wikipedia" }
					: undefined,
			},
		};
	});

	it("extracts and wraps syntaxhighlight JSON payload", async () => {
		const { extractJsonPayloadFromDatabasePage, wrapJsonPayloadForDatabasePage } = await import("../../src/reactionData/store");
		const wrapped = `<syntaxhighlight lang="json">\n{"version":1,"entries":{}}\n</syntaxhighlight>`;
		expect(extractJsonPayloadFromDatabasePage(wrapped)).toBe('{"version":1,"entries":{}}');
		expect(extractJsonPayloadFromDatabasePage("plain text")).toBeNull();
		expect(wrapJsonPayloadForDatabasePage('{"version":1,"entries":{}}'))
			.toContain("<syntaxhighlight lang=\"json\">");
	});

	it("canonicalizes duplicate users per icon and keeps timestampIso", async () => {
		const { canonicalizeReactionEntry } = await import("../../src/reactionData/store");
		const canonical = canonicalizeReactionEntry({
			"👍": [
				{ user: "Example User", timestampIso: "2026-01-01T10:00:00Z" },
				{ user: "Example_User", timestamp: "ts2", timestampIso: "2026-01-01T09:59:00Z" },
			],
		});
		expect(canonical["👍"]).toHaveLength(1);
		expect(canonical["👍"]?.[0]?.user).toBe("Example_User");
		expect(canonical["👍"]?.[0]?.timestampIso).toBe("2026-01-01T09:59:00Z");
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

	it("treats invalid wrappers as empty payloads", async () => {
		fetchPageWikitextSnapshotMock.mockResolvedValue({
			exists: true,
			text: "invalid-content",
			revisionId: 1,
			revisionTimestamp: "2026-02-11T00:00:00Z",
		});
		const { loadReactionDatabasePage } = await import("../../src/reactionData/store");
		const result = await loadReactionDatabasePage("Wikipedia:Reactions/data/Test/202602", { fresh: true });
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.payload.entries).toEqual({});
	});

	it("mutates and saves a sharded comment entry with syntaxhighlight wrapper", async () => {
		const largeEntry = {
			"👍": Array.from({ length: 2600 }, (_, index) => ({
				user: `User_${index}`,
				timestamp: "10:00, 1 January 2026 (UTC)",
				timestampIso: "2026-01-01T10:00:00Z",
			})),
		};
		const basePayload = {
			version: 1,
			entries: {},
			sharded: true,
			shards: ["part-1"],
			shardMap: {
				"c-TestUser-20260211013500-topic": "part-1",
			},
		};
		const shardPayload = {
			version: 1,
			entries: {
				"c-TestUser-20260211013500-topic": largeEntry,
			},
		};
		fetchPageWikitextSnapshotMock
			.mockResolvedValueOnce({
				exists: true,
				text: `<syntaxhighlight lang="json">\n${JSON.stringify(basePayload, null, 2)}\n</syntaxhighlight>`,
				revisionId: 1,
				revisionTimestamp: "2026-02-11T00:00:00Z",
			})
			.mockResolvedValueOnce({
				exists: true,
				text: `<syntaxhighlight lang="json">\n${JSON.stringify(shardPayload, null, 2)}\n</syntaxhighlight>`,
				revisionId: 2,
				revisionTimestamp: "2026-02-11T00:01:00Z",
			});
		savePageWikitextMock.mockResolvedValue({ ok: true });

		const { mutateReactionEntryForComment } = await import("../../src/reactionData/store");
		const result = await mutateReactionEntryForComment({
			commentId: "c-TestUser-20260211013500-topic",
			action: "upvote",
			icon: "👎",
			user: "Another User",
			timestamp: "10:02, 1 January 2026 (UTC)",
			timestampIso: "2026-01-01T10:02:00Z",
			notifySuccess: false,
			notifyFailure: false,
		});
		expect(result.ok).toBe(true);
		expect(savePageWikitextMock).toHaveBeenCalledTimes(2);
		const savedTitles = savePageWikitextMock.mock.calls.map((call) => String(call[0]));
		expect(savedTitles.some((title) => title.endsWith("/part-1"))).toBe(true);
		expect(savedTitles.some((title) => title.endsWith("/202602"))).toBe(true);
		const savedText = String(savePageWikitextMock.mock.calls[0]?.[1] ?? "");
		expect(savedText).toContain("<syntaxhighlight lang=\"json\">");
	});

	it("retries edit-conflict writes with a refreshed base timestamp", async () => {
		vi.useFakeTimers();
		const revisionTs1 = "2026-02-11T00:00:00Z";
		const revisionTs2 = "2026-02-11T00:01:00Z";
		const emptyPayload = {
			version: 1,
			entries: {},
		};
		fetchPageWikitextSnapshotMock
			.mockResolvedValueOnce({
				exists: true,
				text: `<syntaxhighlight lang="json">\n${JSON.stringify(emptyPayload, null, 2)}\n</syntaxhighlight>`,
				revisionId: 1,
				revisionTimestamp: revisionTs1,
			})
			.mockResolvedValueOnce({
				exists: true,
				text: `<syntaxhighlight lang="json">\n${JSON.stringify(emptyPayload, null, 2)}\n</syntaxhighlight>`,
				revisionId: 2,
				revisionTimestamp: revisionTs2,
			});
		savePageWikitextMock
			.mockResolvedValueOnce({ ok: false, errorCode: "editconflict" })
			.mockResolvedValueOnce({ ok: true });

		const { mutateReactionEntryForComment } = await import("../../src/reactionData/store");
		const mutationPromise = mutateReactionEntryForComment({
			commentId: "c-TestUser-20260211013500-topic",
			action: "append",
			icon: "👍",
			user: "Another User",
			timestamp: "10:02, 1 January 2026 (UTC)",
			timestampIso: "2026-01-01T10:02:00Z",
			notifySuccess: false,
			notifyFailure: false,
		});

		await vi.advanceTimersByTimeAsync(500);
		const result = await mutationPromise;
		vi.useRealTimers();

		expect(result.ok).toBe(true);
		expect(savePageWikitextMock).toHaveBeenCalledTimes(2);
		expect(savePageWikitextMock.mock.calls[0]?.[3]).toMatchObject({
			baseTimestamp: revisionTs1,
			createOnly: false,
		});
		expect(savePageWikitextMock.mock.calls[1]?.[3]).toMatchObject({
			baseTimestamp: revisionTs2,
			createOnly: false,
		});
	});
});
