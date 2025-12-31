-- This module implements {{Reaction}}.
-- Maintainers: SunAfterRain, SuperGrey
-- Repository: https://github.com/QZGao/Reaction
-- Release: {{module.reaction.version}}
-- Timestamp: {{module.reaction.timestamp}}
-- <nowiki>
local p = {}
local mIfexist

-- Centralized text constants for the on-wiki fallback UI.
local TEXT = {
    iconInvalidMessage = "{{module.reaction.icon_invalid_message}}",
    tooltipSeparator = "{{module.reaction.tooltip_separator}}",
    tooltipSuffix = "{{module.reaction.tooltip_suffix}}",
    tooltipStamp = "{{module.reaction.tooltip_stamp}}",
    tooltipPrefixNoReactions = "{{module.reaction.tooltip_prefix_no_reactions}}"
}
TEXT.tooltipNoReactions = TEXT.tooltipPrefixNoReactions .. TEXT.tooltipSuffix

-- Attempt to interpret iconInput as a File: title and return a file link if it exists.
-- Otherwise, return false.
local function mayMakeFile(iconInput)
    local success, title = pcall(mw.title.new, iconInput)
    if success and title and title.namespace == 6 then
        if not mIfexist then
            mIfexist = require('Module:Ifexist')
        end
        -- if title.file.exists then
        if mIfexist._pfFileExists(title) then
            return string.format('[[File:%s|x20px|link=]]', title.text)
        end
    end
    return false
end

local jsonEncode = mw.text.jsonEncode

-- Determine the displayed reaction count based on user input and actual count.
local function stripInputCount(inputCount, realCount)
    if inputCount ~= nil then
        inputCount = mw.text.trim(inputCount)
        if inputCount == "" then
            return "0"
        else
            -- Example input allows 99+, so keep the trailing plus and drop leading zeros.
            local num = mw.ustring.match(inputCount, "^0*(%d+%+?)$")
            if num then
                return num
            end
        end
    end
    return tostring(realCount)
end

-- Remove all HTML tags from content.
local function unstripHTML(content)
    content = mw.ustring.gsub(content, "%s*<[^>]+>%s*", "")
    return content
end

-- Custom unstrip function to keep whitelisted extension tags.
local function unstripMarkersCustom(content)
    -- from [[Module:Check_for_unknown_parameters]] # local function clean
    content = mw.ustring.gsub(content, "(\127[^\127]*%-(%l+)%-[^\127]*\127)", function(fullTag, tag)
        if tag == 'nowiki' then
            -- unstrip nowiki content
            return mw.text.unstripNoWiki(fullTag)
        elseif tag == 'templatestyles' or tag == 'math' or tag == 'chem' then
            -- keep templatestyles and low-risk extension tags that interact with templates
            return fullTag
        end
        -- discard all other tags entirely
        return ""
    end)
    return content
end

-- Extract all class attributes and return them as arrays of tokens.
local function extractHTMLClassLists(input)
    local result = {}

    -- 1) Quoted attributes: class="..." or class='...'
    for _, val in input:gmatch([[%f[%w]class%f[^%w]%s*=%s*(["'])(.-)%1]]) do
        local arr = {}
        for cls in val:gmatch("%S+") do
            arr[#arr + 1] = cls
        end
        result[#result + 1] = arr
    end

    -- 2) Unquoted attributes: class=xxx (stop at first delimiter)
    -- HTML forbids whitespace or " ' = < > ` in unquoted values
    for val in input:gmatch([[%f[%w]class%f[^%w]%s*=%s*([^%s"'=<>`]+)]]) do
        result[#result + 1] = {val}
    end

    return result
end

local inArray

-- Validate that for every occurrence of requiredClass, dependentClass is also present.
-- Returns true if valid, false if a violation is found.
local function validateClassDependency(input, requiredClass, dependentClass)
    if not inArray then
        inArray = require('Module:TableTools').inArray
    end

    for _, classList in ipairs(extractHTMLClassLists(input)) do
        if inArray(classList, requiredClass) and not inArray(classList, dependentClass) then
            return false
        end
    end
    return true
end

-- Format a single tooltip entry for a reaction.
-- If timestamp is provided, include it.
local function formatTooltipEntry(user, timestamp)
    if timestamp and timestamp ~= "" then
        return string.format(TEXT.tooltipStamp, user, timestamp)
    end
    return user
end

-- Parse legacy reaction format from positional parameter.
-- Returns user and timestamp (may be nil).
local function parseLegacyReaction(entry)
    local trimmed = mw.text.trim(entry or "")
    if trimmed == "" then
        return nil, nil
    end
    local user, timestamp = mw.ustring.match(trimmed, "^(.-)[於于]%s*(.+)$")
    if user then
        user = mw.text.trim(user)
        timestamp = mw.text.trim(timestamp)
        if user == "" then
            user = trimmed
        end
        if timestamp == "" then
            timestamp = nil
        end
        return user, timestamp
    end
    return trimmed, nil
end

local function trimOrNil(value)
    if value == nil then
        return nil
    end
    local trimmed = mw.text.trim(value)
    if trimmed == "" then
        return nil
    end
    return trimmed
end

-- Collect reactions from parameters.
-- Supports both named parameters (user1=..., ts1=...) and positional parameters.
local function collectReactions(args, iconConsumesPositionalSlot)
    local reactions = {}
    local index = 1
    local positionalOffset = iconConsumesPositionalSlot and 1 or 0
    while true do
        local userParam = trimOrNil(args["user" .. index])
        local timestampParam = trimOrNil(args["ts" .. index] or args["timestamp" .. index])
        if not timestampParam and index == 1 then
            timestampParam = trimOrNil(args.ts or args.timestamp)
        end
        local positionalValue = trimOrNil(args[index + positionalOffset])
        if not positionalValue and positionalOffset ~= 1 then
            positionalValue = trimOrNil(args[index + 1])
        end

        if not userParam and not timestampParam and not positionalValue then
            break
        end

        local user = userParam
        local timestamp = timestampParam

        if (not user or user == "") and positionalValue then
            local legacyUser, legacyTimestamp = parseLegacyReaction(positionalValue)
            if legacyUser and legacyUser ~= "" then
                user = legacyUser
                if not timestamp and legacyTimestamp and legacyTimestamp ~= "" then
                    timestamp = legacyTimestamp
                end
            else
                user = positionalValue
            end
        end

        if user and user ~= "" then
            reactions[#reactions + 1] = {
                user = user,
                timestamp = timestamp
            }
        end
        index = index + 1
    end
    return reactions
end

function p._main(args)
    local iconConsumesPositionalSlot = false
    local iconInput = trimOrNil(args.icon)
    if iconInput then
        iconInput = mw.text.trim(iconInput)
    else
        local positionalIcon = trimOrNil(args[1])
        if positionalIcon then
            iconInput = positionalIcon
            iconConsumesPositionalSlot = true
        else
            iconInput = "👍"
        end
    end
    local iconInvalid = false
    iconInput = mw.text.trim(iconInput)
    if -- Known cases that reliably break the layout (and exceed intended usage)
    mw.ustring.find(iconInput, "<div[ >]") or mw.ustring.find(iconInput, "<table[ >]") or
        mw.ustring.find(iconInput, "<p[ >]") or mw.ustring.find(iconInput, "<li[ >]") or
        mw.ustring.find(iconInput, "\n") or mw.ustring.find(iconInput, "template%-reaction") or
        -- Only allow zhwp-talkicon inputs that also carry the reactionable class
        (mw.ustring.find(iconInput, "zhwp%-talkicon") and
            not validateClassDependency(iconInput, 'zhwp-talkicon', 'zhwp-talkicon-reactionable')) then
        iconInvalid = true
    end

    local iconData = unstripHTML(mw.text.unstrip(iconInput))
    local iconDisplay
    if not iconInvalid then
        -- Custom unstrip to keep whitelisted marks
        iconDisplay = mayMakeFile(iconInput) or mw.text.trim(unstripMarkersCustom(iconInput))
        if iconDisplay == "" then
            -- Only discarded extension tags survived, treat as invalid
            iconDisplay = string.format('<span class="error">%s</span>', TEXT.iconInvalidMessage)
            iconInvalid = true
        end
    else
        iconDisplay = string.format('<span class="error">%s</span>', TEXT.iconInvalidMessage)
    end

    local reactions = collectReactions(args, iconConsumesPositionalSlot)
    local realReactionCount = #reactions -- actual count
    local reactionNames = {}
    local structuredReactions = {}
    for _, reaction in ipairs(reactions) do
        reactionNames[#reactionNames + 1] = formatTooltipEntry(reaction.user, reaction.timestamp)
        structuredReactions[#structuredReactions + 1] = {
            user = reaction.user,
            timestamp = reaction.timestamp
        }
    end
    local reactionTitle
    if realReactionCount >= 1 then
        local list = mw.text.listToText(reactionNames, TEXT.tooltipSeparator, TEXT.tooltipSeparator)
        reactionTitle = list .. TEXT.tooltipSuffix
    else
        reactionTitle = TEXT.tooltipNoReactions
    end
    local reactionCount = stripInputCount(args.num, realReactionCount) -- displayed count

    local out = mw.html.create('span'):addClass('reactionable'):addClass('template-reaction'):attr('title',
        reactionTitle):attr('data-reaction-commentors', table.concat(reactionNames, '/')):attr(
        'data-reaction-commentors-json', jsonEncode(structuredReactions)):attr('data-reaction-icon', iconData):attr(
        'data-reaction-icon-invalid', iconInvalid and "" or nil):attr('data-reaction-count', reactionCount):attr(
        'data-reaction-real-count', realReactionCount)

    local content = out:tag('span'):addClass('reaction-content')

    -- icon
    content:tag('span'):addClass('reaction-icon-container'):tag('span'):addClass('reaction-icon'):wikitext(iconDisplay)

    -- counter
    content:tag('span'):addClass('reaction-counter-container'):tag('span'):addClass('reaction-counter'):wikitext(
        tostring(reactionCount))

    return mw.getCurrentFrame():extensionTag({
        name = 'templatestyles',
        args = {
            src = 'Template:Reaction/styles.css'
        }
    }) .. tostring(out)
end

function p.main(frame)
    local parent = frame:getParent()
    if not parent then
        -- Stop if the template wasn't invoked
        return ''
    end

    return p._main(parent.args)
end

return p
-- </nowiki>
