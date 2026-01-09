import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const watch = process.argv.includes('--watch');
const debug = process.argv.includes('--debug');
const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const debugDir = path.join(projectRoot, '.debug');
const distDir = path.join(projectRoot, 'dist');

const I18N_VIRTUAL_ID = 'virtual:i18n';
const EMOJI_I18N_VIRTUAL_ID = 'virtual:emoji-i18n';
const i18nDir = path.join(projectRoot, 'i18n');
const emojiI18nDir = path.join(projectRoot, 'emoji-i18n');

function createLocaleDataPlugin({ name, virtualId, namespace, dir, locales }) {
	return {
		name,
		setup(build) {
			build.onResolve({ filter: new RegExp(`^${virtualId}$`) }, () => ({
				path: virtualId,
				namespace,
			}));

			build.onLoad({ filter: /.*/, namespace }, async () => {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true });
				const files = entries
					.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
					.map((entry) => entry.name)
					.sort((a, b) => a.localeCompare(b));
				const selected = locales === null
					? files
					: files.filter((file) => locales.includes(path.basename(file, '.json')));

				const catalogues = {};
				for (const file of selected) {
					const locale = path.basename(file, '.json');
					const filePath = path.join(dir, file);
					const contents = await fs.promises.readFile(filePath, 'utf8');
					try {
						catalogues[locale] = JSON.parse(contents);
					} catch (error) {
						throw new Error(`[Reaction build] Failed to parse ${file}: ${String(error)}`);
					}
				}

				return {
					contents: `export default ${JSON.stringify(catalogues)};`,
					loader: 'ts',
					resolveDir: dir,
					watchFiles: selected.map((file) => path.join(dir, file)),
					watchDirs: [dir],
				};
			});
		},
	};
}

function createI18nCatalogPlugin(locales) {
	return createLocaleDataPlugin({
		name: 'i18n',
		virtualId: I18N_VIRTUAL_ID,
		namespace: 'i18n',
		dir: i18nDir,
		locales,
	});
}

function createEmojiI18nPlugin(locales) {
	return createLocaleDataPlugin({
		name: 'emoji-i18n',
		virtualId: EMOJI_I18N_VIRTUAL_ID,
		namespace: 'emoji-i18n',
		dir: emojiI18nDir,
		locales,
	});
}

function getLocaleBundleContents(locale, messages, emojiData) {
	const i18nPayload = { [locale]: messages };
	const emojiPayload = emojiData ? { [locale]: emojiData } : {};
	return `(() => {
  const i18n = ${JSON.stringify(i18nPayload)};
  const emoji = ${JSON.stringify(emojiPayload)};
  const registerI18n = globalThis.__REACTION_REGISTER_I18N__;
  if (typeof registerI18n === 'function') {
    registerI18n(i18n);
  } else {
    const existing = globalThis.__REACTION_I18N__ || {};
    globalThis.__REACTION_I18N__ = Object.assign(existing, i18n);
  }
  const registerEmoji = globalThis.__REACTION_REGISTER_EMOJI_I18N__;
  if (typeof registerEmoji === 'function') {
    registerEmoji(emoji);
  } else if (Object.keys(emoji).length) {
    const existingEmoji = globalThis.__REACTION_EMOJI_I18N__ || {};
    globalThis.__REACTION_EMOJI_I18N__ = Object.assign(existingEmoji, emoji);
  }
})();`;
}

const createBuildOptions = ({ outfile, locales, emojiLocales }) => {
	const timestamp = new Date().toISOString();
	return {
		entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
		outfile,
		bundle: true,
		format: 'iife',
		charset: 'utf8',
		target: ['es2017'],
		minify: !debug,
		sourcemap: debug ? 'inline' : false,
		plugins: [
			createI18nCatalogPlugin(locales),
			createEmojiI18nPlugin(emojiLocales),
		],
		define: {
			__VUE_OPTIONS_API__: 'true',
			__VUE_PROD_DEVTOOLS__: 'false',
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
		},
		// Tell esbuild to load CSS files as text so they're bundled into the JS
		loader: {
			'.css': 'text'
		},
		banner: {
			js: `// Reaction - Main Bundle
// Maintainers: SuperGrey, SunAfterRain
// Repository: https://github.com/QZGao/Reaction
// Release: ${pkgJson.version}
// Timestamp: ${timestamp}
// <nowiki>`
		},
		footer: { js: '// </nowiki>' },
		logLevel: 'info',
	};
};

async function listLocales(dir) {
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => path.basename(entry.name, '.json'))
		.sort((a, b) => a.localeCompare(b));
}

async function buildLocaleBundles({ outputDir, locales, emojiLocales, minify }) {
	const timestamp = new Date().toISOString();
	for (const locale of locales.filter((item) => item !== 'en')) {
		const messagesPath = path.join(i18nDir, `${locale}.json`);
		const messages = JSON.parse(await fs.promises.readFile(messagesPath, 'utf8'));
		const emojiPath = path.join(emojiI18nDir, `${locale}.json`);
		let emojiData = null;
		if (emojiLocales.includes(locale)) {
			emojiData = JSON.parse(await fs.promises.readFile(emojiPath, 'utf8'));
		}
		const contents = getLocaleBundleContents(locale, messages, emojiData);
		const outfile = path.join(outputDir, `Gadget-Reaction-${locale}.js`);
		await esbuild.build({
			stdin: {
				contents,
				sourcefile: `Gadget-Reaction-${locale}.js`,
				loader: 'js',
			},
			outfile,
			minify,
			bundle: false,
			format: 'iife',
			charset: 'utf8',
			target: ['es2017'],
			banner: {
				js: `// Reaction - ${locale} Locale Bundle
// Maintainers: SuperGrey, SunAfterRain
// Repository: https://github.com/QZGao/Reaction
// Release: ${pkgJson.version}
// Timestamp: ${timestamp}
// <nowiki>`
			},
			footer: { js: '// </nowiki>' },
			logLevel: 'info',
		});
		console.log(`[Reaction build] Build complete: ${path.basename(outfile)}`);
	}
}

(async () => {
	try {
		const i18nLocales = await listLocales(i18nDir);
		const emojiLocales = await listLocales(emojiI18nDir);
		if (!i18nLocales.includes('en')) {
			throw new Error('[Reaction build] Missing i18n/en.json required for base bundle.');
		}

		const outputDir = debug || watch ? debugDir : distDir;
		const baseOutFile = path.join(outputDir, 'Gadget-Reaction.js');
		const buildTargets = [
			{
				outfile: baseOutFile,
				locales: ['en'],
				emojiLocales: [],
			},
		];

		if (watch) {
			const contexts = [];
			console.log('[Reaction build] Building...');
			for (const target of buildTargets) {
				const buildOptions = createBuildOptions(target);
				const ctx = await esbuild.context(buildOptions);
				await ctx.rebuild();
				await ctx.watch();
				contexts.push(ctx);
			}
			await buildLocaleBundles({
				outputDir,
				locales: i18nLocales,
				emojiLocales,
				minify: !debug,
			});
			console.log('[Reaction build] Watching for changes...');
			return;
		}

		for (const target of buildTargets) {
			const buildOptions = createBuildOptions(target);
			await esbuild.build(buildOptions);
			console.log(`[Reaction build] Build complete: ${path.basename(target.outfile)}`);
		}

		await buildLocaleBundles({
			outputDir,
			locales: i18nLocales,
			emojiLocales,
			minify: !debug,
		});
	} catch (e) {
		console.error('[Reaction build] Build failed:', e);
		process.exit(1);
	}
})();
