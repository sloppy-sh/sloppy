## One panel of the palette, or one of its sub-pages: a title, a quiet line of
## state, and rows under small headings, every row one height with a glyph on
## its left — DESIGN.md § "The field in a room". Laid from its own top-left
## corner downward, `width` across. A slider the other hand points at is driven
## by this hand's stick.
extends Node3D

const Pieces := preload("res://ui/pieces.gd")
const Room := preload("res://room/room.gd")

## In metres: a row's height, and the room between two.
const ROW := 0.036
const GAP := 0.012
## In metres per pixel of a letter.
const LETTER := 0.0008
const TITLE := 18
const LETTERS := 16
const QUIET := 13
## In metres: from a row's edge to its glyph, the glyph, and from it to the words.
const INSET := 0.008
const GLYPH := 0.016
const AFTER_GLYPH := 0.006
## How many pixels a glyph is drawn from, for its size on a row.
const GLYPH_PIXELS := 64
## In metres: how tall a picture standing in a glyph's place is at most, and how wide.
const PICTURE := 0.026
const PICTURE_WIDE := 0.04
## The most buttons standing side by side on one line.
const BUTTONS_A_LINE := 3
## In metres: between a heading or the title and what is under it, and how
## thick a slider's track is.
const UNDER := 0.004
const TRACK := 0.004
## Seconds a stick leaned all the way takes to sweep a slider end to end.
const SWEEP := 2.0
const LEAN := 0.2
## Seconds between one change a stick makes being kept and the next.
const KEEP_EVERY := 0.15

const BACK := "Back"

var width := 0.18
## The rows and buttons given a key, by that key.
var keyed := {}

var _slider := {}
var _keep_in := 0.0


## A row choosing `on_pick`; `glyph` is a glyph's name, a `[paper, ink]` swatch,
## or a Callable answering (awaited) the picture to stand in its place.
static func choice(text: String, glyph: Variant, on_pick: Callable, chosen := false) -> Dictionary:
	return {"kind": "choice", "text": text, "glyph": glyph, "on_pick": on_pick, "chosen": chosen}


## A row saying what something is set to, choosing the next.
static func setting(text: String, value: String, glyph: Variant, on_pick: Callable, chosen := false) -> Dictionary:
	return {"kind": "choice", "text": text, "value": value, "glyph": glyph, "on_pick": on_pick, "chosen": chosen}


## A row turning to a sub-page, saying what it holds now.
static func onward(text: String, value: String, glyph: Variant, on_pick: Callable) -> Dictionary:
	return {"kind": "choice", "text": text, "value": value, "glyph": glyph, "on_pick": on_pick, "onward": true}


## A slider between `span`'s ends, `shown` saying `value` beside `text`, and
## `on_value` told each value the stick keeps.
static func slider(text: String, glyph: Variant, value: float, span: Vector2, shown: Callable, on_value: Callable) -> Dictionary:
	return {"kind": "slider", "text": text, "glyph": glyph, "value": value, "span": span, "shown": shown, "on_value": on_value}


## Quiet words, as many lines as they take.
static func words(quiet: String) -> Dictionary:
	return {"kind": "words", "text": quiet}


## Buttons side by side, `[text, on_pick, chosen]` each, with a fourth where it
## is to be kept in `keyed` under that key.
static func buttons(choices: Array) -> Dictionary:
	return {"kind": "buttons", "choices": choices}


## The last row of a sub-page.
static func back(on_back: Callable) -> Dictionary:
	return choice(BACK, "arrow-left", on_back)


## `groups` are `{heading?, rows}`, laid under `title` and `state`.
func _init(title: String, groups: Array, state := "", across := 0.18) -> void:
	width = across
	var column := Node3D.new()
	add_child(column)
	var down := 0.0
	if title != "":
		var named := _words(Pieces.cut(title, width, TITLE, LETTER), TITLE, Pieces.INK)
		column.add_child(named)
		down += _line(TITLE) + UNDER
	if state != "":
		var said := _words(state, QUIET, Pieces.QUIET)
		said.position.y = -down
		column.add_child(said)
		down += _lines(state, QUIET) * _line(QUIET)
	for group in groups:
		down += GAP
		if group.get("heading", "") != "":
			var heading := _words(Pieces.cut(group.heading, width, QUIET, LETTER), QUIET, Pieces.QUIET)
			heading.position.y = -down
			column.add_child(heading)
			down += _line(QUIET) + UNDER
		var first := true
		for given in group.get("rows", []):
			if not first:
				down += GAP
			first = false
			var piece := _made(given)
			piece.position.y = -down
			column.add_child(piece)
			down += _height(piece)
			if given.has("key"):
				keyed[given.key] = piece
	set_meta("height", down)


## Whether a slider has this hand's stick now, so the palette does not turn.
func holds_stick() -> bool:
	return not _slider.is_empty()


## The words a row says first.
static func words_of(row: Node3D) -> Label3D:
	for piece in row.get_children():
		if piece is Label3D:
			return piece
	return null


## `row`'s first words said as `text` instead, cut to where they stood.
static func say(row: Node3D, text: String) -> void:
	var said := words_of(row)
	if said != null:
		said.text = Pieces.cut(text, said.get_meta("room"), said.font_size, LETTER)


func _process(delta: float) -> void:
	_keep_in -= delta
	if _slider.is_empty():
		return
	var lean := _lean()
	if absf(lean) < LEAN:
		_keep()
		return
	var span: Vector2 = _slider.span
	_slider.value = clampf(_slider.value + lean * (span.y - span.x) * delta / SWEEP, span.x, span.y)
	_show_value(_slider)
	if _keep_in <= 0.0:
		_keep()


func _unhandled_input(event: InputEvent) -> void:
	if _slider.is_empty() or not event is InputEventKey or not event.pressed:
		return
	var step := 1.0 if event.keycode == KEY_BRACKETRIGHT else (-1.0 if event.keycode == KEY_BRACKETLEFT else 0.0)
	if step == 0.0:
		return
	var span: Vector2 = _slider.span
	_slider.value = clampf(_slider.value + step * (span.y - span.x) / 10.0, span.x, span.y)
	_show_value(_slider)
	_keep()
	get_viewport().set_input_as_handled()


func _lean() -> float:
	var at := get_parent()
	while at != null and not at is XRController3D:
		at = at.get_parent()
	return (at as XRController3D).get_vector2("primary").x if at != null else 0.0


func _keep() -> void:
	_keep_in = KEEP_EVERY
	if not is_equal_approx(_slider.value, _slider.kept):
		_slider.kept = _slider.value
		_slider.on_value.call(_slider.value)


func _made(given: Dictionary) -> Node3D:
	match given.kind:
		"words":
			var said := _words(given.text, QUIET, Pieces.QUIET)
			var held := Node3D.new()
			held.add_child(said)
			held.set_meta("tall", _lines(given.text, QUIET) * _line(QUIET))
			return held
		"buttons":
			return _buttons(given.choices)
		"slider":
			return _slider_row(given)
	return _choice_row(given)


func _height(piece: Node3D) -> float:
	return piece.get_meta("height") if piece.has_meta("height") else piece.get_meta("tall", 0.0)


## A card `across` wide, edged, choosing `on_pick`, with `glyph` on its left;
## answers where its words may start.
func _card(across: float, on_pick: Callable, glyph: Variant) -> Node3D:
	var row := Node3D.new()
	row.set_meta("height", ROW)
	var card := _quad(Vector2(across - Pieces.EDGE_WIDTH * 2.0, ROW - Pieces.EDGE_WIDTH * 2.0), Pieces.CARD)
	card.position = Vector3(across * 0.5, -ROW * 0.5, 0.0)
	card.set_meta("card", true)
	row.add_child(card)
	for side in Pieces.edges(across, ROW, Pieces.EDGE_WIDTH):
		var edge := _quad(side.size, Pieces.EDGE)
		edge.position = Vector3(side.get_center().x, side.get_center().y, 0.0)
		edge.set_meta("edge", true)
		row.add_child(edge)
	var box := BoxShape3D.new()
	box.size = Vector3(across, ROW, 0.01)
	if on_pick.is_valid():
		row.add_child(Pieces.choosing(row, box, on_pick, card.position))
	row.set_meta("words_at", _glyph(row, glyph))
	return row


## Stands `glyph` at the left of `row`; answers where the words after it start.
func _glyph(row: Node3D, glyph: Variant) -> float:
	if glyph is String and glyph != "":
		var shown := _sprite(Pieces.glyph(glyph, GLYPH_PIXELS), GLYPH)
		shown.position = Vector3(INSET + GLYPH * 0.5, -ROW * 0.5, 0.002)
		shown.set_meta("tint", "ink")
		shown.modulate = Pieces.INK
		row.add_child(shown)
	elif glyph is Array and glyph.size() == 2:
		for at in 2:
			var half := _quad(Vector2(GLYPH * 0.5, GLYPH), glyph[at])
			half.position = Vector3(INSET + GLYPH * (0.25 + 0.5 * at), -ROW * 0.5, 0.001)
			half.set_meta("swatch", true)
			row.add_child(half)
	elif glyph is Callable:
		var shown := _sprite(null, PICTURE)
		shown.visible = false
		shown.position = Vector3(INSET + PICTURE_WIDE * 0.5, -ROW * 0.5, 0.002)
		row.add_child(shown)
		_show_picture(shown, glyph)
		return INSET + PICTURE_WIDE + AFTER_GLYPH
	return INSET + GLYPH + AFTER_GLYPH


func _show_picture(shown: Sprite3D, picture: Callable) -> void:
	var texture: Texture2D = await picture.call()
	if texture == null or not is_instance_valid(shown):
		return
	shown.texture = texture
	shown.pixel_size = minf(PICTURE / texture.get_height(), PICTURE_WIDE / texture.get_width())
	shown.visible = true


func _choice_row(given: Dictionary) -> Node3D:
	var row := _card(width, given.on_pick, given.glyph)
	var from: float = row.get_meta("words_at")
	var to := width - INSET
	if given.get("onward", false):
		var next := _sprite(Pieces.glyph("chevron-right", GLYPH_PIXELS), GLYPH)
		next.position = Vector3(to - GLYPH * 0.5, -ROW * 0.5, 0.002)
		next.set_meta("tint", "quiet")
		next.modulate = Pieces.QUIET
		row.add_child(next)
		to -= GLYPH + AFTER_GLYPH * 0.5
	var value: String = given.get("value", "")
	var room := to - from
	var for_name := room if value == "" else maxf(room - _wide(value, LETTERS) - AFTER_GLYPH, room * 0.5)
	var named := Pieces.cut(given.text, for_name, LETTERS, LETTER)
	var said := _row_words(row, named, from, room, Pieces.INK)
	if value != "":
		var after := _wide(named, LETTERS) + AFTER_GLYPH
		var told := Pieces.cut(value, room - after, LETTERS, LETTER)
		_row_words(row, told, to - _wide(told, LETTERS), room - after, Pieces.QUIET)
	said.set_meta("room", room)
	Pieces.choose(row, given.get("chosen", false))
	return row


func _buttons(choices: Array) -> Node3D:
	var held := Node3D.new()
	var lines := ceili(choices.size() / float(BUTTONS_A_LINE))
	var across := (width - GAP * (mini(choices.size(), BUTTONS_A_LINE) - 1)) / mini(choices.size(), BUTTONS_A_LINE)
	for at in choices.size():
		var given: Array = choices[at]
		var button := _card(across, given[1], "")
		var said := _words(Pieces.cut(given[0], across - INSET, LETTERS, LETTER), LETTERS, Pieces.INK)
		said.autowrap_mode = TextServer.AUTOWRAP_OFF
		said.width = (across - INSET) / LETTER
		said.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		said.position = Vector3(across * 0.5, -(ROW - _line(LETTERS)) * 0.5, 0.002)
		button.add_child(said)
		button.position = Vector3((at % BUTTONS_A_LINE) * (across + GAP), -(at / BUTTONS_A_LINE) * (ROW + GAP), 0.0)
		Pieces.choose(button, given[2])
		if given.size() > 3:
			keyed[given[3]] = button
		held.add_child(button)
	held.set_meta("tall", lines * ROW + (lines - 1) * GAP)
	return held


func _slider_row(given: Dictionary) -> Node3D:
	var row := _card(width, Callable(), given.glyph)
	var from: float = row.get_meta("words_at")
	var state := given.duplicate()
	state.kept = given.value
	state.said = _row_words(row, "", from, width - INSET - from, Pieces.INK)
	state.said.position.y = -0.003
	state.along = Vector2(from, width - INSET)
	var track := _quad(Vector2(state.along.y - state.along.x, TRACK), Pieces.EDGE)
	track.position = Vector3((state.along.x + state.along.y) * 0.5, -ROW + 0.007, 0.001)
	row.add_child(track)
	state.fill = _quad(Vector2(1.0, TRACK), Pieces.INK)
	row.add_child(state.fill)
	_show_value(state)
	var box := BoxShape3D.new()
	box.size = Vector3(width, ROW, 0.01)
	var area := Pieces.choosing(row, box, func(): pass, Vector3(width * 0.5, -ROW * 0.5, 0.0))
	area.set_meta("hover", func(pointed: bool):
		Pieces.point(row, pointed)
		if pointed:
			_slider = state
		elif is_same(_slider, state):
			_keep()
			_slider = {})
	row.add_child(area)
	return row


func _show_value(state: Dictionary) -> void:
	var span: Vector2 = state.span
	var share: float = (state.value - span.x) / (span.y - span.x)
	var length: float = (state.along.y - state.along.x) * share
	var fill: MeshInstance3D = state.fill
	fill.scale = Vector3(maxf(length, 1e-4), 1.0, 1.0)
	fill.position = Vector3(state.along.x + length * 0.5, -ROW + 0.007, 0.002)
	var said: Label3D = state.said
	said.text = Pieces.cut("%s  %s" % [state.text, state.shown.call(state.value)], state.along.y - state.along.x, LETTERS, LETTER)


func _row_words(row: Node3D, text: String, from: float, room: float, colour: Color) -> Label3D:
	var said := _words(text, LETTERS, colour)
	said.autowrap_mode = TextServer.AUTOWRAP_OFF
	said.width = room / LETTER
	said.position = Vector3(from, -(ROW - _line(LETTERS)) * 0.5, 0.002)
	row.add_child(said)
	return said


func _words(text: String, size: int, colour: Color) -> Label3D:
	return Pieces.words(text, width, size, colour, LETTER)


## In metres: how tall a line of letters `size` stands.
static func _line(size: int) -> float:
	return Room.font("ui").get_height(size) * LETTER


func _lines(text: String, size: int) -> int:
	return Pieces.lines_of(text, width, size, LETTER)


static func _wide(text: String, size: int) -> float:
	return Room.font("ui").get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x * LETTER


static func _sprite(texture: Texture2D, size: float) -> Sprite3D:
	var shown := Sprite3D.new()
	shown.texture = texture
	shown.shaded = false
	shown.double_sided = false
	shown.alpha_cut = SpriteBase3D.ALPHA_CUT_OPAQUE_PREPASS
	shown.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	if texture != null:
		shown.pixel_size = size / texture.get_width()
	return shown


static func _quad(size: Vector2, colour: Color) -> MeshInstance3D:
	var face := QuadMesh.new()
	face.size = size
	var paint := StandardMaterial3D.new()
	paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	paint.albedo_color = colour
	var shown := MeshInstance3D.new()
	shown.mesh = face
	shown.material_override = paint
	return shown
