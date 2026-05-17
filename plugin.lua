local pluginEnvironment = script.Parent
local assets = pluginEnvironment.Assets
local coreGui = game:GetService("CoreGui")
local tweenService = game:GetService("TweenService")
local marketplace = game:GetService("MarketplaceService")
local serverStorage = game:GetService("ServerStorage")
local scriptEditorService = game:GetService("ScriptEditorService")
local studioUserId = plugin:GetStudioUserId()

local createGetIdsUI = require(assets.GetIdsUIFactory)
local createReplaceIdsUI = require(assets.ReplaceIdsUIFactory)

local isProcessing = false
local getIdsConnections = {}
local replaceIdsConnections = {}
local replaceUi = nil

local function disconnectConnections(connections)
	for _, connection in ipairs(connections) do
		if connection and connection.Disconnect then
			connection:Disconnect()
		end
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
			BackgroundTransparency = 0.42
		})
	end

	tween(scale, TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {
		Scale = 1
	})
	tween(popup, TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Position = UDim2.new(0.5, 0, 0.5, 0)
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
			BackgroundTransparency = 1
		})
	end

	local closeTween = tween(scale, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
		Scale = 0.94
	})
	tween(popup, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
		Position = UDim2.new(0.5, 0, 0.52, 0)
	})

	closeTween.Completed:Once(function()
		if afterClose then afterClose() end
	end)
end

local function attachButtonAnimation(button, holder)
	local target = holder or button
	local scale = getOrCreateScale(target)
	local normalScale = 1
	local hoverScale = 1.035
	local pressScale = 0.97

	button.MouseEnter:Connect(function()
		tween(scale, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = hoverScale })
	end)
	button.MouseLeave:Connect(function()
		tween(scale, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = normalScale })
	end)
	button.MouseButton1Down:Connect(function()
		tween(scale, TweenInfo.new(0.08, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = pressScale })
	end)
	button.MouseButton1Up:Connect(function()
		tween(scale, TweenInfo.new(0.1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = hoverScale })
	end)
end

local function attachCloseAnimation(button)
	local glow = button:FindFirstChild("CloseHoverGlow") or button:FindFirstChild("HoverGlow")
	button.MouseEnter:Connect(function()
		if glow then
			tween(glow, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { BackgroundTransparency = 0.82 })
		end
	end)
	button.MouseLeave:Connect(function()
		if glow then
			tween(glow, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { BackgroundTransparency = 1 })
		end
	end)
end

local function isOwnedByCurrentUser(assetInfo)
	if not assetInfo or not assetInfo.Creator then
		return false
	end
	if assetInfo.Creator.CreatorType == "User" then
		return assetInfo.Creator.CreatorTargetId == studioUserId
	end
	return false
end

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

local function extractAssetIds(source)
	local ids = {}
	for id in source:gmatch("rbxassetid://(%d+)") do
		ids[id] = true
	end
	return ids
end

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
				if success and info and info.AssetTypeId == 3 and not isOwnedByCurrentUser(info) then
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

		if obj:IsA("LuaSourceContainer") then
			local ok, source = pcall(function() return obj.Source end)
			if ok and source and source ~= "" then
				for matchedId in pairs(extractAssetIds(source)) do
					if not seenIds[matchedId] then
						local success, info = pcall(function()
							return marketplace:GetProductInfo(tonumber(matchedId))
						end)
						if success and info and info.AssetTypeId == 3 and not isOwnedByCurrentUser(info) then
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

		if addedThisLoop and onProgress then
			onProgress(#soundIds)
		end
	end

	return soundIds
end

local function replaceIds(inputString, onProgress)
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
		warn("Could not determine asset type.")
		return
	end

	local skippedScripts = {}
	local descendants = game:GetDescendants()
	local total = #descendants
	local processedCount = 0

	for _, obj in ipairs(descendants) do
		processedCount += 1

		if processedCount % 50 == 0 then
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
						table.insert(skippedScripts, obj:GetFullName() .. " -> " .. tostring(err))
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
		print("All replacements completed successfully.")
	end
end

local function writeOutputScript(prefix, resultText)
	local folder = serverStorage:FindFirstChild("Spoofer-Output") or Instance.new("Folder")
	folder.Name = "Spoofer-Output"
	folder.Parent = serverStorage

	local scriptOut = Instance.new("Script")
	scriptOut.Name = prefix .. "_" .. os.date("%Y-%m-%d_%H-%M-%S")
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
end

local function setGetButtonsEnabled(animationButton, soundButton, enabled)
	animationButton.Active = enabled
	soundButton.Active = enabled
	animationButton.AutoButtonColor = enabled
	soundButton.AutoButtonColor = enabled
end

local function setupGetIdsUI(ui)
	disconnectConnections(getIdsConnections)

	local popup = ui.MainPopup
	local prompt = popup.Prompt
	local closeButton = popup.TopArea.CloseButton
	local animationButton = popup.AnimationsButtonHolder.AnimationsButton
	local soundButton = popup.SoundButtonHolder.SoundButton

	attachButtonAnimation(animationButton, popup.AnimationsButtonHolder)
	attachButtonAnimation(soundButton, popup.SoundButtonHolder)
	attachCloseAnimation(closeButton)

	prompt.Text = "Choose an option.."
	setGetButtonsEnabled(animationButton, soundButton, true)

	table.insert(getIdsConnections, animationButton.MouseButton1Click:Connect(function()
		if isProcessing then return end
		isProcessing = true
		setGetButtonsEnabled(animationButton, soundButton, false)
		prompt.Text = "Scanning animations..."

		task.spawn(function()
			local results = getAnimationIds(function(count)
				prompt.Text = "Found " .. count .. " animations..."
			end)

			writeOutputScript("Animations", table.concat(results, "\n"))
			prompt.Text = "Choose an option.."
			isProcessing = false
			setGetButtonsEnabled(animationButton, soundButton, true)
		end)
	end))

	table.insert(getIdsConnections, soundButton.MouseButton1Click:Connect(function()
		if isProcessing then return end
		isProcessing = true
		setGetButtonsEnabled(animationButton, soundButton, false)
		prompt.Text = "Scanning sounds..."

		task.spawn(function()
			local results = getSoundIds(function(count)
				prompt.Text = "Found " .. count .. " sounds..."
			end)

			writeOutputScript("Sounds", table.concat(results, "\n"))
			prompt.Text = "Choose an option.."
			isProcessing = false
			setGetButtonsEnabled(animationButton, soundButton, true)
		end)
	end))

	table.insert(getIdsConnections, closeButton.MouseButton1Click:Connect(function()
		animatePopupClose(ui, function()
			ui.Enabled = false
			prompt.Text = "Choose an option.."
			isProcessing = false
			setGetButtonsEnabled(animationButton, soundButton, true)
		end)
	end))
end

local function setupReplaceUI(ui)
	disconnectConnections(replaceIdsConnections)

	local popup = ui.MainPopup
	local inputBox = popup.MappedIdsInput
	local runButton = popup.RunButtonHolder.RunButton
	local closeButton = popup.TopArea.CloseButton
	local isReplacingIds = false

	attachButtonAnimation(runButton, popup.RunButtonHolder)
	attachCloseAnimation(closeButton)

	table.insert(replaceIdsConnections, runButton.MouseButton1Click:Connect(function()
		if isReplacingIds then
			warn("Replacement already in progress.")
			return
		end
		if not inputBox.Text or #inputBox.Text <= 5 then
			warn("Input box is empty or too short.")
			return
		end

		isReplacingIds = true
		local inputText = inputBox.Text
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
			inputBox.Text = inputText
			print("Replacement complete. Check the Output window for details.")
		end)
	end))

	table.insert(replaceIdsConnections, closeButton.MouseButton1Click:Connect(function()
		animatePopupClose(ui, function()
			ui.Enabled = false
			inputBox.Text = ""
		end)
	end))
end

getIdsButton.Click:Connect(function()
	local existingUI = coreGui:FindFirstChild("SpooferMotion_UI")
	if existingUI then
		existingUI:Destroy()
	end

	local ui = createGetIdsUI(coreGui)
	ui.Enabled = true
	setupGetIdsUI(ui)
	animatePopupOpen(ui)
end)

replaceIdsButton.Click:Connect(function()
	if replaceUi and replaceUi.Parent then
		replaceUi.Enabled = true
		animatePopupOpen(replaceUi)
		return
	end

	replaceUi = createReplaceIdsUI(coreGui)
	replaceUi.Enabled = true
	setupReplaceUI(replaceUi)
	animatePopupOpen(replaceUi)
end)
