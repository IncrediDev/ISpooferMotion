--!strict
local pluginEnvironment     = script.Parent
local assets                = pluginEnvironment.Assets
local coreGui               = game:GetService("CoreGui")
local tweenService          = game:GetService("TweenService")
local marketplace           = game:GetService("MarketplaceService")
local serverStorage         = game:GetService("ServerStorage")
local scriptEditorService   = game:GetService("ScriptEditorService")
local studioUserId          = plugin:GetStudioUserId()

local createGetIdsUI        = require(assets.GetIdsUIFactory)
local createReplaceIdsUI    = require(assets.ReplaceIdsUIFactory)

local isProcessing          = false
local activeOperationId     = 0
local getIdsConnections     = {}
local replaceIdsConnections = {}
local getUi                 = nil
local replaceUi             = nil

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

-- Performance and delay heuristics parameters.
local DIRECT_YIELD_BATCH         = 1024
local SCRIPT_YIELD_BATCH         = 64
local PRODUCT_INFO_WORKERS_MAX   = 96
local PRODUCT_INFO_MAX_RETRIES   = 3
local UI_PROGRESS_INTERVAL       = 0.12
local SOURCE_READ_WORKERS        = 64
local REPLACE_SOURCE_WORKERS     = 32
local CACHE_TTL                  = 86400
local CACHE_SETTING_KEY          = "ISM_ProductInfoCache_v2"
local PERSIST_CACHE_MIN_INTERVAL = 60

local productInfoCache           = {}
local productInfoCacheDirty      = false
local lastPersistTime            = 0

local PLUGIN_VERSION             = "__ISPOOFERMOTION_VERSION__"
if PLUGIN_VERSION:match("^__") then
  PLUGIN_VERSION = "dev"
end

local IGNORED_ANIMATION_CREATOR_USER_IDS = {
  [1] = true,
}

-- Long-term memory structure persisting resolved ID matches across Studio sessions.

local function loadPersistedCache()
  local ok, data = pcall(function() return plugin:GetSetting(CACHE_SETTING_KEY) end)
  if not (ok and type(data) == "table") then return end
  local now = os.time()
  for assetId, entry in pairs(data) do
    if type(entry) == "table" and type(entry.t) == "number" and entry.v ~= nil and entry.v ~= false then
      if now - entry.t < CACHE_TTL then
        productInfoCache[assetId] = entry.v
      end
    end
  end
end

local function persistCache()
  if not productInfoCacheDirty then return end
  local now = os.time()
  if now - lastPersistTime < PERSIST_CACHE_MIN_INTERVAL then return end
  lastPersistTime = now
  local toSave = {}
  for assetId, value in pairs(productInfoCache) do
    if value ~= false and value ~= nil then
      toSave[assetId] = { t = now, v = value }
    end
  end
  local ok = pcall(function() plugin:SetSetting(CACHE_SETTING_KEY, toSave) end)
  if ok then productInfoCacheDirty = false end
end

loadPersistedCache()

local trackedAnimations = {}
local trackedSounds     = {}
local trackedScripts    = {}
local scriptSourceCache = {}

local function trackInstance(obj)
  if obj.ClassName == "Animation" then
    trackedAnimations[obj] = true
  elseif obj.ClassName == "Sound" then
    trackedSounds[obj] = true
  elseif obj:IsA("LuaSourceContainer") and not trackedScripts[obj] then
    local ok, connection = pcall(function()
      return obj:GetPropertyChangedSignal("Source"):Connect(function()
        scriptSourceCache[obj] = nil
      end)
    end)
    trackedScripts[obj] = ok and connection or true
  end
end

local function untrackInstance(obj)
  trackedAnimations[obj] = nil
  trackedSounds[obj]     = nil
  local scriptConnection = trackedScripts[obj]
  if scriptConnection and scriptConnection ~= true and scriptConnection.Disconnect then
    scriptConnection:Disconnect()
  end
  trackedScripts[obj]    = nil
  scriptSourceCache[obj] = nil
end

for _, obj in ipairs(game:GetDescendants()) do
  trackInstance(obj)
end

game.DescendantAdded:Connect(trackInstance)
game.DescendantRemoving:Connect(untrackInstance)

local function sourceFingerprint(source)
  return #source .. ":" .. source:sub(1, 24) .. ":" .. source:sub(-48)
end

local scanHitLists = {
  animation = {},
  sound     = {},
}

-- Allocation optimization cache to eliminate garbage collection pressure during deep hierarchies scans.
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

-- Event signal bindings governing workspace and interface updates.

local function disconnectConnections(connections)
  for _, connection in ipairs(connections) do
    if connection and connection.Disconnect then
      connection:Disconnect()
    end
  end
  table.clear(connections)
end

-- Micro-tween mechanics for fluid glassmorphic visual transitions.

local function getOrCreateScale(instance)
  local scale = instance:FindFirstChildOfClass("UIScale")
  if not scale then
    scale = Instance.new("UIScale")
    scale.Parent = instance
  end
  return scale
end

local function tween(instance, info, properties)
  local activeTween = tweenService:Create(instance, info, properties)
  activeTween:Play()
  return activeTween
end

local function animatePopupOpen(ui)
  local popup = ui:FindFirstChild("MainPopup")
  local dim = ui:FindFirstChild("DimBackground")
  if not popup then return end

  local scale = getOrCreateScale(popup)
  scale.Scale = 0.92
  popup.Position = UDim2.new(0.5, 0, 0.52, 0)

  if dim then
    dim.BackgroundTransparency = 1
    tween(dim, TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
      BackgroundTransparency = 0.42,
    })
  end
  tween(scale, TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 })
  tween(popup, TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
    Position = UDim2.new(0.5, 0, 0.5, 0),
  })
end

local function animatePopupClose(ui, afterClose)
  local popup = ui:FindFirstChild("MainPopup")
  local dim = ui:FindFirstChild("DimBackground")
  if not popup then
    if afterClose then afterClose() end
    return
  end

  local scale = getOrCreateScale(popup)
  if dim then
    tween(dim, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
      BackgroundTransparency = 1,
    })
  end
  local closeTween = tween(scale, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
    Scale = 0.94,
  })
  tween(popup, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
    Position = UDim2.new(0.5, 0, 0.52, 0),
  })
  closeTween.Completed:Once(function()
    if afterClose then afterClose() end
  end)
end

local function hideUiInstant(ui)
  if ui and ui.Parent then ui.Enabled = false end
end

local function hideOtherUi(currentUi)
  if currentUi ~= getUi then hideUiInstant(getUi) end
  if currentUi ~= replaceUi then hideUiInstant(replaceUi) end
end

local function formatLiveCount(count, total)
  count = tonumber(count) or 0
  total = tonumber(total) or 0
  return tostring(count) .. "/" .. tostring(total)
end

local function attachButtonAnimation(button, holder)
  local target = holder or button
  local scale = getOrCreateScale(target)
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
    if glow then
      tween(glow, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
        BackgroundTransparency = 0.82,
      })
    end
  end)
  button.MouseLeave:Connect(function()
    if glow then
      tween(glow, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
        BackgroundTransparency = 1,
      })
    end
  end)
end

-- Verification layers inspecting asset permission trees.

local function getCreatorUserId(assetInfo)
  if not assetInfo or not assetInfo.Creator or assetInfo.Creator.CreatorType ~= "User" then
    return nil
  end
  return tonumber(assetInfo.Creator.CreatorTargetId or assetInfo.Creator.Id)
end

local function isOwnedByCurrentUser(assetInfo)
  return getCreatorUserId(assetInfo) == tonumber(studioUserId)
end

local function isCreatedByIgnoredUser(assetInfo, ignoredUserIds)
  local creatorUserId = getCreatorUserId(assetInfo)
  return creatorUserId ~= nil and ignoredUserIds and ignoredUserIds[creatorUserId] == true
end

-- Instantiates the primary Studio toolbar and visual button actions.

local toolbar = plugin:CreateToolbar("ISpooferMotion")

local getIdsButton = toolbar:CreateButton(
  "Get Id's",
  "Opens UI to scan Animation or Sound IDs",
  "rbxassetid://11778372908"
)
getIdsButton.ClickableWhenViewportHidden = true

local replaceIdsButton = toolbar:CreateButton(
  "Replace Id's",
  "Replaces old id's with new id's.",
  "rbxassetid://11778372908"
)
replaceIdsButton.ClickableWhenViewportHidden = true

-- Extraction algorithms to match asset signatures within script bodies.

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
  for id in text:gmatch("rbxassetid://%s*(%d+)") do
    addAssetId(targetIds, id)
  end
  for id in text:gmatch("[?&]id=(%d+)") do
    addAssetId(targetIds, id)
  end
  local bareId = text:match("^%s*(%d+)%s*$")
  if bareId then addAssetId(targetIds, bareId) end
end

local function collectPropertyIds(source, propertyName, targetIds)
  for value in source:gmatch(propertyName .. "%s*=%s*\"([^\"]*)\"") do
    collectIdsFromTextValue(value, targetIds)
  end
  for value in source:gmatch(propertyName .. "%s*=%s*'([^']*)'") do
    collectIdsFromTextValue(value, targetIds)
  end
  for id in source:gmatch(propertyName .. "%s*=%s*(%d+)") do
    addAssetId(targetIds, id)
  end
end

local function contextLooksLikeAssetKind(context, kind)
  context = string.lower(tostring(context or ""))
  if kind == "animation" then
    return string.find(context, "animation", 1, true) ~= nil
        or string.find(context, "animid", 1, true) ~= nil
        or string.find(context, "loadanimation", 1, true) ~= nil
  end
  if kind == "sound" then
    return string.find(context, "sound", 1, true) ~= nil
        or string.find(context, "audio", 1, true) ~= nil
  end
  return false
end

local function collectContextualIds(source, pattern, idsByKind)
  local searchStart = 1
  while true do
    local matchStart, matchEnd, id = string.find(source, pattern, searchStart)
    if not matchStart then break end
    local contextStart = math.max(1, matchStart - 96)
    local contextEnd = math.min(#source, matchEnd + 96)
    local context = source:sub(contextStart, contextEnd)
    if contextLooksLikeAssetKind(context, "animation") then
      addAssetId(idsByKind.animation, id)
    end
    if contextLooksLikeAssetKind(context, "sound") then
      addAssetId(idsByKind.sound, id)
    end
    searchStart = matchEnd + 1
  end
end

local function extractAssetIdsByKind(source)
  local text = tostring(source or "")
  local idsByKind = {
    animation = {},
    sound = {},
  }

  collectPropertyIds(text, "AnimationId", idsByKind.animation)
  collectPropertyIds(text, "SoundId", idsByKind.sound)

  -- Generic URLs are only accepted when nearby source text identifies the kind.
  -- This prevents decal/mesh/image/package IDs from being checked as both animation and sound IDs.
  collectContextualIds(text, "rbxassetid://%s*(%d+)", idsByKind)
  collectContextualIds(text, "[?&]id=(%d+)", idsByKind)

  return idsByKind
end

local function replaceIdsInsideTextValue(value, idMap)
  local changed = false
  local newValue = tostring(value or ""):gsub("rbxassetid://%s*(%d+)", function(foundId)
    local replacementId = idMap[foundId]
    if replacementId then
      changed = true
      return "rbxassetid://" .. replacementId
    end
  end)

  newValue = newValue:gsub("([?&]id=)(%d+)", function(prefix, foundId)
    local replacementId = idMap[foundId]
    if replacementId then
      changed = true
      return prefix .. replacementId
    end
  end)

  local bareId = newValue:match("^%s*(%d+)%s*$")
  if bareId and idMap[bareId] then
    changed = true
    newValue = newValue:gsub(bareId, idMap[bareId], 1)
  end

  return newValue, changed
end

local function replacePropertyAssetIds(source, propertyName, idMap)
  local changed = false
  local newSource = tostring(source or "")

  newSource = newSource:gsub("(" .. propertyName .. "%s*=%s*\")([^\"]*)(\")", function(prefix, value, suffix)
    local newValue, valueChanged = replaceIdsInsideTextValue(value, idMap)
    if valueChanged then
      changed = true
      return prefix .. newValue .. suffix
    end
  end)

  newSource = newSource:gsub("(" .. propertyName .. "%s*=%s*')([^']*)(')", function(prefix, value, suffix)
    local newValue, valueChanged = replaceIdsInsideTextValue(value, idMap)
    if valueChanged then
      changed = true
      return prefix .. newValue .. suffix
    end
  end)

  newSource = newSource:gsub("(" .. propertyName .. "%s*=%s*)(%d+)", function(prefix, foundId)
    local replacementId = idMap[foundId]
    if replacementId then
      changed = true
      return prefix .. replacementId
    end
  end)

  return newSource, changed
end

local function replaceScriptAssetIds(source, idMap, assetType)
  local changed = false
  local propertyNames = {}
  if assetType == 24 then
    propertyNames = { "AnimationId" }
  elseif assetType == 3 then
    propertyNames = { "SoundId" }
  else
    propertyNames = { "AnimationId", "SoundId" }
  end

  local newSource = tostring(source or "")
  for _, propertyName in ipairs(propertyNames) do
    local updatedSource, propertyChanged = replacePropertyAssetIds(newSource, propertyName, idMap)
    if propertyChanged then
      changed = true
      newSource = updatedSource
    end
  end

  return newSource, changed
end


-- Accesses Roblox asset catalog metadata via resilient backoff-and-retry handlers.

local function getProductInfoCached(assetId)
  if productInfoCache[assetId] ~= nil and productInfoCache[assetId] ~= false then
    return productInfoCache[assetId]
  end

  local info = nil
  for attempt = 1, PRODUCT_INFO_MAX_RETRIES do
    local success, result = pcall(function()
      return marketplace:GetProductInfo(tonumber(assetId))
    end)
    if success and result then
      info = result
      break
    end
    if attempt < PRODUCT_INFO_MAX_RETRIES then
      task.wait(0.1 * (2 ^ attempt))
    end
  end

  -- Do not cache or persist transient failures. Rate limits/private errors can clear later.
  if info then
    productInfoCache[assetId] = info
    productInfoCacheDirty = true
  end
  return info
end

local function getCreatorTargetId(info)
  if not info or not info.Creator then return "Unknown" end
  return info.Creator.CreatorTargetId or info.Creator.Id or "Unknown"
end

local function formatAssetEntry(assetId, info)
  return string.format(
    "[%s] [%s] [%s:%s],",
    assetId,
    info.Name or "Unknown",
    info.Creator and info.Creator.CreatorType or "Unknown",
    getCreatorTargetId(info)
  )
end

-- Micro-throttled UI layout refreshes.

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

-- Executes a single-pass AST/string parsing sweep over script instances to catalog candidate IDs.

local function addCandidate(candidates, hitList, obj, assetId)
  assetId = tostring(assetId or ""):match("^(%d+)$")
  if assetId and not candidates[assetId] then
    candidates[assetId] = true
    hitList[obj] = true
    return 1
  end
  return 0
end

local function collectAllCandidates(onProgress, shouldCancel)
  local animCandidates = {}
  local soundCandidates = {}
  local animCount = 0
  local soundCount = 0

  table.clear(scanHitLists.animation)
  table.clear(scanHitLists.sound)

  local animList   = {}
  local soundList  = {}
  local scriptList = {}

  for obj in pairs(trackedAnimations) do table.insert(animList, obj) end
  for obj in pairs(trackedSounds) do table.insert(soundList, obj) end
  for obj in pairs(trackedScripts) do table.insert(scriptList, obj) end

  local total = #animList + #soundList + #scriptList
  resetSharedState("scan", total)
  spawnHeartbeatReporter(sharedState, onProgress)

  if shouldCancel and shouldCancel() then
    sharedState.done = true
    return {}, 0, {}, 0
  end

  -- Isolates Animation objects.
  for i, obj in ipairs(animList) do
    if shouldCancel and shouldCancel() then
      sharedState.done = true
      return animCandidates, animCount, soundCandidates, soundCount
    end
    sharedState.processed = i
    local id = getAssetIdFromProperty(obj.AnimationId)
    if id and not animCandidates[id] then
      animCandidates[id] = true
      scanHitLists.animation[obj] = true
      animCount += 1
    end
    if i % DIRECT_YIELD_BATCH == 0 then
      sharedState.count = animCount
      task.wait()
    end
  end

  -- Isolates Sound objects.
  local animOffset = #animList
  for i, obj in ipairs(soundList) do
    if shouldCancel and shouldCancel() then
      sharedState.done = true
      return animCandidates, animCount, soundCandidates, soundCount
    end
    sharedState.processed = animOffset + i
    local id = getAssetIdFromProperty(obj.SoundId)
    if id and not soundCandidates[id] then
      soundCandidates[id] = true
      scanHitLists.sound[obj] = true
      soundCount += 1
    end
    if i % DIRECT_YIELD_BATCH == 0 then
      sharedState.count = soundCount
      task.wait()
    end
  end

  -- Evaluates script source containers.
  if #scriptList > 0 then
    local nextScriptIndex  = 0
    local scriptsProcessed = 0
    local primaryOffset    = animOffset + #soundList
    local workerCount      = math.min(SOURCE_READ_WORKERS, #scriptList)
    local doneWorkers      = 0

    for _ = 1, workerCount do
      task.spawn(function()
        while true do
          if shouldCancel and shouldCancel() then break end
          nextScriptIndex += 1
          local obj = scriptList[nextScriptIndex]
          if not obj then break end

          scriptsProcessed += 1
          sharedState.processed = primaryOffset + scriptsProcessed

          local extractedByKind = nil
          local ok, source = pcall(function() return obj.Source end)
          if ok and source and source ~= "" then
            local fp = sourceFingerprint(source)
            local cached = scriptSourceCache[obj]
            if cached and cached.fp == fp and cached.animation ~= nil and cached.sound ~= nil then
              extractedByKind = cached
            elseif #source < 20 then
              extractedByKind = { animation = {}, sound = {} }
              scriptSourceCache[obj] = {
                fp = fp,
                animation = extractedByKind.animation,
                sound = extractedByKind.sound,
              }
            else
              local hasRef = string.find(source, "rbxassetid://", 1, true)
                  or string.find(source, "?id=", 1, true)
                  or string.find(source, "&id=", 1, true)
                  or string.find(source, "AnimationId", 1, true)
                  or string.find(source, "SoundId", 1, true)

              if hasRef then
                extractedByKind = extractAssetIdsByKind(source)
              else
                extractedByKind = { animation = {}, sound = {} }
              end
              scriptSourceCache[obj] = {
                fp = fp,
                animation = extractedByKind.animation,
                sound = extractedByKind.sound,
              }
            end
          end

          if extractedByKind then
            for matchedId in pairs(extractedByKind.animation) do
              if not animCandidates[matchedId] then
                animCandidates[matchedId] = true
                scanHitLists.animation[obj] = true
                animCount += 1
              end
            end
            for matchedId in pairs(extractedByKind.sound) do
              if not soundCandidates[matchedId] then
                soundCandidates[matchedId] = true
                scanHitLists.sound[obj] = true
                soundCount += 1
              end
            end
          end

          sharedState.count = animCount + soundCount
        end
        doneWorkers += 1
      end)
    end

    while doneWorkers < workerCount do task.wait() end
  end

  sharedState.count = animCount + soundCount
  sharedState.done  = true
  return animCandidates, animCount, soundCandidates, soundCount
end

-- Assesses and cross-references matching candidate assets.

local function resolveAssetCandidates(candidates, expectedAssetTypeId, options, onProgress, shouldCancel)
  options = options or {}

  local resultsById = {}
  local candidateList = {}
  for assetId in pairs(candidates) do table.insert(candidateList, assetId) end
  if #candidateList <= 1 then
    -- Skips sorting optimization for low-cardinality collections.
  else
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

  if shouldCancel and shouldCancel() then
    sharedState.done = true
    return {}
  end

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
    local result = resultsById[assetId]
    if result then table.insert(results, result) end
  end

  sharedState.done = true
  return results
end

-- Public API wrappers exposed for scanning workspaces.

local function getAnimationIds(onProgress, shouldCancel)
  local animCandidates, _, _, _ = collectAllCandidates(onProgress, shouldCancel)
  if shouldCancel and shouldCancel() then return {} end
  return resolveAssetCandidates(animCandidates, 24, {
    skipCreatorUserIds = IGNORED_ANIMATION_CREATOR_USER_IDS,
  }, onProgress, shouldCancel)
end

local function getSoundIds(onProgress, shouldCancel)
  local _, _, soundCandidates, _ = collectAllCandidates(onProgress, shouldCancel)
  if shouldCancel and shouldCancel() then return {} end
  return resolveAssetCandidates(soundCandidates, 3, {
    skipOwnedByCurrentUser = true,
  }, onProgress, shouldCancel)
end

-- Executes structural replacement of historical IDs with newly spoofed equivalents.

local function parseReplacementMappings(inputString)
  local idMap = {}
  local order = {}
  local invalidLines = {}
  local duplicateLines = {}

  for lineNumber, rawLine in ipairs(string.split(inputString or "", "\n")) do
    local line = rawLine:gsub("\r", ""):match("^%s*(.-)%s*$")
    if line ~= "" then
      local oldId, newId = line:match("^(%d+)%s*[%-%=]>%s*(%d+)$")
      if not oldId then oldId, newId = line:match("^(%d+)%s*[:=]%s*(%d+)$") end

      if oldId and newId and oldId ~= newId then
        if idMap[oldId] then
          table.insert(duplicateLines, lineNumber)
        else
          idMap[oldId] = newId
          table.insert(order, oldId)
        end
      else
        table.insert(invalidLines, lineNumber)
      end
    end
  end

  return idMap, order, invalidLines, duplicateLines
end

local function replaceIds(inputString, onProgress, shouldCancel)
  local idMap, _, invalidLines, duplicateLines = parseReplacementMappings(inputString)

  if next(idMap) == nil then
    warn("No valid ID mappings found. Use format: oldId = newId, oldId -> newId, or oldId: newId")
    return
  end
  if #invalidLines > 0 then warn("Skipped invalid mapping line(s): " .. table.concat(invalidLines, ", ")) end
  if #duplicateLines > 0 then warn("Skipped duplicate old ID mapping line(s): " .. table.concat(duplicateLines, ", ")) end

  local skippedScripts = {}
  local changedCount   = 0

  local toProcess      = {}
  local seen           = {}

  for inst in pairs(scanHitLists.animation) do
    if inst and inst.Parent then
      seen[inst] = true
      table.insert(toProcess, inst)
    end
  end
  for inst in pairs(scanHitLists.sound) do
    if inst and inst.Parent and not seen[inst] then
      seen[inst] = true
      table.insert(toProcess, inst)
    end
  end

  local function addTracked(trackSet)
    for inst in pairs(trackSet) do
      if not seen[inst] then
        seen[inst] = true
        table.insert(toProcess, inst)
      end
    end
  end
  addTracked(trackedAnimations)
  addTracked(trackedSounds)
  addTracked(trackedScripts)

  local total          = #toProcess
  local processedCount = 0

  resetSharedState("replace", total)
  spawnHeartbeatReporter(sharedState, onProgress)

  if shouldCancel and shouldCancel() then
    sharedState.done = true
    return
  end

  local scriptJobs = {}

  for index, obj in ipairs(toProcess) do
    if shouldCancel and shouldCancel() then
      sharedState.done = true
      return
    end
    if obj.ClassName == "Animation" then
      processedCount += 1
      sharedState.processed = processedCount
      local id = getAssetIdFromProperty(obj.AnimationId)
      local replacementId = id and idMap[id]
      if replacementId then
        local replacementValue = "rbxassetid://" .. replacementId
        if obj.AnimationId ~= replacementValue then
          obj.AnimationId = replacementValue
          changedCount += 1
          sharedState.count = changedCount
        end
      end
    elseif obj.ClassName == "Sound" then
      processedCount += 1
      sharedState.processed = processedCount
      local id = getAssetIdFromProperty(obj.SoundId)
      local replacementId = id and idMap[id]
      if replacementId then
        local replacementValue = "rbxassetid://" .. replacementId
        if obj.SoundId ~= replacementValue then
          obj.SoundId = replacementValue
          changedCount += 1
          sharedState.count = changedCount
        end
      end
    elseif obj:IsA("LuaSourceContainer") then
      -- Always verify current source during replacement so stale cache cannot make us miss edits.
      table.insert(scriptJobs, obj)
    end

    if index % DIRECT_YIELD_BATCH == 0 then
      task.wait()
    end
  end

  if #scriptJobs > 0 then
    local nextScriptIndex = 0
    local doneWorkers = 0
    local workerCount = math.min(REPLACE_SOURCE_WORKERS, #scriptJobs)

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
          if ok and source and source ~= "" then
            if string.find(source, "rbxassetid://", 1, true)
                or string.find(source, "?id=", 1, true)
                or string.find(source, "&id=", 1, true)
                or string.find(source, "AnimationId", 1, true)
                or string.find(source, "SoundId", 1, true) then
              local newSource, changed = replaceScriptAssetIds(source, idMap)
              if changed and newSource ~= source then
                local success, err = pcall(function()
                  scriptEditorService:UpdateSourceAsync(obj, function() return newSource end)
                end)
                if success then
                  scriptSourceCache[obj] = nil
                  changedCount += 1
                  sharedState.count = changedCount
                else
                  table.insert(skippedScripts, obj:GetFullName() .. " -> " .. tostring(err))
                  warn("Failed to update script: " .. obj:GetFullName())
                end
              end
            end
          end

          if nextScriptIndex % SCRIPT_YIELD_BATCH == 0 then
            task.wait()
          end
        end
        doneWorkers += 1
      end)
    end

    while doneWorkers < workerCount do task.wait() end
  end

  sharedState.done = true

  if #skippedScripts > 0 then
    warn("The following scripts were skipped:\n" .. table.concat(skippedScripts, "\n"))
  else
    print("All replacements completed successfully. Changed " .. tostring(changedCount) .. " item(s).")
  end
end

-- Generates a summary script detailing execution outcomes.

local function writeOutputScript(prefix, resultText)
  local folder       = serverStorage:FindFirstChild("Spoofer-Output") or Instance.new("Folder")
  folder.Name        = "Spoofer-Output"
  folder.Parent      = serverStorage

  local scriptOut    = Instance.new("Script")
  scriptOut.Name     = prefix .. "_" .. os.date("%Y-%m-%d_%H-%M-%S")
  scriptOut.Disabled = true
  scriptOut.Source   = "--[[\n"
      .. "-- COPY THE CONTENTS OF THIS SCRIPT AND PASTE IT INTO THE PROGRAM (Ctrl+A -> Ctrl+C)\n"
      .. "-- Generated by ISpooferMotion\n\n"
      .. resultText .. "\n\n--]]"
  scriptOut.Parent   = folder

  local children     = folder:GetChildren()
  table.sort(children, function(a, b) return a.Name > b.Name end)
  for i = 6, #children do children[i]:Destroy() end
  plugin:OpenScript(scriptOut)
end

-- Binds interaction events to screen components.

local function setGetButtonsEnabled(animationButton, soundButton, enabled)
  animationButton.Active          = enabled
  soundButton.Active              = enabled
  animationButton.AutoButtonColor = enabled
  soundButton.AutoButtonColor     = enabled
end

local function setupGetIdsUI(ui)
  disconnectConnections(getIdsConnections)

  local popup           = ui.MainPopup
  local prompt          = popup.Prompt
  local closeButton     = popup.TopArea.CloseButton
  local animationButton = popup.AnimationsButtonHolder.AnimationsButton
  local soundButton     = popup.SoundButtonHolder.SoundButton

  attachButtonAnimation(animationButton, popup.AnimationsButtonHolder)
  attachButtonAnimation(soundButton, popup.SoundButtonHolder)
  attachCloseAnimation(closeButton)

  prompt.Text = "Choose an option..."
  setGetButtonsEnabled(animationButton, soundButton, true)

  local function runScan(label, workingText, doneNoun, scanFn)
    if isProcessing then
      warn("Another operation is already in progress.")
      return
    end

    local operationId = beginOperation()
    local function shouldCancel()
      return not isOperationCurrent(operationId)
    end

    setGetButtonsEnabled(animationButton, soundButton, false)
    prompt.Text = workingText

    task.spawn(function()
      local success, resultsOrError = pcall(function()
        return scanFn(function(stage, count, total, processed)
          if shouldCancel() then return end
          if stage == "resolve" then
            prompt.Text = "Checking " .. label .. "... " .. formatLiveCount(processed, total)
                .. " | found " .. tostring(count)
          else
            prompt.Text = workingText .. " " .. formatLiveCount(processed, total)
          end
        end, shouldCancel)
      end)

      if not shouldCancel() then
        if success then
          writeOutputScript(doneNoun,
            "TYPE: " .. string.upper(label:sub(1, -2)) .. "\n" .. table.concat(resultsOrError, "\n"))
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

  table.insert(getIdsConnections, closeButton.MouseButton1Click:Connect(function()
    cancelOperation()
    animatePopupClose(ui, function()
      ui.Enabled  = false
      prompt.Text = "Choose an option..."
      setGetButtonsEnabled(animationButton, soundButton, true)
    end)
  end))
end

local function setupReplaceUI(ui)
  disconnectConnections(replaceIdsConnections)

  local popup          = ui.MainPopup
  local inputBox       = popup:FindFirstChild("MappedIdsInput", true)
  local statusLabel    = popup:FindFirstChild("StatusLabel", true)
  local runButton      = popup.RunButtonHolder.RunButton
  local closeButton    = popup.TopArea.CloseButton
  local isReplacingIds = false

  attachButtonAnimation(runButton, popup.RunButtonHolder)
  attachCloseAnimation(closeButton)

  local function setStatus(text)
    if statusLabel and statusLabel:IsA("TextLabel") then
      statusLabel.Text = text
    end
  end

  local function setRunEnabled(enabled)
    runButton.Active = enabled
    runButton.AutoButtonColor = enabled
    runButton.Text = enabled and "Run" or "Running..."
    if inputBox and inputBox:IsA("TextBox") then
      inputBox.TextEditable = enabled
    end
  end

  setStatus("Paste mappings like oldId = newId, oldId -> newId, or oldId: newId.")
  setRunEnabled(true)

  table.insert(replaceIdsConnections, runButton.MouseButton1Click:Connect(function()
    if isProcessing or isReplacingIds then
      warn("Another operation is already in progress.")
      return
    end
    if not inputBox or not inputBox:IsA("TextBox") then
      warn("MappedIdsInput TextBox is missing from the replace UI.")
      return
    end
    if not inputBox.Text or #inputBox.Text <= 5 then
      warn("Input box is empty or too short.")
      setStatus("Paste at least one valid mapping first.")
      return
    end

    local operationId = beginOperation()
    local function shouldCancel()
      return not isOperationCurrent(operationId)
    end

    isReplacingIds = true
    setRunEnabled(false)

    local inputText        = inputBox.Text
    local replaceProcessed = 0
    local replaceTotal     = 0
    local replaceChanged   = 0
    local replacing        = true

    task.spawn(function()
      local dotFrames = { ".", "..", "..." }
      local frame = 1
      while replacing and not shouldCancel() do
        setStatus("Replacing" .. dotFrames[frame]
          .. " processed " .. tostring(replaceProcessed) .. "/" .. tostring(replaceTotal)
          .. " | changed " .. tostring(replaceChanged))
        frame = frame % 3 + 1
        task.wait(0.4)
      end
    end)

    task.spawn(function()
      local success, err = pcall(function()
        replaceIds(inputText, function(_, changed, total, processed)
          replaceChanged   = tonumber(changed) or replaceChanged
          replaceProcessed = tonumber(processed) or replaceProcessed
          replaceTotal     = tonumber(total) or replaceTotal
        end, shouldCancel)
      end)

      replacing = false
      if not shouldCancel() then
        isReplacingIds = false
        isProcessing = false
        setRunEnabled(true)
        if success then
          setStatus("Replacement complete. Processed " .. tostring(replaceProcessed)
            .. "/" .. tostring(replaceTotal) .. "; changed " .. tostring(replaceChanged) .. ".")
          print("Replacement complete. Check the Output window for details.")
        else
          setStatus("Replacement failed. Check the Output window for details.")
          warn("Replacement failed: " .. tostring(err))
        end
      end
    end)
  end))

  table.insert(replaceIdsConnections, closeButton.MouseButton1Click:Connect(function()
    cancelOperation()
    isReplacingIds = false
    animatePopupClose(ui, function()
      ui.Enabled = false
      setStatus("Paste mappings like oldId = newId, oldId -> newId, or oldId: newId.")
      setRunEnabled(true)
    end)
  end))
end

-- Connects user toolbar clicks to task orchestrators.

getIdsButton.Click:Connect(function()
  if getUi and getUi.Parent then
    hideOtherUi(getUi)
    getUi.Enabled = true
    animatePopupOpen(getUi)
    return
  end

  local existingUI = coreGui:FindFirstChild("SpooferMotion_UI")
  if existingUI then existingUI:Destroy() end

  getUi = createGetIdsUI(coreGui, PLUGIN_VERSION)
  getUi.Enabled = true
  setupGetIdsUI(getUi)
  hideOtherUi(getUi)
  animatePopupOpen(getUi)
end)

replaceIdsButton.Click:Connect(function()
  if replaceUi and replaceUi.Parent then
    hideOtherUi(replaceUi)
    replaceUi.Enabled = true
    animatePopupOpen(replaceUi)
    return
  end

  replaceUi = createReplaceIdsUI(coreGui, PLUGIN_VERSION)
  replaceUi.Enabled = true
  setupReplaceUI(replaceUi)
  hideOtherUi(replaceUi)
  animatePopupOpen(replaceUi)
end)
