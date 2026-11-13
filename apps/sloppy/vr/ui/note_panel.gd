## A note opened beside the hand, read a section at a time. A target for
## `interaction/pointer.gd`: the pointer works its buttons as a mouse would.
extends Node3D

const Markdown := preload("res://ui/markdown_to_bbcode.gd")
const Room := preload("res://room/room.gd")
const Dressing := preload("res://ui/theme.gd")

signal closed
## A hand's grip took hold of the page, and let it go.
signal taken(pointer: Node3D)
signal let_go_of(pointer: Node3D)

const READING := "Reading…"
const NOTHING := "Nothing is written in this note yet."
const PULLED := "Pulled from another graph"
const MORE := "%d more sections are not shown here."
const OF := "%d of %d"
## Pixels the body moves for a second of the stick leaned all the way.
const SCROLL := 900.0

var _project := ""
var _ref := ""
## Each page: `{markdown}` carried, or `{heading}` still to be read by it.
var _pages: Array[Dictionary] = []
var _at := 0
var _more := 0
## What each note a citation may name is called, by ref.
var _named := {}
var _pressed := false

@onready var _page: SubViewport = $Page
@onready var _face: MeshInstance3D = $Face
@onready var _title: Label = $Page/Sheet/Margin/Column/Head/Title
@onready var _about: Label = $Page/Sheet/Margin/Column/About
@onready var _body: RichTextLabel = $Page/Sheet/Margin/Column/Body
@onready var _where: Label = $Page/Sheet/Margin/Column/Foot/Where
@onready var _before: Button = $Page/Sheet/Margin/Column/Foot/Before
@onready var _next: Button = $Page/Sheet/Margin/Column/Foot/Next


func _ready() -> void:
	var face := StandardMaterial3D.new()
	face.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	face.albedo_texture = _page.get_texture()
	face.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	face.cull_mode = BaseMaterial3D.CULL_DISABLED
	_face.material_override = face
	$Page/Sheet/Margin/Column/Head/Close.pressed.connect(close)
	_before.pressed.connect(func(): _turn(-1))
	_next.pressed.connect(func(): _turn(1))


## Dress the page in the theme pack this headset chose, or else in the field's
## ink and paper and the faces the room reads in.
func dress(ink: Color, paper: Color) -> void:
	$Page/Sheet.theme = Dressing.pack(Room.panels(), Room.look(), ink, paper)


## Read the note `ref` of `project`, `listed` being what the listing said of it
## and `named` what each note in the field is called, by ref.
func open(project: String, ref: String, listed: Dictionary, pulled: bool, named: Dictionary = {}) -> void:
	_project = project
	_ref = ref
	_named = named
	_title.text = named(listed)
	_about.text = _carried(listed.get("tags", []), pulled)
	_body.text = READING
	_where.text = ""
	_before.disabled = true
	_next.disabled = true
	var read := await Client.call_act(project, "read_note", {"note": ref})
	if not is_inside_tree():
		return
	if read.has("error") or read.has("said"):
		_body.text = Markdown.escape(str(read.get("error", read.get("said", ""))))
		return
	_title.text = named(read)
	_pages.clear()
	for section in read.get("sections", []):
		_pages.append({"markdown": str(section.get("markdown", ""))})
	for outlined in read.get("outline", []):
		_pages.append({"heading": str(outlined.get("heading", ""))})
	_more = int(read.get("more", 0))
	_at = 0
	_show()


func close() -> void:
	closed.emit()
	queue_free()


## What a note is called where it is shown: its address, then its title.
static func named(note: Dictionary) -> String:
	var title := str(note.get("title", "")).strip_edges()
	var address := str(note.get("address", ""))
	if address != "" and title != "":
		return "%s  %s" % [address, title]
	return title if title != "" else address


static func _carried(tags: Array, pulled: bool) -> String:
	var said: Array[String] = []
	if pulled:
		said.append(PULLED)
	if not tags.is_empty():
		said.append(" · ".join(PackedStringArray(tags)))
	return "\n".join(said)


func _turn(by: int) -> void:
	_at = clampi(_at + by, 0, maxi(_pages.size() - 1, 0))
	_show()


func _show() -> void:
	_before.disabled = _at == 0
	_next.disabled = _at >= _pages.size() - 1
	_where.text = OF % [_at + 1, _pages.size()] if _pages.size() > 1 else ""
	if _pages.is_empty():
		_body.text = NOTHING
		return
	var page := _pages[_at]
	if page.has("heading"):
		_body.text = READING
		var at := _at
		var read := await Client.call_act(_project, "read_note", {"note": _ref, "sections": [page.heading]})
		if not is_inside_tree():
			return
		var sections: Array = read.get("sections", [])
		if sections.is_empty():
			_body.text = Markdown.escape(str(read.get("error", NOTHING)))
			return
		_pages[at] = {"markdown": str(sections[0].get("markdown", ""))}
		if at != _at:
			return
		page = _pages[at]
	var text: String = Markdown.to_bbcode(page.markdown, _named)
	if _at == _pages.size() - 1 and _more > 0:
		text += "\n\n[i]" + MORE % _more + "[/i]"
	_body.text = text
	_body.scroll_to_line(0)


## Where `pointer`'s ray meets the page, in its pixels; null where it misses.
func _pixel(pointer: Node3D) -> Variant:
	var ray: Array = pointer.ray()
	var inverse := _face.global_transform.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	if absf(along.z) < 1e-6:
		return null
	var t := -from.z / along.z
	if t <= 0.0:
		return null
	var meets := from + along * t
	var size: Vector2 = (_face.mesh as QuadMesh).size
	if absf(meets.x) > size.x / 2.0 or absf(meets.y) > size.y / 2.0:
		return null
	return Vector2((meets.x / size.x + 0.5) * _page.size.x, (0.5 - meets.y / size.y) * _page.size.y)


func hit(pointer: Node3D) -> float:
	var at = _pixel(pointer)
	if at == null:
		return INF
	var ray: Array = pointer.ray()
	var inverse := _face.global_transform.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	return (_face.global_transform * (from + along * (-from.z / along.z))).distance_to(ray[0])


func point(pointer: Node3D) -> void:
	var at = _pixel(pointer)
	if at == null:
		return
	var moved := InputEventMouseMotion.new()
	moved.position = at
	moved.global_position = at
	moved.button_mask = MOUSE_BUTTON_MASK_LEFT if _pressed else 0
	_page.push_input(moved)


func unpoint(_pointer: Node3D) -> void:
	var away := InputEventMouseMotion.new()
	away.position = Vector2(-10, -10)
	away.global_position = away.position
	_page.push_input(away)


func press(pointer: Node3D) -> void:
	_click(pointer, true)


func release(pointer: Node3D) -> void:
	_click(pointer, false)


func take(pointer: Node3D) -> void:
	taken.emit(pointer)


func let_go(pointer: Node3D) -> void:
	let_go_of.emit(pointer)


func scroll(_pointer: Node3D, amount: float) -> bool:
	_body.get_v_scroll_bar().value += amount * SCROLL
	return true


func _click(pointer: Node3D, down: bool) -> void:
	var at = _pixel(pointer)
	if at == null:
		return
	_pressed = down
	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.pressed = down
	click.position = at
	click.global_position = at
	_page.push_input(click)
