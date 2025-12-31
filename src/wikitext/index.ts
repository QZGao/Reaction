export {
	normalizeIcon,
	parseLegacyParticipant,
	parseReactionTemplateText,
	serializeReactionTemplate,
	findReactionTemplates,
	findTemplateByIcon,
	removeReactionFromLine,
	addReactionToLine,
	appendReactionTemplate,
} from "./reactionTemplates";

export type {
	ReactionParticipant,
	ReactionTemplateData,
	ReactionTemplateMatch,
} from "./reactionTemplates";
