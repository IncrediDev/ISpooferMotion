--!strict
return function(parent, pluginVersion)
  parent = parent or game:GetService("CoreGui")

  local titleText = "ISpooferMotion"
  if pluginVersion and tostring(pluginVersion) ~= "" then
    titleText = titleText .. " v" .. tostring(pluginVersion)
  end

  local screenGui = Instance.new("ScreenGui")
  screenGui.Name = "SpooferMotion_MapId_UI"
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
  mainPopup.BackgroundTransparency = 0.08
  mainPopup.BorderSizePixel = 0
  mainPopup.ClipsDescendants = true
  mainPopup.Position = UDim2.new(0.5, 0, 0.5, 0)
  mainPopup.Size = UDim2.new(0.86, 0, 0.74, 0)
  mainPopup.Parent = screenGui

  local mainCorner = Instance.new("UICorner")
  mainCorner.CornerRadius = UDim.new(0, 14)
  mainCorner.Parent = mainPopup

  local mainSize = Instance.new("UISizeConstraint")
  mainSize.MaxSize = Vector2.new(650, 400)
  mainSize.MinSize = Vector2.new(360, 260)
  mainSize.Parent = mainPopup

  local mainAspect = Instance.new("UIAspectRatioConstraint")
  mainAspect.AspectRatio = 1.625
  mainAspect.Parent = mainPopup

  local mainScale = Instance.new("UIScale")
  mainScale.Parent = mainPopup

  local mainStroke = Instance.new("UIStroke")
  mainStroke.Color = Color3.new(1, 1, 1)
  mainStroke.Transparency = 0.9
  mainStroke.Parent = mainPopup

  local mainGradient = Instance.new("UIGradient")
  mainGradient.Color = ColorSequence.new({
    ColorSequenceKeypoint.new(0, Color3.fromRGB(28, 28, 28)),
    ColorSequenceKeypoint.new(0.45, Color3.fromRGB(16, 16, 16)),
    ColorSequenceKeypoint.new(1, Color3.fromRGB(5, 5, 5)),
  })
  mainGradient.Rotation = 90
  mainGradient.Transparency = NumberSequence.new({
    NumberSequenceKeypoint.new(0, 0.02, 0),
    NumberSequenceKeypoint.new(1, 0.14, 0),
  })
  mainGradient.Parent = mainPopup

  local topArea = Instance.new("Frame")
  topArea.Name = "TopArea"
  topArea.BackgroundTransparency = 1
  topArea.BorderSizePixel = 0
  topArea.Size = UDim2.new(1, 0, 0, 82)
  topArea.Parent = mainPopup

  local icon = Instance.new("ImageLabel")
  icon.Name = "Icon"
  icon.BackgroundColor3 = Color3.fromRGB(230, 230, 230)
  icon.BorderSizePixel = 0
  icon.Position = UDim2.new(0, 14, 0, 13)
  icon.Size = UDim2.new(0, 51, 0, 51)
  icon.Image = "rbxassetid://11778372908"
  icon.ScaleType = Enum.ScaleType.Crop
  icon.Parent = topArea

  local iconCorner = Instance.new("UICorner")
  iconCorner.CornerRadius = UDim.new(0, 6)
  iconCorner.Parent = icon

  local iconStroke = Instance.new("UIStroke")
  iconStroke.Color = Color3.new(1, 1, 1)
  iconStroke.Transparency = 0.76
  iconStroke.Parent = icon

  local title = Instance.new("TextLabel")
  title.Name = "Title"
  title.BackgroundTransparency = 1
  title.Position = UDim2.new(0, 75, 0, 11)
  title.Size = UDim2.new(1, -150, 0, 33)
  title.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
  title.Text = titleText
  title.TextColor3 = Color3.new(1, 1, 1)
  title.TextScaled = true
  title.TextSize = 25
  title.TextTruncate = Enum.TextTruncate.AtEnd
  title.TextXAlignment = Enum.TextXAlignment.Left
  title.Parent = topArea

  local titleTextSize = Instance.new("UITextSizeConstraint")
  titleTextSize.MaxTextSize = 25
  titleTextSize.MinTextSize = 16
  titleTextSize.Parent = title

  local subtitle = Instance.new("TextLabel")
  subtitle.Name = "Subtitle"
  subtitle.BackgroundTransparency = 1
  subtitle.Position = UDim2.new(0, 75, 0, 41)
  subtitle.Size = UDim2.new(1, -150, 0, 25)
  subtitle.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular,
    Enum.FontStyle.Normal)
  subtitle.Text = "Paste mapped IDs below, then click Run"
  subtitle.TextColor3 = Color3.fromRGB(198, 198, 198)
  subtitle.TextSize = 15
  subtitle.TextTruncate = Enum.TextTruncate.AtEnd
  subtitle.TextXAlignment = Enum.TextXAlignment.Left
  subtitle.Parent = topArea

  local closeButton = Instance.new("TextButton")
  closeButton.Name = "CloseButton"
  closeButton.AnchorPoint = Vector2.new(1, 0)
  closeButton.BackgroundTransparency = 1
  closeButton.Position = UDim2.new(1, -18, 0, 8)
  closeButton.Size = UDim2.new(0, 56, 0, 56)
  closeButton.AutoButtonColor = false
  closeButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular,
    Enum.FontStyle.Normal)
  closeButton.Text = "×"
  closeButton.TextColor3 = Color3.fromRGB(198, 198, 198)
  closeButton.TextSize = 62
  closeButton.Parent = topArea

  local hoverGlow = Instance.new("Frame")
  hoverGlow.Name = "HoverGlow"
  hoverGlow.AnchorPoint = Vector2.new(0.5, 0.5)
  hoverGlow.BackgroundColor3 = Color3.fromRGB(198, 198, 198)
  hoverGlow.BackgroundTransparency = 1
  hoverGlow.BorderSizePixel = 0
  hoverGlow.Position = UDim2.new(0.5, 0, 0.5, 0)
  hoverGlow.Size = UDim2.new(0, 46, 0, 46)
  hoverGlow.ZIndex = 0
  hoverGlow.Parent = closeButton

  local hoverCorner = Instance.new("UICorner")
  hoverCorner.CornerRadius = UDim.new(0, 12)
  hoverCorner.Parent = hoverGlow

  local inputScrollFrame = Instance.new("ScrollingFrame")
  inputScrollFrame.Name = "MappedIdsInputScroll"
  inputScrollFrame.BackgroundColor3 = Color3.fromRGB(24, 24, 24)
  inputScrollFrame.BackgroundTransparency = 0.32
  inputScrollFrame.BorderSizePixel = 0
  inputScrollFrame.Position = UDim2.new(0, 18, 0, 82)
  inputScrollFrame.Size = UDim2.new(1, -36, 1, -150)
  inputScrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.None
  inputScrollFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
  inputScrollFrame.ClipsDescendants = true
  inputScrollFrame.ElasticBehavior = Enum.ElasticBehavior.WhenScrollable
  inputScrollFrame.ScrollingDirection = Enum.ScrollingDirection.Y
  inputScrollFrame.ScrollBarImageTransparency = 0.12
  inputScrollFrame.ScrollBarThickness = 8
  inputScrollFrame.VerticalScrollBarInset = Enum.ScrollBarInset.ScrollBar
  inputScrollFrame.Parent = mainPopup

  local inputCorner = Instance.new("UICorner")
  inputCorner.CornerRadius = UDim.new(0, 4)
  inputCorner.Parent = inputScrollFrame

  local inputStroke = Instance.new("UIStroke")
  inputStroke.Color = Color3.new(1, 1, 1)
  inputStroke.Transparency = 0.9
  inputStroke.Parent = inputScrollFrame

  local inputPadding = Instance.new("UIPadding")
  inputPadding.PaddingBottom = UDim.new(0, 10)
  inputPadding.PaddingLeft = UDim.new(0, 11)
  inputPadding.PaddingRight = UDim.new(0, 14)
  inputPadding.PaddingTop = UDim.new(0, 10)
  inputPadding.Parent = inputScrollFrame

  local mappedIdsInput = Instance.new("TextBox")
  mappedIdsInput.Name = "MappedIdsInput"
  mappedIdsInput.BackgroundTransparency = 1
  mappedIdsInput.BorderSizePixel = 0
  mappedIdsInput.ClearTextOnFocus = false
  mappedIdsInput.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular,
    Enum.FontStyle.Normal)
  mappedIdsInput.MultiLine = true
  mappedIdsInput.PlaceholderColor3 = Color3.fromRGB(180, 180, 180)
  mappedIdsInput.PlaceholderText = "Paste mappings here, one per line. Example: 123456 -> 789012"
  mappedIdsInput.Position = UDim2.new(0, 0, 0, 0)
  mappedIdsInput.Size = UDim2.new(1, -10, 0, 180)
  mappedIdsInput.Text = ""
  mappedIdsInput.TextColor3 = Color3.fromRGB(242, 242, 242)
  mappedIdsInput.TextSize = 22
  mappedIdsInput.TextWrapped = true
  mappedIdsInput.TextXAlignment = Enum.TextXAlignment.Left
  mappedIdsInput.TextYAlignment = Enum.TextYAlignment.Top
  mappedIdsInput.Parent = inputScrollFrame

  local runButtonHolder = Instance.new("Frame")
  runButtonHolder.Name = "RunButtonHolder"
  runButtonHolder.AnchorPoint = Vector2.new(0.5, 1)
  runButtonHolder.BackgroundTransparency = 1
  runButtonHolder.Position = UDim2.new(0.5, 0, 1, -22)
  runButtonHolder.Size = UDim2.new(0, 310, 0, 36)
  runButtonHolder.Parent = mainPopup

  local shadow = Instance.new("Frame")
  shadow.Name = "Shadow"
  shadow.BackgroundColor3 = Color3.new(0, 0, 0)
  shadow.BackgroundTransparency = 0.72
  shadow.BorderSizePixel = 0
  shadow.Position = UDim2.new(0, 0, 0, 5)
  shadow.Size = UDim2.new(1, 0, 1, 0)
  shadow.Parent = runButtonHolder

  local shadowCorner = Instance.new("UICorner")
  shadowCorner.CornerRadius = UDim.new(0, 5)
  shadowCorner.Parent = shadow

  local runButton = Instance.new("TextButton")
  runButton.Name = "RunButton"
  runButton.BackgroundColor3 = Color3.fromRGB(76, 175, 80)
  runButton.BorderSizePixel = 0
  runButton.Size = UDim2.new(1, 0, 1, 0)
  runButton.AutoButtonColor = false
  runButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular,
    Enum.FontStyle.Normal)
  runButton.Text = "Run"
  runButton.TextColor3 = Color3.new(1, 1, 1)
  runButton.TextSize = 31
  runButton.Parent = runButtonHolder

  local runCorner = Instance.new("UICorner")
  runCorner.CornerRadius = UDim.new(0, 4)
  runCorner.Parent = runButton

  local runStroke = Instance.new("UIStroke")
  runStroke.Color = Color3.new(1, 1, 1)
  runStroke.Transparency = 0.9
  runStroke.Parent = runButton

  local runGradient = Instance.new("UIGradient")
  runGradient.Color = ColorSequence.new({
    ColorSequenceKeypoint.new(0, Color3.fromRGB(76, 175, 80)),
    ColorSequenceKeypoint.new(1, Color3.fromRGB(46, 125, 50)),
  })
  runGradient.Rotation = 90
  runGradient.Parent = runButton

  local function updateInputCanvas()
    local visibleHeight = math.max(120, inputScrollFrame.AbsoluteSize.Y - 20)
    local targetHeight = math.max(visibleHeight, mappedIdsInput.TextBounds.Y + 28)
    mappedIdsInput.Size = UDim2.new(1, -10, 0, targetHeight)
    inputScrollFrame.CanvasSize = UDim2.new(0, 0, 0, targetHeight + 20)
  end

  mappedIdsInput:GetPropertyChangedSignal("Text"):Connect(updateInputCanvas)
  mappedIdsInput:GetPropertyChangedSignal("TextBounds"):Connect(updateInputCanvas)
  inputScrollFrame:GetPropertyChangedSignal("AbsoluteSize"):Connect(updateInputCanvas)
  task.defer(updateInputCanvas)

  screenGui.Parent = parent
  return screenGui
end
