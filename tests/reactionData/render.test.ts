/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const parseWikitextToHtmlMock = vi.fn();

vi.mock("../../src/api/client", () => ({
	parseWikitextToHtml: parseWikitextToHtmlMock,
}));

describe("reactionData/render", () => {
	beforeEach(() => {
		parseWikitextToHtmlMock.mockReset();
	});

	it("serializes entry to Reaction template wikitext", async () => {
		const { reactionEntryToWikitext } = await import("../../src/reactionData/render");
		const wikitext = reactionEntryToWikitext({
			"👍": [{ user: "Example", timestamp: "10:00, 1 January 2026 (UTC)" }],
		});
		expect(wikitext).toContain("{{Reaction|icon=👍");
		expect(wikitext).toContain("user1=Example");
	});

	it("renders parsed reaction buttons from parse API html", async () => {
		parseWikitextToHtmlMock.mockResolvedValue(`
			<span class="template-reaction reactionable" data-reaction-commentors="Example於10:00, 1 January 2026 (UTC)">
				<span class="reaction-content">
					<span class="reaction-icon-container"><span class="reaction-icon">👍</span></span>
					<span class="reaction-counter-container"><span class="reaction-counter">1</span></span>
				</span>
			</span>
		`);
		const { renderReactionEntryButtons } = await import("../../src/reactionData/render");
		const buttons = await renderReactionEntryButtons({
			"👍": [{ user: "Example", timestamp: "10:00, 1 January 2026 (UTC)" }],
		});
		expect(buttons).toHaveLength(1);
		expect(buttons[0]?.classList.contains("template-reaction")).toBe(true);
	});
});

