-- This module implements {{Reaction}}.
-- Maintainers: SunAfterRain, SuperGrey
-- Repository: https://github.com/QZGao/Reaction
-- <nowiki>
local p = {}
local mIfexist

-- Centralized text constants for the on-wiki fallback UI.
local TEXT = {
    iconInvalidMessage = "不-{zh-hans:支持;zh-hant:支援;}-輸入的圖標",
    tooltipSeparator = "、",
    tooltipSuffix = "回应了这条留言",
    tooltipStamp = "%s於%s",
    tooltipPrefixNoReactions = "没有人",
    legacySeparatorPattern = "^(.-)[於于]%s*(.+)$"
}
TEXT.tooltipNoReactions = TEXT.tooltipPrefixNoReactions .. TEXT.tooltipSuffix

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

local function stripInputCount(inputCount, realCount)
    if inputCount ~= nil then
        inputCount = mw.text.trim(inputCount)
        if inputCount == "" then
            return "0"
        else
            -- 示例使用了 99+ 所以這裡也允許尾隨 + 號
            -- 順便把前導 0 也丟掉
            local num = mw.ustring.match(inputCount, "^0*(%d+%+?)$")
            if num then
                return num
            end
        end
    end
    return tostring(realCount)
end

local function unstripHTML(content)
    content = mw.ustring.gsub(content, "%s*<[^>]+>%s*", "")
    return content
end

local function unstripMarkersCustom(content)
    -- from [[Module:Check_for_unknown_parameters]] # local function clean
    content = mw.ustring.gsub(content, "(\127[^\127]*%-(%l+)%-[^\127]*\127)", function(fullTag, tag)
        if tag == 'nowiki' then
            -- unstrip nowiki
            return mw.text.unstripNoWiki(fullTag)
        elseif tag == 'templatestyles' or tag == 'math' or tag == 'chem' then
            -- 保留 templatestyles & 已確認和模板使用低機率會炸裂的標籤
            return fullTag
        end
        -- 其他通通拋棄
        return ""
    end)
    return content
end

-- 取出所有 class 值並轉成二維陣列
local function extractHTMLClassLists(input)
    local result = {}

    -- 1) 有引號：class="..." 或 class='...'
    for _, val in input:gmatch([[%f[%w]class%f[^%w]%s*=%s*(["'])(.-)%1]]) do
        local arr = {}
        for cls in val:gmatch("%S+") do
            arr[#arr + 1] = cls
        end
        result[#result + 1] = arr
    end

    -- 2) 無引號：class=xxx（只到第一個分隔字元）
    -- HTML 無引號屬性值不得包含空白 " ' = < > ` 等字元
    for val in input:gmatch([[%f[%w]class%f[^%w]%s*=%s*([^%s"'=<>`]+)]]) do
        result[#result + 1] = {val}
    end

    return result
end

local inArray
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

local function formatTooltipEntry(user, timestamp)
    if timestamp and timestamp ~= "" then
        return string.format(TEXT.tooltipStamp, user, timestamp)
    end
    return user
end

local function parseLegacyReaction(entry)
    local trimmed = mw.text.trim(entry or "")
    if trimmed == "" then
        return nil, nil
    end
    local user, timestamp = mw.ustring.match(trimmed, TEXT.legacySeparatorPattern)
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
    if -- 已知幾乎無例外會大爆炸的案例（並且也明顯超出這個模板本來的用法）
    mw.ustring.find(iconInput, "<div[ >]") or mw.ustring.find(iconInput, "<table[ >]") or
        mw.ustring.find(iconInput, "<p[ >]") or mw.ustring.find(iconInput, "<li[ >]") or
        mw.ustring.find(iconInput, "\n") or mw.ustring.find(iconInput, "template%-reaction") or
        -- 僅允許特意添加 zhwp-talkicon-reactionable 的圖標反應
        (mw.ustring.find(iconInput, "zhwp%-talkicon") and
            not validateClassDependency(iconInput, 'zhwp-talkicon', 'zhwp-talkicon-reactionable')) then
        iconInvalid = true
    end

    local iconData = unstripHTML(mw.text.unstrip(iconInput))
    local iconDisplay
    if not iconInvalid then
        -- 這裡可以保留部分 mark 所以用自定義寫法
        iconDisplay = mayMakeFile(iconInput) or mw.text.trim(unstripMarkersCustom(iconInput))
        if iconDisplay == "" then
            -- 只有被拋棄掉的 extension tag
            iconDisplay = string.format('<span class="error">%s</span>', TEXT.iconInvalidMessage)
            iconInvalid = true
        end
    else
        iconDisplay = string.format('<span class="error">%s</span>', TEXT.iconInvalidMessage)
    end

    local reactions = collectReactions(args, iconConsumesPositionalSlot)
    local realReactionCount = #reactions -- 真實計數
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
    local reactionCount = stripInputCount(args.num, realReactionCount) -- 顯示的計數

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
        -- 不是模板被引用
        return ''
    end

    return p._main(parent.args)
end

return p
-- </nowiki>
