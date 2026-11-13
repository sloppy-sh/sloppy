## The pages read at the hand, dressed as the desk's are: the look's faces, its
## ink on its card, hairline rules as heavy as its style draws them and room
## between things as its density leaves it — DESIGN.md § "The field in a room".
extends RefCounted

const Room := preload("res://room/room.gd")
const Look := preload("res://look/look.gd")

## Type variations a page's Labels take: its title, and what is said quietly.
const HEADING := "Heading"
const QUIET := "Quiet"

## In pixels of a page, at the comfortable density.
const BODY := 27
const MONO := 23
const TITLE := 38
const SAID_QUIETLY := 24
const BUTTON := 28
const MARGIN := Vector2(44, 36)
const BETWEEN := 18
const HAIRLINE := 2
const CORNER := 18


## The theme packs a headset may dress its panels in, as it keeps them, in the
## order they are offered: each one's file and the types in it a page's sheet,
## title and quiet words take. themes/README.md says where each comes from.
const PACKS := {
	"material_light": {"named": "Material light", "file": "res://themes/material/material_light.tres", "sheet": "M3Card", "heading": "M3LabelHeadline", "quiet": "M3LabelMuted"},
	"material_dark": {"named": "Material dark", "file": "res://themes/material/material_dark.tres", "sheet": "M3Card", "heading": "M3LabelHeadline", "quiet": "M3LabelMuted"},
	"spacey": {"named": "Spacey", "file": "res://themes/spacey/spacey.tres", "sheet": "PanelContainer", "heading": "Label_Title", "quiet": "Label"},
	"clashy": {"named": "Clashy", "file": "res://themes/clashy/clashy.tres", "sheet": "PanelContainer", "heading": "Label_Title", "quiet": "Label"},
}

## Of the label colours a pack gives its Labels, the ones its writing is given too.
const _LABEL_COLOURS := {"font_color": "default_color", "font_outline_color": "font_outline_color", "font_shadow_color": "font_shadow_color"}
const _LABEL_CONSTANTS := {"outline_size": "outline_size", "shadow_offset_x": "shadow_offset_x", "shadow_offset_y": "shadow_offset_y", "shadow_outline_size": "shadow_outline_size"}


## The packs this headset holds, in the order they are offered.
static func held() -> Array:
	return PACKS.keys().filter(func(name): return ResourceLoader.exists(PACKS[name].file))


## The theme pack `name` dresses a page in, at the sizes and spacing `look`
## reads at; the look's own Theme where `name` is `Room.LOOK_PANELS`, or a pack
## this headset does not hold.
static func pack(name: String, look: Dictionary, ink: Color = Room.ink(), paper: Color = Room.paper()) -> Theme:
	var found: Dictionary = PACKS.get(name, {})
	if found.is_empty() or not ResourceLoader.exists(found.file):
		return of(look, ink, paper)
	var worn: Theme = load(found.file)
	var closeness: float = Look.CLOSENESS.get(str(look.get("density", "")), 1.0)
	var lettering := 0.8 + 0.2 * closeness
	var spacing := 0.4 + 0.6 * closeness
	var made := Theme.new()
	made.merge_with(worn)
	var face: Font = worn.default_font if worn.default_font != null else SystemFont.new()
	made.default_font = face
	made.default_font_size = roundi(BODY * lettering)

	made.set_stylebox("panel", "PanelContainer", worn.get_stylebox("panel", found.sheet))
	for side in ["left", "right"]:
		made.set_constant("margin_" + side, "MarginContainer", roundi(MARGIN.x * spacing))
	for side in ["top", "bottom"]:
		made.set_constant("margin_" + side, "MarginContainer", roundi(MARGIN.y * spacing))
	for box in ["VBoxContainer", "HBoxContainer"]:
		made.set_constant("separation", box, roundi(BETWEEN * spacing))

	made.set_font_size("font_size", "Label", roundi(BODY * lettering))
	_variation(made, worn, HEADING, found.heading, roundi(TITLE * lettering))
	_variation(made, worn, QUIET, found.quiet, roundi(SAID_QUIETLY * lettering))
	if found.quiet == "Label" and worn.has_color("font_color", "Label"):
		var said: Color = worn.get_color("font_color", "Label")
		made.set_color("font_color", QUIET, Color(said, said.a * 0.7))

	var writing: Font = worn.get_font("font", "Label") if worn.has_font("font", "Label") else face
	if not worn.has_font("normal_font", "RichTextLabel"):
		var bold := FontVariation.new()
		bold.base_font = writing
		bold.variation_embolden = 0.7
		var leaning := FontVariation.new()
		leaning.base_font = writing
		leaning.variation_transform = Transform2D(Vector2(1.0, 0.0), Vector2(0.2, 1.0), Vector2.ZERO)
		var both := FontVariation.new()
		both.base_font = bold
		both.variation_transform = leaning.variation_transform
		made.set_font("normal_font", "RichTextLabel", writing)
		made.set_font("bold_font", "RichTextLabel", bold)
		made.set_font("italics_font", "RichTextLabel", leaning)
		made.set_font("bold_italics_font", "RichTextLabel", both)
	if not worn.has_font("mono_font", "RichTextLabel"):
		made.set_font("mono_font", "RichTextLabel", _face("mono", look.get("fonts", {})))
	for size in ["normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size"]:
		made.set_font_size(size, "RichTextLabel", roundi(BODY * lettering))
	made.set_font_size("mono_font_size", "RichTextLabel", roundi(MONO * lettering))
	for colour in _LABEL_COLOURS:
		if worn.has_color(colour, "Label") and not worn.has_color(_LABEL_COLOURS[colour], "RichTextLabel"):
			made.set_color(_LABEL_COLOURS[colour], "RichTextLabel", worn.get_color(colour, "Label"))
	for constant in _LABEL_CONSTANTS:
		if worn.has_constant(constant, "Label") and not worn.has_constant(_LABEL_CONSTANTS[constant], "RichTextLabel"):
			made.set_constant(_LABEL_CONSTANTS[constant], "RichTextLabel", worn.get_constant(constant, "Label"))

	made.set_font_size("font_size", "Button", roundi(BUTTON * lettering))
	return made


## `variation` of Label set in what the pack's own `type` is, at `size`.
static func _variation(made: Theme, worn: Theme, variation: String, type: String, size: int) -> void:
	made.set_type_variation(variation, "Label")
	for colour in worn.get_color_list(type):
		made.set_color(colour, variation, worn.get_color(colour, type))
	for constant in worn.get_constant_list(type):
		made.set_constant(constant, variation, worn.get_constant(constant, type))
	if worn.has_font("font", type):
		made.set_font("font", variation, worn.get_font("font", type))
	made.set_font_size("font_size", variation, size)


## A Theme for a page in `look` (as `Room.look()` answers it), in `ink` on
## `paper`, its sheet the room's card.
static func of(look: Dictionary, ink: Color = Room.ink(), paper: Color = Room.paper()) -> Theme:
	var closeness: float = Look.CLOSENESS.get(str(look.get("density", "")), 1.0)
	var lettering := 0.8 + 0.2 * closeness
	var spacing := 0.4 + 0.6 * closeness
	var rule := int(round(HAIRLINE * float(Look.EDGE_WEIGHTS.get(str(look.get("style", "")), 1.0))))
	var edge := Room.edge()
	var fonts: Dictionary = look.get("fonts", {})
	var ui := _face("ui", fonts)
	var made := Theme.new()
	made.default_font = ui
	made.default_font_size = roundi(BODY * lettering)

	var sheet := StyleBoxFlat.new()
	sheet.bg_color = Room.card()
	sheet.border_color = edge
	sheet.set_border_width_all(rule)
	sheet.set_corner_radius_all(CORNER)
	made.set_stylebox("panel", "PanelContainer", sheet)
	var line := StyleBoxLine.new()
	line.color = edge
	line.thickness = rule
	made.set_stylebox("separator", "HSeparator", line)
	made.set_constant("separation", "HSeparator", rule)

	for side in ["left", "right"]:
		made.set_constant("margin_" + side, "MarginContainer", roundi(MARGIN.x * spacing))
	for side in ["top", "bottom"]:
		made.set_constant("margin_" + side, "MarginContainer", roundi(MARGIN.y * spacing))
	for box in ["VBoxContainer", "HBoxContainer"]:
		made.set_constant("separation", box, roundi(BETWEEN * spacing))

	made.set_color("font_color", "Label", ink)
	made.set_font_size("font_size", "Label", roundi(BODY * lettering))
	made.set_type_variation(HEADING, "Label")
	made.set_font("font", HEADING, _face("heading", fonts))
	made.set_font_size("font_size", HEADING, roundi(TITLE * lettering))
	made.set_type_variation(QUIET, "Label")
	made.set_color("font_color", QUIET, paper.lerp(ink, 0.7))
	made.set_font_size("font_size", QUIET, roundi(SAID_QUIETLY * lettering))

	var bold := FontVariation.new()
	bold.base_font = ui
	bold.variation_embolden = 0.7
	var leaning := FontVariation.new()
	leaning.base_font = ui
	leaning.variation_transform = Transform2D(Vector2(1.0, 0.0), Vector2(0.2, 1.0), Vector2.ZERO)
	var both := FontVariation.new()
	both.base_font = bold
	both.variation_transform = leaning.variation_transform
	made.set_font("normal_font", "RichTextLabel", ui)
	made.set_font("bold_font", "RichTextLabel", bold)
	made.set_font("italics_font", "RichTextLabel", leaning)
	made.set_font("bold_italics_font", "RichTextLabel", both)
	made.set_font("mono_font", "RichTextLabel", _face("mono", fonts))
	for size in ["normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size"]:
		made.set_font_size(size, "RichTextLabel", roundi(BODY * lettering))
	made.set_font_size("mono_font_size", "RichTextLabel", roundi(MONO * lettering))
	made.set_color("default_color", "RichTextLabel", ink)

	var quiet := StyleBoxFlat.new()
	quiet.bg_color = paper.lerp(ink, 0.06)
	quiet.border_color = edge
	quiet.set_border_width_all(rule)
	quiet.set_corner_radius_all(roundi(CORNER * 0.66))
	quiet.content_margin_left = roundi(22 * spacing)
	quiet.content_margin_right = roundi(22 * spacing)
	quiet.content_margin_top = roundi(10 * spacing)
	quiet.content_margin_bottom = roundi(10 * spacing)
	var near := quiet.duplicate()
	near.bg_color = paper.lerp(ink, 0.14)
	made.set_stylebox("normal", "Button", quiet)
	made.set_stylebox("hover", "Button", near)
	made.set_stylebox("pressed", "Button", near)
	made.set_stylebox("disabled", "Button", quiet)
	made.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	made.set_font_size("font_size", "Button", roundi(BUTTON * lettering))
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		made.set_color(state, "Button", ink)
	made.set_color("font_disabled_color", "Button", paper.lerp(ink, 0.3))
	return made


static func _face(role: String, fonts: Dictionary) -> Font:
	var path := Look.face_file(role, str(fonts.get(role, "system")))
	return SystemFont.new() if path == "" else load(path)
