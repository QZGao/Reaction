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
const outFile = path.join(projectRoot, debug ? '.debug' : 'dist', 'bundled.js');

const I18N_VIRTUAL_ID = 'virtual:i18n';
const EMOJI_I18N_VIRTUAL_ID = 'virtual:emoji-i18n';
const i18nDir = path.join(projectRoot, 'i18n');
const emojiI18nDir = path.join(projectRoot, 'emoji-i18n');

const i18nCatalogPlugin = {
	name: 'i18n',
	setup(build) {
		build.onResolve({ filter: new RegExp(`^${I18N_VIRTUAL_ID}$`) }, () => ({
			path: I18N_VIRTUAL_ID,
			namespace: 'i18n'
		}));

		build.onLoad({ filter: /.*/, namespace: 'i18n' }, async () => {
			const entries = await fs.promises.readdir(i18nDir, { withFileTypes: true });
			const jsonFiles = entries
				.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
				.map((entry) => entry.name)
				.sort();

			const imports = jsonFiles
				.map((file, index) => `import locale${index} from './${file}';`)
				.join('\n');

			const mappings = jsonFiles
				.map((file, index) => {
					const locale = path.basename(file, '.json');
					return `\t${JSON.stringify(locale)}: locale${index}`;
				})
				.join(',\n');

			const contents = `${imports}
const catalogues = {
${mappings}
};

export default catalogues;
`;

			return {
				contents,
				loader: 'ts',
				resolveDir: i18nDir,
				watchFiles: jsonFiles.map((file) => path.join(i18nDir, file)),
				watchDirs: [i18nDir]
			};
		});
	}
};

const emojiI18nPlugin = {
	name: 'emoji-i18n',
	setup(build) {
		build.onResolve({ filter: new RegExp(`^${EMOJI_I18N_VIRTUAL_ID}$`) }, () => ({
			path: EMOJI_I18N_VIRTUAL_ID,
			namespace: 'emoji-i18n'
		}));

		build.onLoad({ filter: /.*/, namespace: 'emoji-i18n' }, async () => {
			const entries = await fs.promises.readdir(emojiI18nDir, { withFileTypes: true });
			const jsonFiles = entries
				.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
				.map((entry) => entry.name)
				.sort();

			const imports = jsonFiles
				.map((file, index) => `import locale${index} from './${file}';`)
				.join('\n');

			const mappings = jsonFiles
				.map((file, index) => {
					const locale = path.basename(file, '.json');
					return `\t${JSON.stringify(locale)}: locale${index}`;
				})
				.join(',\n');

			const contents = `${imports}
const emojiI18n = {
${mappings}
};

export default emojiI18n;
`;

			return {
				contents,
				loader: 'ts',
				resolveDir: emojiI18nDir,
				watchFiles: jsonFiles.map((file) => path.join(emojiI18nDir, file)),
				watchDirs: [emojiI18nDir]
			};
		});
	}
};

const createBuildOptions = () => {
	const timestamp = new Date().toISOString();
	return {
		entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
		outfile: outFile,
		bundle: true,
		format: 'iife',
		charset: 'utf8',
		target: ['es2017'],
		minify: !debug,
		sourcemap: debug ? 'inline' : false,
		plugins: [i18nCatalogPlugin, emojiI18nPlugin],
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
			js: `// Reaction - Bundled Version
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

(async () => {
	try {
		const buildOptions = createBuildOptions();
		if (watch) {
			const ctx = await esbuild.context(buildOptions);
			console.log('[Reaction build] Building...');
			await ctx.rebuild();
			await ctx.watch();
			console.log('[Reaction build] Watching for changes...');
		} else {
			await esbuild.build(buildOptions);
			console.log('[Reaction build] Build complete');
		}
	} catch (e) {
		console.error('[Reaction build] Build failed:', e);
		process.exit(1);
	}
})();
