import { addReactionButtons } from "./dom/buttons";

/**
 * Initialization entry point: load required modules and bind events.
 */
function init() {
	mw.loader.load('/w/index.php?title=Template:Reaction/styles.css&action=raw&ctype=text/css', 'text/css');
	mw.hook('wikipage.content').add(function () {
		setTimeout(() => addReactionButtons(), 200);
	});
}

init();
