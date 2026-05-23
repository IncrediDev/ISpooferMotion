--!strict
local pluginEnvironment     = script.Parent
local assets                = pluginEnvironment.Assets
local coreGui               = game:GetService("CoreGui")
local tweenService          = game:GetService("TweenService")
local marketplace           = game:GetService("MarketplaceService")
local serverStorage         = game:GetService("ServerStorage")
local scriptEditorService   = game:GetService("ScriptEditorService")
local studioUserId          = plugin:GetStudioUserId()

local createUnifiedUI       = require(assets.UnifiedUIFactory)

local isProcessing          = false
local isReplacingIds        = false
local activeOperationId     = 0
local getIdsConnections     = {}
local replaceIdsConnections = {}
local unifiedUi             = nil

local function beginOperation()
  activeOperationId += 1
  isProcessing = true
  return activeOperationId
end

local function cancelOperation()
  activeOperationId += 1
  isProcessing = false
end

local function isOperationCurrent(operationId)
  return isProcessing and activeOperationId == operationId
end

local DIRECT_YIELD_BATCH         = 4096
local SCRIPT_YIELD_BATCH         = 512
local PRODUCT_INFO_WORKERS_MAX   = 512
local PRODUCT_INFO_MAX_RETRIES   = 3
local UI_PROGRESS_INTERVAL       = 0.12
local SOURCE_READ_WORKERS        = 256
local REPLACE_SOURCE_WORKERS     = 64
local CACHE_TTL                  = 86400
local CACHE_SETTING_KEY          = "ISM_ProductInfoCache_v3"
local SCRIPT_CACHE_SETTING_KEY   = "ISM_ScriptSourceCache_v1"
local PERSIST_CACHE_MIN_INTERVAL = 60
local SCAN_RESULT_CACHE_TTL      = 45
local NEGATIVE_CACHE_TTL         = 21600
local SCRIPT_CACHE_TTL           = 86400
local SCRIPT_CACHE_MAX_ENTRIES   = 2000
local DEBUG_REPLACED_PATH_LIMIT  = 500

local productInfoCache           = {}
local productInfoCacheDirty      = false
local lastPersistTime            = 0
local persistedScriptSourceCache = {}
local scriptSourceCacheDirty     = false
local lastScriptPersistTime      = 0

local lastScanResults            = nil
local lastScanTime               = 0

local PLUGIN_VERSION = "__ISPOOFERMOTION_VERSION__"
if PLUGIN_VERSION:match("^__") then PLUGIN_VERSION = "dev" end

local IGNORED_ANIMATION_CREATOR_USER_IDS = { [1] = true }

local function getProjectCacheKey()
  return tostring(game.GameId or 0) .. ":" .. tostring(game.PlaceId or 0)
end

local function loadPersistedCache()
  local ok, data = pcall(function() return plugin:GetSetting(CACHE_SETTING_KEY) end)
  if not (ok and type(data) == "table") then return end

  local now = os.time()
  for assetId, entry in pairs(data) do
    if type(entry) == "table" and type(entry.t) == "number" and entry.v ~= nil then
      local ttl = (entry.v == false) and NEGATIVE_CACHE_TTL or CACHE_TTL
      if now - entry.t < ttl then
        productInfoCache[assetId] = entry.v
      end
    end
  end
end

local function persistCache(force)
  if not productInfoCacheDirty and not force then return end
  local now = os.time()
  if not force and now - lastPersistTime < PERSIST_CACHE_MIN_INTERVAL then return end

  lastPersistTime = now
  local toSave = {}

  for assetId, value in pairs(productInfoCache) do
    if value ~= nil then
      toSave[assetId] = { t = now, v = value }
    end
  end

  local ok = pcall(function() plugin:SetSetting(CACHE_SETTING_KEY, toSave) end)
  if ok then productInfoCacheDirty = false end
end

local function mapToSortedList(map)
  local list = {}
  for id in pairs(map or {}) do table.insert(list, id) end
  table.sort(list, function(a, b) return tonumber(a) < tonumber(b) end)
  return list
end

local function listToMap(list)
  local map = {}
  if type(list) == "table" then
    for _, id in ipairs(list) do
      id = tostring(id or ""):match("^(%d+)$")
      if id then map[id] = true end
    end
  end
  return map
end

local function loadPersistedScriptSourceCache()
  local ok, data = pcall(function() return plugin:GetSetting(SCRIPT_CACHE_SETTING_KEY) end)
  if not (ok and type(data) == "table") then return end
  if data.projectKey ~= getProjectCacheKey() or type(data.entries) ~= "table" then return end

  local now = os.time()
  for path, entry in pairs(data.entries) do
    if type(path) == "string" and type(entry) == "table" and type(entry.t) == "number" and type(entry.fp) == "string" then
      if now - entry.t < SCRIPT_CACHE_TTL then
        persistedScriptSourceCache[path] = {
          t = entry.t,
          fp = entry.fp,
          animation = listToMap(entry.animation),
          sound = listToMap(entry.sound),
        }
      end
    end
  end
end

local function persistScriptSourceCache(force)
  if not scriptSourceCacheDirty and not force then return end
  local now = os.time()
  if not force and now - lastScriptPersistTime < PERSIST_CACHE_MIN_INTERVAL then return end

  lastScriptPersistTime = now
  local entries = {}
  local count = 0

  for path, entry in pairs(persistedScriptSourceCache) do
    if count >= SCRIPT_CACHE_MAX_ENTRIES then break end
    if type(entry) == "table" and type(entry.fp) == "string" and now - (entry.t or 0) < SCRIPT_CACHE_TTL then
      entries[path] = {
        t = entry.t or now,
        fp = entry.fp,
        animation = mapToSortedList(entry.animation),
        sound = mapToSortedList(entry.sound),
      }
      count += 1
    end
  end

  local ok = pcall(function()
    plugin:SetSetting(SCRIPT_CACHE_SETTING_KEY, {
      projectKey = getProjectCacheKey(),
      savedAt = now,
      entries = entries,
    })
  end)

  if ok then scriptSourceCacheDirty = false end
end

loadPersistedCache()
loadPersistedScriptSourceCache()

local scriptSourceCache = {}

local function sourceFingerprint(source)
  return #source .. ":" .. source:sub(1, 24) .. ":" .. source:sub(-48)
end

local scanHitLists = { animation = {}, sound = {} }

local sharedState = {
  stage = "scan", count = 0, total = 0, processed = 0, done = false,
}

local function resetSharedState(stage, total)
  sharedState.stage     = stage
  sharedState.count     = 0
  sharedState.total     = total
  sharedState.processed = 0
  sharedState.done      = false
end

local function disconnectConnections(connections)
  for _, connection in ipairs(connections) do
    if connection and connection.Disconnect then connection:Disconnect() end
  end
  table.clear(connections)
end

local function getOrCreateScale(instance)
  local scale = instance:FindFirstChildOfClass("UIScale")
  if not scale then
    scale = Instance.new("UIScale")
    scale.Parent = instance
  end
  return scale
end

local function tween(instance, info, properties)
  local t = tweenService:Create(instance, info, properties)
  t:Play()
  return t
end

local function animatePopupOpen(ui)
  local popup = ui:FindFirstChild("MainPopup")
  local dim   = ui:FindFirstChild("DimBackground")
  if not popup then return end
  local scale = getOrCreateScale(popup)
  scale.Scale = 0.92
  popup.Position = UDim2.new(0.5, 0, 0.52, 0)
  if dim then
    dim.BackgroundTransparency = 1
    tween(dim, TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { BackgroundTransparency = 0.42 })
  end
  tween(scale, TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 })
  tween(popup, TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Position = UDim2.new(0.5, 0, 0.5, 0) })
end

local function animatePopupClose(ui, afterClose)
  local popup = ui:FindFirstChild("MainPopup")
  local dim   = ui:FindFirstChild("DimBackground")
  if not popup then
    if afterClose then afterClose() end
    return
  end
  local scale = getOrCreateScale(popup)
  if dim then
    tween(dim, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { BackgroundTransparency = 1 })
  end
  local ct = tween(scale, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { Scale = 0.94 })
  tween(popup, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { Position = UDim2.new(0.5, 0, 0.52, 0) })
  ct.Completed:Once(function() if afterClose then afterClose() end end)
end

local function hideUiInstant(ui)
  if ui and ui.Parent then ui.Enabled = false end
end

local function hideOtherUIs(currentUi)
  if currentUi ~= unifiedUi then hideUiInstant(unifiedUi) end
end

local function formatLiveCount(count, total)
  return tostring(tonumber(count) or 0) .. "/" .. tostring(tonumber(total) or 0)
end

local function attachButtonAnimation(button, holder)
  local target = holder or button
  local scale  = getOrCreateScale(target)
  button.MouseEnter:Connect(function()
    tween(scale, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = 1.035 })
  end)
  button.MouseLeave:Connect(function()
    tween(scale, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = 1 })
  end)
  button.MouseButton1Down:Connect(function()
    tween(scale, TweenInfo.new(0.08, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = 0.97 })
  end)
  button.MouseButton1Up:Connect(function()
    tween(scale, TweenInfo.new(0.1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = 1.035 })
  end)
end

local function attachCloseAnimation(button)
  local glow = button:FindFirstChild("CloseHoverGlow") or button:FindFirstChild("HoverGlow")
  button.MouseEnter:Connect(function()
    if glow then tween(glow, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { BackgroundTransparency = 0.82 }) end
  end)
  button.MouseLeave:Connect(function()
    if glow then tween(glow, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { BackgroundTransparency = 1 }) end
  end)
end

local function getCreatorUserId(assetInfo)
  if not assetInfo or not assetInfo.Creator or assetInfo.Creator.CreatorType ~= "User" then return nil end
  return tonumber(assetInfo.Creator.CreatorTargetId or assetInfo.Creator.Id)
end

local function isOwnedByCurrentUser(assetInfo)
  return getCreatorUserId(assetInfo) == tonumber(studioUserId)
end

local function isCreatedByIgnoredUser(assetInfo, ignoredUserIds)
  local id = getCreatorUserId(assetInfo)
  return id ~= nil and ignoredUserIds and ignoredUserIds[id] == true
end

local toolbar      = plugin:CreateToolbar("ISpooferMotion")
local toggleButton = toolbar:CreateButton("Spoofer UI", "Opens the Spoofer UI.", "rbxassetid://11778372908")
toggleButton.ClickableWhenViewportHidden = true

-- ID extraction

local function addAssetId(ids, assetId)
  assetId = tostring(assetId or ""):match("^(%d+)$")
  if assetId then ids[assetId] = true end
end

local function getAssetIdFromProperty(value)
  local text = tostring(value or "")
  return text:match("rbxassetid://%s*(%d+)") or text:match("^%s*(%d+)%s*$")
end

local function collectIdsFromTextValue(value, targetIds)
  local text = tostring(value or "")
  for id in text:gmatch("rbxassetid://%s*(%d+)") do addAssetId(targetIds, id) end
  for id in text:gmatch("[?&]id=(%d+)")           do addAssetId(targetIds, id) end
  local bareId = text:match("^%s*(%d+)%s*$")
  if bareId then addAssetId(targetIds, bareId) end
end

local function collectPropertyIds(source, propertyName, targetIds)
  for value in source:gmatch(propertyName .. "%s*=%s*\"([^\"]*)\"") do collectIdsFromTextValue(value, targetIds) end
  for value in source:gmatch(propertyName .. "%s*=%s*'([^']*)'")   do collectIdsFromTextValue(value, targetIds) end
  for id    in source:gmatch(propertyName .. "%s*=%s*(%d+)")       do addAssetId(targetIds, id) end
end

local ANIM_SIGNALS = {
  "animationid", "animation", "loadanimation", "animtrack", "animid",
  "playanim", "animator", "keyframe", "r15", "r6", "emote", "dance",
  "idleanim", "runanim", "jumpanim", "swayanim", "toolanim",
  "animate", "animobj", "animname", "getmarkerreachedattime",
  "instance.new(\"animation\"", "instance.new('animation'",
}

local SOUND_SIGNALS = {
  "soundid", "sound", "audio", "music", "sfx", "playsound", "playlocal",
  "volume", "pitch", "looped", "rolloffmax", "rolloffmin", "timeposition",
  "soundgroup", "equalizersoundeffect", "reverb", "distortion",
  "instance.new(\"sound\"", "instance.new('sound'",
  ":play()", ":stop()", ":pause()", ":resume()",
}

local function contextLooksLikeKind(context, kind)
  local lower   = string.lower(tostring(context or ""))
  local signals = (kind == "animation") and ANIM_SIGNALS or SOUND_SIGNALS
  for _, signal in ipairs(signals) do
    if string.find(lower, signal, 1, true) then return true end
  end
  return false
end

local function extractLhsVarName(source, matchStart)
  local before  = source:sub(math.max(1, matchStart - 128), matchStart - 1)
  local varName = before:match("([%a_][%w_]*)%s*[=%[]%s*$")
               or before:match("([%a_][%w_]*)%s*=%s*[\"']?%s*$")
  return varName and string.lower(varName) or ""
end

local function idContextKind(source, matchStart, matchEnd)
  local ctx    = source:sub(math.max(1, matchStart - 160), math.min(#source, matchEnd + 160))
  local lhsVar = extractLhsVarName(source, matchStart)
  local isAnim  = contextLooksLikeKind(ctx, "animation") or contextLooksLikeKind(lhsVar, "animation")
  local isSound = contextLooksLikeKind(ctx, "sound")     or contextLooksLikeKind(lhsVar, "sound")
  return isAnim, isSound
end

-- Fast pre-check: returns (hasAnimSignals, hasSoundSignals) by scanning
-- the lowercased source once for the most common indicator words.
-- A script with neither can be skipped entirely before running any patterns.
local function detectSourceKindSignals(source)
  local lower    = string.lower(source)
  local hasAnim  = lower:find("animation", 1, true) ~= nil
                or lower:find("animid",    1, true) ~= nil
  local hasSound = lower:find("sound",     1, true) ~= nil
                or lower:find("audio",     1, true) ~= nil
                or lower:find("music",     1, true) ~= nil
                or lower:find("sfx",       1, true) ~= nil

  if lower:find("rbxassetid", 1, true) then
    hasAnim  = true
    hasSound = true
  end

  if source:find("{", 1, true) and source:find("%d%d%d%d%d%d%d") then
    hasAnim  = true
    hasSound = true
  end

  return hasAnim, hasSound
end

local function collectContextualIds(source, pattern, idsByKind, wantAnim, wantSound)
  local searchStart = 1
  while true do
    local matchStart, matchEnd, id = string.find(source, pattern, searchStart)
    if not matchStart then break end
    local isAnim, isSound = idContextKind(source, matchStart, matchEnd)
    if isAnim  and wantAnim  then addAssetId(idsByKind.animation, id) end
    if isSound and wantSound then addAssetId(idsByKind.sound, id)     end
    searchStart = matchEnd + 1
  end
end

local function collectBareNumberIds(source, idsByKind, wantAnim, wantSound)
  local searchStart = 1
  while true do
    local matchStart, matchEnd, numStr = string.find(source, "(%d+)", searchStart)
    if not matchStart then break end
    local len = #numStr
    if len >= 7 and len <= 15 then
      local alreadyAnim  = idsByKind.animation[numStr]
      local alreadySound = idsByKind.sound[numStr]
      if not (alreadyAnim and alreadySound) then
        local isAnim, isSound = idContextKind(source, matchStart, matchEnd)
        if isAnim  and wantAnim  and not alreadyAnim  then addAssetId(idsByKind.animation, numStr) end
        if isSound and wantSound and not alreadySound then addAssetId(idsByKind.sound, numStr)     end
      end
    end
    searchStart = matchEnd + 1
  end
end

local function collectLooseTableNumberIds(source, idsByKind, wantAnim, wantSound)
  if not (wantAnim or wantSound) then return end
  if not source:find("{", 1, true) then return end

  local searchStart = 1
  local sourceLength = #source

  while searchStart <= sourceLength do
    local assignStart, braceStart = source:find("=%s*{", searchStart)
    if not braceStart then
      assignStart, braceStart = source:find("return%s*{", searchStart)
    end

    if not braceStart then break end

    local blockStart, blockEnd = source:find("%b{}", braceStart)
    if blockStart and blockEnd then
      local contextStart = math.max(1, assignStart - 160)
      local contextEnd   = math.min(sourceLength, blockEnd + 80)
      local tableContext = source:sub(contextStart, contextEnd)
      local contextAnim  = contextLooksLikeKind(tableContext, "animation")
      local contextSound = contextLooksLikeKind(tableContext, "sound")
      local untypedTable = not contextAnim and not contextSound
      local block        = source:sub(blockStart, blockEnd)

      for numStr in block:gmatch("(%d+)") do
        local len = #numStr
        if len >= 7 and len <= 15 then
          if wantAnim and (contextAnim or untypedTable) then
            addAssetId(idsByKind.animation, numStr)
          end
          if wantSound and (contextSound or untypedTable) then
            addAssetId(idsByKind.sound, numStr)
          end
        end
      end

      searchStart = blockEnd + 1
    else
      searchStart = braceStart + 1
    end
  end
end

local ANIM_DEDICATED_PATTERNS = {
  "AnimationId%s*=%s*[\"']rbxassetid://(%d+)[\"']",
  "AnimationId%s*=%s*'rbxassetid://(%d+)'",
  "AnimationId%s*=%s*(%d+)",
  "[Aa]nim[s]?%s*[=%{][^}]-[\"']?(%d%d%d%d%d%d%d+)[\"']?",
  "[Aa]nim[%w_]*%s*=%s*[\"']rbxassetid://(%d+)[\"']",
}

local SOUND_DEDICATED_PATTERNS = {
  "SoundId%s*=%s*[\"']rbxassetid://(%d+)[\"']",
  "SoundId%s*=%s*'rbxassetid://(%d+)'",
  "SoundId%s*=%s*(%d+)",
  "[Ss]ound[%w_]*%s*[%.:]%s*SoundId%s*=%s*[\"']?rbxassetid://(%d+)[\"']?",
  "[Ss]ound[%w_]*%s*=%s*[\"']rbxassetid://(%d+)[\"']",
  "[Mm]usic[%w_]*%s*=%s*[\"']rbxassetid://(%d+)[\"']",
  "[Ss][Ff][Xx][%w_]*%s*=%s*[\"']rbxassetid://(%d+)[\"']",
}

-- wantAnim / wantSound: skip whole passes when the source has no relevant keywords.
local function extractAssetIdsByKind(source, wantAnim, wantSound)
  if wantAnim  == nil then wantAnim  = true end
  if wantSound == nil then wantSound = true end

  local text      = tostring(source or "")
  local idsByKind = { animation = {}, sound = {} }

  if wantAnim then
    collectPropertyIds(text, "AnimationId", idsByKind.animation)
    for _, pat in ipairs(ANIM_DEDICATED_PATTERNS) do
      for id in text:gmatch(pat) do addAssetId(idsByKind.animation, id) end
    end
  end

  if wantSound then
    collectPropertyIds(text, "SoundId", idsByKind.sound)
    for _, pat in ipairs(SOUND_DEDICATED_PATTERNS) do
      for id in text:gmatch(pat) do addAssetId(idsByKind.sound, id) end
    end
  end

  if wantAnim or wantSound then
    collectContextualIds(text, "rbxassetid://%s*(%d+)", idsByKind, wantAnim, wantSound)
    collectContextualIds(text, "[?&]id=(%d+)",           idsByKind, wantAnim, wantSound)
    collectBareNumberIds(text, idsByKind, wantAnim, wantSound)
    collectLooseTableNumberIds(text, idsByKind, wantAnim, wantSound)
  end

  return idsByKind
end

-- Attribute helpers

local function collectAttributeIds(attrName, attrValue, idsByKind)
  local lowerName   = string.lower(tostring(attrName))
  local nameIsAnim  = contextLooksLikeKind(lowerName, "animation")
  local nameIsSound = contextLooksLikeKind(lowerName, "sound")
  local valType     = typeof(attrValue)

  if valType == "string" then
    local valStr = tostring(attrValue)
    local id     = getAssetIdFromProperty(valStr)
    if id then
      if     nameIsAnim  then addAssetId(idsByKind.animation, id)
      elseif nameIsSound then addAssetId(idsByKind.sound, id)
      else
        local ex = extractAssetIdsByKind(valStr)
        for eid in pairs(ex.animation) do addAssetId(idsByKind.animation, eid) end
        for eid in pairs(ex.sound)     do addAssetId(idsByKind.sound, eid)     end
      end
    else
      local ex = extractAssetIdsByKind(valStr)
      for eid in pairs(ex.animation) do addAssetId(idsByKind.animation, eid) end
      for eid in pairs(ex.sound)     do addAssetId(idsByKind.sound, eid)     end
    end
  elseif valType == "number" then
    local numStr = tostring(math.floor(attrValue))
    if #numStr >= 7 and #numStr <= 15 then
      if     nameIsAnim  then addAssetId(idsByKind.animation, numStr)
      elseif nameIsSound then addAssetId(idsByKind.sound, numStr)
      end
    end
  end
end

-- Replacement helpers

local function sortedNumericKeys(map)
  local keys = {}
  for key in pairs(map) do table.insert(keys, key) end
  table.sort(keys, function(a, b) return tonumber(a) < tonumber(b) end)
  return keys
end

local function summarizeMappedIdsFromText(text, idMap)
  local counts = {}
  local total = 0

  for numStr in tostring(text or ""):gmatch("%d+") do
    if idMap[numStr] then
      counts[numStr] = (counts[numStr] or 0) + 1
      total += 1
    end
  end

  return counts, total
end

local function addSingleMappedIdCount(assetId)
  local counts = {}
  counts[assetId] = 1
  return counts
end

local function addReplacedPath(replacedPaths, location, counts, idMap)
  if not replacedPaths then return end

  local parts = {}
  for _, oldId in ipairs(sortedNumericKeys(counts)) do
    local count = counts[oldId] or 0
    if count > 0 then
      local text = tostring(oldId) .. " -> " .. tostring(idMap[oldId])
      if count > 1 then text ..= " x" .. tostring(count) end
      table.insert(parts, text)
    end
  end

  if #parts > 0 then
    table.insert(replacedPaths, tostring(location) .. " (" .. table.concat(parts, ", ") .. ")")
  end
end

local function printReplacedPaths(replacedPaths)
  if #replacedPaths == 0 then return end

  print("[ISpooferMotion] Replacement paths")

  local limit = math.min(#replacedPaths, DEBUG_REPLACED_PATH_LIMIT)
  for i = 1, limit do
    print("  - " .. replacedPaths[i])
  end

  if #replacedPaths > DEBUG_REPLACED_PATH_LIMIT then
    warn("[ISpooferMotion] Path output was limited to " .. tostring(DEBUG_REPLACED_PATH_LIMIT) .. " item(s). " .. tostring(#replacedPaths - DEBUG_REPLACED_PATH_LIMIT) .. " more replacement path(s) were hidden to avoid flooding Output.")
  end
end

local function replaceMappedNumericTokens(text, idMap)
  local changedCount = 0
  local source       = tostring(text or "")
  local parts        = {}
  local pos          = 1
  local srcLen       = #source

  while pos <= srcLen do
    local mStart, mEnd, numStr = source:find("(%d+)", pos)
    if not mStart then
      parts[#parts + 1] = source:sub(pos)
      break
    end

    parts[#parts + 1] = source:sub(pos, mStart - 1)

    local replacement = idMap[numStr]
    if replacement then
      parts[#parts + 1] = replacement
      changedCount += 1
    else
      parts[#parts + 1] = numStr
    end

    pos = mEnd + 1
  end

  if #parts == 0 then return source, 0 end
  return table.concat(parts), changedCount
end

local function replaceIdsInsideTextValue(value, idMap)
  -- Replace exact old IDs anywhere inside a string value. This catches:
  -- rbxassetid://123, ?id=123, plain 123, JSON-ish strings, and config lists.
  local newValue, changedCount = replaceMappedNumericTokens(value, idMap)
  return newValue, changedCount > 0, changedCount
end

local function replacePropertyAssetIds(source, propertyName, idMap)
  -- Kept for compatibility with the old path, but now reports real occurrence count.
  local changedCount = 0
  local newSource    = tostring(source or "")

  newSource = newSource:gsub("(" .. propertyName .. "%s*=%s*\")([^\"]*)(\")", function(pre, val, suf)
    local nv, _, count = replaceIdsInsideTextValue(val, idMap)
    if count > 0 then changedCount += count end
    return pre .. nv .. suf
  end)

  newSource = newSource:gsub("(" .. propertyName .. "%s*=%s*')([^']*)(')", function(pre, val, suf)
    local nv, _, count = replaceIdsInsideTextValue(val, idMap)
    if count > 0 then changedCount += count end
    return pre .. nv .. suf
  end)

  newSource = newSource:gsub("(" .. propertyName .. "%s*=%s*)(%d+)", function(pre, foundId)
    local r = idMap[foundId]
    if r then changedCount += 1; return pre .. r end
    return pre .. foundId
  end)

  return newSource, changedCount > 0, changedCount
end

local function replaceScriptAssetIds(source, idMap, assetType)
  -- Strong exact-ID replacement. If the user pasted an old ID in the map,
  -- replace that exact numeric token anywhere in script/source text.
  -- This fixes sound IDs stored as plain table values with no SoundId context.
  -- assetType is intentionally unused here; the pasted mapping is the scope.
  local newSource, changedCount = replaceMappedNumericTokens(source, idMap)
  return newSource, changedCount > 0, changedCount
end

local function replaceAttributeIds(obj, idMap, replacedPaths)
  -- GetAttributes is safe on Instance; avoid pcall overhead during large replacement scans.
  local attrs = obj:GetAttributes()
  if not attrs then return 0 end

  local changedCount = 0

  for attrName, attrValue in pairs(attrs) do
    local valType = typeof(attrValue)
    local location = obj:GetFullName() .. " attribute " .. tostring(attrName)

    if valType == "string" then
      local counts = summarizeMappedIdsFromText(attrValue, idMap)
      local newVal, _, count = replaceIdsInsideTextValue(attrValue, idMap)
      if count > 0 and newVal ~= attrValue then
        local success = pcall(function() obj:SetAttribute(attrName, newVal) end)
        if success then
          changedCount += count
          addReplacedPath(replacedPaths, location, counts, idMap)
        end
      end

    elseif valType == "number" then
      local numStr = tostring(math.floor(attrValue))
      local r      = idMap[numStr]
      if r then
        local success = pcall(function() obj:SetAttribute(attrName, tonumber(r)) end)
        if success then
          changedCount += 1
          addReplacedPath(replacedPaths, location, addSingleMappedIdCount(numStr), idMap)
        end
      end
    end
  end

  return changedCount
end

-- Asset catalog

local function getProductInfoCached(assetId)
  local cached = productInfoCache[assetId]
  if cached ~= nil then
    if cached == false then return nil end
    return cached
  end

  local info = nil
  for attempt = 1, PRODUCT_INFO_MAX_RETRIES do
    local success, result = pcall(function() return marketplace:GetProductInfo(tonumber(assetId)) end)
    if success and result then
      info = result
      break
    end
    if attempt < PRODUCT_INFO_MAX_RETRIES then task.wait(0.1 * (2 ^ attempt)) end
  end

  if info then
    productInfoCache[assetId] = info
  else
    productInfoCache[assetId] = false
  end

  productInfoCacheDirty = true
  return info
end

local function getCreatorTargetId(info)
  if not info or not info.Creator then return "Unknown" end
  return info.Creator.CreatorTargetId or info.Creator.Id or "Unknown"
end

local function formatAssetEntry(assetId, info)
  return string.format("[%s] [%s] [%s:%s],",
    assetId, info.Name or "Unknown",
    info.Creator and info.Creator.CreatorType or "Unknown",
    getCreatorTargetId(info))
end

local function spawnHeartbeatReporter(state, onProgress)
  if not onProgress then return end
  task.spawn(function()
    while not state.done do
      onProgress(state.stage, state.count, state.total, state.processed)
      task.wait(UI_PROGRESS_INTERVAL)
    end
    onProgress(state.stage, state.count, state.total, state.processed)
  end)
end

-- Scan index

local scanIndex = {
  ready = false,
  building = false,
  watchersStarted = false,
  animationCandidates = {},
  soundCandidates = {},
  animationCounts = {},
  soundCounts = {},
  objectEntries = {},
  objectConnections = {},
  rootConnections = {},
  pendingObjects = {},
}

local function countMap(map)
  local count = 0
  for _ in pairs(map) do count += 1 end
  return count
end

local function disconnectIndexedObject(obj)
  local connections = scanIndex.objectConnections[obj]
  if not connections then return end
  disconnectConnections(connections)
  scanIndex.objectConnections[obj] = nil
end

local function clearIndexedObject(obj)
  local entry = scanIndex.objectEntries[obj]
  if not entry then return end

  for assetId in pairs(entry.animation) do
    local current = scanIndex.animationCounts[assetId] or 0
    if current <= 1 then
      scanIndex.animationCounts[assetId] = nil
      scanIndex.animationCandidates[assetId] = nil
    else
      scanIndex.animationCounts[assetId] = current - 1
    end
  end

  for assetId in pairs(entry.sound) do
    local current = scanIndex.soundCounts[assetId] or 0
    if current <= 1 then
      scanIndex.soundCounts[assetId] = nil
      scanIndex.soundCandidates[assetId] = nil
    else
      scanIndex.soundCounts[assetId] = current - 1
    end
  end

  scanIndex.objectEntries[obj] = nil
  scanHitLists.animation[obj] = nil
  scanHitLists.sound[obj] = nil
  lastScanResults = nil
end

local function resetScanIndex()
  local objectsWithConnections = {}
  for obj in pairs(scanIndex.objectConnections) do
    table.insert(objectsWithConnections, obj)
  end
  for _, obj in ipairs(objectsWithConnections) do
    disconnectIndexedObject(obj)
  end

  table.clear(scanIndex.animationCandidates)
  table.clear(scanIndex.soundCandidates)
  table.clear(scanIndex.animationCounts)
  table.clear(scanIndex.soundCounts)
  table.clear(scanIndex.objectEntries)
  table.clear(scanIndex.pendingObjects)
  table.clear(scanHitLists.animation)
  table.clear(scanHitLists.sound)
  lastScanResults = nil
end

local function addIndexedObjectId(entry, obj, kind, assetId)
  assetId = tostring(assetId or ""):match("^(%d+)$")
  if not assetId then return end

  if kind == "animation" then
    if entry.animation[assetId] then return end
    entry.animation[assetId] = true
    scanIndex.animationCounts[assetId] = (scanIndex.animationCounts[assetId] or 0) + 1
    scanIndex.animationCandidates[assetId] = true
    scanHitLists.animation[obj] = true
  elseif kind == "sound" then
    if entry.sound[assetId] then return end
    entry.sound[assetId] = true
    scanIndex.soundCounts[assetId] = (scanIndex.soundCounts[assetId] or 0) + 1
    scanIndex.soundCandidates[assetId] = true
    scanHitLists.sound[obj] = true
  end
end

local function collectIdsFromObject(obj)
  local idsByKind = { animation = {}, sound = {} }
  local className = obj.ClassName

  if className == "Animation" then
    local id = getAssetIdFromProperty(obj.AnimationId)
    if id then addAssetId(idsByKind.animation, id) end

  elseif className == "Sound" then
    local id = getAssetIdFromProperty(obj.SoundId)
    if id then addAssetId(idsByKind.sound, id) end

  elseif obj:IsA("LuaSourceContainer") then
    local ok, source = pcall(function() return obj.Source end)
    if ok and source and #source >= 20 then
      local hasA, hasS = detectSourceKindSignals(source)
      if hasA or hasS then
        local fp = sourceFingerprint(source)
        local cached = scriptSourceCache[obj]
        local path = obj:GetFullName()
        local persisted = persistedScriptSourceCache[path]
        local extractedByKind

        if cached and cached.fp == fp and cached.animation ~= nil and cached.sound ~= nil then
          extractedByKind = cached
        elseif persisted and persisted.fp == fp and persisted.animation ~= nil and persisted.sound ~= nil then
          extractedByKind = {
            fp = fp,
            animation = persisted.animation,
            sound = persisted.sound,
          }
          scriptSourceCache[obj] = extractedByKind
        else
          extractedByKind = extractAssetIdsByKind(source, hasA, hasS)
          scriptSourceCache[obj] = {
            fp = fp,
            animation = extractedByKind.animation,
            sound = extractedByKind.sound,
          }
          persistedScriptSourceCache[path] = {
            t = os.time(),
            fp = fp,
            animation = extractedByKind.animation,
            sound = extractedByKind.sound,
          }
          scriptSourceCacheDirty = true
        end

        for id in pairs(extractedByKind.animation) do addAssetId(idsByKind.animation, id) end
        for id in pairs(extractedByKind.sound) do addAssetId(idsByKind.sound, id) end
      end
    end

  elseif className == "StringValue" or className == "NumberValue" or className == "IntValue" then
    local val = tostring(obj.Value)
    if string.find(val, "%d+") then
      local lowerName = string.lower(obj.Name)
      local nameIsAnim = contextLooksLikeKind(lowerName, "animation")
      local nameIsSound = contextLooksLikeKind(lowerName, "sound")

      if nameIsAnim then
        local id = getAssetIdFromProperty(val)
        if id then addAssetId(idsByKind.animation, id) end
      elseif nameIsSound then
        local id = getAssetIdFromProperty(val)
        if id then addAssetId(idsByKind.sound, id) end
      else
        local hasA, hasS = detectSourceKindSignals(val)
        local ex = extractAssetIdsByKind(val, hasA, hasS)
        for id in pairs(ex.animation) do addAssetId(idsByKind.animation, id) end
        for id in pairs(ex.sound) do addAssetId(idsByKind.sound, id) end
      end
    end
  end

  local attrs = obj:GetAttributes()
  if attrs and next(attrs) then
    for attrName, attrValue in pairs(attrs) do
      collectAttributeIds(attrName, attrValue, idsByKind)
    end
  end

  return idsByKind
end

local function indexObject(obj)
  if not obj or not obj.Parent then return end

  local idsByKind = collectIdsFromObject(obj)
  clearIndexedObject(obj)

  local entry = { animation = {}, sound = {} }
  for id in pairs(idsByKind.animation) do
    addIndexedObjectId(entry, obj, "animation", id)
  end
  for id in pairs(idsByKind.sound) do
    addIndexedObjectId(entry, obj, "sound", id)
  end

  if next(entry.animation) or next(entry.sound) then
    scanIndex.objectEntries[obj] = entry
  end

  lastScanResults = nil
end

local function scheduleIndexObject(obj)
  if not scanIndex.ready or not obj then return end
  if scanIndex.pendingObjects[obj] then return end

  scanIndex.pendingObjects[obj] = true
  task.spawn(function()
    scanIndex.pendingObjects[obj] = nil
    if obj.Parent then
      indexObject(obj)
    else
      clearIndexedObject(obj)
      disconnectIndexedObject(obj)
    end
  end)
end

local function isDirectIndexWatchCandidate(obj)
  local className = obj.ClassName
  return className == "Animation"
      or className == "Sound"
      or className == "StringValue"
      or className == "NumberValue"
      or className == "IntValue"
      or obj:IsA("LuaSourceContainer")
end

local function attachIndexWatchers(obj)
  if scanIndex.objectConnections[obj] then return end

  local connections = {}
  local function connectSignal(signal)
    if signal then
      table.insert(connections, signal:Connect(function()
        scheduleIndexObject(obj)
      end))
    end
  end

  local className = obj.ClassName
  if className == "Animation" then
    connectSignal(obj:GetPropertyChangedSignal("AnimationId"))
  elseif className == "Sound" then
    connectSignal(obj:GetPropertyChangedSignal("SoundId"))
  elseif className == "StringValue" or className == "NumberValue" or className == "IntValue" then
    connectSignal(obj:GetPropertyChangedSignal("Value"))
  elseif obj:IsA("LuaSourceContainer") then
    local ok, signal = pcall(function() return obj:GetPropertyChangedSignal("Source") end)
    if ok then connectSignal(signal) end
  end

  -- AttributeChanged is only attached to objects already known to contain asset IDs.
  -- This avoids thousands of live connections on unrelated parts, models, folders, and UI objects.
  if scanIndex.objectEntries[obj] then
    local okAttr, attrConnection = pcall(function()
      return obj.AttributeChanged:Connect(function()
        scheduleIndexObject(obj)
      end)
    end)
    if okAttr and attrConnection then table.insert(connections, attrConnection) end
  end

  if #connections > 0 then
    scanIndex.objectConnections[obj] = connections
  end
end

local function startScanIndexWatchers()
  if scanIndex.watchersStarted then return end
  scanIndex.watchersStarted = true

  table.insert(scanIndex.rootConnections, game.DescendantAdded:Connect(function(obj)
    if isDirectIndexWatchCandidate(obj) then
      attachIndexWatchers(obj)
    end
    scheduleIndexObject(obj)
  end))

  table.insert(scanIndex.rootConnections, game.DescendantRemoving:Connect(function(obj)
    clearIndexedObject(obj)
    disconnectIndexedObject(obj)
    lastScanResults = nil
  end))
end

local function buildScanIndex(onProgress, shouldCancel)
  scanIndex.ready = false
  scanIndex.building = true
  resetScanIndex()

  local descendants = game:GetDescendants()
  local total = #descendants
  resetSharedState("scan", total)
  spawnHeartbeatReporter(sharedState, onProgress)

  if total == 0 then
    sharedState.done = true
    scanIndex.ready = true
    scanIndex.building = false
    startScanIndexWatchers()
    return
  end

  local directObjects = {}
  local valueObjects = {}
  local attributeObjects = {}
  local scriptObjects = {}

  for _, obj in ipairs(descendants) do
    local className = obj.ClassName
    if className == "Animation" or className == "Sound" then
      table.insert(directObjects, obj)
    elseif className == "StringValue" or className == "NumberValue" or className == "IntValue" then
      table.insert(valueObjects, obj)
    elseif obj:IsA("LuaSourceContainer") then
      table.insert(scriptObjects, obj)
    else
      table.insert(attributeObjects, obj)
    end
  end

  local processed = 0

  local function processObjectList(objects, workerLimit)
    if shouldCancel and shouldCancel() then return end
    if #objects == 0 then return end

    local nextIndex = 0
    local doneWorkers = 0
    local workerCount = math.min(workerLimit, #objects)

    local function claimNextObject()
      if shouldCancel and shouldCancel() then return nil end
      nextIndex += 1
      return objects[nextIndex]
    end

    for _ = 1, workerCount do
      task.spawn(function()
        while true do
          local obj = claimNextObject()
          if not obj then break end

          indexObject(obj)
          attachIndexWatchers(obj)

          processed += 1
          sharedState.processed = processed
          if processed % 50 == 0 then
            sharedState.count = countMap(scanIndex.animationCandidates) + countMap(scanIndex.soundCandidates)
          end

          if processed % SCRIPT_YIELD_BATCH == 0 then task.wait() end
        end
        doneWorkers += 1
      end)
    end

    while doneWorkers < workerCount do task.wait() end
  end

  -- Cheap exact properties first, then values/attributes, then expensive script source reads last.
  processObjectList(directObjects, SOURCE_READ_WORKERS)
  processObjectList(valueObjects, SOURCE_READ_WORKERS)
  processObjectList(attributeObjects, SOURCE_READ_WORKERS)
  processObjectList(scriptObjects, SOURCE_READ_WORKERS)

  sharedState.count = countMap(scanIndex.animationCandidates) + countMap(scanIndex.soundCandidates)
  sharedState.done = true
  scanIndex.ready = not (shouldCancel and shouldCancel())
  scanIndex.building = false
  startScanIndexWatchers()
  task.spawn(persistScriptSourceCache)
end

local function copyScanIndexCandidates()
  local animCandidates = {}
  local soundCandidates = {}

  for id in pairs(scanIndex.animationCandidates) do animCandidates[id] = true end
  for id in pairs(scanIndex.soundCandidates) do soundCandidates[id] = true end

  return animCandidates, soundCandidates
end

local function refreshIndexedObjectAfterChange(obj)
  if scanIndex.ready and obj and obj.Parent then
    indexObject(obj)
  else
    lastScanResults = nil
  end
end

-- Candidate resolution

local function resolveAssetCandidates(candidates, expectedAssetTypeId, options, onProgress, shouldCancel)
  options = options or {}
  local resultsById   = {}
  local candidateList = {}
  for assetId in pairs(candidates) do table.insert(candidateList, assetId) end
  if #candidateList > 1 then
    table.sort(candidateList, function(a, b) return tonumber(a) < tonumber(b) end)
  end

  local total = #candidateList
  if total == 0 then
    if onProgress then onProgress("resolve", 0, 0, 0) end
    return {}
  end

  local nextIndex     = 0
  local processed     = 0
  local found         = 0
  local activeWorkers = 0

  resetSharedState("resolve", total)
  spawnHeartbeatReporter(sharedState, onProgress)

  if shouldCancel and shouldCancel() then sharedState.done = true; return {} end

  local function claimNextAssetId()
    if shouldCancel and shouldCancel() then return nil, nil end
    nextIndex += 1
    return nextIndex, candidateList[nextIndex]
  end

  local workerCount = math.min(PRODUCT_INFO_WORKERS_MAX, total)
  for _ = 1, workerCount do
    activeWorkers += 1
    task.spawn(function()
      while true do
        local _, assetId = claimNextAssetId()
        if not assetId then break end
        local info = getProductInfoCached(assetId)
        processed += 1
        sharedState.processed = processed
        if info and info.AssetTypeId == expectedAssetTypeId then
          local shouldSkip = (options.skipOwnedByCurrentUser and isOwnedByCurrentUser(info))
                          or isCreatedByIgnoredUser(info, options.skipCreatorUserIds)
          if not shouldSkip then
            resultsById[assetId] = formatAssetEntry(assetId, info)
            found += 1
            sharedState.count = found
          end
        end
      end
      activeWorkers -= 1
    end)
  end

  while activeWorkers > 0 do task.wait() end
  task.spawn(persistCache)

  local results = {}
  for _, assetId in ipairs(candidateList) do
    if resultsById[assetId] then table.insert(results, resultsById[assetId]) end
  end

  sharedState.done = true
  return results
end

-- Public scan APIs

local function getOrRunScan(onProgress, shouldCancel)
  if not scanIndex.ready then
    buildScanIndex(onProgress, shouldCancel)
  elseif onProgress then
    local total = countMap(scanIndex.animationCandidates) + countMap(scanIndex.soundCandidates)
    onProgress("scan", total, total, total)
  end

  if shouldCancel and shouldCancel() then return {}, {} end
  return copyScanIndexCandidates()
end

local function getAnimationIds(onProgress, shouldCancel)
  local animCandidates = (getOrRunScan(onProgress, shouldCancel))
  if shouldCancel and shouldCancel() then return {} end
  return resolveAssetCandidates(animCandidates, 24, {
    skipOwnedByCurrentUser = true,
    skipCreatorUserIds = IGNORED_ANIMATION_CREATOR_USER_IDS,
  }, onProgress, shouldCancel)
end

local function getSoundIds(onProgress, shouldCancel)
  local _, soundCandidates = getOrRunScan(onProgress, shouldCancel)
  if shouldCancel and shouldCancel() then return {} end
  return resolveAssetCandidates(soundCandidates, 3, {
    skipOwnedByCurrentUser = true,
  }, onProgress, shouldCancel)
end

-- Replacement mapping parser

local function parseReplacementMappings(inputString)
  local idMap = {}; local order = {}; local invalidLines = {}; local dupLines = {}
  local function firstAssetId(text) return tostring(text or ""):match("(%d%d%d%d%d+)") end
  local function splitMappingLine(line)
    local l, r = line:match("(%d%d%d%d%d+)[^%d]+(%d%d%d%d%d+)")
    if l and r then return l, r end
    local left, right
    left, right = line:match("^(.-)%s*=>%s*(.+)$"); if left and right then return left, right end
    left, right = line:match("^(.-)%s*%->%s*(.+)$"); if left and right then return left, right end
    left, right = line:match("^(.-)%s*=%s*(.+)$");   if left and right then return left, right end
    return line:match("^(.-)%s*:%s*(.+)$")
  end
  for lineNumber, rawLine in ipairs(string.split(inputString or "", "\n")) do
    local line = rawLine:gsub("\r", ""):match("^%s*(.-)%s*$"):gsub(",%s*$", "")
    if line ~= "" then
      local left, right = splitMappingLine(line)
      local oldId = firstAssetId(left); local newId = firstAssetId(right)
      if oldId and newId and oldId ~= newId then
        if idMap[oldId] then table.insert(dupLines, lineNumber)
        else idMap[oldId] = newId; table.insert(order, oldId) end
      else table.insert(invalidLines, lineNumber) end
    end
  end
  return idMap, order, invalidLines, dupLines
end

-- Replacement pass

local function sourceContainsMappedId(source, idMap)
  -- Fast single-pass check. Avoid running the expensive replacement parser on
  -- scripts/values that contain numbers, but none of the old IDs being replaced.
  for numStr in tostring(source or ""):gmatch("%d+") do
    if idMap[numStr] then return true end
  end
  return false
end

local function addRemainingIdHit(remaining, assetId, location)
  local entry = remaining[assetId]
  if not entry then
    entry = { count = 0, locations = {} }
    remaining[assetId] = entry
  end
  entry.count += 1
  if #entry.locations < 5 then
    table.insert(entry.locations, location)
  end
end

local function collectRemainingMappedIdsFromText(text, idMap, remaining, location)
  for numStr in tostring(text or ""):gmatch("%d+") do
    if idMap[numStr] then
      addRemainingIdHit(remaining, numStr, location)
    end
  end
end

local function scanRemainingMappedIds(descendants, idMap)
  local remaining = {}
  local totalHits = 0

  local function remember(assetId, location)
    if idMap[assetId] then
      addRemainingIdHit(remaining, assetId, location)
      totalHits += 1
    end
  end

  for index, obj in ipairs(descendants) do
    local className = obj.ClassName

    if className == "Animation" then
      local id = getAssetIdFromProperty(obj.AnimationId)
      if id then remember(id, obj:GetFullName() .. ".AnimationId") end

    elseif className == "Sound" then
      local id = getAssetIdFromProperty(obj.SoundId)
      if id then remember(id, obj:GetFullName() .. ".SoundId") end

    elseif className == "StringValue" or className == "NumberValue" or className == "IntValue" then
      collectRemainingMappedIdsFromText(tostring(obj.Value), idMap, remaining, obj:GetFullName() .. ".Value")

    elseif obj:IsA("LuaSourceContainer") then
      local ok, source = pcall(function() return obj.Source end)
      if ok and source and source ~= "" and sourceContainsMappedId(source, idMap) then
        collectRemainingMappedIdsFromText(source, idMap, remaining, obj:GetFullName() .. ".Source")
      end
    end

    local attrs = obj:GetAttributes()
    if attrs and next(attrs) then
      for attrName, attrValue in pairs(attrs) do
        local valType = typeof(attrValue)
        if valType == "string" or valType == "number" then
          collectRemainingMappedIdsFromText(tostring(attrValue), idMap, remaining, obj:GetFullName() .. " attribute " .. tostring(attrName))
        end
      end
    end

    if index % DIRECT_YIELD_BATCH == 0 then task.wait() end
  end

  totalHits = 0
  for _, entry in pairs(remaining) do
    totalHits += entry.count
  end

  return remaining, totalHits
end

local function isReplaceCandidateInstance(inst)
  return inst.ClassName == "Animation" or inst.ClassName == "Sound"
      or inst:IsA("LuaSourceContainer")
      or inst.ClassName == "StringValue"
      or inst.ClassName == "NumberValue"
      or inst.ClassName == "IntValue"
end

local function replaceIds(inputString, onProgress, shouldCancel)
  local idMap, mappingOrder, invalidLines, dupLines = parseReplacementMappings(inputString)
  local mappingCount = #mappingOrder

  print("[ISpooferMotion] Replace started. Reading pasted mappings...")

  if next(idMap) == nil then
    warn("[ISpooferMotion] No valid ID mappings found. Paste lines like: oldId = newId")
    return
  end

  print("[ISpooferMotion] Valid mappings loaded: " .. tostring(mappingCount))

  if #invalidLines > 0 then
    warn("[ISpooferMotion] Skipped invalid mapping line(s): " .. table.concat(invalidLines, ", ") .. ". Check those lines for missing/duplicate IDs.")
  end
  if #dupLines > 0 then
    warn("[ISpooferMotion] Skipped duplicate old-ID mapping line(s): " .. table.concat(dupLines, ", ") .. ". The first mapping for each old ID was used.")
  end

  local skippedScripts          = {}
  local changedCount            = 0
  local animationChanged        = 0
  local soundChanged            = 0
  local valueChanged            = 0
  local attributeChanged        = 0
  local scriptsChanged          = 0
  local scriptOccurrencesChanged = 0
  local replacedPaths           = {}
  local toProcess               = {}
  local seen                    = {}

  local function addProcessTarget(inst)
    if inst and inst.Parent and not seen[inst] then
      seen[inst] = true
      table.insert(toProcess, inst)
    end
  end

  -- Reuse this descendants table for target collection, attribute replacement,
  -- and the final friendly leftover-ID report. This avoids extra full traversals.
  local descendants = game:GetDescendants()

  for inst in pairs(scanHitLists.animation) do addProcessTarget(inst) end
  for inst in pairs(scanHitLists.sound)     do addProcessTarget(inst) end

  for _, inst in ipairs(descendants) do
    if isReplaceCandidateInstance(inst) then
      addProcessTarget(inst)
    end
  end

  local total          = #toProcess
  local processedCount = 0
  resetSharedState("replace", total)
  spawnHeartbeatReporter(sharedState, onProgress)

  if shouldCancel and shouldCancel() then sharedState.done = true; return end

  local scriptJobs = {}

  for index, obj in ipairs(toProcess) do
    if shouldCancel and shouldCancel() then sharedState.done = true; return end

    local className = obj.ClassName

    if className == "Animation" then
      processedCount += 1
      sharedState.processed = processedCount

      local id = getAssetIdFromProperty(obj.AnimationId)
      local r  = id and idMap[id]
      if r then
        local v = "rbxassetid://" .. r
        if obj.AnimationId ~= v then
          obj.AnimationId = v
          refreshIndexedObjectAfterChange(obj)
          changedCount += 1
          animationChanged += 1
          addReplacedPath(replacedPaths, obj:GetFullName() .. ".AnimationId", addSingleMappedIdCount(id), idMap)
          sharedState.count = changedCount
        end
      end

    elseif className == "Sound" then
      processedCount += 1
      sharedState.processed = processedCount

      local id = getAssetIdFromProperty(obj.SoundId)
      local r  = id and idMap[id]
      if r then
        local v = "rbxassetid://" .. r
        if obj.SoundId ~= v then
          obj.SoundId = v
          refreshIndexedObjectAfterChange(obj)
          changedCount += 1
          soundChanged += 1
          addReplacedPath(replacedPaths, obj:GetFullName() .. ".SoundId", addSingleMappedIdCount(id), idMap)
          sharedState.count = changedCount
        end
      end

    elseif obj:IsA("LuaSourceContainer") then
      table.insert(scriptJobs, obj)

    elseif className == "StringValue" or className == "NumberValue" or className == "IntValue" then
      processedCount += 1
      sharedState.processed = processedCount

      local val = tostring(obj.Value)
      if sourceContainsMappedId(val, idMap) then
        local lowerName = string.lower(obj.Name)
        if contextLooksLikeKind(lowerName, "animation") or contextLooksLikeKind(lowerName, "sound") then
          local bareId = val:match("^%s*(%d+)%s*$")
          if bareId and idMap[bareId] then
            if className == "StringValue" then
              obj.Value = idMap[bareId]
            else
              obj.Value = tonumber(idMap[bareId]) or obj.Value
            end
            refreshIndexedObjectAfterChange(obj)
            changedCount += 1
            valueChanged += 1
            addReplacedPath(replacedPaths, obj:GetFullName() .. ".Value", addSingleMappedIdCount(bareId), idMap)
            sharedState.count = changedCount
          else
            local counts = summarizeMappedIdsFromText(val, idMap)
            local newVal, c, count = replaceIdsInsideTextValue(val, idMap)
            if c and newVal ~= val then
              obj.Value = newVal
              changedCount += count
              valueChanged += count
              addReplacedPath(replacedPaths, obj:GetFullName() .. ".Value", counts, idMap)
              sharedState.count = changedCount
            end
          end
        else
          local counts = summarizeMappedIdsFromText(val, idMap)
          local newVal, c, count = replaceScriptAssetIds(val, idMap)
          if c and newVal ~= val then
            if className == "StringValue" then
              obj.Value = newVal
            else
              obj.Value = tonumber(newVal) or obj.Value
            end
            refreshIndexedObjectAfterChange(obj)
            changedCount += count
            valueChanged += count
            addReplacedPath(replacedPaths, obj:GetFullName() .. ".Value", counts, idMap)
            sharedState.count = changedCount
          end
        end
      end
    end

    local attrChanged = replaceAttributeIds(obj, idMap, replacedPaths)
    if attrChanged > 0 then
      refreshIndexedObjectAfterChange(obj)
      changedCount += attrChanged
      attributeChanged += attrChanged
      sharedState.count = changedCount
    end

    if index % DIRECT_YIELD_BATCH == 0 then task.wait() end
  end

  -- Attribute replacement for instances not already in toProcess.
  -- Uses the descendants table collected above instead of another full traversal.
  for index, obj in ipairs(descendants) do
    if shouldCancel and shouldCancel() then sharedState.done = true; return end
    if not seen[obj] then
      local ac = replaceAttributeIds(obj, idMap, replacedPaths)
      if ac > 0 then
        refreshIndexedObjectAfterChange(obj)
        changedCount += ac
        attributeChanged += ac
        sharedState.count = changedCount
      end
    end
    if index % DIRECT_YIELD_BATCH == 0 then task.wait() end
  end

  if #scriptJobs > 0 then
    local nextScriptIndex = 0
    local doneWorkers     = 0
    local workerCount     = math.min(REPLACE_SOURCE_WORKERS, #scriptJobs)

    for _ = 1, workerCount do
      task.spawn(function()
        while true do
          if shouldCancel and shouldCancel() then break end

          nextScriptIndex += 1
          local obj = scriptJobs[nextScriptIndex]
          if not obj then break end

          processedCount += 1
          sharedState.processed = processedCount

          local ok, source = pcall(function() return obj.Source end)
          if ok and source and source ~= "" and sourceContainsMappedId(source, idMap) then
            local counts = summarizeMappedIdsFromText(source, idMap)
            local newSource, changed, count = replaceScriptAssetIds(source, idMap)
            if changed and newSource ~= source then
              local success, err = pcall(function()
                scriptEditorService:UpdateSourceAsync(obj, function() return newSource end)
              end)

              if success then
                scriptSourceCache[obj] = nil
                refreshIndexedObjectAfterChange(obj)
                changedCount += count
                scriptOccurrencesChanged += count
                scriptsChanged += 1
                addReplacedPath(replacedPaths, obj:GetFullName() .. ".Source", counts, idMap)
                sharedState.count = changedCount
              else
                table.insert(skippedScripts, obj:GetFullName() .. " -> " .. tostring(err))
                warn("[ISpooferMotion] Could not update script: " .. obj:GetFullName())
              end
            end
          elseif not ok then
            table.insert(skippedScripts, obj:GetFullName() .. " -> could not read source")
          end

          if nextScriptIndex % SCRIPT_YIELD_BATCH == 0 then task.wait() end
        end
        doneWorkers += 1
      end)
    end

    while doneWorkers < workerCount do task.wait() end
  end

  sharedState.done = true

  print("[ISpooferMotion] Checking for old IDs that still remain...")
  local remainingIds, remainingHits = scanRemainingMappedIds(descendants, idMap)
  local remainingKeys = sortedNumericKeys(remainingIds)

  print("[ISpooferMotion] Replacement report")
  print("  Valid mappings: " .. tostring(mappingCount))
  print("  Changed ID occurrence(s): " .. tostring(changedCount))
  print("  Animation object changes: " .. tostring(animationChanged))
  print("  Sound object changes: " .. tostring(soundChanged))
  print("  Value object changes: " .. tostring(valueChanged))
  print("  Attribute changes: " .. tostring(attributeChanged))
  print("  Scripts changed: " .. tostring(scriptsChanged) .. " script(s), " .. tostring(scriptOccurrencesChanged) .. " ID occurrence(s)")
  print("  Processed targets: " .. tostring(processedCount) .. "/" .. tostring(total))
  print("  Replacement path entries: " .. tostring(#replacedPaths))

  printReplacedPaths(replacedPaths)

  if #invalidLines > 0 then
    warn("[ISpooferMotion] " .. tostring(#invalidLines) .. " invalid mapping line(s) were skipped. Lines: " .. table.concat(invalidLines, ", "))
  end
  if #dupLines > 0 then
    warn("[ISpooferMotion] " .. tostring(#dupLines) .. " duplicate mapping line(s) were skipped. Lines: " .. table.concat(dupLines, ", "))
  end

  if #skippedScripts > 0 then
    warn("[ISpooferMotion] " .. tostring(#skippedScripts) .. " script(s) could not be read/updated:")
    for i, message in ipairs(skippedScripts) do
      if i <= 20 then warn("  - " .. message) end
    end
    if #skippedScripts > 20 then
      warn("  ...and " .. tostring(#skippedScripts - 20) .. " more script issue(s).")
    end
  end

  if #remainingKeys > 0 then
    warn("[ISpooferMotion] Some old IDs still appear after replacement: " .. tostring(#remainingKeys) .. " unique old ID(s), " .. tostring(remainingHits) .. " total hit(s).")
    for _, oldId in ipairs(remainingKeys) do
      local entry = remainingIds[oldId]
      warn("  - " .. oldId .. " still appears " .. tostring(entry.count) .. " time(s). New ID should be " .. tostring(idMap[oldId]))
      for _, location in ipairs(entry.locations) do
        warn("      " .. location)
      end
    end
  elseif changedCount == 0 then
    warn("[ISpooferMotion] Replacement finished, but no matching old IDs were found in the place.")
  else
    print("[ISpooferMotion] Success: no pasted old IDs were found after replacement.")
  end

  task.spawn(persistScriptSourceCache)

  return {
    changed    = changedCount,
    processed  = processedCount,
    total      = total,
    skipped    = #skippedScripts,
    invalid    = #invalidLines,
    duplicates = #dupLines,
    remaining  = #remainingKeys,
    remainingHits = remainingHits,
    replacementPaths = #replacedPaths,
  }
end

-- Output script writer

local function writeOutputScript(prefix, resultText)
  local folder    = serverStorage:FindFirstChild("Spoofer-Output") or Instance.new("Folder")
  folder.Name     = "Spoofer-Output"
  folder.Parent   = serverStorage
  local scriptOut = Instance.new("Script")
  scriptOut.Name     = prefix .. "_" .. os.date("%Y-%m-%d_%H-%M-%S")
  scriptOut.Disabled = true
  scriptOut.Source   = "--[[\n-- COPY THE CONTENTS OF THIS SCRIPT AND PASTE IT INTO THE PROGRAM (Ctrl+A -> Ctrl+C)\n-- Generated by ISpooferMotion\n\n"
      .. resultText .. "\n\n--]]"
  scriptOut.Parent = folder
  local children = folder:GetChildren()
  table.sort(children, function(a, b) return a.Name > b.Name end)
  for i = 6, #children do children[i]:Destroy() end
  plugin:OpenScript(scriptOut)
end

-- UI wiring

local function setGetButtonsEnabled(animationButton, soundButton, enabled)
  animationButton.Active = enabled; soundButton.Active = enabled
  animationButton.AutoButtonColor = enabled; soundButton.AutoButtonColor = enabled
end

local closeUnifiedUI

local function closeAllUIs()
  cancelOperation()
  if closeUnifiedUI then closeUnifiedUI() end
end

local function setupGetIdsUI(ui)
  disconnectConnections(getIdsConnections)
  local popup           = ui.MainPopup
  local prompt          = popup.ContentArea.LeftPanel.Prompt
  local closeButton     = popup.TopArea.CloseButton
  local animationButton = popup.ContentArea.LeftPanel.AnimationsButton
  local soundButton     = popup.ContentArea.LeftPanel.SoundButton
  prompt.Text = "Scan Place For Unmapped IDs"
  setGetButtonsEnabled(animationButton, soundButton, true)

  local function runScan(label, workingText, doneNoun, scanFn)
    if isProcessing then warn("Another operation is already in progress."); return end
    local operationId = beginOperation()
    local function shouldCancel() return not isOperationCurrent(operationId) end
    setGetButtonsEnabled(animationButton, soundButton, false)
    prompt.Text = workingText
    task.spawn(function()
      local success, resultsOrError = pcall(function()
        return scanFn(function(stage, count, total, processed)
          if shouldCancel() then return end
          if stage == "resolve" then
            prompt.Text = "Checking " .. label .. "... " .. formatLiveCount(processed, total) .. " | found " .. tostring(count)
          else
            prompt.Text = workingText .. " " .. formatLiveCount(processed, total)
          end
        end, shouldCancel)
      end)
      if not shouldCancel() then
        if success then
          writeOutputScript(doneNoun, "TYPE: " .. string.upper(label:sub(1, -2)) .. "\n" .. table.concat(resultsOrError, "\n"))
          prompt.Text = "Found " .. tostring(#resultsOrError) .. " " .. label .. "."
        else
          warn(doneNoun .. " scan failed: " .. tostring(resultsOrError))
          prompt.Text = "Choose an option..."
        end
        isProcessing = false
        setGetButtonsEnabled(animationButton, soundButton, true)
      end
    end)
  end

  table.insert(getIdsConnections, animationButton.MouseButton1Click:Connect(function()
    runScan("animations", "Scanning animations...", "Animations", getAnimationIds)
  end))
  table.insert(getIdsConnections, soundButton.MouseButton1Click:Connect(function()
    runScan("sounds", "Scanning sounds...", "Sounds", getSoundIds)
  end))
end

local function setupReplaceUI(ui)
  disconnectConnections(replaceIdsConnections)
  local popup       = ui.MainPopup
  local prompt      = popup.ContentArea.RightPanel.Prompt
  prompt.TextScaled = true
  local runButton   = popup.ContentArea.RightPanel.RunButton
  local input       = popup.ContentArea.RightPanel.InputBackground.InputBox
  local function setStatus(text) prompt.Text = tostring(text) end
  local function setRunEnabled(enabled)
    runButton.Active = enabled; runButton.AutoButtonColor = enabled; input.TextEditable = enabled
  end
  setStatus("Paste mapped IDs below & run.")
  setRunEnabled(true)

  table.insert(replaceIdsConnections, runButton.MouseButton1Click:Connect(function()
    if isProcessing or isReplacingIds then warn("Another operation is already in progress."); return end
    if not input or not input.Text or #input.Text <= 5 then
      warn("Input box is empty or too short."); setStatus("Paste at least one valid mapping first."); return
    end
    local operationId = beginOperation()
    local function shouldCancel() return not isOperationCurrent(operationId) end
    isReplacingIds = true; setRunEnabled(false)
    local inputText = input.Text
    local replaceProcessed = 0; local replaceTotal = 0; local replaceChanged = 0; local replacing = true
    task.spawn(function()
      local frames = { ".", "..", "..." }; local frame = 1
      while replacing and not shouldCancel() do
        setStatus("Replacing" .. frames[frame] .. " processed " .. tostring(replaceProcessed) .. "/" .. tostring(replaceTotal) .. " | changed " .. tostring(replaceChanged))
        frame = frame % 3 + 1; task.wait(0.4)
      end
    end)
    task.spawn(function()
      local success, err = pcall(function()
        return replaceIds(inputText, function(_, changed, total, processed)
          replaceChanged   = tonumber(changed)   or replaceChanged
          replaceProcessed = tonumber(processed) or replaceProcessed
          replaceTotal     = tonumber(total)     or replaceTotal
        end, shouldCancel)
      end)
      replacing = false
      if not shouldCancel() then
        isReplacingIds = false; isProcessing = false; setRunEnabled(true)
        if success then
          local result = err; local replaceSkipped = 0
          if type(result) == "table" then
            replaceChanged   = tonumber(result.changed)   or replaceChanged
            replaceProcessed = tonumber(result.processed) or replaceProcessed
            replaceTotal     = tonumber(result.total)     or replaceTotal
            replaceSkipped   = tonumber(result.skipped)   or 0
          end
          local replaceRemaining = 0
          if type(result) == "table" then
            replaceRemaining = tonumber(result.remaining) or 0
          end
          if replaceRemaining > 0 then
            setStatus("Completed with warnings: " .. tostring(replaceChanged) .. " changed, " .. tostring(replaceRemaining) .. " old ID(s) still found. Check Output.")
          elseif replaceChanged > 0 or replaceSkipped > 0 then
            setStatus("Completed: " .. tostring(replaceChanged) .. " changed, " .. tostring(replaceSkipped) .. " failed. Check Output.")
          else
            setStatus("No matching IDs found. Check that the old IDs exist in this place.")
          end
        else
          setStatus("Replacement failed. Check the Output window for details.")
          warn("Replacement failed: " .. tostring(err))
        end
      end
    end)
  end))
end

local function setupUnifiedUI(ui)
  local closeButton = ui.MainPopup.TopArea.CloseButton
  closeUnifiedUI = function()
    if not ui.Enabled then return end
    animatePopupClose(ui, function()
      ui.Enabled = false
      ui.MainPopup.ContentArea.LeftPanel.Prompt.Text  = "Scan Place For Unmapped IDs"
      ui.MainPopup.ContentArea.RightPanel.Prompt.Text = "Replace IDs"
    end)
  end
  table.insert(getIdsConnections, closeButton.MouseButton1Click:Connect(closeAllUIs))
end

toggleButton.Click:Connect(function()
  if not (unifiedUi and unifiedUi.Parent) then
    local existingUI = coreGui:FindFirstChild("SpooferMotion_UI")
    if existingUI then existingUI:Destroy() end
    unifiedUi = createUnifiedUI(coreGui, PLUGIN_VERSION)
    setupGetIdsUI(unifiedUi)
    setupReplaceUI(unifiedUi)
    setupUnifiedUI(unifiedUi)
  end
  unifiedUi.Enabled = true
  animatePopupOpen(unifiedUi)
end)
