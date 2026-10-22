import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const postMock = vi.fn();
const postWithTokenMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../src/state", () => ({
	default: {
		version: "test",
		pageName: "Talk:Example",
	},
}));

vi.mock("../../src/i18n", () => ({
	t: vi.fn((key: string) => key),
	tReaction: vi.fn((key: string) => key),
}));

describe("api/client", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useRealTimers();
		getMock.mockReset();
		postMock.mockReset();
		postWithTokenMock.mockReset();
		notifyMock.mockReset();

		(globalThis as { mw?: unknown }).mw = {
			Api: class MockApi {
				get(...args: unknown[]) {
					return getMock(...args);
				}

				post(...args: unknown[]) {
					return postMock(...args);
				}

				postWithToken(...args: unknown[]) {
					return postWithTokenMock(...args);
				}
			},
			notify: notifyMock,
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries transient page-read failures before succeeding", async () => {
		getMock
			.mockRejectedValueOnce(new Error("Temporary network failure"))
			.mockResolvedValueOnce({
				query: {
					pageids: ["1"],
					pages: {
						1: {
							revisions: [{
								slots: {
									main: {
										"*": "Example body",
									},
								},
								revid: 9,
								timestamp: "2026-02-11T00:00:00Z",
							}],
						},
					},
				},
			});

		const { fetchPageWikitextSnapshot } = await import("../../src/api/client");
		const snapshot = await fetchPageWikitextSnapshot("Wikipedia:Reactions/data/Test/202602");

		expect(getMock).toHaveBeenCalledTimes(2);
		expect(snapshot).toEqual({
			exists: true,
			text: "Example body",
			revisionId: 9,
			revisionTimestamp: "2026-02-11T00:00:00Z",
		});
	});

	it("retries transient parse failures before succeeding", async () => {
		postMock
			.mockRejectedValueOnce({ textStatus: "timeout" })
			.mockResolvedValueOnce({
				parse: {
					text: "<span>parsed</span>",
				},
			});

		const { parseWikitextToHtml } = await import("../../src/api/client");
		const html = await parseWikitextToHtml("{{Reaction|icon=👍|user1=Example}}");

		expect(postMock).toHaveBeenCalledTimes(2);
		expect(html).toBe("<span>parsed</span>");
	});

	it("passes edit preconditions to save requests", async () => {
		postWithTokenMock.mockResolvedValue({});

		const { savePageWikitext } = await import("../../src/api/client");
		const result = await savePageWikitext(
			"Wikipedia:Reactions/data/Test/202602",
			"body",
			"summary",
			{
				notifySuccess: false,
				notifyFailure: false,
				appendBacklink: false,
				baseTimestamp: "2026-02-11T00:00:00Z",
				startTimestamp: "2026-02-11T00:01:00Z",
				createOnly: true,
			},
		);

		expect(result).toEqual({ ok: true });
		expect(postWithTokenMock).toHaveBeenCalledWith("edit", expect.objectContaining({
			action: "edit",
			title: "Wikipedia:Reactions/data/Test/202602",
			text: "body",
			summary: "summary",
			basetimestamp: "2026-02-11T00:00:00Z",
			starttimestamp: "2026-02-11T00:01:00Z",
			createonly: true,
		}));
	});

	it("returns a timeout error code for hung writes", async () => {
		vi.useFakeTimers();
		postWithTokenMock.mockImplementation(() => new Promise(() => undefined));

		const { savePageWikitext } = await import("../../src/api/client");
		const savePromise = savePageWikitext(
			"Wikipedia:Reactions/data/Test/202602",
			"body",
			"summary",
			{
				notifySuccess: false,
				notifyFailure: false,
				appendBacklink: false,
			},
		);

		await vi.advanceTimersByTimeAsync(12_000);

		await expect(savePromise).resolves.toMatchObject({
			ok: false,
			errorCode: "timeout",
		});
	});
});
