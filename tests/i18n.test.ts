import { describe, it, expect, vi, afterEach } from 'vitest';

type Catalogue = Record<string, Record<string, string>>;

const baseCatalogues: Catalogue = {
	en: { greeting: 'hello' },
	'zh-hans': { greeting: '你好' },
	'zh-hant': { greeting: '妳好' }
};

const mockModule = vi.mock as unknown as (
	moduleName: string,
	factory: () => { default: Catalogue },
	options: { virtual?: boolean }
) => void;

mockModule('virtual:i18n-catalogues', () => ({ default: baseCatalogues }), { virtual: true });

afterEach(() => {
	Reflect.deleteProperty(globalThis as { mw?: unknown }, 'mw');
	vi.resetModules();
	vi.clearAllMocks();
});

async function loadI18n(chain: string[]): Promise<typeof import('../src/i18n')> {
	(globalThis as { mw?: unknown }).mw = {
		config: {
			get: () => undefined
		},
		language: {
			getFallbackLanguageChain: () => chain
		}
	};
	return import('../src/i18n');
}

describe('i18n locale fallback', () => {
	it('falls back from zh-Hans-CN to simplified Chinese catalogue', async () => {
		const module = await loadI18n(['zh-hans', 'zh', 'zh-hant']);
		module.refreshLocale();
		expect(module.getLocale()).toBe('zh-hans');
		expect(module.t('greeting')).toBe('你好');
	});

	it('falls back from zh-Hant-HK to traditional Chinese catalogue', async () => {
		const module = await loadI18n(['zh-hk', 'zh-hant', 'zh-tw', 'zh', 'zh-hans']);
		module.refreshLocale();
		expect(module.getLocale()).toBe('zh-hant');
		expect(module.t('greeting')).toBe('妳好');
	});
});
