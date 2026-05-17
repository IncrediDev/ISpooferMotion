return function(parent)
	parent = parent or game:GetService("CoreGui")

-- Parents

local parent_SpooferMotion_MapId_UI = parent

-- Instances

local SpooferMotion_MapId_UI_ScreenGui = Instance.new("ScreenGui")
local DimBackground_Frame = Instance.new("Frame")
local MainPopup_Frame = Instance.new("Frame")
local UICorner_UICorner = Instance.new("UICorner")
local UISizeConstraint_UISizeConstraint = Instance.new("UISizeConstraint")
local UIAspectRatioConstraint_UIAspectRatioConstraint = Instance.new("UIAspectRatioConstraint")
local UIScale_UIScale = Instance.new("UIScale")
local UIStroke_UIStroke = Instance.new("UIStroke")
local UIGradient_UIGradient = Instance.new("UIGradient")
local TopArea_Frame = Instance.new("Frame")
local Icon_ImageLabel = Instance.new("ImageLabel")
local UICorner_UICorner_2 = Instance.new("UICorner")
local UIStroke_UIStroke_2 = Instance.new("UIStroke")
local Title_TextLabel = Instance.new("TextLabel")
local UIStroke_UIStroke_3 = Instance.new("UIStroke")
local Subtitle_TextLabel = Instance.new("TextLabel")
local UIStroke_UIStroke_4 = Instance.new("UIStroke")
local CloseButton_TextButton = Instance.new("TextButton")
local UIStroke_UIStroke_5 = Instance.new("UIStroke")
local HoverGlow_Frame = Instance.new("Frame")
local UICorner_UICorner_3 = Instance.new("UICorner")
local MappedIdsInput_TextBox = Instance.new("TextBox")
local UICorner_UICorner_4 = Instance.new("UICorner")
local UIStroke_UIStroke_6 = Instance.new("UIStroke")
local UIPadding_UIPadding = Instance.new("UIPadding")
local UIStroke_UIStroke_7 = Instance.new("UIStroke")
local RunButtonHolder_Frame = Instance.new("Frame")
local Shadow_Frame = Instance.new("Frame")
local UICorner_UICorner_5 = Instance.new("UICorner")
local RunButton_TextButton = Instance.new("TextButton")
local UICorner_UICorner_6 = Instance.new("UICorner")
local UIStroke_UIStroke_8 = Instance.new("UIStroke")
local UIGradient_UIGradient_2 = Instance.new("UIGradient")
local UIStroke_UIStroke_9 = Instance.new("UIStroke")

SpooferMotion_MapId_UI_ScreenGui.Name = "SpooferMotion_MapId_UI"
SpooferMotion_MapId_UI_ScreenGui.ResetOnSpawn = false
SpooferMotion_MapId_UI_ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
SpooferMotion_MapId_UI_ScreenGui.IgnoreGuiInset = true
SpooferMotion_MapId_UI_ScreenGui.ScreenInsets = Enum.ScreenInsets.DeviceSafeInsets

DimBackground_Frame.Name = "DimBackground"
DimBackground_Frame.BackgroundColor3 = Color3.new(0, 0, 0)
DimBackground_Frame.BackgroundTransparency = 0.41999995708465576
DimBackground_Frame.BorderSizePixel = 0
DimBackground_Frame.Size = UDim2.new(1, 0, 1, 0)

MainPopup_Frame.Name = "MainPopup"
MainPopup_Frame.AnchorPoint = Vector2.new(0.5, 0.5)
MainPopup_Frame.BackgroundColor3 = Color3.new(0.0078431377187371254, 0.015686275437474251, 0.023529412224888802)
MainPopup_Frame.BackgroundTransparency = 0.079999998211860657
MainPopup_Frame.BorderSizePixel = 0
MainPopup_Frame.ClipsDescendants = true
MainPopup_Frame.Position = UDim2.new(0.5, 0, 0.5, 0)
MainPopup_Frame.Size = UDim2.new(0.86000001430511475, 0, 0.74000000953674316, 0)

UICorner_UICorner.CornerRadius = UDim.new(0, 14)

UISizeConstraint_UISizeConstraint.MaxSize = Vector2.new(650, 400)
UISizeConstraint_UISizeConstraint.MinSize = Vector2.new(360, 260)

UIAspectRatioConstraint_UIAspectRatioConstraint.AspectRatio = 1.625

UIStroke_UIStroke.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke.Transparency = 0.89999997615814209

UIGradient_UIGradient.Color = ColorSequence.new({ColorSequenceKeypoint.new(0, Color3.new(0.035294119268655777, 0.043137256056070328, 0.050980392843484879)), ColorSequenceKeypoint.new(0.44999998807907104, Color3.new(0.0078431377187371254, 0.019607843831181526, 0.027450980618596077)), ColorSequenceKeypoint.new(1, Color3.new(0, 0.0078431377187371254, 0.015686275437474251))})
UIGradient_UIGradient.Rotation = 90
UIGradient_UIGradient.Transparency = NumberSequence.new({NumberSequenceKeypoint.new(0, 0.019999999552965164, 0), NumberSequenceKeypoint.new(1, 0.14000000059604645, 0)})

TopArea_Frame.Name = "TopArea"
TopArea_Frame.BackgroundTransparency = 1
TopArea_Frame.BorderSizePixel = 0
TopArea_Frame.Size = UDim2.new(1, 0, 0, 82)

Icon_ImageLabel.Name = "Icon"
Icon_ImageLabel.BackgroundColor3 = Color3.new(0.92156863212585449, 0.92156863212585449, 0.92156863212585449)
Icon_ImageLabel.BorderSizePixel = 0
Icon_ImageLabel.Position = UDim2.new(0, 14, 0, 13)
Icon_ImageLabel.Size = UDim2.new(0, 51, 0, 51)
Icon_ImageLabel.Image = "rbxassetid://11778372908"
Icon_ImageLabel.ScaleType = Enum.ScaleType.Crop

UICorner_UICorner_2.CornerRadius = UDim.new(0, 6)

UIStroke_UIStroke_2.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_2.Transparency = 0.75999999046325684

Title_TextLabel.Name = "Title"
Title_TextLabel.BackgroundTransparency = 1
Title_TextLabel.Position = UDim2.new(0, 75, 0, 11)
Title_TextLabel.Size = UDim2.new(0, 390, 0, 33)
Title_TextLabel.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
Title_TextLabel.Text = "ISpooferMotion"
Title_TextLabel.TextColor3 = Color3.new(1, 1, 1)
Title_TextLabel.TextSize = 25
Title_TextLabel.TextXAlignment = Enum.TextXAlignment.Left

UIStroke_UIStroke_3.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_3.Transparency = 0.89999997615814209

Subtitle_TextLabel.Name = "Subtitle"
Subtitle_TextLabel.BackgroundTransparency = 1
Subtitle_TextLabel.Position = UDim2.new(0, 75, 0, 41)
Subtitle_TextLabel.Size = UDim2.new(0, 420, 0, 25)
Subtitle_TextLabel.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
Subtitle_TextLabel.Text = "Paste the Mapped Id's Below then click run"
Subtitle_TextLabel.TextColor3 = Color3.new(0.64705884456634521, 0.64705884456634521, 0.64705884456634521)
Subtitle_TextLabel.TextSize = 15
Subtitle_TextLabel.TextXAlignment = Enum.TextXAlignment.Left

UIStroke_UIStroke_4.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_4.Transparency = 0.89999997615814209

CloseButton_TextButton.Name = "CloseButton"
CloseButton_TextButton.AnchorPoint = Vector2.new(1, 0)
CloseButton_TextButton.BackgroundTransparency = 1
CloseButton_TextButton.Position = UDim2.new(1, -18, 0, 8)
CloseButton_TextButton.Size = UDim2.new(0, 56, 0, 56)
CloseButton_TextButton.AutoButtonColor = false
CloseButton_TextButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
CloseButton_TextButton.Text = "×"
CloseButton_TextButton.TextColor3 = Color3.new(1, 0.25490197539329529, 0.29803922772407532)
CloseButton_TextButton.TextSize = 62

UIStroke_UIStroke_5.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_5.Transparency = 0.89999997615814209

HoverGlow_Frame.Name = "HoverGlow"
HoverGlow_Frame.AnchorPoint = Vector2.new(0.5, 0.5)
HoverGlow_Frame.BackgroundColor3 = Color3.new(1, 0.25490197539329529, 0.29803922772407532)
HoverGlow_Frame.BackgroundTransparency = 1
HoverGlow_Frame.BorderSizePixel = 0
HoverGlow_Frame.Position = UDim2.new(0.5, 0, 0.5, 0)
HoverGlow_Frame.Size = UDim2.new(0, 46, 0, 46)
HoverGlow_Frame.ZIndex = 0

UICorner_UICorner_3.CornerRadius = UDim.new(0, 12)

MappedIdsInput_TextBox.Name = "MappedIdsInput"
MappedIdsInput_TextBox.BackgroundColor3 = Color3.new(0.039215687662363052, 0.054901961237192154, 0.066666670143604279)
MappedIdsInput_TextBox.BackgroundTransparency = 0.31999999284744263
MappedIdsInput_TextBox.BorderSizePixel = 0
MappedIdsInput_TextBox.Position = UDim2.new(0, 18, 0, 82)
MappedIdsInput_TextBox.Size = UDim2.new(1, -36, 0, 215)
MappedIdsInput_TextBox.ClearTextOnFocus = false
MappedIdsInput_TextBox.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
MappedIdsInput_TextBox.MultiLine = true
MappedIdsInput_TextBox.PlaceholderColor3 = Color3.new(0.72549021244049072, 0.72549021244049072, 0.72549021244049072)
MappedIdsInput_TextBox.PlaceholderText = "Paste something here first."
MappedIdsInput_TextBox.Text = ""
MappedIdsInput_TextBox.TextColor3 = Color3.new(0.96078431606292725, 0.96078431606292725, 0.96078431606292725)
MappedIdsInput_TextBox.TextSize = 27
MappedIdsInput_TextBox.TextWrapped = true
MappedIdsInput_TextBox.TextXAlignment = Enum.TextXAlignment.Left
MappedIdsInput_TextBox.TextYAlignment = Enum.TextYAlignment.Top

UICorner_UICorner_4.CornerRadius = UDim.new(0, 4)

UIStroke_UIStroke_6.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_6.Transparency = 0.89999997615814209

UIPadding_UIPadding.PaddingBottom = UDim.new(0, 10)
UIPadding_UIPadding.PaddingLeft = UDim.new(0, 11)
UIPadding_UIPadding.PaddingRight = UDim.new(0, 11)
UIPadding_UIPadding.PaddingTop = UDim.new(0, 10)

UIStroke_UIStroke_7.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_7.Transparency = 0.93999999761581421

RunButtonHolder_Frame.Name = "RunButtonHolder"
RunButtonHolder_Frame.AnchorPoint = Vector2.new(0.5, 1)
RunButtonHolder_Frame.BackgroundTransparency = 1
RunButtonHolder_Frame.Position = UDim2.new(0.5, 0, 1, -33)
RunButtonHolder_Frame.Size = UDim2.new(0, 310, 0, 36)

Shadow_Frame.Name = "Shadow"
Shadow_Frame.BackgroundColor3 = Color3.new(0, 0, 0)
Shadow_Frame.BackgroundTransparency = 0.72000002861022949
Shadow_Frame.BorderSizePixel = 0
Shadow_Frame.Position = UDim2.new(0, 0, 0, 5)
Shadow_Frame.Size = UDim2.new(1, 0, 1, 0)

UICorner_UICorner_5.CornerRadius = UDim.new(0, 5)

RunButton_TextButton.Name = "RunButton"
RunButton_TextButton.BackgroundColor3 = Color3.new(0.24313725531101227, 0.60392159223556519, 0.23921568691730499)
RunButton_TextButton.BorderSizePixel = 0
RunButton_TextButton.Size = UDim2.new(1, 0, 1, 0)
RunButton_TextButton.AutoButtonColor = false
RunButton_TextButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
RunButton_TextButton.Text = "Run"
RunButton_TextButton.TextColor3 = Color3.new(1, 1, 1)
RunButton_TextButton.TextSize = 31

UICorner_UICorner_6.CornerRadius = UDim.new(0, 4)

UIStroke_UIStroke_8.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_8.Transparency = 0.89999997615814209

UIGradient_UIGradient_2.Color = ColorSequence.new({ColorSequenceKeypoint.new(0, Color3.new(0.28235295414924622, 0.67058825492858887, 0.27450981736183167)), ColorSequenceKeypoint.new(1, Color3.new(0.19607843458652496, 0.53333336114883423, 0.19607843458652496))})
UIGradient_UIGradient_2.Rotation = 90

UIStroke_UIStroke_9.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_9.Transparency = 0.87999999523162842

-- Parenting

DimBackground_Frame.Parent = SpooferMotion_MapId_UI_ScreenGui
MainPopup_Frame.Parent = SpooferMotion_MapId_UI_ScreenGui
UICorner_UICorner.Parent = MainPopup_Frame
UISizeConstraint_UISizeConstraint.Parent = MainPopup_Frame
UIAspectRatioConstraint_UIAspectRatioConstraint.Parent = MainPopup_Frame
UIScale_UIScale.Parent = MainPopup_Frame
UIStroke_UIStroke.Parent = MainPopup_Frame
UIGradient_UIGradient.Parent = MainPopup_Frame
TopArea_Frame.Parent = MainPopup_Frame
Icon_ImageLabel.Parent = TopArea_Frame
UICorner_UICorner_2.Parent = Icon_ImageLabel
UIStroke_UIStroke_2.Parent = Icon_ImageLabel
Title_TextLabel.Parent = TopArea_Frame
UIStroke_UIStroke_3.Parent = Title_TextLabel
Subtitle_TextLabel.Parent = TopArea_Frame
UIStroke_UIStroke_4.Parent = Subtitle_TextLabel
CloseButton_TextButton.Parent = TopArea_Frame
UIStroke_UIStroke_5.Parent = CloseButton_TextButton
HoverGlow_Frame.Parent = CloseButton_TextButton
UICorner_UICorner_3.Parent = HoverGlow_Frame
MappedIdsInput_TextBox.Parent = MainPopup_Frame
UICorner_UICorner_4.Parent = MappedIdsInput_TextBox
UIStroke_UIStroke_6.Parent = MappedIdsInput_TextBox
UIPadding_UIPadding.Parent = MappedIdsInput_TextBox
UIStroke_UIStroke_7.Parent = MappedIdsInput_TextBox
RunButtonHolder_Frame.Parent = MainPopup_Frame
Shadow_Frame.Parent = RunButtonHolder_Frame
UICorner_UICorner_5.Parent = Shadow_Frame
RunButton_TextButton.Parent = RunButtonHolder_Frame
UICorner_UICorner_6.Parent = RunButton_TextButton
UIStroke_UIStroke_8.Parent = RunButton_TextButton
UIGradient_UIGradient_2.Parent = RunButton_TextButton
UIStroke_UIStroke_9.Parent = RunButton_TextButton
SpooferMotion_MapId_UI_ScreenGui.Parent = parent_SpooferMotion_MapId_UI

-- Selection

	return SpooferMotion_MapId_UI_ScreenGui
end
