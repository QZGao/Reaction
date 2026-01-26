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
			<dl class="cd-commentLevel cd-commentLevel-1">
				<dd class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="18">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a href="/wiki/User:TimYuan28" title="User:TimYuan28"
									class="userlink cd-comment-author"><bdi>TimYuan28</bdi></a> <span
									class="cd-comment-author-links">（<a href="/wiki/User_talk:TimYuan28" title="User talk:TimYuan28"
										class="userlink">討論</a>）</span></div><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-TimYuan28-20260124143800-Ahfosh-20260124142700" title="2026年1月24日 (六) 14:38 (UTC)">2026年1月24日 (六) 14:38 (UTC)</a><a tabindex="0" role="button"
								class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.<span
						data-mw-comment-sig="c-TimYuan28-20260124143800-Ahfosh-20260124142700"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu"><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
					</div>
				</dd>
				<dd class="cd-comment-part cd-comment-part-first" data-cd-comment-index="19">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a href="/wiki/User:Thehistorianisaac" title=""
									class="userlink cd-comment-author"><bdi>Thehistorianisaac</bdi></a> <span
									class="cd-comment-author-links">（<a href="/wiki/User_talk:Thehistorianisaac"
										title="User talk:Thehistorianisaac" class="userlink">討論</a>）</span></div><a tabindex="0"
								role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-Thehistorianisaac-20260124150400-Ahfosh-20260124142700" title="2026年1月24日 (六) 15:04 (UTC)">2026年1月24日 (六) 15:04 (UTC)</a><a tabindex="0" role="button"
								class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.
				</dd>
				<dd class="cd-comment-part" data-cd-comment-index="19">Sample text.</dd>
				<dd class="cd-comment-part cd-comment-part-last" data-cd-comment-index="19">
					Sample text.<span
						data-mw-comment-sig="c-Thehistorianisaac-20260124150400-Ahfosh-20260124142700"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu"><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
					</div>
				</dd>
				<dd class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="20">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a
									href="/wiki/User:%E7%8E%B0%E5%9C%A8%E7%9C%8B%E8%A7%81%E4%BD%A0" title="User:現在看見你"
									class="userlink cd-comment-author"><bdi>现在看见你</bdi></a> <span
									class="cd-comment-author-links">（<a
										href="/wiki/User_talk:%E7%8E%B0%E5%9C%A8%E7%9C%8B%E8%A7%81%E4%BD%A0" title="User talk:現在看見你"
										class="userlink">討論</a>）</span></div><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-现在看见你-20260124151300-Ahfosh-20260124142700" title="2026年1月24日 (六) 15:13 (UTC)">2026年1月24日 (六) 15:13 (UTC)</a><a tabindex="0"
								role="button" class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.<span
						data-mw-comment-sig="c-现在看见你-20260124151300-Ahfosh-20260124142700"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu"><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
					</div>
				</dd>
				<dd class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="21">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a href="/wiki/User:YFdyh000" title="User:YFdyh000"
									class="userlink cd-comment-author"><bdi>YFdyh000</bdi></a> <span
									class="cd-comment-author-links">（<a href="/wiki/User_talk:YFdyh000" title="User talk:YFdyh000"
										class="userlink">討論</a>）</span></div><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-YFdyh000-20260124153000-Ahfosh-20260124142700" title="2026年1月24日 (六) 15:30 (UTC)">2026年1月24日 (六) 15:30 (UTC)</a><a tabindex="0" role="button"
								class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.<span
						data-mw-comment-sig="c-YFdyh000-20260124153000-Ahfosh-20260124142700"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu"><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
					</div>
				</dd>
				<dd class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="22">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a href="/wiki/User:%E9%9D%99%E9%AD%94%E9%AD%94%E5%A5%B3"
									title="User:靜魔魔女" class="userlink cd-comment-author"><bdi>静魔魔女</bdi></a> <span
									class="cd-comment-author-links">（<a title="User talk:静魔魔女"
										href="/wiki/User_talk:%E9%9D%99%E9%AD%94%E9%AD%94%E5%A5%B3" class="userlink">討論</a>）</span>
							</div><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-静魔魔女-20260124163300-Ahfosh-20260124142700" title="2026年1月24日 (六) 16:33 (UTC)">2026年1月24日 (六) 16:33 (UTC)</a><a tabindex="0" role="button"
								class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.<span
						data-mw-comment-sig="c-静魔魔女-20260124163300-Ahfosh-20260124142700"></span>
					<style data-mw-deduplicate="TemplateStyles:r91035298"></style><span class="reactionable template-reaction test-marker1" title="YFdyh000於2026年1月24日 (六) 16:47 (UTC)回應了這條留言"
						data-reaction-commentors="YFdyh000於2026年1月24日 (六) 16:47 (UTC)"
						data-reaction-commentors-json="[{&quot;timestamp&quot;:&quot;2026年1月24日 (六) 16:47 (UTC)&quot;,&quot;user&quot;:&quot;YFdyh000&quot;}]"
						data-reaction-icon="👍" data-reaction-count="1" data-reaction-real-count="1"><span
							class="reaction-content"><span class="reaction-icon-container"><span
									class="reaction-icon">👍</span></span><span class="reaction-counter-container"><span
									class="reaction-counter">1</span></span></span></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu"><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
					</div>
				</dd>
				<dd class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="23">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a href="/wiki/User:Cs_haoh" title="User:Cs haoh"
									class="userlink cd-comment-author"><bdi>Cs haoh</bdi></a> <span
									class="cd-comment-author-links">（<a href="/wiki/User_talk:Cs_haoh" title="User talk:Cs haoh"
										class="userlink">討論</a>）</span></div><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-Cs_haoh-20260125013900-Ahfosh-20260124142700" title="2026年1月25日 (日) 01:39 (UTC)">2026年1月25日 (日) 01:39 (UTC)</a><a tabindex="0" role="button"
								class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.<span
						data-mw-comment-sig="c-Cs_haoh-20260125013900-Ahfosh-20260124142700"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu"><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
					</div>
				</dd>
				<dd class="cd-comment-part cd-comment-part-first" data-cd-comment-index="24">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a class="cd-comment-author mw-userlink userlink new"
									title="User:~2026-51566-3"
									href="/w/index.php?title=User:~2026-51566-3&amp;action=edit&amp;redlink=1"><bdi>~2026-51566-3</bdi></a>
								<span class="cd-comment-author-links">（<a
										href="/w/index.php?title=User_talk:~2026-51566-3&amp;action=edit&amp;redlink=1"
										class="new userlink" title="User talk:~2026-51566-3（頁面不存在）"
										data-ipe-edit-mounted="1">討論</a>）</span></div><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-~2026-51566-3-20260125034500-Ahfosh-20260124142700" title="2026年1月25日 (日) 03:45 (UTC)">2026年1月25日 (日) 03:45 (UTC)</a><a tabindex="0" role="button"
								class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.
				</dd>
				<dd class="cd-comment-part" data-cd-comment-index="24">Sample text.</dd>
				<dd class="cd-comment-part" data-cd-comment-index="24">Sample text.</dd>
				<dd class="cd-connectToPreviousItem">
					<div class="cd-comment-part cd-comment-part-last test-marker2" data-cd-comment-index="24">Sample text.--<span
							data-mw-comment-sig="c-~2026-51566-3-20260125034500-Ahfosh-20260124142700"></span><a
							href="/wiki/Special:Contributions/~2026-51566-3" class="mw-tempuserlink userlink"
							title="Special:Contributions/~2026-51566-3">~2026-51566-3</a><span
							class="ext-checkuser-tempaccount-reveal-ip-button oo-ui-widget oo-ui-widget-enabled oo-ui-buttonElement oo-ui-buttonElement-frameless oo-ui-labelElement oo-ui-flaggedElement-progressive oo-ui-buttonWidget"><a
								class="oo-ui-buttonElement-button" role="button" tabindex="0" rel="nofollow"><span
									class="oo-ui-iconElement-icon oo-ui-iconElement-noIcon oo-ui-image-progressive"></span><span
									class="oo-ui-labelElement-label">顯示 IP</span><span
									class="oo-ui-indicatorElement-indicator oo-ui-indicatorElement-noIndicator oo-ui-image-progressive"></span></a></span>（
						<div class="cd-comment-menu-wrapper">
							<div class="cd-comment-menu"><a tabindex="0" role="button"
									class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
									class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
									class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
						</div>
					</div>
					<dl class="cd-commentLevel cd-commentLevel-2">
						<dd class="cd-comment-part cd-comment-part-first cd-comment-part-last" data-cd-comment-index="25">
							<div class="cd-comment-header-wrapper">
								<div class="cd-comment-header">
									<div class="cd-comment-author-wrapper"><a href="/wiki/User:Cs_haoh" title=""
											class="userlink cd-comment-author"><bdi>Cs haoh</bdi></a> <span
											class="cd-comment-author-links">（<a href="/wiki/User_talk:Cs_haoh"
												title="User talk:Cs haoh" class="userlink">討論</a>）</span></div><a tabindex="0"
										role="button"
										class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
										href="#c-Cs_haoh-20260125062200-~2026-51566-3-20260125034500"
										title="2026年1月25日 (日) 06:22 (UTC)">2026年1月25日 (日) 06:22 (UTC)</a><a tabindex="0"
										role="button"
										class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
										title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
											class="mw-invert">
											<path d="M10 5l8 10H2z"></path>
										</svg></a>
								</div>
							</div>
							Sample text.<span
								data-mw-comment-sig="c-Cs_haoh-20260125062200-~2026-51566-3-20260125034500"></span>
							<div class="cd-comment-menu-wrapper">
								<div class="cd-comment-menu"><a tabindex="0" role="button"
										class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
										class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
										class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
							</div>
						</dd>
					</dl>
				</dd>
				<dd class="cd-comment-part cd-comment-part-first" data-cd-comment-index="26">
					<div class="cd-comment-header-wrapper">
						<div class="cd-comment-header">
							<div class="cd-comment-author-wrapper"><a href="/wiki/User:Ahfosh" title="User:Ahfosh"
									class="userlink cd-comment-author"><bdi>Ahfosh</bdi></a> <span
									class="cd-comment-author-links">（<a href="/wiki/User_talk:Ahfosh" title=""
										class="userlink">討論</a>）</span></div><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-timestamp mw-selflink-fragment cd-comment-button"
								href="#c-Ahfosh-20260125045100-Ahfosh-20260124142700" title="2026年1月25日 (日) 04:51 (UTC)">2026年1月25日 (日) 04:51 (UTC)</a><a tabindex="0"
								role="button" class="cd-comment-button-icon cd-comment-button-goToParent cd-icon cd-comment-button"
								title="前往上層級意見"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"
									class="mw-invert">
									<path d="M10 5l8 10H2z"></path>
								</svg></a>
						</div>
					</div>Sample text.
				</dd>
				<dd class="cd-comment-part" data-cd-comment-index="26">Sample text.</dd>
				<dd class="cd-comment-part" data-cd-comment-index="26">Sample text.</dd>
				<dd class="cd-comment-part cd-comment-part-last" data-cd-comment-index="26">Sample text.<span
						data-mw-comment-sig="c-Ahfosh-20260125045100-Ahfosh-20260124142700"></span>
					<div class="cd-comment-menu-wrapper">
						<div class="cd-comment-menu"><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">回覆</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button">編輯</a><a tabindex="0" role="button"
								class="cd-comment-button-label cd-comment-button" title="對新增此意見的編輯表示感謝">感謝</a></div>
					</div>
				</dd>
			</dl>
		`;

		await addReactionButtons(document);

		// An existing reaction button
		const reactionButton1 = document.querySelector<HTMLElement>(".test-marker1");
		expect(reactionButton1).not.toBeNull();
		expect(reactionButton1?.getAttribute("data-reaction-comment-id")).toBe("c-静魔魔女-20260124163300-Ahfosh-20260124142700");

		// A newly added reaction button
		const reactionButton2 = document.querySelector<HTMLElement>(".test-marker2 .reaction-new");
		expect(reactionButton2).not.toBeNull();
		expect(reactionButton2?.getAttribute("data-reaction-comment-id")).toBe("c-~2026-51566-3-20260125034500-Ahfosh-20260124142700");
	});
});
