-- =========================
-- Services & Environment
-- =========================
local pluginEnvironment = script.Parent
local assets = pluginEnvironment.Assets
local coreGui = game:GetService("CoreGui")
local marketplace = game:GetService("MarketplaceService")
local serverStorage = game:GetService("ServerStorage")
local scriptEditorService = game:GetService("ScriptEditorService")
local studioUserId = plugin:GetStudioUserId()

-- =========================
-- Processing State Tracking
-- =========================
local isProcessing = false

local function isOwnedByCurrentUser(assetInfo)
	if not assetInfo or not assetInfo.Creator then
		return false
	end
	if assetInfo.Creator.CreatorType == "User" then
		return assetInfo.Creator.CreatorTargetId == studioUserId
	end
	return false
end

-- =========================
-- Toolbar
-- =========================
local toolbar = plugin:CreateToolbar("ISpooferMotion")

local button = toolbar:CreateButton(
	"Get Id's",
	"Opens UI to scan Animation or Sound IDs",
	"rbxassetid://11778372908"
)
button.ClickableWhenViewportHidden = true

local button2 = toolbar:CreateButton(
	"Replace Id's",
	"Replaces old id's with new id's.",
	"rbxassetid://11778372908"
)
button2.ClickableWhenViewportHidden = true

-- =========================
-- Helper: Extract all rbxassetid:// IDs from source
-- =========================
local function extractAssetIds(source: string)
	local ids = {}
	for id in source:gmatch("rbxassetid://(%d+)") do
		ids[id] = true
	end
	return ids
end

-- =========================
-- Get Animation IDs (instances + inside scripts)
-- =========================
local function getAnimationIds(onProgress)
	local animationIds = {}
	local seenIds = {}
	local descendants = game:GetDescendants()

	for i, obj in ipairs(descendants) do
		if i % 50 == 0 then
			task.wait()
		end

		if obj:IsA("Animation") then
			local animId = obj.AnimationId:match("rbxassetid://(%d+)")
			if animId and not seenIds[animId] then
				local success, info = pcall(function()
					return marketplace:GetProductInfo(tonumber(animId))
				end)
				if success and info and info.AssetTypeId == 24 then
					table.insert(animationIds, string.format(
						"[%s] [%s] [%s:%s],",
						animId,
						info.Name or "Unknown",
						info.Creator and info.Creator.CreatorType or "Unknown",
						info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "Unknown"
					))
					seenIds[animId] = true
					if onProgress then onProgress(#animationIds) end
				end
			end
		end

		if obj:IsA("LuaSourceContainer") then
			local ok, source = pcall(function() return obj.Source end)
			if ok and source and source ~= "" then
				for matchedId in pairs(extractAssetIds(source)) do
					if not seenIds[matchedId] then
						local success, info = pcall(function()
							return marketplace:GetProductInfo(tonumber(matchedId))
						end)
						if success and info and info.AssetTypeId == 24 then
							table.insert(animationIds, string.format(
								"[%s] [%s] [%s:%s],",
								matchedId,
								info.Name or "Unknown",
								info.Creator and info.Creator.CreatorType or "Unknown",
								info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "Unknown"
							))
							seenIds[matchedId] = true
							if onProgress then onProgress(#animationIds) end
						end
					end
				end
			end
		end
	end

	return animationIds
end

-- =========================
-- Get Sound IDs (instances + inside scripts)
-- =========================
local function getSoundIds(onProgress)
	local soundIds = {}
	local seenIds = {}
	local descendants = game:GetDescendants()

	for i, obj in ipairs(descendants) do
		if i % 50 == 0 then
			task.wait()
		end

		local addedThisLoop = false

		if obj:IsA("Sound") then
			local soundId = obj.SoundId:match("rbxassetid://(%d+)")
			if soundId and not seenIds[soundId] then
				local success, info = pcall(function()
					return marketplace:GetProductInfo(tonumber(soundId))
				end)
				if success and info and info.AssetTypeId == 3 then
					if not isOwnedByCurrentUser(info) then
						table.insert(soundIds, string.format(
							"[%s] [%s] [%s:%s],",
							soundId,
							info.Name or "Unknown",
							info.Creator and info.Creator.CreatorType or "Unknown",
							info.Creator and info.Creator.CreatorTargetId or "Unknown"
						))
						seenIds[soundId] = true
						addedThisLoop = true
					end
				end
			end
		end

		if obj:IsA("LuaSourceContainer") then
			local ok, source = pcall(function() return obj.Source end)
			if ok and source and source ~= "" then
				for matchedId in pairs(extractAssetIds(source)) do
					if not seenIds[matchedId] then
						local success, info = pcall(function()
							return marketplace:GetProductInfo(tonumber(matchedId))
						end)
						if success and info and info.AssetTypeId == 3 then
							if not isOwnedByCurrentUser(info) then
								table.insert(soundIds, string.format(
									"[%s] [%s] [%s:%s],",
									matchedId,
									info.Name or "Unknown",
									info.Creator and info.Creator.CreatorType or "Unknown",
									info.Creator and info.Creator.CreatorTargetId or "Unknown"
								))
								seenIds[matchedId] = true
								addedThisLoop = true
							end
						end
					end
				end
			end
		end

		if addedThisLoop and onProgress then
			onProgress(#soundIds)
		end
	end

	return soundIds
end

-- =========================
-- Replace IDs
-- =========================
local function replaceIds(inputString: string, onProgress)
	local idMap = {}

	for line in inputString:gmatch("[^\r\n]+") do
		local oldId, newId = line:match("(%d+)%s*[:=]%s*(%d+)")
		if oldId and newId and oldId ~= newId then
			idMap[oldId] = newId
		end
	end

	if next(idMap) == nil then
		warn("No valid ID mappings found. Use format: oldId = newId")
		return
	end

	local firstId = next(idMap)
	local assetType
	pcall(function()
		local info = marketplace:GetProductInfo(tonumber(firstId))
		if info then
			assetType = info.AssetTypeId
		end
	end)

	if not assetType then
		warn("Could not determine asset type (Animation or Sound)")
		return
	end

	local skippedScripts = {}
	local descendants = game:GetDescendants()
	local total = #descendants
	local processedCount = 0
	local YIELD_EVERY = 50

	for _, obj in ipairs(descendants) do
		processedCount += 1

		if processedCount % YIELD_EVERY == 0 then
			if onProgress then
				onProgress(processedCount, total)
			end
			task.wait()
		end

		if assetType == 24 and obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.AnimationId = "rbxassetid://" .. idMap[id]
			end
		elseif assetType == 3 and obj:IsA("Sound") then
			local id = obj.SoundId:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.SoundId = "rbxassetid://" .. idMap[id]
			end
		end

		if obj:IsA("LuaSourceContainer") then
			local ok, source = pcall(function() return obj.Source end)
			if ok and source and source ~= "" then
				local newSource = source
				local changed = false

				for oldId, newId in pairs(idMap) do
					local pattern = "rbxassetid://%s*" .. oldId
					if newSource:find(pattern) then
						newSource = newSource:gsub(pattern, "rbxassetid://" .. newId)
						changed = true
					end
				end

				if changed then
					local success, err = pcall(function()
						scriptEditorService:UpdateSourceAsync(obj, function()
							return newSource
						end)
					end)

					if not success then
						table.insert(skippedScripts, obj:GetFullName() .. " → " .. tostring(err))
						warn("Failed to update script: " .. obj:GetFullName())
					end
				end
			end
		end
	end

	if onProgress then
		onProgress(total, total)
	end

	if #skippedScripts > 0 then
		warn("The following scripts were skipped:\n" .. table.concat(skippedScripts, "\n"))
	else
		print("All replacements completed successfully!")
	end
end

-- =========================
-- UI Button Wiring
-- =========================
local function connectUIButtons(popUpUI)
	local panel = popUpUI.Panel
	local outputBox = panel.Container.OutputBox
	local buttons = panel.Buttons

	outputBox.ClearTextOnFocus = false
	outputBox.TextEditable = false
	buttons.Visible = true
	outputBox.Text = ""
	outputBox.PlaceholderText = "Choose an option.."

	buttons.AnimationButton.MouseButton1Click:Connect(function()
		if isProcessing then return end
		isProcessing = true
		buttons.AnimationButton.Active = false
		buttons.SoundButton.Active = false
		buttons.Visible = false
		outputBox.PlaceholderText = "Scanning animations..."

		task.spawn(function()
			local results = getAnimationIds(function(count)
				outputBox.PlaceholderText = "Found " .. count .. " animations..."
			end)

			local resultText = table.concat(results, "\n")

			local folder = serverStorage:FindFirstChild("Spoofer-Output") or Instance.new("Folder")
			folder.Name = "Spoofer-Output"
			folder.Parent = serverStorage

			local scriptOut = Instance.new("Script")
			scriptOut.Name = "Animations_" .. os.date("%Y-%m-%d_%H-%M-%S")
			scriptOut.Disabled = true
			scriptOut.Source = "--[[\n" ..
				"-- COPY THE CONTENTS OF THIS SCRIPT AND PASTE IT INTO THE PROGRAM\n" ..
				"-- Generated by ISpooferMotion\n\n" ..
				resultText .. "\n\n--]]"
			scriptOut.Parent = folder

			local children = folder:GetChildren()
			table.sort(children, function(a, b) return a.Name > b.Name end)
			for i = 6, #children do
				children[i]:Destroy()
			end

			plugin:OpenScript(scriptOut)

			outputBox.PlaceholderText = "Choose an option.."
			isProcessing = false
			buttons.AnimationButton.Active = true
			buttons.SoundButton.Active = true
			buttons.Visible = true
		end)
	end)

	buttons.SoundButton.MouseButton1Click:Connect(function()
		if isProcessing then return end
		isProcessing = true
		buttons.AnimationButton.Active = false
		buttons.SoundButton.Active = false
		buttons.Visible = false
		outputBox.PlaceholderText = "Scanning sounds..."

		task.spawn(function()
			local results = getSoundIds(function(count)
				outputBox.PlaceholderText = "Found " .. count .. " sounds..."
			end)

			local resultText = table.concat(results, "\n")

			local folder = serverStorage:FindFirstChild("Spoofer-Output") or Instance.new("Folder")
			folder.Name = "Spoofer-Output"
			folder.Parent = serverStorage

			local scriptOut = Instance.new("Script")
			scriptOut.Name = "Sounds_" .. os.date("%Y-%m-%d_%H-%M-%S")
			scriptOut.Disabled = true
			scriptOut.Source = "--[[\n" ..
				"-- COPY THE CONTENTS OF THIS SCRIPT AND PASTE IT INTO THE PROGRAM\n" ..
				"-- Generated by ISpooferMotion\n\n" ..
				resultText .. "\n\n--]]"
			scriptOut.Parent = folder

			local children = folder:GetChildren()
			table.sort(children, function(a, b) return a.Name > b.Name end)
			for i = 6, #children do
				children[i]:Destroy()
			end

			plugin:OpenScript(scriptOut)

			outputBox.PlaceholderText = "Choose an option.."
			isProcessing = false
			buttons.AnimationButton.Active = true
			buttons.SoundButton.Active = true
			buttons.Visible = true
		end)
	end)

	panel.CloseButton.MouseButton1Click:Connect(function()
		popUpUI.Enabled = false
		outputBox.Text = ""
		outputBox.PlaceholderText = ""
		buttons.Visible = true
		isProcessing = false
		buttons.AnimationButton.Active = true
		buttons.SoundButton.Active = true
	end)
end

-- =========================
-- Replace UI (created once, reused)
-- =========================
local popUpUI2 = nil

local function setupReplaceUI()
	popUpUI2 = assets.PopUpUI2:Clone()
	popUpUI2.Parent = coreGui

	local inputBox = popUpUI2.Panel.Container.InputBox
	local runButton = popUpUI2.Panel.Container.RunButton
	local isReplacingIds = false

	-- Wire RunButton once
	runButton.MouseButton1Click:Connect(function()
		if isReplacingIds then
			warn("Replacement already in progress, please wait.")
			return
		end
		if not inputBox.Text or #inputBox.Text <= 5 then
			warn("Input box is empty or too short.")
			return
		end

		isReplacingIds = true
		local inputText = inputBox.Text  -- preserve original before overwriting
		local currentPct = 0
		local replacing = true

		task.spawn(function()
			local dotFrames = {".", "..", "..."}
			local frame = 1
			while replacing do
				inputBox.Text = "Replacing" .. dotFrames[frame] .. " " .. currentPct .. "% done"
				frame = frame % 3 + 1
				task.wait(0.4)
			end
		end)

		task.spawn(function()
			replaceIds(inputText, function(processed, total)
				currentPct = math.floor((processed / total) * 100)
			end)
			replacing = false
			isReplacingIds = false
			inputBox.Text = inputText  -- restore original mapping so user can re-run if needed
			print("Replacement complete! Check the Output window for details.")
		end)
	end)

	-- Wire CloseButton once
	popUpUI2.Panel.CloseButton.MouseButton1Click:Connect(function()
		popUpUI2.Enabled = false
		inputBox.Text = ""
	end)
end

-- =========================
-- Toolbar Button 1 - Get IDs
-- =========================
button.Click:Connect(function()
	local existingUI = coreGui:FindFirstChild("PopUpUI")
	if existingUI then
		existingUI:Destroy()
	end

	local popUpUI = assets.PopUpUI:Clone()
	popUpUI.Parent = coreGui
	popUpUI.Enabled = true
	connectUIButtons(popUpUI)
end)

-- =========================
-- Toolbar Button 2 - Replace IDs
-- =========================
button2.Click:Connect(function()
	if not popUpUI2 then
		setupReplaceUI()
	end
	popUpUI2.Enabled = true
end)
