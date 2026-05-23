--!strict
return function(parent, pluginVersion)
  parent = parent or game:GetService("CoreGui")

  local titleText = "ISpooferMotion"
  if pluginVersion and tostring(pluginVersion) ~= "" then
    titleText = titleText .. " v" .. tostring(pluginVersion)
  end

  local screenGui = Instance.new("ScreenGui")
  screenGui.Name = "SpooferMotion_UI"
  screenGui.ResetOnSpawn = false
  screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
  screenGui.IgnoreGuiInset = true
  screenGui.ScreenInsets = Enum.ScreenInsets.DeviceSafeInsets

  local dimBackground = Instance.new("Frame")
  dimBackground.Name = "DimBackground"
  dimBackground.BackgroundColor3 = Color3.fromRGB(5, 5, 5)
  dimBackground.BackgroundTransparency = 0.5
  dimBackground.BorderSizePixel = 0
  dimBackground.Size = UDim2.new(1, 0, 1, 0)
  dimBackground.Parent = screenGui

  local mainPopup = Instance.new("Frame")
  mainPopup.Name = "MainPopup"
  mainPopup.AnchorPoint = Vector2.new(0.5, 0.5)
  mainPopup.BackgroundColor3 = Color3.fromRGB(15, 15, 18)
  mainPopup.BackgroundTransparency = 0.02
  mainPopup.BorderSizePixel = 0
  mainPopup.ClipsDescendants = false
  mainPopup.Position = UDim2.new(0.5, 0, 0.5, 0)
  mainPopup.Size = UDim2.new(0, 740, 0, 420)
  mainPopup.Parent = screenGui

  local mainGradient = Instance.new("UIGradient")
  mainGradient.Color = ColorSequence.new({
    ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 255, 255)),
    ColorSequenceKeypoint.new(1, Color3.fromRGB(220, 220, 230))
  })
  mainGradient.Rotation = 45
  mainGradient.Parent = mainPopup

  local mainCorner = Instance.new("UICorner")
  mainCorner.CornerRadius = UDim.new(0, 16)
  mainCorner.Parent = mainPopup

  local mainSize = Instance.new("UISizeConstraint")
  mainSize.MaxSize = Vector2.new(1000, 600)
  mainSize.MinSize = Vector2.new(740, 420)
  mainSize.Parent = mainPopup

  local mainAspect = Instance.new("UIAspectRatioConstraint")
  mainAspect.AspectRatio = 1.76
  mainAspect.Parent = mainPopup

  local mainStroke = Instance.new("UIStroke")
  mainStroke.Color = Color3.fromRGB(255, 255, 255)
  mainStroke.Transparency = 0.85
  mainStroke.Thickness = 1
  mainStroke.Parent = mainPopup

  local shadow = Instance.new("ImageLabel")
  shadow.Name = "DropShadow"
  shadow.BackgroundTransparency = 1
  shadow.Position = UDim2.new(0, -30, 0, -30)
  shadow.Size = UDim2.new(1, 60, 1, 60)
  shadow.ZIndex = -1
  shadow.Image = "rbxassetid://6015897843"
  shadow.ImageColor3 = Color3.fromRGB(0, 0, 0)
  shadow.ImageTransparency = 0.4
  shadow.ScaleType = Enum.ScaleType.Slice
  shadow.SliceCenter = Rect.new(49, 49, 450, 450)
  shadow.Parent = mainPopup

  local topArea = Instance.new("Frame")
  topArea.Name = "TopArea"
  topArea.BackgroundTransparency = 1
  topArea.BorderSizePixel = 0
  topArea.Size = UDim2.new(1, 0, 0, 70)
  topArea.Parent = mainPopup

  local icon = Instance.new("ImageLabel")
  icon.Name = "Icon"
  icon.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
  icon.BackgroundTransparency = 0.95
  icon.BorderSizePixel = 0
  icon.Position = UDim2.new(0, 20, 0, 15)
  icon.Size = UDim2.new(0, 40, 0, 40)
  icon.Image = "rbxassetid://11778372908"
  icon.ScaleType = Enum.ScaleType.Crop
  icon.Parent = topArea

  local iconCorner = Instance.new("UICorner")
  iconCorner.CornerRadius = UDim.new(0, 8)
  iconCorner.Parent = icon

  local iconStroke = Instance.new("UIStroke")
  iconStroke.Color = Color3.fromRGB(255, 255, 255)
  iconStroke.Transparency = 0.8
  iconStroke.Parent = icon

  local title = Instance.new("TextLabel")
  title.Name = "Title"
  title.BackgroundTransparency = 1
  title.Position = UDim2.new(0, 76, 0, 20)
  title.Size = UDim2.new(1, -150, 0, 30)
  title.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
  title.Text = titleText
  title.TextColor3 = Color3.fromRGB(250, 250, 250)
  title.TextScaled = true
  title.TextSize = 22
  title.TextTruncate = Enum.TextTruncate.AtEnd
  title.TextXAlignment = Enum.TextXAlignment.Left
  title.Parent = topArea

  local closeButton = Instance.new("TextButton")
  closeButton.Name = "CloseButton"
  closeButton.AnchorPoint = Vector2.new(1, 0)
  closeButton.BackgroundTransparency = 1
  closeButton.Position = UDim2.new(1, -16, 0, 16)
  closeButton.Size = UDim2.new(0, 36, 0, 36)
  closeButton.AutoButtonColor = false
  closeButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json")
  closeButton.Text = "×"
  closeButton.TextColor3 = Color3.fromRGB(150, 150, 150)
  closeButton.TextSize = 38
  closeButton.Parent = topArea

  local closeHoverGlow = Instance.new("Frame")
  closeHoverGlow.Name = "CloseHoverGlow"
  closeHoverGlow.AnchorPoint = Vector2.new(0.5, 0.5)
  closeHoverGlow.BackgroundColor3 = Color3.fromRGB(255, 60, 60)
  closeHoverGlow.BackgroundTransparency = 1
  closeHoverGlow.BorderSizePixel = 0
  closeHoverGlow.Position = UDim2.new(0.5, 0, 0.5, 0)
  closeHoverGlow.Size = UDim2.new(1, 0, 1, 0)
  closeHoverGlow.ZIndex = 0
  closeHoverGlow.Parent = closeButton
  local closeCorner = Instance.new("UICorner")
  closeCorner.CornerRadius = UDim.new(0, 8)
  closeCorner.Parent = closeHoverGlow

  closeButton.MouseEnter:Connect(function()
    closeHoverGlow.BackgroundTransparency = 0.8
    closeButton.TextColor3 = Color3.fromRGB(255, 100, 100)
  end)
  closeButton.MouseLeave:Connect(function()
    closeHoverGlow.BackgroundTransparency = 1
    closeButton.TextColor3 = Color3.fromRGB(150, 150, 150)
  end)

  -- Content Area
  local contentArea = Instance.new("Frame")
  contentArea.Name = "ContentArea"
  contentArea.BackgroundTransparency = 1
  contentArea.Position = UDim2.new(0, 20, 0, 70)
  contentArea.Size = UDim2.new(1, -40, 1, -90)
  contentArea.Parent = mainPopup

  local listLayout = Instance.new("UIListLayout")
  listLayout.FillDirection = Enum.FillDirection.Horizontal
  listLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
  listLayout.SortOrder = Enum.SortOrder.LayoutOrder
  listLayout.Padding = UDim.new(0, 20)
  listLayout.Parent = contentArea

  local function createCard(name, titleText)
    local card = Instance.new("Frame")
    card.Name = name
    card.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
    card.BackgroundTransparency = 0.2
    card.BorderSizePixel = 0
    card.Size = UDim2.new(0.5, -10, 1, 0)

    local cardCorner = Instance.new("UICorner")
    cardCorner.CornerRadius = UDim.new(0, 12)
    cardCorner.Parent = card

    local cardStroke = Instance.new("UIStroke")
    cardStroke.Color = Color3.fromRGB(255, 255, 255)
    cardStroke.Transparency = 0.92
    cardStroke.Parent = card

    local title = Instance.new("TextLabel")
    title.Name = "Prompt"
    title.BackgroundTransparency = 1
    title.Position = UDim2.new(0, 20, 0, 16)
    title.Size = UDim2.new(1, -40, 0, 24)
    title.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Bold)
    title.Text = titleText
    title.TextColor3 = Color3.fromRGB(220, 220, 220)
    title.TextSize = 16
    title.TextXAlignment = Enum.TextXAlignment.Left
    title.Parent = card

    local divider = Instance.new("Frame")
    divider.Name = "Divider"
    divider.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    divider.BackgroundTransparency = 0.92
    divider.BorderSizePixel = 0
    divider.Position = UDim2.new(0, 20, 0, 50)
    divider.Size = UDim2.new(1, -40, 0, 1)
    divider.Parent = card

    return card
  end

  local function createHoverButton(parent, name, text, defaultColor, yPos)
    local btn = Instance.new("TextButton")
    btn.Name = name
    btn.BackgroundColor3 = defaultColor
    btn.BorderSizePixel = 0

    local btnCorner = Instance.new("UICorner")
    btnCorner.CornerRadius = UDim.new(0, 6)
    btnCorner.Parent = btn

    local btnStroke = Instance.new("UIStroke")
    btnStroke.Color = Color3.fromRGB(255, 255, 255)
    btnStroke.Transparency = 0.88
    btnStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    btnStroke.Parent = btn
    btn.Position = UDim2.new(0, 20, 0, yPos)
    btn.Size = UDim2.new(1, -40, 0, 54)
    btn.AutoButtonColor = false
    btn.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json")
    btn.Text = text
    btn.TextColor3 = Color3.fromRGB(255, 255, 255)
    btn.TextSize = 20
    btn.Parent = parent

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 8)
    corner.Parent = btn

    local stroke = Instance.new("UIStroke")
    stroke.Color = Color3.fromRGB(255, 255, 255)
    stroke.Transparency = 0.8
    stroke.Parent = btn

    btn.MouseEnter:Connect(function()
      btn.BackgroundTransparency = 0.1
    end)
    btn.MouseLeave:Connect(function()
      btn.BackgroundTransparency = 0
    end)

    return btn
  end

  -- Left Card (Get IDs)
  local leftPanel = createCard("LeftPanel", "Extract IDs")
  leftPanel.Parent = contentArea

  local infoText = Instance.new("TextLabel")
  infoText.BackgroundTransparency = 1
  infoText.Position = UDim2.new(0, 20, 0, 65)
  infoText.Size = UDim2.new(1, -40, 0, 40)
  infoText.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Medium)
  infoText.Text = "Scan your place to grab all unmapped asset IDs."
  infoText.TextColor3 = Color3.fromRGB(150, 150, 150)
  infoText.TextSize = 13
  infoText.TextWrapped = true
  infoText.TextXAlignment = Enum.TextXAlignment.Left
  infoText.TextYAlignment = Enum.TextYAlignment.Top
  infoText.Parent = leftPanel

  local animationsButton = createHoverButton(leftPanel, "AnimationsButton", "Extract Animations",
    Color3.fromRGB(33, 150, 243), 115)
  local soundButton = createHoverButton(leftPanel, "SoundButton", "Extract Sounds", Color3.fromRGB(156, 39, 176), 185)

  -- Right Card (Replace IDs)
  local rightPanel = createCard("RightPanel", "Replace IDs")
  rightPanel.Parent = contentArea

  local inputScrollFrame = Instance.new("ScrollingFrame")
  inputScrollFrame.Name = "InputBackground"
  inputScrollFrame.BackgroundColor3 = Color3.fromRGB(8, 8, 10)
  inputScrollFrame.BorderSizePixel = 0
  inputScrollFrame.Position = UDim2.new(0, 20, 0, 65)
  inputScrollFrame.Size = UDim2.new(1, -40, 1, -145)
  inputScrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.None
  inputScrollFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
  inputScrollFrame.ScrollBarThickness = 6
  inputScrollFrame.Parent = rightPanel

  local inputCorner = Instance.new("UICorner")
  inputCorner.CornerRadius = UDim.new(0, 8)
  inputCorner.Parent = inputScrollFrame
  local inputStroke = Instance.new("UIStroke")
  inputStroke.Color = Color3.fromRGB(255, 255, 255)
  inputStroke.Transparency = 0.92
  inputStroke.Parent = inputScrollFrame

  local inputPadding = Instance.new("UIPadding")
  inputPadding.PaddingBottom = UDim.new(0, 10)
  inputPadding.PaddingLeft = UDim.new(0, 12)
  inputPadding.PaddingRight = UDim.new(0, 12)
  inputPadding.PaddingTop = UDim.new(0, 10)
  inputPadding.Parent = inputScrollFrame

  local mappedIdsInput = Instance.new("TextBox")
  mappedIdsInput.Name = "InputBox"
  mappedIdsInput.BackgroundTransparency = 1
  mappedIdsInput.ClearTextOnFocus = false
  mappedIdsInput.FontFace = Font.new("rbxasset://fonts/families/RobotoMono.json")
  mappedIdsInput.MultiLine = true
  mappedIdsInput.PlaceholderColor3 = Color3.fromRGB(100, 100, 100)
  mappedIdsInput.PlaceholderText = "Paste mapped IDs from the desktop app here...\n\n123456 -> 789012\n..."
  mappedIdsInput.Size = UDim2.new(1, -4, 0, 200)
  mappedIdsInput.Text = ""
  mappedIdsInput.TextColor3 = Color3.fromRGB(220, 220, 220)
  mappedIdsInput.TextSize = 13
  mappedIdsInput.TextWrapped = true
  mappedIdsInput.TextXAlignment = Enum.TextXAlignment.Left
  mappedIdsInput.TextYAlignment = Enum.TextYAlignment.Top
  mappedIdsInput.Parent = inputScrollFrame

  local runButton = createHoverButton(rightPanel, "RunButton", "Apply Replacements", Color3.fromRGB(88, 101, 242), 0)
  runButton.Position = UDim2.new(0, 20, 1, -74)

  local btnGradient = Instance.new("UIGradient")
  btnGradient.Color = ColorSequence.new({
    ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 255, 255)),
    ColorSequenceKeypoint.new(1, Color3.fromRGB(210, 220, 255))
  })
  btnGradient.Rotation = 90
  btnGradient.Parent = runButton

  local isUpdating = false
  local function updateInputCanvas()
    if isUpdating then return end
    isUpdating = true
    local visibleHeight = math.max(60, inputScrollFrame.AbsoluteSize.Y - 20)
    local targetHeight = math.max(visibleHeight, mappedIdsInput.TextBounds.Y + 28)
    if mappedIdsInput.Size.Y.Offset ~= targetHeight then
      mappedIdsInput.Size = UDim2.new(1, -4, 0, targetHeight)
      inputScrollFrame.CanvasSize = UDim2.new(0, 0, 0, targetHeight + 20)
    end
    isUpdating = false
  end

  mappedIdsInput:GetPropertyChangedSignal("Text"):Connect(updateInputCanvas)
  mappedIdsInput:GetPropertyChangedSignal("TextBounds"):Connect(updateInputCanvas)
  inputScrollFrame:GetPropertyChangedSignal("AbsoluteSize"):Connect(updateInputCanvas)
  task.defer(updateInputCanvas)

  screenGui.Parent = parent
  return screenGui
end
