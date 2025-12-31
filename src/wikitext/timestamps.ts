import moment from "moment-timezone";

type MessageMap = Record<string, string>;

const INVISIBLE_MARK_PATTERN = "[\\u200E\\u200F]?";

const DEFAULT_MESSAGES: MessageMap = {
	// Month names
	january: "January",
	february: "February",
	march: "March",
	april: "April",
	may_long: "May",
	june: "June",
	july: "July",
	august: "August",
	september: "September",
	october: "October",
	november: "November",
	december: "December",
	// Genitive forms (English matches the nominative)
	"january-gen": "January",
	"february-gen": "February",
	"march-gen": "March",
	"april-gen": "April",
	"may-gen": "May",
	"june-gen": "June",
	"july-gen": "July",
	"august-gen": "August",
	"september-gen": "September",
	"october-gen": "October",
	"november-gen": "November",
	"december-gen": "December",
	// Month abbreviations
	jan: "Jan",
	feb: "Feb",
	mar: "Mar",
	apr: "Apr",
	may: "May",
	jun: "Jun",
	jul: "Jul",
	aug: "Aug",
	sep: "Sep",
	oct: "Oct",
	nov: "Nov",
	dec: "Dec",
	// Weekday abbreviations
	sun: "Sun",
	mon: "Mon",
	tue: "Tue",
	wed: "Wed",
	thu: "Thu",
	fri: "Fri",
	sat: "Sat",
	// Weekday names
	sunday: "Sunday",
	monday: "Monday",
	tuesday: "Tuesday",
	wednesday: "Wednesday",
	thursday: "Thursday",
	friday: "Friday",
	saturday: "Saturday",
};

function escapeRegexLiteral(text: string): string {
	return text.replace(/[\\^$.*+?()[\]{}|\-]/g, "\\$&");
}

function getMessages(keys: string[], overrides?: MessageMap): string[] {
	return keys.map((key) => overrides?.[key] ?? DEFAULT_MESSAGES[key] ?? key);
}

function regexpGroup(pattern: string): string {
	return `(${pattern})`;
}

function regexpAlternateGroup(values: string[]): string {
	return regexpGroup(values.map((value) => escapeRegexLiteral(value)).join("|"));
}

interface TimestampMessageOptions {
	messages?: MessageMap;
}

export interface TimestampRegexpOptions extends TimestampMessageOptions {
	digitsPattern?: string;
	timezoneAbbreviations: Record<string, string>;
}

export function getTimestampRegexp(format: string, options: TimestampRegexpOptions): string {
	const digitsPattern = options.digitsPattern ?? "\\d";
	const tzKeys = Object.keys(options.timezoneAbbreviations);
	if (tzKeys.length === 0) {
		throw new Error("timezoneAbbreviations must contain at least one entry");
	}

	let result = "";
	let rawNumbers = false;
	for (let p = 0; p < format.length; p++) {
		let numericLength: string | false = false;
		let code = format[p];
		if (code === "x" && p < format.length - 1) {
			code += format[++p];
		}
		if (code === "xk" && p < format.length - 1) {
			code += format[++p];
		}

		switch (code) {
			case "xx":
				result += "x";
				break;
			case "xg":
				result += regexpAlternateGroup(
					getMessages(
						[
							"january-gen",
							"february-gen",
							"march-gen",
							"april-gen",
							"may-gen",
							"june-gen",
							"july-gen",
							"august-gen",
							"september-gen",
							"october-gen",
							"november-gen",
							"december-gen",
						],
						options.messages,
					),
				);
				break;
			case "xn":
				rawNumbers = true;
				break;
			case "d":
			case "m":
			case "H":
			case "i":
			case "s":
				numericLength = "2";
				break;
			case "j":
			case "n":
			case "G":
				numericLength = "1,2";
				break;
			case "Y":
			case "xkY":
				numericLength = "4";
				break;
			case "D":
				result += regexpAlternateGroup(
					getMessages(["sun", "mon", "tue", "wed", "thu", "fri", "sat"], options.messages),
				);
				break;
			case "l":
				result += regexpAlternateGroup(
					getMessages(
						["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
						options.messages,
					),
				);
				break;
			case "F":
				result += regexpAlternateGroup(
					getMessages(
						[
							"january",
							"february",
							"march",
							"april",
							"may_long",
							"june",
							"july",
							"august",
							"september",
							"october",
							"november",
							"december",
						],
						options.messages,
					),
				);
				break;
			case "M":
				result += regexpAlternateGroup(
					getMessages(
						["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
						options.messages,
					),
				);
				break;
			case "\\":
				if (p < format.length - 1) {
					result += escapeRegexLiteral(format[++p]);
				} else {
					result += escapeRegexLiteral("\\");
				}
				break;
			case '"': {
				if (p < format.length - 1) {
					const endQuote = format.indexOf('"', p + 1);
					if (endQuote === -1) {
						result += '"';
					} else {
						result += escapeRegexLiteral(format.slice(p + 1, endQuote));
						p = endQuote;
					}
				} else {
					result += '"';
				}
				break;
			}
			default: {
				const codePoint = format.codePointAt(p);
				if (codePoint === undefined) {
					break;
				}
				const char = String.fromCodePoint(codePoint);
				result += escapeRegexLiteral(char);
				p += char.length - 1;
			}
		}

		if (numericLength !== false) {
			if (rawNumbers) {
				result += regexpGroup(`[0-9]{${numericLength}}`);
				rawNumbers = false;
			} else {
				result += regexpGroup(`${digitsPattern}{${numericLength}}`);
			}
		}
		result += INVISIBLE_MARK_PATTERN;
	}

	const timezoneAlternates = regexpAlternateGroup(Object.keys(options.timezoneAbbreviations));
	return `${result} ${INVISIBLE_MARK_PATTERN}\\(${timezoneAlternates}\\)`;
}

export interface TimestampParserOptions extends TimestampMessageOptions {
	digits?: string[] | null;
	timeZone: string;
	timezoneAbbreviations: Record<string, string>;
}

export interface ParsedTimestamp {
	date: Date;
	warning: string | null;
}

export type TimestampParserFn = (
	match: RegExpMatchArray | Array<string | null> | null,
) => ParsedTimestamp | null;

export function getTimestampParser(format: string, options: TimestampParserOptions): TimestampParserFn {
	const groupOrder: string[] = [];
	for (let p = 0; p < format.length; p++) {
		let code = format[p];
		if (code === "x" && p < format.length - 1) {
			code += format[++p];
		}
		if (code === "xk" && p < format.length - 1) {
			code += format[++p];
		}
		switch (code) {
			case "xx":
			case "xn":
				break;
			case "\\":
				if (p < format.length - 1) {
					p++;
				}
				break;
			case '"': {
				if (p < format.length - 1) {
					const endQuote = format.indexOf('"', p + 1);
					if (endQuote !== -1) {
						p = endQuote;
					}
				}
				break;
			}
			default: {
				if (
					code === "xg" ||
					code === "d" ||
					code === "j" ||
					code === "D" ||
					code === "l" ||
					code === "F" ||
					code === "M" ||
					code === "m" ||
					code === "n" ||
					code === "Y" ||
					code === "xkY" ||
					code === "G" ||
					code === "H" ||
					code === "i" ||
					code === "s"
				) {
					groupOrder.push(code);
				}
			}
		}
	}

	const digitMap = new Map<string, string>();
	if (options.digits) {
		options.digits.forEach((digit, index) => {
			digitMap.set(digit, String(index));
		});
	}
	const untransformDigits = (text: string): number => {
		if (digitMap.size === 0) {
			return Number(text);
		}
		const normalized = Array.from(text)
			.map((char) => digitMap.get(char) ?? char)
			.join("");
		return Number(normalized);
	};

	return (match) => {
		if (!match) {
			return null;
		}

		let year = 0;
		let monthIdx = 0;
		let day = 0;
		let hour = 0;
		let minute = 0;

		for (let i = 0; i < groupOrder.length; i++) {
			const code = groupOrder[i];
			const text = match[i + 1] ?? "";
			switch (code) {
				case "xg":
					monthIdx = getMessages(
						[
							"january-gen",
							"february-gen",
							"march-gen",
							"april-gen",
							"may-gen",
							"june-gen",
							"july-gen",
							"august-gen",
							"september-gen",
							"october-gen",
							"november-gen",
							"december-gen",
						],
						options.messages,
					).indexOf(text);
					break;
				case "d":
				case "j":
					day = untransformDigits(text);
					break;
				case "D":
				case "l":
					break;
				case "F":
					monthIdx = getMessages(
						[
							"january",
							"february",
							"march",
							"april",
							"may_long",
							"june",
							"july",
							"august",
							"september",
							"october",
							"november",
							"december",
						],
						options.messages,
					).indexOf(text);
					break;
				case "M":
					monthIdx = getMessages(
						["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
						options.messages,
					).indexOf(text);
					break;
				case "m":
				case "n":
					monthIdx = untransformDigits(text) - 1;
					break;
				case "Y":
					year = untransformDigits(text);
					break;
				case "xkY":
					year = untransformDigits(text) - 543;
					break;
				case "G":
				case "H":
					hour = untransformDigits(text);
					break;
				case "i":
					minute = untransformDigits(text);
					break;
				case "s":
					break;
				default:
					throw new Error(`Unhandled format code ${code}`);
			}
		}

		const tzMatch = match[match.length - 1];
		const tzAbbr = (tzMatch && options.timezoneAbbreviations[tzMatch]) || tzMatch;

		let parsedMoment = moment.tz([year, monthIdx, day, hour, minute], options.timeZone);
		let warning: string | null = null;

		if (tzAbbr && parsedMoment.zoneAbbr() !== tzAbbr) {
			moment.tz.moveAmbiguousForward = true;
			const alternateMoment = moment.tz([year, monthIdx, day, hour, minute], options.timeZone);
			moment.tz.moveAmbiguousForward = false;
			if (alternateMoment.zoneAbbr() !== tzAbbr) {
				warning = "Timestamp has timezone abbreviation for the wrong time";
			} else {
				warning = "Ambiguous time at DST switchover was parsed";
				parsedMoment = alternateMoment;
			}
		}

		if (!parsedMoment.isValid()) {
			return null;
		}

		return {
			date: parsedMoment.toDate(),
			warning,
		};
	};
}
