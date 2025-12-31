import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

const I18N_VIRTUAL_ID = 'virtual:i18n-catalogues';
const I18N_DIR = path.resolve(process.cwd(), 'i18n');

function i18nCataloguesPlugin(): Plugin {
	return {
		name: 'reaction-vitest-i18n-catalogues',
		resolveId(id) {
			if (id === I18N_VIRTUAL_ID) {
				return id;
			}
			return undefined;
		},
		async load(id) {
			if (id !== I18N_VIRTUAL_ID) {
				return null;
			}
			const entries = await fs.readdir(I18N_DIR, { withFileTypes: true });
			const catalogues: Record<string, unknown> = {};
			for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
				if (!entry.isFile() || !entry.name.endsWith('.json')) {
					continue;
				}
				const locale = entry.name.replace(/\.json$/i, '');
				const filePath = path.join(I18N_DIR, entry.name);
				const contents = await fs.readFile(filePath, 'utf8');
				try {
					catalogues[locale] = JSON.parse(contents);
				} catch (error) {
					throw new Error(`[Reaction Vitest] Failed to parse ${entry.name}: ${(error as Error).message}`);
				}
			}
			return {
				code: `export default ${JSON.stringify(catalogues)};`,
				map: null
			};
		}
	};
}

export default defineConfig({
	plugins: [i18nCataloguesPlugin()],
	test: {
		coverage: {
			include: ['src/**/*.{ts,tsx}'],
			exclude: ['src/**/*.d.ts']
		},
		exclude: [
			...configDefaults.exclude,
			'**/dist/**',
			'**/cypress/**',
			'**/.{idea,git,cache,output,temp}/**',
			'**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*'
		]
	}
});
