local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")

local PLUGIN_VERSION = "__ISPOOFERMOTION_VERSION__"
if PLUGIN_VERSION:match("^__") then
  PLUGIN_VERSION = "dev"
end

local PORT = 3100
local MAX_PORT = 3110
local BASE_URLS = {}
for port = PORT, MAX_PORT do
  table.insert(BASE_URLS, "http://localhost:" .. tostring(port))
  table.insert(BASE_URLS, "http://127.0.0.1:" .. tostring(port))
end
local BATCH_YIELD_EVERY = 300
local PRODUCT_INFO_YIELD_EVERY = 25
local PRODUCT_INFO_RETRIES = 3
local ICON_ID = "rbxassetid://11778372908"

local toolbar = plugin:CreateToolbar("ISpooferMotion")
local animationsButton = toolbar:CreateButton("Animations",
  "Scan the open game for animation IDs and send them to ISpooferMotion.", ICON_ID)
local soundsButton = toolbar:CreateButton("Sounds", "Scan the open game for sound IDs and send them to ISpooferMotion.",
  ICON_ID)
animationsButton.ClickableWhenViewportHidden = true
soundsButton.ClickableWhenViewportHidden = true

local scanInProgress = false
local replaceInProgress = false
local activeBaseUrl = BASE_URLS[1]
local studioUserId = 0
pcall(function()
  studioUserId = plugin:GetStudioUserId()
end)

local ASSET_TYPE_BY_KIND = {
  animation = { [24] = true, [61] = true },
  sound = { [3] = true },
}

local IGNORED_ROOTS = {
  CoreGui = true,
  PluginGuiService = true,
  TextChatService = true,
  Chat = true,
  MaterialService = true,
}

local ANIMATION_SIGNALS = {
  "animationid",
  "animation",
  "loadanimation",
  "animator",
  "animtrack",
  "animid",
  "emote",
  "keyframe",
  "idle",
  "walkanim",
  "runanim",
  "jumpanim",
  "fallanim",
  "climbanim",
  "swimanim",
  "toolanim",
}

local SOUND_SIGNALS = {
  "soundid",
  "sound",
  "audio",
  "music",
  "sfx",
  "playsound",
  "playlocal",
  "soundgroup",
  "volume",
  "looped",
  "rolloff",
}

local function setButtonsEnabled(enabled)
  pcall(function() animationsButton.Enabled = enabled end)
  pcall(function() soundsButton.Enabled = enabled end)
end

local function addId(ids, value)
  local text = tostring(value or "")
  local id = text:match("rbxassetid://%s*(%d%d%d%d%d+)")
      or text:match("[?&][Ii][Dd]=(%d%d%d%d%d+)")
      or text:match("^%s*(%d%d%d%d%d+)%s*$")
      or text:match("(%d%d%d%d%d+)")
  if id then
    ids[id] = true
  end
end

local function addPropertyIds(source, propertyName, ids)
  for id in source:gmatch(propertyName .. "%s*=%s*['\"]rbxassetid://%s*(%d%d%d%d%d+)['\"]") do
    addId(ids, id)
  end
  for id in source:gmatch(propertyName .. "%s*=%s*rbxassetid://%s*(%d%d%d%d%d+)") do
    addId(ids, id)
  end
  for id in source:gmatch(propertyName .. "%s*=%s*['\"](%d%d%d%d%d+)['\"]") do
    addId(ids, id)
  end
  for id in source:gmatch(propertyName .. "%s*=%s*(%d%d%d%d%d+)") do
    addId(ids, id)
  end
end

local function contextLooksLikeKind(context, kind)
  local lower = string.lower(tostring(context or ""))
  local signals = kind == "sound" and SOUND_SIGNALS or ANIMATION_SIGNALS
  for _, signal in ipairs(signals) do
    if lower:find(signal, 1, true) then
      return true
    end
  end
  return false
end

local function collectContextualAssetUrls(source, kind, ids)
  local lower = string.lower(source)
  local startPos = 1
  while true do
    local s, e, id = source:find("rbxassetid://%s*(%d%d%d%d%d+)", startPos)
    if not s then break end
    local context = lower:sub(math.max(1, s - 160), math.min(#lower, e + 160))
    if contextLooksLikeKind(context, kind) then
      addId(ids, id)
    end
    startPos = e + 1
  end

  startPos = 1
  while true do
    local s, e, id = source:find("[?&][Ii][Dd]=(%d%d%d%d%d+)", startPos)
    if not s then break end
    local context = lower:sub(math.max(1, s - 160), math.min(#lower, e + 160))
    if contextLooksLikeKind(context, kind) then
      addId(ids, id)
    end
    startPos = e + 1
  end
end

local function collectLooseContextIds(source, kind, ids)
  local lower = string.lower(source)
  local startPos = 1
  while true do
    local s, e, id = source:find("(%d%d%d%d%d+)", startPos)
    if not s then break end
    local context = lower:sub(math.max(1, s - 90), math.min(#lower, e + 90))
    if contextLooksLikeKind(context, kind) then
      addId(ids, id)
    end
    startPos = e + 1
  end
end

local function collectIdsFromSource(source, kind, ids)
  source = tostring(source or "")
  if source == "" then return end

  if kind == "animation" then
    addPropertyIds(source, "AnimationId", ids)
    addPropertyIds(source, "animationId", ids)
    addPropertyIds(source, "AnimId", ids)
    addPropertyIds(source, "animId", ids)
  else
    addPropertyIds(source, "SoundId", ids)
    addPropertyIds(source, "soundId", ids)
    addPropertyIds(source, "AudioId", ids)
    addPropertyIds(source, "audioId", ids)
  end

  collectContextualAssetUrls(source, kind, ids)
  collectLooseContextIds(source, kind, ids)
end

local function traverseValidDescendants(callback, progressCallback)
  local count = 0
  for _, service in ipairs(game:GetChildren()) do
    if not IGNORED_ROOTS[service.Name] then
      count += 1
      callback(service, count)

      local descendants = service:GetDescendants()
      for i, obj in ipairs(descendants) do
        count += 1
        callback(obj, count)
        if i % 10000 == 0 then
          if progressCallback then progressCallback(count) end
          task.wait()
        end
      end
    end
  end
  if progressCallback then progressCallback(count) end
  return count
end

local function addReplacement(replacements, ordered, oldId, newId)
  oldId = tostring(oldId or ""):match("(%d%d%d%d%d+)") or ""
  newId = tostring(newId or ""):match("(%d%d%d%d%d+)") or ""
  if oldId == "" or newId == "" or oldId == newId or replacements[oldId] then
    return
  end

  replacements[oldId] = newId
  table.insert(ordered, {
    oldId = oldId,
    newId = newId,
  })
end

local function parseReplacementMappings(text)
  text = tostring(text or "")
  local replacements = {}
  local ordered = {}

  for oldId, newId in text:gmatch("(%d%d%d%d%d+)%s*=%s*(%d%d%d%d%d+)") do
    addReplacement(replacements, ordered, oldId, newId)
  end

  for oldId, newId in text:gmatch("(%d%d%d%d%d+)%s*[-=]+>%s*(%d%d%d%d%d+)") do
    addReplacement(replacements, ordered, oldId, newId)
  end

  for oldId, newId in text:gmatch("Original ID:%s*(%d%d%d%d%d+).-New Asset ID:%s*(%d%d%d%d%d+)") do
    addReplacement(replacements, ordered, oldId, newId)
  end

  for oldId, newId in text:gmatch("Original ID:%s*(%d%d%d%d%d+).-Overwrote Asset ID:%s*(%d%d%d%d%d+)") do
    addReplacement(replacements, ordered, oldId, newId)
  end

  return replacements, ordered
end

local function replaceIdsInText(text, replacements, ordered)
  local total = 0
  local nextText = tostring(text or ""):gsub("%f[%d](%d%d%d%d%d+)%f[%D]", function(id)
    local replacement = replacements[id]
    if replacement then
      total += 1
      return replacement
    end
    return id
  end)

  return nextText, total
end

local function replaceNumericValue(value, replacements)
  local id = tostring(math.floor(tonumber(value) or -1))
  local replacement = replacements[id]
  if replacement then
    return tonumber(replacement), 1
  end
  return value, 0
end

local function replacePropertyText(obj, propertyName, replacements, ordered, stats)
  local okRead, value = pcall(function()
    return obj[propertyName]
  end)
  if not okRead or value == nil then
    return
  end

  local nextValue, changed = replaceIdsInText(value, replacements, ordered)
  if changed <= 0 or nextValue == value then
    return
  end

  local okWrite = pcall(function()
    obj[propertyName] = nextValue
  end)
  if okWrite then
    stats.replacements += changed
    stats.objects += 1
  else
    stats.failed += 1
  end
end

local function replaceValueObject(obj, replacements, ordered, stats)
  local okRead, value = pcall(function()
    return obj.Value
  end)
  if not okRead then
    return
  end

  local nextValue = value
  local changed = 0
  if type(value) == "string" then
    nextValue, changed = replaceIdsInText(value, replacements, ordered)
  elseif type(value) == "number" then
    nextValue, changed = replaceNumericValue(value, replacements)
  end

  if changed <= 0 or nextValue == value then
    return
  end

  local okWrite = pcall(function()
    obj.Value = nextValue
  end)
  if okWrite then
    stats.replacements += changed
    stats.objects += 1
  else
    stats.failed += 1
  end
end

local function replaceAttributes(obj, replacements, ordered, stats)
  local okAttributes, attributes = pcall(function()
    return obj:GetAttributes()
  end)
  if not okAttributes or not attributes then
    return
  end

  local changedAttributes = 0
  for name, value in pairs(attributes) do
    local nextValue = value
    local changed = 0
    if type(value) == "string" then
      nextValue, changed = replaceIdsInText(value, replacements, ordered)
    elseif type(value) == "number" then
      nextValue, changed = replaceNumericValue(value, replacements)
    end

    if changed > 0 and nextValue ~= value then
      local okWrite = pcall(function()
        obj:SetAttribute(name, nextValue)
      end)
      if okWrite then
        stats.replacements += changed
        changedAttributes += 1
      else
        stats.failed += 1
      end
    end
  end

  if changedAttributes > 0 then
    stats.objects += 1
  end
end

local function replaceIdsInObject(obj, replacements, ordered, stats)

  if obj:IsA("Animation") then
    replacePropertyText(obj, "AnimationId", replacements, ordered, stats)
  elseif obj:IsA("Sound") then
    replacePropertyText(obj, "SoundId", replacements, ordered, stats)
  elseif obj:IsA("LuaSourceContainer") then
    replacePropertyText(obj, "Source", replacements, ordered, stats)
  elseif obj:IsA("StringValue") or obj:IsA("IntValue") or obj:IsA("NumberValue") then
    replaceValueObject(obj, replacements, ordered, stats)
  end

  replaceAttributes(obj, replacements, ordered, stats)
end

local function replaceOpenGame(text)
  local replacements, ordered = parseReplacementMappings(text)
  if #ordered == 0 then
    return false, "No replacement mappings found. Copy app output like \"123 = 456,\" or paste old -> new pairs."
  end

  local stats = {
    mappings = #ordered,
    objects = 0,
    replacements = 0,
    failed = 0,
  }
  traverseValidDescendants(function(obj)
    replaceIdsInObject(obj, replacements, ordered, stats)
  end)

  return true, stats
end

local function collectIdsFromAttribute(attributeName, attributeValue, kind, ids)
  if not contextLooksLikeKind(attributeName, kind) then return end
  addId(ids, attributeValue)
end

local function collectIdsFromObject(obj, kind, ids)

  if kind == "animation" and obj:IsA("Animation") then
    addId(ids, obj.AnimationId)
  elseif kind == "sound" and obj:IsA("Sound") then
    addId(ids, obj.SoundId)
  elseif obj:IsA("LuaSourceContainer") then
    local ok, source = pcall(function()
      return obj.Source
    end)
    if ok and source then
      collectIdsFromSource(source, kind, ids)
    end
  elseif obj:IsA("StringValue") or obj:IsA("IntValue") or obj:IsA("NumberValue") then
    if contextLooksLikeKind(obj.Name, kind) then
      local ok, value = pcall(function()
        return obj.Value
      end)
      if ok then
        addId(ids, value)
      end
    end
  end

  local okAttributes, attributes = pcall(function()
    return obj:GetAttributes()
  end)
  if okAttributes and attributes then
    for attributeName, attributeValue in pairs(attributes) do
      collectIdsFromAttribute(attributeName, attributeValue, kind, ids)
    end
  end
end

local function sortedIds(ids)
  local list = {}
  for id in pairs(ids) do
    table.insert(list, id)
  end
  table.sort(list, function(a, b)
    return tonumber(a) < tonumber(b)
  end)
  return list
end

local function scanOpenGame(kind, progressCallback)
  local ids = {}
  local scannedObjects = traverseValidDescendants(function(obj)
    collectIdsFromObject(obj, kind, ids)
  end, progressCallback)
  return sortedIds(ids), scannedObjects
end

local function getProductInfo(assetId)
  for attempt = 1, PRODUCT_INFO_RETRIES do
    local ok, info = pcall(function()
      return MarketplaceService:GetProductInfo(tonumber(assetId))
    end)
    if ok and info then
      return info
    end
    if attempt < PRODUCT_INFO_RETRIES then
      task.wait(0.15 * attempt)
    end
  end
  return nil
end

local function creatorTypeFromInfo(info)
  local raw = tostring(info and info.Creator and info.Creator.CreatorType or "User")
  if string.find(string.lower(raw), "group", 1, true) then
    return "Group"
  end
  return "User"
end

local function creatorIdFromInfo(info)
  if info and info.Creator then
    local id = info.Creator.CreatorTargetId or info.Creator.Id or info.Creator.CreatorId
    if id then
      return tostring(id)
    end
  end
  return tostring(studioUserId or 0)
end

local function cleanText(value, fallback)
  local text = tostring(value or fallback or "Unknown")
  text = text:gsub("[\r\n\t]+", " ")
  text = text:gsub("[%[%]]+", "")
  text = text:gsub("%s+", " ")
  text = text:match("^%s*(.-)%s*$") or ""
  if text == "" then
    return tostring(fallback or "Unknown")
  end
  return text
end

local function formatLine(asset)
  return string.format("[%s] [%s] [%s:%s],", asset.assetId, cleanText(asset.name, asset.assetId), asset.creatorType,
    asset.creatorId)
end

local function resolveIds(kind, ids, progressCallback)
  local expectedTypes = ASSET_TYPE_BY_KIND[kind]
  local assets = {}
  local unresolved = 0
  local wrongType = 0
  local completed = 0

  local queueIndex = 1
  local concurrency = math.min(5, math.max(1, #ids))
  local workersFinished = 0

  local function worker()
    while true do
      local index = queueIndex
      queueIndex += 1

      if index > #ids then
        workersFinished += 1
        return
      end

      local id = ids[index]
      local info = getProductInfo(id)

      if info and expectedTypes[info.AssetTypeId] then
        local creatorType = creatorTypeFromInfo(info)
        local creatorId = creatorIdFromInfo(info)
        if not (creatorType == "User" and tostring(creatorId) == "1") then
          table.insert(assets, {
            assetId = tostring(id),
            name = cleanText(info.Name, id),
            creatorType = creatorType,
            creatorId = creatorId,
            assetTypeId = info.AssetTypeId,
          })
        end
      elseif info then
        wrongType += 1
      else
        unresolved += 1
      end

      completed += 1
      if progressCallback then
        progressCallback(completed, #ids)
      end
    end
  end

  for i = 1, concurrency do
    task.spawn(worker)
  end

  while workersFinished < concurrency do
    task.wait(0.05)
  end

  return assets, unresolved, wrongType
end

local function requestJson(method, url, payload)
  local body = payload and HttpService:JSONEncode(payload) or nil
  return HttpService:RequestAsync({
    Url = url,
    Method = method,
    Headers = {
      ["Content-Type"] = "application/json",
    },
    Body = body,
  })
end

local function tryHealth(baseUrl)
  local ok, response = pcall(function()
    return requestJson("GET", baseUrl .. "/health")
  end)
  if not ok or not response or not response.Success then
    return false
  end

  local decodedOk, body = pcall(function()
    return HttpService:JSONDecode(response.Body or "")
  end)
  return decodedOk and body and body.ok == true and body.app == "ISpooferMotion"
end

local function findAppBaseUrl()
  if activeBaseUrl and tryHealth(activeBaseUrl) then
    return activeBaseUrl
  end

  for _, baseUrl in ipairs(BASE_URLS) do
    if tryHealth(baseUrl) then
      activeBaseUrl = baseUrl
      return baseUrl
    end
  end

  return nil
end

local function postScanResults(payload)
  local baseUrl = findAppBaseUrl()
  if not baseUrl then
    return false,
        "The ISpooferMotion desktop app was not reachable on localhost ports " ..
        tostring(PORT) .. "-" .. tostring(MAX_PORT) ..
        ". Open the app and make sure Studio HTTP requests are enabled."
  end

  local lastError = nil
  for attempt = 1, 3 do
    local ok, response = pcall(function()
      return requestJson("POST", baseUrl .. "/plugin-scan", payload)
    end)
    if ok and response and response.Success then
      activeBaseUrl = baseUrl
      return true, response.Body
    end

    if ok and response then
      lastError = tostring(response.StatusCode) .. " " .. tostring(response.StatusMessage or response.Body or "")
    else
      lastError = tostring(response)
    end
    task.wait(0.25 * attempt)
  end

  return false, lastError or "Unknown localhost POST failure"
end

local function getLatestReplacementTextFromApp()
  local baseUrl = findAppBaseUrl()
  if not baseUrl then
    return false,
        "The ISpooferMotion desktop app was not reachable on localhost ports " ..
        tostring(PORT) .. "-" .. tostring(MAX_PORT) .. ". Open the app first, or paste mappings manually."
  end

  local ok, response = pcall(function()
    return requestJson("GET", baseUrl .. "/latest-replacements")
  end)
  if not ok or not response or not response.Success then
    if response then
      return false, tostring(response.StatusCode) .. " " .. tostring(response.StatusMessage or response.Body or "")
    end
    return false, tostring(response)
  end

  local decodedOk, body = pcall(function()
    return HttpService:JSONDecode(response.Body or "")
  end)
  if not decodedOk or not body or body.ok ~= true then
    return false, "The app returned an invalid replacements response."
  end
  if tonumber(body.count or 0) <= 0 then
    return false, "No replacements are available in the app yet. Run a spoof first, or paste mappings manually."
  end

  return true, tostring(body.text or "")
end

local pollingActive = false

local function runReplacementWithText(text)
  if replaceInProgress then
    warn("[ISpooferMotion] Replacement is already running.")
    return
  end

  replaceInProgress = true
  setButtonsEnabled(false)
  print("[ISpooferMotion] Replacing IDs...")
  print("[ISpooferMotion] Replacement started.")

  task.spawn(function()
    local ok, success, statsOrMessage = pcall(function()
      return replaceOpenGame(text)
    end)

    if not ok then
      warn("[ISpooferMotion] Replacement failed: " .. tostring(success))
    elseif not success then
      warn("[ISpooferMotion] " .. tostring(statsOrMessage))
    else
      local stats = statsOrMessage
      local message = string.format(
        "Replacement finished. %d replacement(s) across %d object(s). %d mapping(s), %d failed write(s).",
        stats.replacements,
        stats.objects,
        stats.mappings,
        stats.failed
      )
      print("[ISpooferMotion] " .. message)
    end

    replaceInProgress = false
    setButtonsEnabled(true)
  end)
end

local function markApplied(baseUrl)
  pcall(function()
    requestJson("POST", baseUrl .. "/mark-replacement-applied", {})
  end)
end

local function pollForPendingReplacement()
  if pollingActive then return end
  pollingActive = true

  task.spawn(function()
    while true do
      task.wait(3)

      if replaceInProgress or scanInProgress then
        -- Back off while a scan or replace is already running
      else
        local baseUrl = findAppBaseUrl()
        if baseUrl then
          local ok, response = pcall(function()
            return requestJson("GET", baseUrl .. "/pending-replacement")
          end)

          if ok and response and response.Success then
            local decodedOk, body = pcall(function()
              return HttpService:JSONDecode(response.Body or "")
            end)

            if decodedOk and body and body.ok == true and body.pending == true then
              local text = tostring(body.text or "")
              if text ~= "" then
                print("[ISpooferMotion] Auto-Replace: Applying...")
                runReplacementWithText(text)
                -- Wait for the replacement to finish (replaceInProgress flips back to false)
                while replaceInProgress do
                  task.wait(0.5)
                end
                markApplied(baseUrl)
                print("[ISpooferMotion] Auto-Replace: Applied.")
              end
            end
          end
        end
      end
    end
  end)
end



local function runScan(kind)
  if scanInProgress then
    warn("[ISpooferMotion] A scan is already running.")
    return
  end

  scanInProgress = true
  setButtonsEnabled(false)

  local label = kind == "sound" and "Sounds" or "Animations"
  local statusText = "Starting " .. label .. " scan..."
  print("[ISpooferMotion] " .. label .. " scan started.")

  local gui = Instance.new("ScreenGui")
  gui.Name = "ISpooferMotionDimmer"
  gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
  gui.Parent = game:GetService("CoreGui")

  local bg = Instance.new("Frame")
  bg.BackgroundColor3 = Color3.new(0, 0, 0)
  bg.BackgroundTransparency = 0.5
  bg.Size = UDim2.fromScale(1, 1)
  bg.Parent = gui

  local textLabel = Instance.new("TextLabel")
  textLabel.BackgroundTransparency = 1
  textLabel.Size = UDim2.fromScale(1, 1)
  textLabel.Position = UDim2.new(0, 0, 0, -20)
  textLabel.FontFace = Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Bold, Enum.FontStyle.Normal)
  textLabel.Text = statusText
  textLabel.TextSize = 36
  textLabel.TextColor3 = Color3.new(1, 1, 1)
  textLabel.Parent = bg

  local etaLabel = Instance.new("TextLabel")
  etaLabel.BackgroundTransparency = 1
  etaLabel.Size = UDim2.fromScale(1, 1)
  etaLabel.Position = UDim2.new(0, 0, 0, 30)
  etaLabel.FontFace = Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
  etaLabel.Text = ""
  etaLabel.TextSize = 20
  etaLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
  etaLabel.Parent = bg

  task.spawn(function()
    local ok, err = pcall(function()
      local startedAt = os.clock()
      
      local scanStart = os.clock()
      local ids, scannedObjects = scanOpenGame(kind, function(count)
        local elapsed = math.floor((os.clock() - scanStart) * 10) / 10
        textLabel.Text = string.format("Scanning %s... (%d objects)", label, count)
        etaLabel.Text = "Elapsed: " .. tostring(elapsed) .. "s"
      end)
      etaLabel.Text = ""
      print(string.format("[ISpooferMotion] Found %d possible %s ID(s) across %d instance(s). Resolving metadata...",
        #ids, label:lower(), scannedObjects))

      local resolveStart = os.clock()
      local assets, unresolved, wrongType = resolveIds(kind, ids, function(current, total)
        if current % 10 == 0 or current == total then
          local elapsed = os.clock() - resolveStart
          local avgTime = elapsed / current
          local remaining = total - current
          local etaSeconds = math.ceil(remaining * avgTime)
          textLabel.Text = string.format("Resolving %s metadata... (%d/%d)", label, current, total)
          if etaSeconds > 0 then
            etaLabel.Text = "ETA: " .. tostring(etaSeconds) .. "s"
          else
            etaLabel.Text = ""
          end
        end
      end)
      etaLabel.Text = ""
      local lines = {}
      for _, asset in ipairs(assets) do
        table.insert(lines, formatLine(asset))
      end

      local payload = {
        kind = kind,
        version = PLUGIN_VERSION,
        placeId = game.PlaceId,
        gameId = game.GameId,
        studioUserId = studioUserId,
        scannedAt = os.time(),
        elapsedMs = math.floor((os.clock() - startedAt) * 1000),
        candidateCount = #ids,
        assetCount = #assets,
        unresolvedCount = unresolved,
        wrongTypeCount = wrongType,
        assets = assets,
        lines = lines,
      }

      textLabel.Text = "Sending to app..."
      local sent, message = postScanResults(payload)
      if sent then
        print(string.format("[ISpooferMotion] %s scan finished. %d ID(s) sent to the app.", label, #lines))
        textLabel.Text = label .. " scan finished!"
      else
        warn("[ISpooferMotion] " .. label .. " scan finished, but sending to the app failed: " .. tostring(message))
        textLabel.Text = "Failed to send to app."
      end
      task.wait(0.5)
    end)

    if not ok then
      warn("[ISpooferMotion] " .. label .. " scan failed: " .. tostring(err))
      textLabel.Text = "Scan failed: " .. tostring(err)
      task.wait(1.5)
    end

    scanInProgress = false
    setButtonsEnabled(true)
    gui:Destroy()
  end)
end

animationsButton.Click:Connect(function()
  runScan("animation")
end)

soundsButton.Click:Connect(function()
  runScan("sound")
end)



print("[ISpooferMotion] Plugin loaded (v" ..
  tostring(PLUGIN_VERSION) .. "). Open the desktop app, then click Animations or Sounds.")

-- Start auto-replace polling immediately so the plugin can receive pushed
-- replacement batches from the app even before the Replace widget is opened.
pollForPendingReplacement()
