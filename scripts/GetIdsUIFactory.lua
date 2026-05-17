return function(parent)
	parent = parent or game:GetService("CoreGui")

-- Parents

local parent_SpooferMotion_UI = parent

-- Instances

local SpooferMotion_UI_ScreenGui = Instance.new("ScreenGui")
local DimBackground_Frame = Instance.new("Frame")
local MainPopup_Frame = Instance.new("Frame")
local UICorner_UICorner = Instance.new("UICorner")
local AutoScale_UIScale = Instance.new("UIScale")
local UISizeConstraint_UISizeConstraint = Instance.new("UISizeConstraint")
local UIAspectRatioConstraint_UIAspectRatioConstraint = Instance.new("UIAspectRatioConstraint")
local UIStroke_UIStroke = Instance.new("UIStroke")
local UIGradient_UIGradient = Instance.new("UIGradient")
local TopGlow_Frame = Instance.new("Frame")
local UIGradient_UIGradient_2 = Instance.new("UIGradient")
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
local CloseHoverGlow_Frame = Instance.new("Frame")
local UICorner_UICorner_3 = Instance.new("UICorner")
local Prompt_TextLabel = Instance.new("TextLabel")
local UIStroke_UIStroke_6 = Instance.new("UIStroke")
local AnimationsButtonHolder_Frame = Instance.new("Frame")
local Shadow_Frame = Instance.new("Frame")
local UICorner_UICorner_4 = Instance.new("UICorner")
local AnimationsButton_TextButton = Instance.new("TextButton")
local UICorner_UICorner_5 = Instance.new("UICorner")
local UIStroke_UIStroke_7 = Instance.new("UIStroke")
local UIStroke_UIStroke_8 = Instance.new("UIStroke")
local UIGradient_UIGradient_3 = Instance.new("UIGradient")
local SoundButtonHolder_Frame = Instance.new("Frame")
local Shadow_Frame_2 = Instance.new("Frame")
local UICorner_UICorner_6 = Instance.new("UICorner")
local SoundButton_TextButton = Instance.new("TextButton")
local UICorner_UICorner_7 = Instance.new("UICorner")
local UIStroke_UIStroke_9 = Instance.new("UIStroke")
local UIStroke_UIStroke_10 = Instance.new("UIStroke")
local UIGradient_UIGradient_4 = Instance.new("UIGradient")

SpooferMotion_UI_ScreenGui.Name = "SpooferMotion_UI"
SpooferMotion_UI_ScreenGui.ResetOnSpawn = false
SpooferMotion_UI_ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
SpooferMotion_UI_ScreenGui.IgnoreGuiInset = true
SpooferMotion_UI_ScreenGui.ScreenInsets = Enum.ScreenInsets.DeviceSafeInsets

DimBackground_Frame.Name = "DimBackground"
DimBackground_Frame.BackgroundColor3 = Color3.new(0, 0, 0)
DimBackground_Frame.BackgroundTransparency = 0.41999995708465576
DimBackground_Frame.BorderSizePixel = 0
DimBackground_Frame.Size = UDim2.new(1, 0, 1, 0)

MainPopup_Frame.Name = "MainPopup"
MainPopup_Frame.AnchorPoint = Vector2.new(0.5, 0.5)
MainPopup_Frame.BackgroundColor3 = Color3.new(0.011764706112444401, 0.019607843831181526, 0.027450980618596077)
MainPopup_Frame.BackgroundTransparency = 0.070000000298023224
MainPopup_Frame.BorderSizePixel = 0
MainPopup_Frame.ClipsDescendants = true
MainPopup_Frame.Position = UDim2.new(0.5, 0, 0.5, 0)
MainPopup_Frame.Size = UDim2.new(0.89999997615814209, 0, 0.89999997615814209, 0)

UICorner_UICorner.CornerRadius = UDim.new(0, 16)

AutoScale_UIScale.Name = "AutoScale"

UISizeConstraint_UISizeConstraint.MaxSize = Vector2.new(650, 470)
UISizeConstraint_UISizeConstraint.MinSize = Vector2.new(340, 250)

UIAspectRatioConstraint_UIAspectRatioConstraint.AspectRatio = 1.3829786777496338

UIStroke_UIStroke.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke.Transparency = 0.87999999523162842

UIGradient_UIGradient.Color = ColorSequence.new({ColorSequenceKeypoint.new(0, Color3.new(0.047058824449777603, 0.054901961237192154, 0.066666670143604279)), ColorSequenceKeypoint.new(0.41999998688697815, Color3.new(0.015686275437474251, 0.027450980618596077, 0.039215687662363052)), ColorSequenceKeypoint.new(1, Color3.new(0, 0.0078431377187371254, 0.019607843831181526))})
UIGradient_UIGradient.Rotation = 90
UIGradient_UIGradient.Transparency = NumberSequence.new({NumberSequenceKeypoint.new(0, 0.0099999997764825821, 0), NumberSequenceKeypoint.new(0.55000001192092896, 0.059999998658895493, 0), NumberSequenceKeypoint.new(1, 0.15999999642372131, 0)})

TopGlow_Frame.Name = "TopGlow"
TopGlow_Frame.BackgroundColor3 = Color3.new(1, 1, 1)
TopGlow_Frame.BackgroundTransparency = 0.97000002861022949
TopGlow_Frame.BorderSizePixel = 0
TopGlow_Frame.Size = UDim2.new(1, 0, 0, 120)

UIGradient_UIGradient_2.Rotation = 90
UIGradient_UIGradient_2.Transparency = NumberSequence.new({NumberSequenceKeypoint.new(0, 0.89999997615814209, 0), NumberSequenceKeypoint.new(1, 1, 0)})

TopArea_Frame.Name = "TopArea"
TopArea_Frame.BackgroundTransparency = 1
TopArea_Frame.BorderSizePixel = 0
TopArea_Frame.Size = UDim2.new(1, 0, 0, 92)

Icon_ImageLabel.Name = "Icon"
Icon_ImageLabel.BackgroundColor3 = Color3.new(0.92156863212585449, 0.92156863212585449, 0.92156863212585449)
Icon_ImageLabel.BorderSizePixel = 0
Icon_ImageLabel.Position = UDim2.new(0, 16, 0, 15)
Icon_ImageLabel.Size = UDim2.new(0, 52, 0, 52)
Icon_ImageLabel.Image = "rbxassetid://11778372908"
Icon_ImageLabel.ScaleType = Enum.ScaleType.Crop

UICorner_UICorner_2.CornerRadius = UDim.new(0, 7)

UIStroke_UIStroke_2.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_2.Transparency = 0.72000002861022949

Title_TextLabel.Name = "Title"
Title_TextLabel.BackgroundTransparency = 1
Title_TextLabel.Position = UDim2.new(0, 82, 0, 13)
Title_TextLabel.Size = UDim2.new(0, 395, 0, 36)
Title_TextLabel.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
Title_TextLabel.Text = "ISpooferMotion"
Title_TextLabel.TextColor3 = Color3.new(1, 1, 1)
Title_TextLabel.TextSize = 26
Title_TextLabel.TextXAlignment = Enum.TextXAlignment.Left

UIStroke_UIStroke_3.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_3.Transparency = 0.89999997615814209

Subtitle_TextLabel.Name = "Subtitle"
Subtitle_TextLabel.BackgroundTransparency = 1
Subtitle_TextLabel.Position = UDim2.new(0, 82, 0, 45)
Subtitle_TextLabel.Size = UDim2.new(0, 360, 0, 27)
Subtitle_TextLabel.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
Subtitle_TextLabel.Text = "Copy the output below"
Subtitle_TextLabel.TextColor3 = Color3.new(0.80392158031463623, 0.80392158031463623, 0.80392158031463623)
Subtitle_TextLabel.TextSize = 16
Subtitle_TextLabel.TextXAlignment = Enum.TextXAlignment.Left

UIStroke_UIStroke_4.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_4.Transparency = 0.89999997615814209

CloseButton_TextButton.Name = "CloseButton"
CloseButton_TextButton.AnchorPoint = Vector2.new(1, 0)
CloseButton_TextButton.BackgroundTransparency = 1
CloseButton_TextButton.Position = UDim2.new(1, -17, 0, 8)
CloseButton_TextButton.Size = UDim2.new(0, 58, 0, 58)
CloseButton_TextButton.AutoButtonColor = false
CloseButton_TextButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
CloseButton_TextButton.Text = "×"
CloseButton_TextButton.TextColor3 = Color3.new(1, 0.27450981736183167, 0.32156863808631897)
CloseButton_TextButton.TextSize = 64

UIStroke_UIStroke_5.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_5.Transparency = 0.89999997615814209

CloseHoverGlow_Frame.Name = "CloseHoverGlow"
CloseHoverGlow_Frame.AnchorPoint = Vector2.new(0.5, 0.5)
CloseHoverGlow_Frame.BackgroundColor3 = Color3.new(1, 0.27450981736183167, 0.32156863808631897)
CloseHoverGlow_Frame.BackgroundTransparency = 1
CloseHoverGlow_Frame.BorderSizePixel = 0
CloseHoverGlow_Frame.Position = UDim2.new(0.5, 0, 0.5, 0)
CloseHoverGlow_Frame.Size = UDim2.new(0, 48, 0, 48)
CloseHoverGlow_Frame.ZIndex = 0

UICorner_UICorner_3.CornerRadius = UDim.new(0, 12)

Prompt_TextLabel.Name = "Prompt"
Prompt_TextLabel.BackgroundTransparency = 1
Prompt_TextLabel.Position = UDim2.new(0, 22, 0, 102)
Prompt_TextLabel.Size = UDim2.new(0, 455, 0, 45)
Prompt_TextLabel.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
Prompt_TextLabel.Text = "Choose an option.."
Prompt_TextLabel.TextColor3 = Color3.new(0.86274510622024536, 0.86274510622024536, 0.86274510622024536)
Prompt_TextLabel.TextSize = 28
Prompt_TextLabel.TextXAlignment = Enum.TextXAlignment.Left

UIStroke_UIStroke_6.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_6.Transparency = 0.89999997615814209

AnimationsButtonHolder_Frame.Name = "AnimationsButtonHolder"
AnimationsButtonHolder_Frame.AnchorPoint = Vector2.new(0.5, 0)
AnimationsButtonHolder_Frame.BackgroundTransparency = 1
AnimationsButtonHolder_Frame.Position = UDim2.new(0.5, 0, 0, 229)
AnimationsButtonHolder_Frame.Size = UDim2.new(0, 324, 0, 78)

Shadow_Frame.Name = "Shadow"
Shadow_Frame.BackgroundColor3 = Color3.new(0, 0, 0)
Shadow_Frame.BackgroundTransparency = 0.68000000715255737
Shadow_Frame.BorderSizePixel = 0
Shadow_Frame.Position = UDim2.new(0, 0, 0, 7)
Shadow_Frame.Size = UDim2.new(1, 0, 1, 0)

UICorner_UICorner_4.CornerRadius = UDim.new(0, 10)

AnimationsButton_TextButton.Name = "AnimationsButton"
AnimationsButton_TextButton.BackgroundColor3 = Color3.new(0.25098040699958801, 0.61960786581039429, 0.24705882370471954)
AnimationsButton_TextButton.BorderSizePixel = 0
AnimationsButton_TextButton.Size = UDim2.new(1, 0, 1, 0)
AnimationsButton_TextButton.AutoButtonColor = false
AnimationsButton_TextButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
AnimationsButton_TextButton.Text = "Animations"
AnimationsButton_TextButton.TextColor3 = Color3.new(1, 1, 1)
AnimationsButton_TextButton.TextSize = 47

UICorner_UICorner_5.CornerRadius = UDim.new(0, 9)

UIStroke_UIStroke_7.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_7.Transparency = 0.89999997615814209

UIStroke_UIStroke_8.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_8.Transparency = 0.86000001430511475

UIGradient_UIGradient_3.Color = ColorSequence.new({ColorSequenceKeypoint.new(0, Color3.new(0.33725491166114807, 0.7450980544090271, 0.32156863808631897)), ColorSequenceKeypoint.new(0.47999998927116394, Color3.new(0.25490197539329529, 0.62745100259780884, 0.24705882370471954)), ColorSequenceKeypoint.new(1, Color3.new(0.17647059261798859, 0.48627451062202454, 0.17647059261798859))})
UIGradient_UIGradient_3.Rotation = 90

SoundButtonHolder_Frame.Name = "SoundButtonHolder"
SoundButtonHolder_Frame.AnchorPoint = Vector2.new(0.5, 0)
SoundButtonHolder_Frame.BackgroundTransparency = 1
SoundButtonHolder_Frame.Position = UDim2.new(0.5, 0, 0, 329)
SoundButtonHolder_Frame.Size = UDim2.new(0, 324, 0, 78)

Shadow_Frame_2.Name = "Shadow"
Shadow_Frame_2.BackgroundColor3 = Color3.new(0, 0, 0)
Shadow_Frame_2.BackgroundTransparency = 0.68000000715255737
Shadow_Frame_2.BorderSizePixel = 0
Shadow_Frame_2.Position = UDim2.new(0, 0, 0, 7)
Shadow_Frame_2.Size = UDim2.new(1, 0, 1, 0)

UICorner_UICorner_6.CornerRadius = UDim.new(0, 10)

SoundButton_TextButton.Name = "SoundButton"
SoundButton_TextButton.BackgroundColor3 = Color3.new(0.25098040699958801, 0.61960786581039429, 0.24705882370471954)
SoundButton_TextButton.BorderSizePixel = 0
SoundButton_TextButton.Size = UDim2.new(1, 0, 1, 0)
SoundButton_TextButton.AutoButtonColor = false
SoundButton_TextButton.FontFace = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
SoundButton_TextButton.Text = "Sound"
SoundButton_TextButton.TextColor3 = Color3.new(1, 1, 1)
SoundButton_TextButton.TextSize = 47

UICorner_UICorner_7.CornerRadius = UDim.new(0, 9)

UIStroke_UIStroke_9.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_9.Transparency = 0.89999997615814209

UIStroke_UIStroke_10.Color = Color3.new(1, 1, 1)
UIStroke_UIStroke_10.Transparency = 0.86000001430511475

UIGradient_UIGradient_4.Color = ColorSequence.new({ColorSequenceKeypoint.new(0, Color3.new(0.33725491166114807, 0.7450980544090271, 0.32156863808631897)), ColorSequenceKeypoint.new(0.47999998927116394, Color3.new(0.25490197539329529, 0.62745100259780884, 0.24705882370471954)), ColorSequenceKeypoint.new(1, Color3.new(0.17647059261798859, 0.48627451062202454, 0.17647059261798859))})
UIGradient_UIGradient_4.Rotation = 90

-- Parenting

DimBackground_Frame.Parent = SpooferMotion_UI_ScreenGui
MainPopup_Frame.Parent = SpooferMotion_UI_ScreenGui
UICorner_UICorner.Parent = MainPopup_Frame
AutoScale_UIScale.Parent = MainPopup_Frame
UISizeConstraint_UISizeConstraint.Parent = MainPopup_Frame
UIAspectRatioConstraint_UIAspectRatioConstraint.Parent = MainPopup_Frame
UIStroke_UIStroke.Parent = MainPopup_Frame
UIGradient_UIGradient.Parent = MainPopup_Frame
TopGlow_Frame.Parent = MainPopup_Frame
UIGradient_UIGradient_2.Parent = TopGlow_Frame
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
CloseHoverGlow_Frame.Parent = CloseButton_TextButton
UICorner_UICorner_3.Parent = CloseHoverGlow_Frame
Prompt_TextLabel.Parent = MainPopup_Frame
UIStroke_UIStroke_6.Parent = Prompt_TextLabel
AnimationsButtonHolder_Frame.Parent = MainPopup_Frame
Shadow_Frame.Parent = AnimationsButtonHolder_Frame
UICorner_UICorner_4.Parent = Shadow_Frame
AnimationsButton_TextButton.Parent = AnimationsButtonHolder_Frame
UICorner_UICorner_5.Parent = AnimationsButton_TextButton
UIStroke_UIStroke_7.Parent = AnimationsButton_TextButton
UIStroke_UIStroke_8.Parent = AnimationsButton_TextButton
UIGradient_UIGradient_3.Parent = AnimationsButton_TextButton
SoundButtonHolder_Frame.Parent = MainPopup_Frame
Shadow_Frame_2.Parent = SoundButtonHolder_Frame
UICorner_UICorner_6.Parent = Shadow_Frame_2
SoundButton_TextButton.Parent = SoundButtonHolder_Frame
UICorner_UICorner_7.Parent = SoundButton_TextButton
UIStroke_UIStroke_9.Parent = SoundButton_TextButton
UIStroke_UIStroke_10.Parent = SoundButton_TextButton
UIGradient_UIGradient_4.Parent = SoundButton_TextButton
SpooferMotion_UI_ScreenGui.Parent = parent_SpooferMotion_UI
	return SpooferMotion_UI_ScreenGui
end
