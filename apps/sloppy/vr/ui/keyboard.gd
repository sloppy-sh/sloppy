## The keys a page in the room is typed into: letters, with digits and symbols on
## a second layer, shift, space, backspace, Enter and a key that puts them away,
## each a row of the palette's — DESIGN.md § "The field in a room". Laid from its
## own top-left corner rightward and downward. Its keys are chosen through
## `ui/pointing.gd`; to `interaction/pointer.gd` it is a target that stops the
## ray, and the grip on it takes whoever holds it.
extends Node3D

const Pieces := preload("res://ui/pieces.gd")
const Room := preload("res://room/room.gd")

## A key typing `text` was chosen.
signal typed(text: String)
## "Enter" or "Backspace" was chosen.
signal pressed_key(name: String)
signal closed
signal taken(pointer: Node3D)
signal let_go_of(pointer: Node3D)

## In metres: a key's side, and the room between two.
const KEY := 0.026
const GAP := 0.004
## Keys across a row, and rows.
const ACROSS := 10
const DOWN := 4
## In metres per pixel of a letter, and pixels a key's letter is drawn at.
const LETTER := 0.0008
const LETTERS := 20
const GLYPH := 0.014
const GLYPH_PIXELS := 64
const SPACE := "space"
const TO_SYMBOLS := "123"
const TO_LETTERS := "abc"

## A row is keys left to right: a String types itself, a number is that many
## keys' room left empty, and a Dictionary is a key that does something, `wide`
## keys across.
const LETTER_ROWS := [
	["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
	[0.5, "a", "s", "d", "f", "g", "h", "j", "k", "l"],
	[{"does": "shift", "wide": 1.5}, "z", "x", "c", "v", "b", "n", "m", {"does": "Backspace", "wide": 1.5}],
	[{"does": "layer", "wide": 1.5}, ",", {"does": "space", "wide": 4.0}, ".", {"does": "Enter", "wide": 1.5}, {"does": "hide"}],
]
const SYMBOL_ROWS := [
	["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
	["@", "#", "$", "%", "&", "-", "+", "(", ")", "/"],
	["=", "*", "\"", "'", ":", ";", "!", "?", {"does": "Backspace", "wide": 2.0}],
	[{"does": "layer", "wide": 1.5}, ",", {"does": "space", "wide": 4.0}, ".", {"does": "Enter", "wide": 1.5}, {"does": "hide"}],
]
const GLYPHS := {"shift": "arrow-big-up", "Backspace": "delete", "Enter": "corner-down-left", "hide": "keyboard-off"}

## In metres.
static var wide: float:
	get:
		return ACROSS * KEY + (ACROSS - 1) * GAP
static var tall: float:
	get:
		return DOWN * KEY + (DOWN - 1) * GAP

## Whether the keys stand, to be typed on.
var up := false
var symbols := false
var shifted := false
## Each key standing, by what it types or what it does.
var keys := {}

var _keys: Node3D


func _ready() -> void:
	visible = false
	var room := Room.of(get_tree())
	if room != null:
		room.dressed.connect(_redraw)


func show_keys() -> void:
	if up:
		return
	up = true
	visible = true
	_draw()


func hide_keys() -> void:
	up = false
	visible = false
	shifted = false
	symbols = false
	_clear()


func _redraw() -> void:
	if up:
		_draw()


func _clear() -> void:
	keys = {}
	if _keys != null:
		_keys.queue_free()
		_keys = null


func _draw() -> void:
	_clear()
	_keys = Node3D.new()
	_keys.name = "Keys"
	add_child(_keys)
	var board := _quad(Vector2(wide + GAP * 2.0, tall + GAP * 2.0), Pieces.PAPER)
	board.position = Vector3(wide * 0.5, -tall * 0.5, -0.001)
	_keys.add_child(board)
	var rows: Array = SYMBOL_ROWS if symbols else LETTER_ROWS
	for at in rows.size():
		var across := 0.0
		for given in rows[at]:
			if given is float or given is int:
				across += given * (KEY + GAP)
				continue
			var spans: float = given.get("wide", 1.0) if given is Dictionary else 1.0
			var width := spans * KEY + (spans - 1.0) * GAP
			var key := _key(given, width)
			key.position = Vector3(across, -at * (KEY + GAP), 0.0)
			_keys.add_child(key)
			keys[given.does if given is Dictionary else given] = key
			across += width + GAP
	if keys.has("shift"):
		Pieces.choose(keys.shift, shifted)


## A key `width` across, chosen as the palette's rows are.
func _key(given: Variant, width: float) -> Node3D:
	var key := Node3D.new()
	var card := _quad(Vector2(width - Pieces.EDGE_WIDTH * 2.0, KEY - Pieces.EDGE_WIDTH * 2.0), Pieces.CARD)
	card.position = Vector3(width * 0.5, -KEY * 0.5, 0.0)
	card.set_meta("card", true)
	key.add_child(card)
	for side in Pieces.edges(width, KEY, Pieces.EDGE_WIDTH):
		var edge := _quad(side.size, Pieces.EDGE)
		edge.position = Vector3(side.get_center().x, side.get_center().y, 0.0)
		edge.set_meta("edge", true)
		key.add_child(edge)
	var does: String = given.does if given is Dictionary else ""
	if GLYPHS.has(does):
		var glyph := Sprite3D.new()
		glyph.texture = Pieces.glyph(GLYPHS[does], GLYPH_PIXELS)
		glyph.shaded = false
		glyph.alpha_cut = SpriteBase3D.ALPHA_CUT_OPAQUE_PREPASS
		glyph.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		if glyph.texture != null:
			glyph.pixel_size = GLYPH / glyph.texture.get_width()
		glyph.position = Vector3(width * 0.5, -KEY * 0.5, 0.002)
		glyph.modulate = Pieces.INK
		glyph.set_meta("tint", "ink")
		key.add_child(glyph)
	else:
		var said := Pieces.words(_face_of(given), width, LETTERS, Pieces.INK, LETTER)
		said.autowrap_mode = TextServer.AUTOWRAP_OFF
		said.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		said.position = Vector3(width * 0.5, -(KEY - Room.font("ui").get_height(LETTERS) * LETTER) * 0.5, 0.002)
		key.add_child(said)
	var box := BoxShape3D.new()
	box.size = Vector3(width, KEY, 0.01)
	key.add_child(Pieces.choosing(key, box, _chosen.bind(given), card.position))
	return key


func _face_of(given: Variant) -> String:
	if given is String:
		return given.to_upper() if shifted else given
	match given.does:
		"space":
			return SPACE
		"layer":
			return TO_LETTERS if symbols else TO_SYMBOLS
	return ""


func _chosen(given: Variant) -> void:
	if given is String:
		typed.emit(given.to_upper() if shifted else given)
		if shifted:
			_shift(false)
		return
	match given.does:
		"shift":
			_shift(not shifted)
		"layer":
			symbols = not symbols
			shifted = false
			_draw()
		"space":
			typed.emit(" ")
		"hide":
			hide_keys()
		_:
			pressed_key.emit(given.does)


## The letters said in capitals while shifted, and the shift key filled.
func _shift(on: bool) -> void:
	shifted = on
	for given in keys:
		if given is String and given.length() == 1:
			var said := _words_of(keys[given])
			if said != null:
				said.text = _face_of(given)
	if keys.has("shift"):
		Pieces.choose(keys.shift, shifted)


static func _words_of(key: Node3D) -> Label3D:
	for piece in key.get_children():
		if piece is Label3D:
			return piece
	return null


## Where `pointer`'s ray meets the keys, in their own plane; null where it misses
## or they are away.
func _meets(pointer: Node3D) -> Variant:
	if not up or not is_visible_in_tree():
		return null
	var ray: Array = pointer.ray()
	var inverse := global_transform.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	if absf(along.z) < 1e-6:
		return null
	var t := -from.z / along.z
	if t <= 0.0:
		return null
	var meets := from + along * t
	if meets.x < -GAP or meets.x > wide + GAP or meets.y > GAP or meets.y < -tall - GAP:
		return null
	return global_transform * meets


func hit(pointer: Node3D) -> float:
	var meets = _meets(pointer)
	return INF if meets == null else (meets as Vector3).distance_to(pointer.ray()[0])


func point(_pointer: Node3D) -> void:
	pass


func unpoint(_pointer: Node3D) -> void:
	pass


func press(_pointer: Node3D) -> void:
	pass


func release(_pointer: Node3D) -> void:
	pass


func scroll(_pointer: Node3D, _amount: float) -> bool:
	return false


func take(pointer: Node3D) -> void:
	taken.emit(pointer)


func let_go(pointer: Node3D) -> void:
	let_go_of.emit(pointer)


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
