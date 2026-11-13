## The titles of the marks the reader is near, and no others — DESIGN.md
## § "The field in a room". Kept outside the field's scale, each title is drawn
## at one apparent size however near or far its mark; set in the heading face.
extends Node3D

const Captions := preload("res://field/captions.gd")
const Lod := preload("res://field/lod.gd")
const Room := preload("res://room/room.gd")
const Settings := preload("res://field/settings.gd")

## In metres beside a mark, past its own radius.
const BESIDE := 0.008
## In characters: a title longer than this is cut, and says so.
const LONGEST := 48
## In metres: how tall a title's letters stand one metre from the eyes; nearer
## than `NEAREST` a title keeps the size it has there.
const LETTER_AT_1M := 0.022
const NEAREST := 0.5
## In pixels of the face, which is drawn from a distance field and stays sharp at any size.
const FONT_SIZE := 96
const OUTLINE := 4
## How much larger the title pointed at or sought reads; in seconds, how long
## it takes to grow or shrink.
const HELD_LARGER := 1.4
const GROWING := 0.15
## In metres: how far toward the eyes a title stands off its mark, past the mark's radius.
const LIFT := 0.02

enum Says { NOTHING, WHOLE, ADDRESS }

## How many titles stand at most.
var most := Lod.TITLES_MOST

var _marks: Node3D
var _said: Array[String] = []
var _cited: Array[String] = []
var _shown: Array[int] = []
var _pinned := -1
var _pointing := -1
## How far each mark's title has grown towards its pointed size, 0 to 1, by mark.
var _growth := {}
var _distances := PackedFloat32Array()
var _facing := PackedFloat32Array()
var _pool: Array[Label3D] = []
var _says: Array[Says] = []
## In metres, per slot: what the whole caption and the address alone measure.
var _whole: Array[Vector2] = []
var _address: Array[Vector2] = []
## What `follow` stood this frame, in `Captions`' plane.
var _placed: Array[Rect2] = []
var _ink: Color
var _paper: Color


## Title the marks of `marks`, in order, `said` being what each says whole and
## `cited` its address alone ("" where it has none).
func build(marks: Node3D, said: Array[String], cited: Array[String], ink: Color, paper: Color) -> void:
	_marks = marks
	_said = said
	_cited = cited
	_ink = ink
	_paper = paper
	for _i in Settings.TITLES.y:
		var label := Label3D.new()
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.pixel_size = LETTER_AT_1M / FONT_SIZE
		label.font = Room.font("heading")
		label.font_size = FONT_SIZE
		label.outline_size = OUTLINE
		label.alpha_cut = Label3D.ALPHA_CUT_OPAQUE_PREPASS
		label.modulate = ink
		label.outline_modulate = paper
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		label.visible = false
		add_child(label)
		_pool.append(label)
		_says.append(Says.NOTHING)
		_whole.append(Vector2.ZERO)
		_address.append(Vector2.ZERO)


## Draw the titles in `ink` with a `paper` edge, in the room's heading face.
func dress(ink: Color, paper: Color) -> void:
	_ink = ink
	_paper = paper
	for label in _pool:
		label.font = Room.font("heading")
		label.modulate = Color(ink, label.modulate.a)
		label.outline_modulate = Color(paper, label.outline_modulate.a)
	for at in _shown.size():
		_whole[at] = _measure(_pool[at], _whole_text(_shown[at]))
		_address[at] = _measure(_pool[at], _cited[_shown[at]])


## How many times its size a title `distance` metres off is drawn, so its
## letters stand at the angle `LETTER_AT_1M` does.
static func apparent(distance: float) -> float:
	return maxf(distance, NEAREST)


## Where a title meant for `at` stands brought `by` metres toward `eye`, and no
## more than halfway.
static func toward_eyes(at: Vector3, eye: Vector3, by: float) -> Vector3:
	var away := at.distance_to(eye)
	return at.move_toward(eye, minf(by, away * 0.5))


## The box a `width` x `high` caption takes centred above a picture `rim` across
## worn on a mark seen at `seen`, in `Captions`' plane.
static func above(seen: Vector2, rim: float, width: float, high: float) -> Rect2:
	return Rect2(Vector2(seen.x - width / 2.0, seen.y + rim), Vector2(width, high))


## The mark at `at` is titled first and whole, however far it is, and grown to
## read; -1 lets it go.
func pin(at: int) -> void:
	_pinned = at


## The mark at `at` is the one pointed at, titled as a pinned one is; -1 lets it go.
func point(at: int) -> void:
	if _pointing == at:
		return
	_pointing = at
	if not _distances.is_empty():
		choose(_distances, _facing)


## Which marks are titled, from every mark's distance from the eyes and its
## cosine off where they look.
func choose(distances: PackedFloat32Array, facing: PackedFloat32Array) -> void:
	_distances = distances
	_facing = facing
	_shown = Lod.titled(distances, facing, _shown, most)
	var held := _held()
	for at in range(held.size() - 1, -1, -1):
		_shown.erase(held[at])
		_shown.push_front(held[at])
	_shown.resize(mini(_shown.size(), _pool.size()))
	for at in _pool.size():
		_says[at] = Says.NOTHING
		_pool[at].visible = false
		if at < _shown.size():
			_whole[at] = _measure(_pool[at], _whole_text(_shown[at]))
			_address[at] = _measure(_pool[at], _cited[_shown[at]])


## Stand each title beside its mark — above its picture where it wears one —
## nearest first, where it lands on no title already standing, or its address
## alone, or nothing this frame. `eyes` is the eyes' basis, its x the reader's
## right and its y up.
func follow(eye: Vector3, eyes: Basis, delta := GROWING) -> void:
	_grow(delta)
	var view := eyes.orthonormalized()
	var place := _marks.global_transform
	var larger := place.basis.get_scale().x
	var mark_radius: float = _marks.radius() * larger
	var aside := mark_radius + BESIDE
	var lift := mark_radius + LIFT
	var ahead := -view.z
	_placed.clear()
	var marks: Array[Vector3] = []
	var nearest := INF
	var farthest := 0.0
	for at in _shown.size():
		marks.append(place * _marks.local_at(_shown[at]))
		nearest = minf(nearest, marks[at].distance_to(eye))
		farthest = maxf(farthest, marks[at].distance_to(eye))
	for at in _shown.size():
		var label := _pool[at]
		var mark := marks[at]
		var toward := mark - eye
		var depth := toward.dot(ahead)
		var held := _growth.has(_shown[at]) or _shown[at] == _pinned or _shown[at] == _pointing
		var size := _size(_shown[at], mark.distance_to(eye))
		var worn: float = _marks.wearing(_shown[at]) * larger
		var rim := (worn if worn > 0.0 else aside) / maxf(depth, 0.01)
		var box: Variant = null
		var says := Says.NOTHING
		if depth > 0.01:
			var seen := Vector2(toward.dot(view.x), toward.dot(view.y)) / depth
			var whole := _whole[at] * size / depth
			var short := _address[at] * size / depth
			if worn > 0.0:
				var over := above(seen, rim, whole.x, whole.y)
				if not _placed.any(func(one: Rect2) -> bool: return one.intersects(over)):
					box = over
			if box == null:
				box = Captions.place(seen, rim, whole.x, whole.y, _placed)
			says = Says.WHOLE
			if box == null and held:
				box = above(seen, rim, whole.x, whole.y) if worn > 0.0 else Rect2(Vector2(seen.x + rim, seen.y - whole.y / 2.0), whole)
			if box == null and short.x > 0.0:
				box = Captions.place(seen, rim, short.x, short.y, _placed)
				says = Says.ADDRESS
		if box == null:
			label.visible = false
			continue
		_placed.append(box)
		_say(at, says)
		var rect: Rect2 = box
		var anchor := Vector2(rect.position.x, rect.get_center().y)
		var standing := eye + (ahead + view.x * anchor.x + view.y * anchor.y) * depth
		var lifted := toward_eyes(standing, eye, lift)
		label.global_position = lifted
		label.scale = Vector3.ONE * size * lifted.distance_to(eye) / standing.distance_to(eye)
		var alpha := 1.0 if held else Lod.title_alpha(mark.distance_to(eye), nearest, farthest)
		label.modulate = Color(_ink, alpha)
		label.outline_modulate = Color(_paper, alpha)
		label.visible = true


## The pinned mark, then the one pointed at, then any title still shrinking back
## that the eyes still face.
func _held() -> Array[int]:
	var held: Array[int] = []
	for mark in [_pinned, _pointing] + _growth.keys():
		var shrinking: bool = mark != _pinned and mark != _pointing
		if mark >= 0 and mark < _said.size() and not held.has(mark) and not (shrinking and _facing[mark] < Lod.TITLE_CONE_HELD):
			held.append(mark)
	return held


func _grow(delta: float) -> void:
	for mark in [_pinned, _pointing]:
		if mark >= 0 and not _growth.has(mark):
			_growth[mark] = 0.0
	for mark in _growth.keys():
		var toward := 1.0 if mark == _pinned or mark == _pointing else 0.0
		_growth[mark] = move_toward(_growth[mark], toward, delta / GROWING)
		if _growth[mark] <= 0.0 and toward == 0.0:
			_growth.erase(mark)


func _size(mark: int, distance: float) -> float:
	return apparent(distance) * lerpf(1.0, HELD_LARGER, smoothstep(0.0, 1.0, _growth.get(mark, 0.0)))


func _say(at: int, says: Says) -> void:
	if _says[at] == says:
		return
	_says[at] = says
	_pool[at].text = _cited[_shown[at]] if says == Says.ADDRESS else _whole_text(_shown[at])


func _whole_text(mark: int) -> String:
	return _said[mark].left(LONGEST) + ("…" if _said[mark].length() > LONGEST else "")


func _measure(label: Label3D, text: String) -> Vector2:
	if text == "":
		return Vector2.ZERO
	var font: Font = label.font if label.font != null else ThemeDB.fallback_font
	var size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, label.font_size)
	return (size + Vector2.ONE * 2.0 * label.outline_size) * label.pixel_size
