## One of the desk's chat threads, read at the hand as it is written — DESIGN.md
## § "Speaking to the desk". A target for `interaction/pointer.gd`, like a note.
extends Node3D

const Markdown := preload("res://ui/markdown_to_bbcode.gd")
const Room := preload("res://room/room.gd")
const Dressing := preload("res://ui/theme.gd")
const WindowFrame := preload("res://ui/window_frame.gd")

signal closed
## A hand's grip took hold of the page, and let it go.
signal taken(pointer: Node3D)
signal let_go_of(pointer: Node3D)

const NEW := "A new thread"
const NOTHING := "Nothing has been said here yet."
const THINKING := "…"
## Pixels the body moves for a second of the stick leaned all the way.
const SCROLL := 900.0
## `SLOPPY_TOOL_SPECS`' labels in `@sloppy/types`, as the desk's thread draws an act.
const DOING := {
	"list_notes": "Reading the notes",
	"search_notes": "Looking through the notes",
	"find_note": "Finding a note",
	"read_note": "Reading a note",
	"write_note": "Writing a note",
	"move_note": "Moving a note",
	"tag_note": "Tagging a note",
	"number_note": "Numbering a note",
	"link_notes": "Linking notes",
	"style_edge": "Labelling a line",
	"style_note": "Drawing a mark",
	"delete_note": "Putting a note in the bin",
	"list_tags": "Reading the tags",
	"list_bin": "Looking in the bin",
	"restore_note": "Taking a note out of the bin",
	"list_offers": "Reading what is offered",
	"read_graph": "Reading the graph",
	"read_around": "Reading a note and its neighbours",
	"brief": "Briefing",
	"relate": "Finding where a note belongs",
	"find_code": "Looking through the code",
	"show_note": "Showing a note",
}

## The thread read here; "" until it is open.
var thread := ""
## Every turn of it this panel has, as `chat/open` and `chat/event` gave them.
var turns: Array = []
## Whether the assistant is answering in it now.
var answering := false
## What each note an act or a citation names is called, by ref.
var named := {}

## The agent turn being written, by its place in `turns`; -1 between turns.
var _writing := -1
## Whether it was answering before the reader last said something into it.
var _answering_before := false
var _trouble := ""
var _window: Node3D
## The sheet's pixels to a metre of the panel, and the size it was last laid out at.
var _density := 1.0
var _laid := Vector2.ZERO

@onready var _page: SubViewport = $Page
@onready var _face: MeshInstance3D = $Face
@onready var _title: Label = $Page/Sheet/Margin/Column/Title
@onready var _body: RichTextLabel = $Page/Sheet/Margin/Column/Body


func _ready() -> void:
	var face := StandardMaterial3D.new()
	face.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	face.albedo_texture = _page.get_texture()
	face.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	face.cull_mode = BaseMaterial3D.CULL_DISABLED
	_face.material_override = face
	_face.mesh = _face.mesh.duplicate()
	_laid = (_face.mesh as QuadMesh).size
	_density = _page.size.x / _laid.x
	_window = WindowFrame.new(_laid, resize_to)
	add_child(_window)
	_body.scroll_following = true


## Dress the page in the theme pack this headset chose, or else in the field's
## ink and paper and the faces the room reads in.
func dress(ink: Color, paper: Color) -> void:
	$Page/Sheet.theme = Dressing.pack(Room.panels(), Room.look(), ink, paper)


## Read the thread `held`, as `chat/open` answers it.
func fill(held: Dictionary) -> void:
	thread = str(held.get("id", ""))
	var name := str(held.get("name", "")).strip_edges()
	_title.text = name if name != "" else NEW
	turns = held.get("turns", []).duplicate(true)
	_show()


func close() -> void:
	closed.emit()
	queue_free()


## The panel `given` metres across and tall about its middle: drawn larger or
## smaller while it is being sized, and laid out again at that size once `done`.
func resize_to(given: Vector2, done := true) -> void:
	_window.fit(given)
	if not done:
		_face.scale = Vector3(given.x / _laid.x, given.y / _laid.y, 1.0)
		return
	_laid = given
	_face.scale = Vector3.ONE
	(_face.mesh as QuadMesh).size = given
	_page.size = Vector2i((given * _density).round())


## The reader said `words` into the thread; the answer is on its way.
func add_said(words: String) -> void:
	turns.append({"from": "person", "blocks": [{"kind": "said", "said": words}]})
	_answering_before = answering
	answering = true
	_writing = -1
	_trouble = ""
	_show()


## The desk would not take what `add_said` added.
func take_back_said() -> void:
	if not turns.is_empty() and turns.back().get("from") == "person":
		turns.pop_back()
	answering = _answering_before
	_show()


## One `ChatEvent`, applied as the desk's own thread applies it.
func apply(event: Dictionary) -> void:
	match str(event.get("event", "")):
		"block":
			answering = true
			if _writing < 0 or _writing >= turns.size():
				turns.append({"from": "agent", "blocks": []})
				_writing = turns.size() - 1
			var blocks: Array = turns[_writing].blocks
			var at := int(event.get("at", blocks.size()))
			if at < blocks.size():
				blocks[at] = event.get("block", {})
			else:
				blocks.append(event.get("block", {}))
		"ended":
			answering = false
			_writing = -1
		"over":
			answering = false
			_writing = -1
			_trouble = str(event.get("said", ""))
		_:
			return
	_answering_before = answering
	_show()


## `turns` as the page draws them.
static func transcript(turns: Array, named: Dictionary) -> String:
	var parts: Array[String] = []
	for turn in turns:
		var person: bool = turn.get("from") == "person"
		var thinking := false
		for block in turn.get("blocks", []):
			if not block is Dictionary:
				continue
			var kind := str(block.get("kind", ""))
			if kind != "thinking":
				thinking = false
			match kind:
				"said":
					var said := str(block.get("said", ""))
					parts.append("[b]%s[/b]" % Markdown.escape(said) if person else Markdown.to_bbcode(said, named))
				"thinking":
					if not thinking:
						parts.append("[i]%s[/i]" % THINKING)
					thinking = true
				"tool_call":
					parts.append("[i]%s[/i]" % Markdown.escape(act_line(block, named)))
	return "\n\n".join(parts)


## What a call reads as in the thread: what is being done, and what to.
static func act_line(block: Dictionary, named: Dictionary) -> String:
	var act := str(block.get("act", ""))
	var doing: String = DOING.get(act, str(block.get("tool", "")))
	var arguments = block.get("arguments", {})
	if not arguments is Dictionary:
		return doing
	var subject := ""
	var note := str(arguments.get("note", ""))
	if named.has(note):
		subject = named[note]
	else:
		for key in ["words", "about", "title", "address"]:
			if arguments.get(key) is String:
				subject = arguments[key]
				break
	return doing if subject.strip_edges() == "" else "%s: %s" % [doing, subject]


func _show() -> void:
	var text := transcript(turns, named)
	if text == "":
		text = NOTHING
	if _trouble != "":
		text += "\n\n[i]%s[/i]" % Markdown.escape(_trouble)
	_body.text = text


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
	return _window.nearer(pointer, _sheet_hit(pointer))


func _sheet_hit(pointer: Node3D) -> float:
	if _pixel(pointer) == null:
		return INF
	var ray: Array = pointer.ray()
	var inverse := _face.global_transform.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	return (_face.global_transform * (from + along * (-from.z / along.z))).distance_to(ray[0])


func point(pointer: Node3D) -> void:
	if _window.takes(pointer):
		_window.point(pointer)
	else:
		_window.unpoint(pointer)


func unpoint(pointer: Node3D) -> void:
	_window.unpoint(pointer)


func press(pointer: Node3D) -> void:
	if _window.takes(pointer):
		_window.press(pointer)


func holds(pointer: Node3D) -> bool:
	return _window.holds(pointer)


func release(pointer: Node3D) -> void:
	if _window.holds(pointer):
		_window.release(pointer)


func take(pointer: Node3D) -> void:
	taken.emit(pointer)


func let_go(pointer: Node3D) -> void:
	let_go_of.emit(pointer)


## Scrolled up, the page stays where the reader left it as the answer grows;
## scrolled back to the end, it follows the answer again.
func scroll(pointer: Node3D, amount: float) -> bool:
	if _window.takes(pointer):
		return _window.scroll(pointer, amount)
	var bar := _body.get_v_scroll_bar()
	bar.value += amount * SCROLL
	_body.scroll_following = bar.value + bar.page >= bar.max_value - 1.0
	return true
