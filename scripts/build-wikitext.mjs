import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const templatePath = path.join(projectRoot, "wikitext", "Reaction.module.lua");
const i18nDir = path.join(projectRoot, "i18n");
const outputDir = path.join(projectRoot, "dist");
const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

const PLACEHOLDERS = [
	"module.reaction.icon_invalid_message",
	"module.reaction.tooltip_separator",
	"module.reaction.tooltip_suffix",
	"module.reaction.tooltip_stamp",
	"module.reaction.tooltip_prefix_no_reactions",
	"module.reaction.legacy_separator_pattern",
];

const FALLBACK_LANG = "en";

function luaEscape(value) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r?\n/g, "\\n")
		.replace(/\t/g, "\\t");
}

function loadJson(filePath) {
	const raw = fs.readFileSync(filePath, "utf-8");
	return JSON.parse(raw);
}

function loadTranslations(language) {
	const filePath = path.join(i18nDir, `${language}.json`);
	if (!fs.existsSync(filePath)) {
		throw new Error(`Missing translation file for ${language}`);
	}
	return loadJson(filePath);
}

function applyPlaceholders(template, translations, fallbackTranslations) {
	let output = template;
	for (const key of PLACEHOLDERS) {
		const marker = `{{${key}}}`;
		if (!output.includes(marker)) {
			throw new Error(`Missing placeholder ${marker} in template.`);
		}
		const translatedValue = translations[key] ?? fallbackTranslations[key];
		if (typeof translatedValue !== "string") {
			throw new Error(`Missing translation for ${key}`);
		}
		output = output.split(marker).join(luaEscape(translatedValue));
	}
	return output;
}

function getLanguages() {
	return fs
		.readdirSync(i18nDir)
		.filter((file) => file.endsWith(".json"))
		.map((file) => path.basename(file, ".json"))
		.sort();
}

async function buildModules() {
	const timestamp = new Date().toISOString();
	const template = fs.readFileSync(templatePath, "utf-8")
		.replace("{{module.reaction.version}}", pkgJson.version)
		.replace("{{module.reaction.timestamp}}", timestamp);
	const fallbackTranslations = loadTranslations(FALLBACK_LANG);
	await fs.promises.mkdir(outputDir, { recursive: true });

	for (const language of getLanguages()) {
		const translations = loadTranslations(language);
		const rendered = applyPlaceholders(template, translations, fallbackTranslations);
		const targetPath = path.join(outputDir, `Reaction.module.${language}.lua`);
		await fs.promises.writeFile(targetPath, rendered, "utf-8");
		console.log(`[Reaction module] Built ${path.basename(targetPath)}`);
	}
}

await buildModules();
