-- This module implements {{Reaction}}.
-- Maintainers: SunAfterRain, SuperGrey
-- <nowiki>
local p = {}
local mIfexist

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

local iconInvalidDisplay = "<span class=\"error\">不-{zh-hans:支持;zh-hant:支援;}-輸入的圖標</span>"

function p._main(args)
    local iconInput = args[1] or "👍"
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
            iconDisplay = iconInvalidDisplay
            iconInvalid = true
        end
    else
        iconDisplay = iconInvalidDisplay
    end

    local reactions = {}
    while true do
        local currentItem = args[1 + #reactions + 1] -- 反應者從第二個參數開始
        if currentItem == nil then
            break
        end
        currentItem = mw.text.trim(currentItem)
        if currentItem == '' then
            break
        end
        table.insert(reactions, currentItem)
    end
    local realReactionCount = #reactions -- 真實計數
    local reactionTitle = (realReactionCount >= 1 and mw.text.listToText(reactions, '、', '、') or '没有人') ..
                              '回应了这条留言'
    local reactionCount = stripInputCount(args.num, realReactionCount) -- 顯示的計數

    local out = mw.html.create('span'):addClass('reactionable'):addClass('template-reaction'):attr('title',
        reactionTitle):attr('data-reaction-commentors', table.concat(reactions, '/')):attr('data-reaction-icon',
        iconData):attr('data-reaction-icon-invalid', iconInvalid and "" or nil):attr('data-reaction-count',
        reactionCount):attr('data-reaction-real-count', realReactionCount)

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
