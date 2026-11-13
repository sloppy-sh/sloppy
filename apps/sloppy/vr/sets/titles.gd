## The titles of the notes nearest the reader in Sets, the one pointed at and the
## one sought, each read at one apparent size whatever its distance and stood
## above its mark, or the picture it wears, toward the eyes — DESIGN.md § "The
## field in a room".
## Kept outside the field's scale.
extends Node3D

const Labels := preload("res://field/labels.gd")
const Lod := preload("res://field/lod.gd")
const Room := preload("res://room/room.gd")

## The field's titles' sizes, so a title reads alike in either reading.
const LETTER_AT_1M := Labels.LETTER_AT_1M
const NEAREST := Labels.NEAREST
const HELD_LARGER := Labels.HELD_LARGER
const FONT_SIZE := Labels.FONT_SIZE
const OUTLINE := Labels.OUTLINE
## In metres past a mark's own radius: above it, and toward the eyes.
const ABOVE := 0.01
const TOWARD := 0.02
## In characters: a title longer than this is cut, and says so.
const LONGEST := 48

## How many of the nearest stand at most.
var most := Lod.TITLES_MOST

var _field: Node3D
var _local: Array[Vector3] = []
var _said: Array[String] = []
var _mark_radius := 0.0
var _wearing := Callable()
var _shown: Array[int] = []
var _pinned := -1
var _pointing := -1
var _pool: Array[Label3D] = []
var _ink: Color
var _paper: Color


## Title the marks standing at `local` in `field`'s own units, each `mark_radius`
## there, `said` being what each is called. `wearing(at)` is how far the picture
## the `at`th mark wears reaches in those units, 0 while it wears none.
func build(field: Node3D, local: Array[Vector3], said: Array[String], mark_radius: float, ink: Color, paper: Color, wearing := Callable()) -> void:
	_field = field
	_local = local
	_said = said
	_mark_radius = mark_radius
	_wearing = wearing
	_ink = ink
	_paper = paper
	for _i in most + 2:
		var label := Label3D.new()
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.font_size = FONT_SIZE
		label.pixel_size = LETTER_AT_1M / FONT_SIZE
		label.outline_size = OUTLINE
		label.alpha_cut = Label3D.ALPHA_CUT_OPAQUE_PREPASS
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		label.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
		label.visible = false
		add_child(label)
		_pool.append(label)
	dress(ink, paper)


func dress(ink: Color, paper: Color) -> void:
	_ink = ink
	_paper = paper
	for label in _pool:
		label.font = Room.font("heading")
		label.modulate = Color(ink, label.modulate.a)
		label.outline_modulate = Color(paper, label.outline_modulate.a)


## The scale that keeps a title at LETTER_AT_1M's angle `distance` metres off.
static func apparent(distance: float) -> float:
	return Labels.apparent(distance)


## Where a title stands for a mark at `mark` `radius` metres across, read from
## `eye`: just above the mark, and toward the eyes past its near side.
static func stood(mark: Vector3, eye: Vector3, radius: float) -> Vector3:
	var toward := (eye - mark).normalized() if eye.distance_to(mark) > 1e-6 else Vector3.ZERO
	return mark + Vector3.UP * (radius + ABOVE) + toward * (radius + TOWARD)


## The mark at `at` is titled however far it is; -1 lets it go.
func pin(at: int) -> void:
	_pinned = at


## The mark at `at` is the one pointed at; -1 lets it go.
func point(at: int) -> void:
	_pointing = at


## Which marks are titled, from where the eyes are and the way they look.
func choose(eye: Vector3, ahead: Vector3) -> void:
	var place := _field.global_transform
	var distances := PackedFloat32Array()
	var facing := PackedFloat32Array()
	for at in _local.size():
		var toward := place * _local[at] - eye
		distances.append(toward.length())
		facing.append(toward.normalized().dot(ahead) if toward.length_squared() > 1e-12 else 1.0)
	_shown = Lod.titled(distances, facing, _shown, most)


func follow(eye: Vector3) -> void:
	var place := _field.global_transform
	var larger := place.basis.get_scale().x
	var titled: Array[int] = _shown.duplicate()
	for held in [_pointing, _pinned]:
		if held >= 0 and held < _local.size() and not titled.has(held):
			titled.push_front(held)
	var distances: Array[float] = []
	for at in titled:
		distances.append((place * _local[at]).distance_to(eye))
	var nearest: float = distances.min() if not distances.is_empty() else 0.0
	var farthest: float = distances.max() if not distances.is_empty() else 0.0
	for slot in _pool.size():
		var label := _pool[slot]
		label.visible = slot < titled.size()
		if not label.visible:
			continue
		var at := titled[slot]
		var held := at == _pointing or at == _pinned
		var mark := place * _local[at]
		label.text = _said[at].left(LONGEST) + ("…" if _said[at].length() > LONGEST else "")
		var worn: float = _wearing.call(at) if _wearing.is_valid() else 0.0
		label.global_position = stood(mark, eye, maxf(_mark_radius, worn) * larger)
		label.scale = Vector3.ONE * apparent(distances[slot]) * (HELD_LARGER if held else 1.0)
		var alpha := 1.0 if held else Lod.title_alpha(distances[slot], nearest, farthest)
		label.modulate = Color(_ink, alpha)
		label.outline_modulate = Color(_paper, alpha)
		label.render_priority = 1 if held else 0
