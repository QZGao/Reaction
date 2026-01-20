/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

(globalThis as { mw?: unknown }).mw = {
	config: {
		get: (key: string) => {
			switch (key) {
				case "wgUserName":
					return "TestUser";
				case "wgUserIsTemp":
					return false;
				case "wgPageName":
					return "Talk:範例";
				case "wgUserLanguage":
					return "zh-hant";
				case "wgContentLanguage":
					return "zh";
				case "wgServer":
					return "https://zh.wikipedia.org";
				case "wgArticlePath":
					return "/wiki/$1";
				default:
					return undefined;
			}
		},
	},
	language: {
		getFallbackLanguageChain: () => ["zh-hant", "zh", "en"],
	},
	util: {
		getUrl: (title: string) => `/wiki/${title}`,
		escapeRegExp: (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
	},
	user: {
		options: {
			get: () => null,
		},
	},
};

vi.mock("../../src/api/discussionTools", () => ({
	getDiscussionToolsLookup: vi.fn(async () => null),
	createMatchingState: vi.fn(),
	matchCommentById: vi.fn(),
	matchCommentByTimestamp: vi.fn(),
	consumeNextComment: vi.fn(),
}));

vi.mock("../../src/dom/reactionTooltip", () => ({
	attachReactionTooltip: vi.fn(),
}));

vi.mock("../../src/dom/emojiPicker", () => ({
	showEmojiPicker: vi.fn(),
	hideEmojiPicker: vi.fn(),
}));

describe("addReactionButtons", () => {
	let addReactionButtons: typeof import("../../src/dom/buttons").addReactionButtons;

	beforeAll(async () => {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("reaction.enabled", "true");
		}
		({ addReactionButtons } = await import("../../src/dom/buttons"));
	});

	it("assigns metadata when the comment marker follows the timestamp", async () => {
		const commentId = "c-For_Each_..._Next-20260111093800-For_Each_..._Next-20251122155500";
		const title = "2026年1月11日 (日) 09:38 (UTC)";
		document.body.innerHTML = `
			<dd>
				<div class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="138">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper">
								<a class="cd-comment-author mw-userlink userlink new" title="User:For Each ... Next" href="/w/index.php?title=User:For_Each_..._Next&action=edit&redlink=1"><bdi>For Each ... Next</bdi></a>
								<span class="cd-comment-author-links">（<a href="/wiki/User_talk:For_Each_..._Next" title="User talk:For Each ... Next" class="userlink">討論</a>）</span>
							</div>
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button" href="#${commentId}" title="${title}">${title}</a>
						</div>
					</div>
					Sample text.
					<span data-mw-comment-sig="${commentId}"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu">
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button">回覆</a>
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button">編輯</a>
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a>
						</div>
					</div>
				</div>
			</dd>
		`;
		await addReactionButtons(document);

		const timestamp = document.querySelector<HTMLElement>(".cd-comment-timestamp");
		expect(timestamp?.getAttribute("data-reaction-comment-id")).toBe(commentId);

		const reactionButton = document.querySelector<HTMLElement>(".reaction-new");
		expect(reactionButton).not.toBeNull();
		expect(reactionButton?.getAttribute("data-reaction-comment-id")).toBe(commentId);
	});

	it("does not bleed marker matching into nested replies", async () => {
		const parentId = "c-For_Each_..._Next-20260111093800-For_Each_..._Next-20251122155500";
		const childId = "c-Ericliu1912-20260111150300-For_Each_..._Next-20260111093800";
		document.body.innerHTML = `
			<dd>
				<div class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="138">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper">
								<a class="cd-comment-author mw-userlink userlink new" title="User:For Each ... Next" href="/w/index.php?title=User:For_Each_..._Next&action=edit&redlink=1"><bdi>For Each ... Next</bdi></a>
								<span class="cd-comment-author-links">（<a href="/wiki/User_talk:For_Each_..._Next" title="User talk:For Each ... Next" class="userlink">討論</a>）</span>
							</div>
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button" href="#${parentId}" title="2026年1月11日 (日) 09:38 (UTC)">2026年1月11日 (日) 09:38 (UTC)</a>
						</div>
					</div>
					Sample text.
					<span data-mw-comment-sig="${parentId}"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu">
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button">回覆</a>
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button">編輯</a>
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a>
						</div>
					</div>
					<dl class="cd-commentLevel cd-commentLevel-2">
						<dd class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="139">
							<div class="cd-comment-header-wrapper">
								<div class="cd-comment-header">
									<div class="cd-comment-author-wrapper">
										<a href="/wiki/User:Ericliu1912" title="User:Ericliu1912" class="userlink cd-comment-author"><bdi>Ericliu1912</bdi></a>
										<span class="cd-comment-author-links">（<a href="/wiki/User_talk:Ericliu1912" title="User talk:Ericliu1912" class="userlink">討論</a>）</span>
									</div>
									<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button" href="#${childId}" title="2026年1月11日 (日) 15:03 (UTC)">2026年1月11日 (日) 15:03 (UTC)</a>
								</div>
							</div>
							Sample text.
							<span data-mw-comment-sig="${childId}"></span>
							<div class="cd-comment-menu-wrapper">
								<div class="cd-comment-menu">
									<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button">回覆</a>
									<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button">編輯</a>
									<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a>
								</div>
							</div>
						</dd>
					</dl>
				</div>
			</dd>
		`;

		await addReactionButtons(document);

		const parentPart = document.querySelector<HTMLElement>('.cd-comment-part[data-cd-comment-index="138"]');
		const childPart = document.querySelector<HTMLElement>('.cd-comment-part[data-cd-comment-index="139"]');
		expect(parentPart).not.toBeNull();
		expect(childPart).not.toBeNull();

		const reactionButtons = Array.from(document.querySelectorAll<HTMLElement>(".reaction-new"));
		const parentButtons = reactionButtons.filter((button) => button.closest(".cd-comment-part") === parentPart);
		const childButtons = reactionButtons.filter((button) => button.closest(".cd-comment-part") === childPart);

		expect(parentButtons).toHaveLength(1);
		expect(childButtons).toHaveLength(1);
		expect(parentButtons[0]?.getAttribute("data-reaction-comment-id")).toBe(parentId);
		expect(childButtons[0]?.getAttribute("data-reaction-comment-id")).toBe(childId);
	});

	it("maps reactions in split comment parts using the shared index", async () => {
		const commentId = "c-魔琴-20260104035100-SunAfterRain-20260104021200";

		document.body.innerHTML = `
			<dl class="cd-commentLevel cd-commentLevel-3">
				<dd class="cd-comment-part cd-comment-part-first" data-cd-comment-index="4">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper">
								<a href="/wiki/User:%E9%AD%94%E7%90%B4" title="User:魔琴" class="userlink cd-comment-author"><bdi>魔琴</bdi></a>
							</div>
							<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button" href="#${commentId}" title="2026年1月4日 (日) 03:51 (UTC)">2026年1月4日 (日) 03:51 (UTC)</a>
						</div>
					</div>
					<ul><li>Sample text.</li></ul>
				</dd>
				<dd class="cd-connectToPreviousItem">
					<div class="cd-comment-part cd-comment-part-last" data-cd-comment-index="4">
						<span data-mw-comment-sig="${commentId}"></span>
						<span class="reactionable template-reaction" data-reaction-commentors="Srapoj於2026年1月4日 (日) 06:51 (UTC)" data-reaction-commentors-json="[]" data-reaction-icon="👍" data-reaction-count="1" data-reaction-real-count="1">
							<span class="reaction-content"><span class="reaction-icon-container"><span class="reaction-icon">👍</span></span><span class="reaction-counter-container"><span class="reaction-counter">1</span></span></span>
						</span>
						<div class="cd-comment-menu-wrapper">
							<div class="cd-comment-menu">
								<a tabindex="0" role="button" class="cd-comment-button-label cd-comment-button">回覆</a>
							</div>
						</div>
					</div>
				</dd>
			</dl>
		`;

		await addReactionButtons(document);

		const existingReaction = document.querySelector<HTMLElement>(".template-reaction[data-reaction-commentors]");
		expect(existingReaction).not.toBeNull();
		expect(existingReaction?.getAttribute("data-reaction-comment-id")).toBe(commentId);
	});
});
