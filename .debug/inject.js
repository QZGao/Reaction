// Inject bundled.js into the page context after page loads
(function () {
	const bundleUrl = browser.runtime.getURL('bundled.js');
	const SCRIPT_ID = 'reaction-debug-userscript';
	const DEV_STORAGE_KEY = 'reaction-dev';

	function markDevMode() {
		if (localStorage.getItem(DEV_STORAGE_KEY) !== '1') {
			localStorage.setItem(DEV_STORAGE_KEY, '1');
		}
	}

	markDevMode();

	function inject() {
		// Create inline script that waits for mw.loader then loads our bundle
		const waitScript = document.createElement('script');
		waitScript.textContent = `
			(function() {
				function loadReaction() {
					// Remove any previously injected copy (prevents double-injection)
					var old = document.getElementById(${JSON.stringify(SCRIPT_ID)});
					if (old) old.remove();

					var script = document.createElement('script');
					script.id = ${JSON.stringify(SCRIPT_ID)};

					// Cache-bust so Firefox won’t reuse an old bundled.js
					script.src = ${JSON.stringify(bundleUrl)} + '?t=' + Date.now();

					document.head.appendChild(script);
				}

				if (typeof mw !== 'undefined' && mw.loader && typeof mw.loader.using === 'function') {
					loadReaction();
				} else {
					// Fallback: wait for mw.loader
					setTimeout(function retry() {
						if (typeof mw !== 'undefined' && mw.loader && typeof mw.loader.using === 'function') {
							loadReaction();
						} else {
							setTimeout(retry, 50);
						}
					}, 50);
				}
			})();
		`;
		(document.head || document.documentElement).appendChild(waitScript);
		waitScript.remove();
	}

	// Wait for page to finish loading
	if (document.readyState === 'complete') {
		inject();
	} else {
		window.addEventListener('load', inject);
	}
})();
