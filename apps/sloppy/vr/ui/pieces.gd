## The pieces a panel in the room is made of: lines of words, glyphs, and rows a
## hand points at and the trigger chooses. Words standing in the room are in its
## ink and its face (`room/room.gd`); a row is that ink on one of its cards, the
## look's style drawing its edge and its density the room between. A row chosen,
## pointed at or pressed is painted by `paint` — DESIGN.md § "The field in a room".
extends RefCounted

const Pointing := preload("res://ui/pointing.gd")
const Room := preload("res://room/room.gd")

static var INK: Color:
	get:
		return Room.ink()
static var QUIET: Color:
	get:
		return Color(Room.ink(), 0.6)
static var CARD: Color:
	get:
		return Room.card()
static var EDGE: Color:
	get:
		return Room.edge()
static var POINTED: Color:
	get:
		return Room.pointed()
static var PAPER: Color:
	get:
		return Room.paper()
## In metres.
static var EDGE_WIDTH: float:
	get:
		return HAIRLINE * Room.edge_weight()
const HAIRLINE := 0.003
## In metres per pixel of a letter.
const LETTER := 0.0011
const SIZE := 36
const SMALL := 28
## The smallest a row's words are drawn to stand on one line.
const LEAST := 12
## In metres from a row's edge to its words, for letters of SMALL_ROW pixels;
## larger letters stand further in.
const INSET := 0.01
const SMALL_ROW := 16
## In metres a pointed row stands nearer the eyes, and a pressed one further;
## in seconds, how long each takes.
const LIFT := 0.004
const DIP := 0.002
const MOVING := 0.08
const CUT := "…"

static var _glyphs := {}


## Words `width` metres wide at most, wrapping, their top-left where they stand.
static func words(text: String, width: float, size := SIZE, colour: Color = INK, letter := LETTER) -> Label3D:
	var label := Label3D.new()
	label.text = text
	label.pixel_size = letter
	label.font = Room.font("ui")
	label.font_size = size
	label.outline_size = 0
	label.modulate = colour
	label.shaded = false
	label.double_sided = false
	label.alpha_cut = Label3D.ALPHA_CUT_OPAQUE_PREPASS
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.width = width / letter
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	label.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	label.set_meta("tint", "quiet" if colour == QUIET else "ink")
	return label


## A row `width` by `height` metres choosing `on_pick`, its top-left where it
## stands. `quiet` is a second line under the first, smaller.
static func row(text: String, width: float, on_pick: Callable, quiet := "", height := 0.0, size := SIZE) -> Node3D:
	var inset := INSET * size / float(SMALL_ROW)
	var room := width - inset * 2.0
	var used := fitted(text, room, size)
	var said_tall := lines_of(text, room, used) * used * LETTER * 1.25
	var tall := height if height > 0.0 else maxf(0.11 if quiet != "" else 0.075, said_tall + 0.03)
	var held := Node3D.new()
	var card := MeshInstance3D.new()
	var face := QuadMesh.new()
	face.size = Vector2(width - EDGE_WIDTH * 2.0, tall - EDGE_WIDTH * 2.0)
	card.mesh = face
	var fill := StandardMaterial3D.new()
	fill.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fill.albedo_color = CARD
	card.material_override = fill
	card.position = Vector3(width * 0.5, -tall * 0.5, 0.0)
	card.set_meta("card", true)
	held.add_child(card)
	var rim_paint := StandardMaterial3D.new()
	rim_paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rim_paint.albedo_color = EDGE
	for side in edges(width, tall, EDGE_WIDTH):
		var edge := MeshInstance3D.new()
		var strip := QuadMesh.new()
		strip.size = side.size
		edge.mesh = strip
		edge.material_override = rim_paint
		edge.position = Vector3(side.get_center().x, side.get_center().y, 0.0)
		edge.set_meta("edge", true)
		held.add_child(edge)
	var said := words(text, room, used)
	said.position = Vector3(inset, -0.018 if quiet != "" else -(tall - said_tall) * 0.5, 0.002)
	held.add_child(said)
	if quiet != "":
		var under := words(quiet, room, fitted(quiet, room, SMALL), QUIET)
		under.position = Vector3(inset, -0.06, 0.002)
		held.add_child(under)
	var box := BoxShape3D.new()
	box.size = Vector3(width, tall, 0.01)
	held.add_child(choosing(held, box, on_pick, card.position))
	held.set_meta("height", tall)
	return held


## What the pointer finds of `row`: `shape` standing at `at`, choosing `on_pick`
## with a dip, lifting `row` while pointed at, and ticking in the hand.
static func choosing(row: Node3D, shape: Shape3D, on_pick: Callable, at: Vector3) -> Area3D:
	var area := Pointing.pickable(shape, func():
		press(row)
		on_pick.call(), func(pointed: bool): point(row, pointed))
	area.position = at
	area.set_meta("tick", true)
	return area


## Paints `row` as it stands: chosen (its "chosen" meta), its card filled with
## ink and its words and glyph in paper; pointed at ("pointed"), its card lit.
## A piece with a "tint" meta is words or a glyph drawn in ink, or "quiet" ink.
static func paint(row: Node3D) -> void:
	var chosen: bool = row.get_meta("chosen", false)
	var pointed: bool = row.get_meta("pointed", false)
	for piece in row.get_children():
		if piece.has_meta("card"):
			(piece.material_override as StandardMaterial3D).albedo_color = INK if chosen else (POINTED if pointed else CARD)
		elif piece.has_meta("edge"):
			(piece.material_override as StandardMaterial3D).albedo_color = INK if chosen else EDGE
		elif piece.has_meta("tint"):
			var colour: Color = QUIET if piece.get_meta("tint") == "quiet" else INK
			piece.modulate = Color(PAPER, colour.a) if chosen else colour


## `row` chosen or not, and painted so.
static func choose(row: Node3D, chosen: bool) -> void:
	row.set_meta("chosen", chosen)
	paint(row)


## `row` pointed at or not: painted, and lifted toward the eyes while it is.
static func point(row: Node3D, pointed: bool) -> void:
	if not is_instance_valid(row):
		return
	row.set_meta("pointed", pointed)
	paint(row)
	_move(row, [LIFT if pointed else 0.0])


## `row` dips under the trigger and comes back.
static func press(row: Node3D) -> void:
	if is_instance_valid(row):
		var rest := LIFT if row.get_meta("pointed", false) else 0.0
		_move(row, [rest - DIP, rest])


static func _move(row: Node3D, through: Array) -> void:
	if row.has_meta("moving") and (row.get_meta("moving") as Tween).is_valid():
		(row.get_meta("moving") as Tween).kill()
	if not row.is_inside_tree():
		row.position.z = through.back()
		return
	var moving := row.create_tween()
	for z in through:
		moving.tween_property(row, "position:z", z, MOVING / through.size())
	row.set_meta("moving", moving)


## The glyph `name` from `res://icons/`, drawn `size` pixels square in white to
## be tinted; null where it is not on this headset.
static func glyph(name: String, size: int) -> Texture2D:
	var key := "%s@%d" % [name, size]
	if _glyphs.has(key):
		return _glyphs[key]
	var drawn: Texture2D = null
	var path := "res://icons/%s.svg" % name
	if FileAccess.file_exists(path):
		var image := Image.new()
		var svg := FileAccess.get_file_as_string(path).replace("currentColor", "#ffffff")
		if image.load_svg_from_string(svg, size / 24.0) == OK:
			image.generate_mipmaps()
			drawn = ImageTexture.create_from_image(image)
	_glyphs[key] = drawn
	return drawn


## `text` cut to one line `room` metres wide at `size`, ending in "…" where it is cut.
static func cut(text: String, room: float, size: int, letter := LETTER) -> String:
	var font: Font = Room.font("ui")
	var wide := func(said: String) -> float:
		return font.get_string_size(said, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x * letter
	if wide.call(text) <= room:
		return text
	var kept := text
	while kept.length() > 1 and wide.call(kept.strip_edges() + CUT) > room:
		kept = kept.left(-1)
	return kept.strip_edges() + CUT


## The four strips edging a row `width` by `tall` whose top-left is the origin,
## `thick` wide, inside it and in its plane, round a card inset by `thick`: left
## and right the full height, top and bottom between them. None overlaps the
## card, another, or anything beyond the row.
static func edges(width: float, tall: float, thick: float) -> Array[Rect2]:
	return [
		Rect2(0.0, -tall, thick, tall),
		Rect2(width - thick, -tall, thick, tall),
		Rect2(thick, -thick, width - thick * 2.0, thick),
		Rect2(thick, -tall, width - thick * 2.0, thick),
	]


## The largest size, from `size` down to LEAST, at which `text` stands on one
## line `room` metres wide; LEAST where none does, and the line wraps.
static func fitted(text: String, room: float, size: int) -> int:
	var font: Font = Room.font("ui")
	var used := size
	while used > LEAST and font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, used).x * LETTER > room:
		used -= 2
	return used


## How many lines `text` takes at `size` in `room` metres, measured by its font.
static func lines_of(text: String, room: float, size: int, letter := LETTER) -> int:
	var font: Font = Room.font("ui")
	var lines := 0
	for line in text.split("\n"):
		lines += maxi(1, ceili(font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x * letter / room))
	return lines


## Stacks `pieces` downward from the top-left of `into`, `between` metres apart.
static func stack(into: Node3D, pieces: Array, between := 0.015) -> void:
	var down := 0.0
	for piece in pieces:
		piece.position = Vector3(0.0, -down, 0.0)
		into.add_child(piece)
		down += _height(piece) + between * Room.closeness()


## A label's lines are counted from an average letter's width, since a label
## has measured nothing until it has drawn.
static func _height(piece: Node3D) -> float:
	if piece.has_meta("height"):
		return piece.get_meta("height")
	if not piece is Label3D:
		return 0.0
	var label := piece as Label3D
	var lines := 0
	for line in label.text.split("\n"):
		lines += maxi(1, ceili(line.length() * label.font_size * 0.52 / label.width))
	return lines * label.font_size * LETTER * 1.25
