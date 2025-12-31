import { addReactionButtons } from "./dom/buttons";

/**
 * Initialization entry point: load required modules and bind events.
 */
async function init() {
	mw.loader.load("/w/index.php?title=Template:Reaction/styles.css&action=raw&ctype=text/css", "text/css");
	try {
		await mw.loader.using("ext.discussionTools.init");
	} catch (error) {
		console.error("[Reaction] Failed to load DiscussionTools module.", error);
		return;
	}
	mw.hook("wikipage.content").add(function () {
		setTimeout(() => addReactionButtons(), 200);
	});
}

void init();
