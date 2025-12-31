import { describe, it, expect } from "vitest";

import regexCases from "../cases/timestamp-regex.json";
import parserCases from "../cases/timestamp-parser.json";
import parserDstCases from "../cases/timestamp-parser-dst.json";
import { getTimestampParser, getTimestampRegexp } from "../../src/wikitext/timestamps";

describe("wikitext timestamp utilities", () => {
	describe("getTimestampRegexp", () => {
		regexCases.forEach((caseItem) => {
			it(caseItem.message, () => {
				const regexp = getTimestampRegexp(caseItem.format, {
					digitsPattern: "\\d",
					timezoneAbbreviations: { UTC: "UTC" },
				});
				expect(regexp).toBe(caseItem.expected);
			});
		});
	});

	describe("getTimestampParser", () => {
		parserCases.forEach((caseItem) => {
			it(caseItem.message, () => {
				const parser = getTimestampParser(caseItem.format, {
					digits: caseItem.digits,
					timeZone: "UTC",
					timezoneAbbreviations: { UTC: "UTC" },
				});
				const result = parser(caseItem.data);
				expect(result).not.toBeNull();
				expect(result?.date.toISOString()).toBe(new Date(caseItem.expected).toISOString());
				expect(result?.warning).toBeNull();
			});
		});

		parserDstCases.forEach((caseItem) => {
			it(caseItem.message, () => {
				const regexp = new RegExp(
					getTimestampRegexp(caseItem.format, {
						digitsPattern: "\\d",
						timezoneAbbreviations: caseItem.timezoneAbbrs,
					}),
				);
				const match = caseItem.sample.match(regexp);
				expect(match).not.toBeNull();
				const parser = getTimestampParser(caseItem.format, {
					digits: null,
					timeZone: caseItem.timezone,
					timezoneAbbreviations: caseItem.timezoneAbbrs,
				});
				const result = parser(match);
				expect(result).not.toBeNull();
				expect(result?.date.getTime()).toBe(new Date(caseItem.expected).getTime());
				expect(result?.date.getTime()).toBe(new Date(caseItem.expectedUtc).getTime());
			});
		});
	});
});
