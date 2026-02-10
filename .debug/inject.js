// Inject bundled.js into the page context after page loads
(function () {
	const baseBundleUrl = browser.runtime.getURL('Gadget-Reaction.js');
	const bundlePrefix = baseBundleUrl.replace(/Gadget-Reaction\.js$/, '');
	const SCRIPT_ID_PREFIX = 'reaction-debug-userscript';
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
				function getScriptId(url) {
					var name = (url.split('/').pop() || 'bundle').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
					return ${JSON.stringify(SCRIPT_ID_PREFIX)} + '-' + name;
				}

				function loadReactionWithUrl(url, onError) {
					// Replace only the same target script, so base + locale can coexist.
					var scriptId = getScriptId(url);
					var old = document.getElementById(scriptId);
					if (old) old.remove();

					var script = document.createElement('script');
					script.id = scriptId;

					// Cache-bust so Firefox won’t reuse an old bundle
					script.src = url + '?t=' + Date.now();
					if (typeof onError === 'function') {
						script.onerror = onError;
					}

					document.head.appendChild(script);
				}

				function collectLocaleCandidates() {
					var locales = [];
					var addLocale = function(value) {
						if (!value || typeof value !== 'string') return;
						var normalized = value.toLowerCase();
						if (normalized && locales.indexOf(normalized) === -1) {
							locales.push(normalized);
						}
					};
					try {
						if (typeof mw !== 'undefined') {
							var chain = mw.language && mw.language.getFallbackLanguageChain
								? mw.language.getFallbackLanguageChain()
								: null;
							if (Array.isArray(chain)) {
								chain.forEach(addLocale);
							}
							addLocale(mw.config && mw.config.get('wgUserLanguage'));
							addLocale(mw.config && mw.config.get('wgContentLanguage'));
						}
					} catch (e) {}
					addLocale(navigator && navigator.language);
					return locales;
				}

				function tryLoadLocaleBundles() {
					var locales = collectLocaleCandidates();
					var index = 0;
					var featureUrl = ${JSON.stringify(bundlePrefix)} + 'Gadget-Reaction-feature.js';

					function loadLocaleBundle() {
						if (index >= locales.length) {
							return;
						}
						var locale = locales[index++];
						var localeUrl = ${JSON.stringify(bundlePrefix)} + 'Gadget-Reaction-' + locale + '.js';
						loadReactionWithUrl(localeUrl, function() {
							loadLocaleBundle();
						});
					}

					loadReactionWithUrl(${JSON.stringify(baseBundleUrl)});
					loadReactionWithUrl(featureUrl);
					loadLocaleBundle();
				}

				if (typeof mw !== 'undefined' && mw.loader && typeof mw.loader.using === 'function') {
					tryLoadLocaleBundles();
				} else {
					// Fallback: wait for mw.loader
					setTimeout(function retry() {
						if (typeof mw !== 'undefined' && mw.loader && typeof mw.loader.using === 'function') {
							tryLoadLocaleBundles();
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
