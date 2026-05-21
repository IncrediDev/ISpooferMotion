--!strict
return function(parent, pluginVersion)
  parent = parent or game:GetService("CoreGui")

  local titleText = "ISpooferMotion"
  if pluginVersion and tostring(pluginVersion) ~= "" then
    titleText = titleText .. " v" .. tostring(pluginVersion)
  end

  local fredoka = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)

  local function addCorner(instance, radius)
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, radius)
    corner.Parent = instance
    return corner
  end

  local function addStroke(instance, transparency)
    local stroke = Instance.new("UIStroke")
    stroke.Color = Color3.new(1, 1, 1)
    stroke.Transparency = transparency
    stroke.Parent = instance
    return stroke
  end

  local function addTextSizeConstraint(instance, minSize, maxSize)
    local constraint = Instance.new("UITextSizeConstraint")
    constraint.MinTextSize = minSize
    constraint.MaxTextSize = maxSize
    constraint.Parent = instance
    return constraint
  end

  local screenGui = Instance.new("ScreenGui")
  screenGui.Name = "SpooferMotion_UI"
  screenGui.ResetOnSpawn = false
  screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
  screenGui.IgnoreGuiInset = true
  screenGui.ScreenInsets = Enum.ScreenInsets.DeviceSafeInsets

  local dimBackground = Instance.new("Frame")
  dimBackground.Name = "DimBackground"
  dimBackground.BackgroundColor3 = Color3.new(0, 0, 0)
  dimBackground.BackgroundTransparency = 0.42
  dimBackground.BorderSizePixel = 0
  dimBackground.Size = UDim2.new(1, 0, 1, 0)
  dimBackground.Parent = screenGui

  local mainPopup = Instance.new("Frame")
  mainPopup.Name = "MainPopup"
  mainPopup.AnchorPoint = Vector2.new(0.5, 0.5)
  mainPopup.BackgroundColor3 = Color3.fromRGB(10, 10, 10)
  mainPopup.BackgroundTransparency = 0.07
  mainPopup.BorderSizePixel = 0
  mainPopup.ClipsDescendants = true
  mainPopup.Position = UDim2.new(0.5, 0, 0.5, 0)
  mainPopup.Size = UDim2.new(0.9, 0, 0.9, 0)
  mainPopup.Parent = screenGui

  addCorner(mainPopup, 16)

  local autoScale = Instance.new("UIScale")
  autoScale.Name = "AutoScale"
  autoScale.Parent = mainPopup

  local popupSize = Instance.new("UISizeConstraint")
  popupSize.MaxSize = Vector2.new(650, 470)
  popupSize.MinSize = Vector2.new(340, 250)
  popupSize.Parent = mainPopup

  local popupAspect = Instance.new("UIAspectRatioConstraint")
  popupAspect.AspectRatio = 1.3829786777496338
  popupAspect.Parent = mainPopup

  addStroke(mainPopup, 0.88)

  local function createActionButton(holderName, buttonName, text, positionY)
    local holder = Instance.new("Frame")
    holder.Name = holderName
    holder.AnchorPoint = Vector2.new(0.5, 0)
    holder.BackgroundTransparency = 1
    holder.Position = UDim2.new(0.5, 0, 0, positionY)
    holder.Size = UDim2.new(0.58, 0, 0, 78)
    holder.Parent = mainPopup

    local holderSize = Instance.new("UISizeConstraint")
    holderSize.MinSize = Vector2.new(260, 60)
    holderSize.MaxSize = Vector2.new(324, 78)
    holderSize.Parent = holder

    local shadow = Instance.new("Frame")
    shadow.Name = "Shadow"
    shadow.BackgroundColor3 = Color3.new(0, 0, 0)
    shadow.BackgroundTransparency = 0.68
    shadow.BorderSizePixel = 0
    shadow.Position = UDim2.new(0, 0, 0, 7)
    shadow.Size = UDim2.new(1, 0, 1, 0)
    shadow.Parent = holder
    addCorner(shadow, 10)

    local button = Instance.new("TextButton")
    button.Name = buttonName
    button.BackgroundColor3 = Color3.fromRGB(76, 175, 80)
    button.BorderSizePixel = 0
    button.Size = UDim2.new(1, 0, 1, 0)
    button.AutoButtonColor = false
    button.FontFace = fredoka
    button.Text = text
    button.TextColor3 = Color3.new(1, 1, 1)
    button.TextScaled = true
    button.TextSize = 47
    button.Parent = holder
    addCorner(button, 9)
    addStroke(button, 0.86)
    addTextSizeConstraint(button, 24, 47)

    local gradient = Instance.new("UIGradient")
    gradient.Color = ColorSequence.new({
      ColorSequenceKeypoint.new(0, Color3.fromRGB(129, 199, 132)),
      ColorSequenceKeypoint.new(0.48, Color3.fromRGB(76, 175, 80)),
      ColorSequenceKeypoint.new(1, Color3.fromRGB(46, 125, 50)),
    })
    gradient.Rotation = 90
    gradient.Parent = button

    return holder, button
  end

  local popupGradient = Instance.new("UIGradient")
  popupGradient.Color = ColorSequence.new({
    ColorSequenceKeypoint.new(0, Color3.fromRGB(28, 28, 28)),
    ColorSequenceKeypoint.new(0.42, Color3.fromRGB(16, 16, 16)),
    ColorSequenceKeypoint.new(1, Color3.fromRGB(5, 5, 5)),
  })
  popupGradient.Rotation = 90
  popupGradient.Transparency = NumberSequence.new({
    NumberSequenceKeypoint.new(0, 0.01, 0),
    NumberSequenceKeypoint.new(0.55, 0.06, 0),
    NumberSequenceKeypoint.new(1, 0.16, 0),
  })
  popupGradient.Parent = mainPopup

  local topGlow = Instance.new("Frame")
  topGlow.Name = "TopGlow"
  topGlow.BackgroundColor3 = Color3.new(1, 1, 1)
  topGlow.BackgroundTransparency = 0.97
  topGlow.BorderSizePixel = 0
  topGlow.Size = UDim2.new(1, 0, 0, 120)
  topGlow.Parent = mainPopup

  local topGlowGradient = Instance.new("UIGradient")
  topGlowGradient.Rotation = 90
  topGlowGradient.Transparency = NumberSequence.new({
    NumberSequenceKeypoint.new(0, 0.9, 0),
    NumberSequenceKeypoint.new(1, 1, 0),
  })
  topGlowGradient.Parent = topGlow

  local topArea = Instance.new("Frame")
  topArea.Name = "TopArea"
  topArea.BackgroundTransparency = 1
  topArea.BorderSizePixel = 0
  topArea.Size = UDim2.new(1, 0, 0, 92)
  topArea.Parent = mainPopup

  local icon = Instance.new("ImageLabel")
  icon.Name = "Icon"
  icon.BackgroundColor3 = Color3.fromRGB(230, 230, 230)
  icon.BorderSizePixel = 0
  icon.Position = UDim2.new(0, 16, 0, 15)
  icon.Size = UDim2.new(0, 52, 0, 52)
  icon.Image = "rbxassetid://11778372908"
  icon.ScaleType = Enum.ScaleType.Crop
  icon.Parent = topArea
  addCorner(icon, 7)
  addStroke(icon, 0.72)

  local title = Instance.new("TextLabel")
  title.Name = "Title"
  title.BackgroundTransparency = 1
  title.Position = UDim2.new(0, 82, 0, 13)
  title.Size = UDim2.new(1, -165, 0, 36)
  title.FontFace = fredoka
  title.Text = titleText
  title.TextColor3 = Color3.new(1, 1, 1)
  title.TextScaled = true
  title.TextSize = 26
  title.TextTruncate = Enum.TextTruncate.AtEnd
  title.TextXAlignment = Enum.TextXAlignment.Left
  title.Parent = topArea
  addTextSizeConstraint(title, 16, 26)

  local subtitle = Instance.new("TextLabel")
  subtitle.Name = "Subtitle"
  subtitle.BackgroundTransparency = 1
  subtitle.Position = UDim2.new(0, 82, 0, 45)
  subtitle.Size = UDim2.new(1, -165, 0, 27)
  subtitle.FontFace = fredoka
  subtitle.Text = "Choose what asset IDs to scan"
  subtitle.TextColor3 = Color3.fromRGB(198, 198, 198)
  subtitle.TextSize = 16
  subtitle.TextTruncate = Enum.TextTruncate.AtEnd
  subtitle.TextXAlignment = Enum.TextXAlignment.Left
  subtitle.Parent = topArea

  local closeButton = Instance.new("TextButton")
  closeButton.Name = "CloseButton"
  closeButton.AnchorPoint = Vector2.new(1, 0)
  closeButton.BackgroundTransparency = 1
  closeButton.Position = UDim2.new(1, -17, 0, 8)
  closeButton.Size = UDim2.new(0, 58, 0, 58)
  closeButton.AutoButtonColor = false
  closeButton.FontFace = fredoka
  closeButton.Text = "×"
  closeButton.TextColor3 = Color3.fromRGB(198, 198, 198)
  closeButton.TextSize = 64
  closeButton.Parent = topArea

  local closeHoverGlow = Instance.new("Frame")
  closeHoverGlow.Name = "CloseHoverGlow"
  closeHoverGlow.AnchorPoint = Vector2.new(0.5, 0.5)
  closeHoverGlow.BackgroundColor3 = Color3.fromRGB(198, 198, 198)
  closeHoverGlow.BackgroundTransparency = 1
  closeHoverGlow.BorderSizePixel = 0
  closeHoverGlow.Position = UDim2.new(0.5, 0, 0.5, 0)
  closeHoverGlow.Size = UDim2.new(0, 48, 0, 48)
  closeHoverGlow.ZIndex = 0
  closeHoverGlow.Parent = closeButton
  addCorner(closeHoverGlow, 12)

  local prompt = Instance.new("TextLabel")
  prompt.Name = "Prompt"
  prompt.BackgroundTransparency = 1
  prompt.Position = UDim2.new(0, 22, 0, 102)
  prompt.Size = UDim2.new(1, -44, 0, 45)
  prompt.FontFace = fredoka
  prompt.Text = "Choose an option..."
  prompt.TextColor3 = Color3.fromRGB(230, 230, 230)
  prompt.TextScaled = true
  prompt.TextSize = 28
  prompt.TextTruncate = Enum.TextTruncate.AtEnd
  prompt.TextXAlignment = Enum.TextXAlignment.Left
  prompt.Parent = mainPopup
  addTextSizeConstraint(prompt, 16, 28)

  createActionButton("AnimationsButtonHolder", "AnimationsButton", "Animations", 229)
  createActionButton("SoundButtonHolder", "SoundButton", "Sounds", 329)

  screenGui.Parent = parent
  return screenGui
end
