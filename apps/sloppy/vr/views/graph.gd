## A project's notes as a field in the room — DESIGN.md § "The field in a room".
## Entered with `{project}`, the id `Client.projects()` gave; "" is the desk's first.
extends Node3D

const Palette := preload("res://field/palette.gd")
const Settings := preload("res://field/settings.gd")
const Lod := preload("res://field/lod.gd")
const Marks := preload("res://field/marks.gd")
const Lines := preload("res://field/lines.gd")
const Labels := preload("res://field/labels.gd")
const Pointer := preload("res://interaction/pointer.gd")
const Grab := preload("res://interaction/grab.gd")
const Walk := preload("res://interaction/walk.gd")
const Reach := preload("res://interaction/reach.gd")
const Chat := preload("res://ui/chat.gd")
const Room := preload("res://room/room.gd")
const HandMenu := preload("res://ui/hand_menu.gd")
const FieldPanel := preload("res://ui/field_panel.gd")
const NotePanel := preload("res://ui/note_panel.gd")
const PANEL := preload("res://ui/note_panel.tscn")

const READING := "Reading the notes…"
const EMPTY := "This project has no notes yet."
const PARTIAL := "Showing the first %d notes. Go back and open the project again for the rest."
const PULLED := "Pulled from another graph"
const HOW_TO_CHANGE := "Hold A and say how the line from %s to %s should look."
const LINES := "%d lines"
## Seconds between one reading of what is near and the next.
const SETTLE_EVERY := 0.2
## In metres, beside the hand that opened a note.
const BESIDE := Vector3(0.24, 0.08, -0.05)
## Seconds marks take to walk to where another arrangement stands them.
const REARRANGING := 0.5
## Seconds the field takes to bring the note sought before the reader.
const SEEKING := 1.2
## Seconds a field opened for the first time takes to come out of the fog, the
## radians it turns about the reader meanwhile, and in metres how far from the
## eyes the fog thins and where nothing shows as it begins.
const ARRIVING := 2.5
const ARRIVING_TURN := PI / 4.0
const VEILED_NEAR := 0.5
const VEILED_FAR := 1.5
## Seconds the field takes to stand out at the vantage and back in, and the
## radians a second it turns about its own middle while it stands there.
const TO_VANTAGE := 1.2
const VANTAGE_TURN := TAU / 60.0
## How much larger marks and lines are drawn than the field's own units make
## them, so a field standing at its own size reads from across it.
const LARGER := 3.0
## The most pictures asked of the desk at once, the nearest first, and in metres
## the nearest and farthest a mark wearing one stands from the eyes: the reader
## standing at a mark is inside it, with nothing to see it on.
const PICTURES_MOST := 24
const PICTURES_BEYOND := 0.3
const PICTURES_WITHIN := 10.0

## How a reader left each project's field, for this session only.
static var _left_as := {}

var project := ""
## How this reader has the field drawn.
var settings = Settings.shared()

var _palette := Room.palette()
var _field := Node3D.new()
var _lines: Node3D
var _marks: Node3D
var _labels: Node3D
var _notes := {}
## What each note is called where a note panel cites it, by ref.
var _named := {}
var _targets: Array = []
var _pointers: Array[Node3D] = []
var _panel: Node3D
var _origin: XROrigin3D
var _camera: XRCamera3D
var _left: XRController3D
var _right: XRController3D
var _origin_was := Transform3D()
var _told: Label3D
var _status := ""
## What the line chosen is, while one is.
var _line_said := ""
var _settle_in := 0.0
## In the field's own units: how far its farthest mark is from its middle.
var _radius := 0.0
var _walk: Node
var _reach: Node
var _listed: Array = []
## The arrangement the marks stand in now.
var _arrangement := ""
var _opened := ""
var _pointed := {}
var _asked := {}
var _asking := 0
var _pictures: Array[int] = []
## A rearrangement under way: `{from, to, field_from, field_to, done}`; empty while none is.
var _moving := {}
## The field carried to a note: `{ref, done, from, was}`, `was` the basis whose
## size and heading it arrives in; empty while none is under way.
var _seeking := {}
## The field coming out of the fog: `{done, to, eye, far}`, `to` where it stands
## once out and `far` the metres from the eyes the fog then clears to; empty
## while none is under way.
var _arriving := {}
## The field at the vantage or on its way out or in: `{was, from, to, done,
## back}`, `was` where it stood before; empty while it is not.
var _vantage := {}
## Where the arrangement standing now puts every note, as `Field.derive` answers.
var _laid := {}


func enter(args: Dictionary) -> void:
	project = str(args.get("project", ""))
	var room := get_tree().current_scene
	_origin = room.get_node("XROrigin3D")
	_camera = _origin.get_node("XRCamera3D")
	_origin_was = _origin.global_transform
	if get_viewport().use_xr:
		_left = _origin.get_node("LeftHand")
		_right = _origin.get_node("RightHand")
	add_child(_field)
	_tell_at_hand()
	_interact()
	var dressing := Room.of(get_tree())
	if dressing != null:
		dressing.dressed.connect(_redress)
	Client.heard.connect(_heard_from_desk)
	var menu := HandMenu.of(get_tree())
	if menu != null:
		menu.chat().changed.connect(_chat_changed)
	_read()


func _exit_tree() -> void:
	if _marks != null:
		_left_as[project] = {"field": _left_standing(), "origin": _origin.global_transform, "arrangement": _arrangement}
	_unveil()
	if settings.changed.is_connected(_settings_changed):
		settings.changed.disconnect(_settings_changed)
	Client.heard.disconnect(_heard_from_desk)
	var menu := HandMenu.of(get_tree())
	if menu != null and menu.chat().changed.is_connected(_chat_changed):
		menu.chat().changed.disconnect(_chat_changed)
	_origin.global_transform = _origin_was
	if is_instance_valid(_panel):
		_panel.close()
	for pointer in _pointers:
		if is_instance_valid(pointer):
			pointer.queue_free()
	if is_instance_valid(_told):
		_told.queue_free()


func _interact() -> void:
	var hands: Array = [_left, _right] if _left != null else [null]
	for hand in hands:
		var pointer := Pointer.new(hand, _camera, _targets, _palette.ink)
		pointer.missed.connect(_let_all_go)
		if hand != null:
			hand.add_child(pointer)
		else:
			add_child(pointer)
		_pointers.append(pointer)
	var grab := Grab.new()
	grab.field = _field
	grab.left = _left
	grab.right = _right
	grab.mouse = _pointers[0] if _left == null else null
	if _left != null:
		grab.pointers = {_left: _pointers[0], _right: _pointers[1]}
	add_child(grab)
	var walk := Walk.new()
	_walk = walk
	walk.origin = _origin
	walk.camera = _camera
	walk.left = _left
	walk.left_pointer = _pointers[0]
	walk.palette = HandMenu.of(get_tree())
	walk.fly = true
	add_child(walk)
	_reach = Reach.new()
	_reach.field = _field
	_reach.camera = _camera
	_reach.hand = _right
	_reach.pointer = _pointers[1] if _right != null else null
	add_child(_reach)
	grab.moved.connect(_taken_hold)
	walk.moved.connect(_stick_moved)
	_reach.moved.connect(_stick_moved)


func _read() -> void:
	_say(READING)
	var whose := await Client.call_act(project, "read_graph", {})
	var page := await Client.field(project)
	if not is_inside_tree():
		return
	if page.has("error"):
		_say(str(page.error))
		return
	var notes: Array = page.notes
	var cut_short := false
	while page.get("next") is String:
		page = await Client.field(project, page.next)
		if not is_inside_tree():
			return
		if page.has("error"):
			cut_short = true
			break
		notes.append_array(page.notes)
	if notes.is_empty():
		_say(EMPTY)
		return
	for note in notes:
		if note is Dictionary and note.get("note") is String:
			_notes[note.note] = note
			_named[note.note] = NotePanel.named(note)
	var owner: Variant = whose.get("owner")
	_draw(notes, owner if owner is String else "")
	_say(PARTIAL % notes.size() if cut_short else "")


func _draw(notes: Array, owner: String) -> void:
	_listed = notes
	_arrangement = settings.arrangement
	var placed := _placed()
	_laid = placed
	var drawn := Palette.drawn_sets(notes)
	_lines = Lines.new()
	_lines.weight = LARGER
	_lines.arcing = _arrangement == Settings.INSIDE
	_lines.build(placed, _notes, _palette)
	_field.add_child(_lines)
	settings.offer("%s %s" % [Client.desk, project], _lines.rows(), _lines.dense())
	_lines.show_only(settings)
	_marks = Marks.new()
	_marks.size = settings.size * LARGER
	_field.add_child(_marks)
	_marks.build(placed, _notes, _palette, drawn, owner)
	_marks.chosen.connect(_open)
	_marks.pointed.connect(_pointed_at)
	_targets.append(_marks)
	_targets.append(_lines)
	_lines.chosen.connect(_line_chosen)
	_lines.asked_about.connect(_line_asked_about)
	var said: Array[String] = []
	var cited: Array[String] = []
	for ref in _marks.refs:
		said.append(NotePanel.named(_notes.get(ref, {})))
		cited.append(str(_notes.get(ref, {}).get("address", "")))
	_labels = Labels.new()
	_labels.most = settings.titles
	add_child(_labels)
	_labels.build(_marks, said, cited, _palette.ink, _palette.paper)
	_radius = _reach_of(placed)
	var held: Dictionary = _left_as.get(project, {})
	if held.is_empty():
		arrive()
	elif held.get("arrangement") != _arrangement:
		bring_back()
	else:
		_origin.global_transform = held.origin
		_field.global_transform = held.field
	settings.changed.connect(_settings_changed)


## Everything standing drawn again in what the room is dressed in now.
func _redress() -> void:
	_palette = Room.palette()
	for pointer in _pointers:
		pointer.dress(_palette.ink)
	_dress_told()
	if is_instance_valid(_panel):
		_panel.dress(_palette.ink, _palette.paper)
	if _marks != null:
		_lines.dress(_palette)
		_marks.dress(_palette)
		_labels.dress(_palette.ink, _palette.paper)


## Stand the field as it first stood, upright, at its own size and ahead of
## where the reader looks: inside, about them with its middle ahead; as a tree,
## ahead of them within a step or two.
func bring_back() -> void:
	if _marks != null:
		_land()
		_let_seeking_go()
		_let_arriving_go()
		_vantage_forgotten()
		_field.global_transform = _first_stand(_arrangement)


## The field stood as it first stands, veiled, turning into place as the fog
## draws back to show the whole of it.
func arrive() -> void:
	if _marks == null:
		return
	bring_back()
	var to := _field.global_transform
	var eye := _camera.global_position
	var farthest := eye.distance_to(to.origin) + _radius * to.basis.get_scale().x
	_arriving = {"done": 0.0, "to": to, "eye": eye, "far": maxf(VEILED_FAR, farthest * 1.5)}
	_field.global_transform = Reach.turned(to, eye, -ARRIVING_TURN)
	var room := Room.of(get_tree())
	if room != null:
		room.veil(VEILED_NEAR, VEILED_FAR)


func _step_arriving(delta: float) -> void:
	_arriving.done = minf(_arriving.done + delta / ARRIVING, 1.0)
	var eased := smoothstep(0.0, 1.0, _arriving.done)
	_field.global_transform = Reach.turned(_arriving.to, _arriving.eye, -ARRIVING_TURN * (1.0 - eased))
	var room := Room.of(get_tree())
	if room != null:
		room.veil(VEILED_NEAR, lerpf(VEILED_FAR, _arriving.far, eased))
	if _arriving.done >= 1.0:
		_let_arriving_go()


## The field stops turning where it is and the fog lifts at once.
func _let_arriving_go() -> void:
	if not _arriving.is_empty():
		_arriving = {}
		_unveil()


func _unveil() -> void:
	var room := Room.of(get_tree())
	if room != null:
		room.unveil()


## Whether the field stands out at the vantage, or is on its way there.
func at_vantage() -> bool:
	return not _vantage.is_empty() and not _vantage.back


## The whole field stood out before the reader, small, turning slowly about its
## own middle; asked again, or once a stick moves, it goes back to where it stood.
func vantage() -> void:
	if _marks == null:
		return
	if at_vantage():
		_from_vantage()
		return
	_land()
	_let_arriving_go()
	_seeking = {}
	var was: Transform3D = _vantage.get("was", _field.global_transform)
	_vantage = {
		"was": was, "from": _field.global_transform, "done": 0.0, "back": false,
		"to": Reach.stand_before(_camera.global_transform, _radius),
	}
	_tell_panel()


func _from_vantage() -> void:
	_vantage = {"was": _vantage.was, "from": _field.global_transform, "to": _vantage.was, "done": 0.0, "back": true}
	_tell_panel()


func _step_vantage(delta: float) -> void:
	if _vantage.done < 1.0:
		_vantage.done = minf(_vantage.done + delta / TO_VANTAGE, 1.0)
		_field.global_transform = _vantage.from.interpolate_with(_vantage.to, smoothstep(0.0, 1.0, _vantage.done))
	elif _vantage.back:
		_vantage = {}
		_tell_panel()
	else:
		var stood := _field.global_transform
		_field.global_transform = Transform3D(Basis(Vector3.UP, VANTAGE_TURN * delta) * stood.basis, stood.origin)


## The vantage let go with the field left where it stands.
func _vantage_forgotten() -> void:
	if not _vantage.is_empty():
		_vantage = {}
		_tell_panel()


func _tell_panel() -> void:
	get_tree().call_group(FieldPanel.GROUP, "vantage_changed")


## Where the reader finds the field again: where it was going if it was under
## way, and where it stood before the vantage.
func _left_standing() -> Transform3D:
	if not _vantage.is_empty():
		return _vantage.was
	if not _arriving.is_empty():
		return _arriving.to
	return global_transform * _field.transform


func _first_stand(arrangement: String) -> Transform3D:
	var eyes := _camera.global_transform
	if arrangement == Settings.INSIDE:
		return Reach.arrival(eyes, _laid)
	if arrangement == Settings.TREE:
		return Reach.before_at_size(eyes, _laid)
	return Reach.stand_before(eyes, _radius)


func _placed() -> Dictionary:
	return Field.derive({"notes": _listed}, _arrangement, settings.room)


static func _reach_of(placed: Dictionary) -> float:
	var reach := 0.0
	for ref in placed:
		reach = maxf(reach, placed[ref].position.length())
	return reach


func _settings_changed(what: String) -> void:
	match what:
		"arrangement":
			_rearrange()
		"room":
			_land()
			var placed := _placed()
			_laid = placed
			_radius = _reach_of(placed)
			_stand(_positions(placed))
		"size":
			_marks.set_size(settings.size * LARGER)
		"titles":
			_labels.most = settings.titles
		"lines":
			_lines.show_only(settings)


## The marks walk to where the arrangement chosen now stands them, and the field
## with them, so the reader stays where they are.
func _rearrange() -> void:
	if settings.arrangement == _arrangement:
		return
	var from := {}
	for ref in _marks.refs:
		from[ref] = _marks.local_position(ref)
	var field_from := _field.global_transform
	_arrangement = settings.arrangement
	var placed := _placed()
	_laid = placed
	_radius = _reach_of(placed)
	_lines.arcing = _arrangement == Settings.INSIDE
	_let_seeking_go()
	_let_arriving_go()
	_vantage_forgotten()
	_moving = {"from": from, "to": _positions(placed), "field_from": field_from, "field_to": _first_stand(_arrangement), "done": 0.0}


static func _positions(placed: Dictionary) -> Dictionary:
	var positions := {}
	for ref in placed:
		positions[ref] = placed[ref].position
	return positions


func _stand(positions: Dictionary) -> void:
	_marks.move(positions)
	_lines.move(positions)


func _step_moving(delta: float) -> void:
	_moving.done = minf(_moving.done + delta / REARRANGING, 1.0)
	var eased := smoothstep(0.0, 1.0, _moving.done)
	var now := {}
	for ref in _moving.to:
		now[ref] = _moving.from.get(ref, _moving.to[ref]).lerp(_moving.to[ref], eased)
	_stand(now)
	_field.global_transform = _moving.field_from.interpolate_with(_moving.field_to, eased)
	if _moving.done >= 1.0:
		_moving = {}
		_lines.settle()


## A rearrangement under way ends where it was going, at once.
func _land() -> void:
	if _moving.is_empty():
		return
	_stand(_moving.to)
	_field.global_transform = _moving.field_to
	_moving = {}
	_lines.settle()


## Carry the reader to the note of `ref`: the note lights, its title stands,
## and the field glides from where it is until that note is within reach ahead
## of them, upright, at the size it was. A ref this field does not draw is let be.
func seek(ref: String) -> void:
	if _marks == null or not _marks.refs.has(ref):
		return
	_land()
	_let_arriving_go()
	var was: Basis = _vantage.was.basis if not _vantage.is_empty() else _field.global_basis
	_vantage_forgotten()
	_marks.seek(ref)
	_labels.pin(_marks.refs.find(ref))
	_seeking = {"ref": ref, "done": 0.0, "from": _field.global_transform, "was": was}


func _step_seeking(delta: float) -> void:
	_seeking.done = minf(_seeking.done + delta / SEEKING, 1.0)
	var to := Reach.before_mark(_camera.global_transform, _marks.local_position(_seeking.ref), _seeking.was)
	_field.global_transform = _seeking.from.interpolate_with(to, smoothstep(0.0, 1.0, _seeking.done))
	if _seeking.done >= 1.0:
		_seeking = {}


## The glide stops where it is, and the note sought is lit no more.
func _let_seeking_go() -> void:
	_seeking = {}
	if _marks != null and _marks.sought != "":
		_marks.seek("")
		_labels.pin(-1)


## A stick turning, tilting or walking: whatever carries the field stops where
## it is, and from the vantage the field goes back to where it stood.
func _stick_moved() -> void:
	_let_seeking_go()
	_let_arriving_go()
	if at_vantage():
		_from_vantage()


func _taken_hold() -> void:
	_let_seeking_go()
	_let_arriving_go()
	_vantage_forgotten()


func _heard_from_desk(method: String, params: Dictionary) -> void:
	if method == "view/show":
		seek(str(params.get("note", "")))


func _chat_changed() -> void:
	if _told.text != PULLED:
		_told.text = _words()


func _process(delta: float) -> void:
	if _marks == null:
		return
	if not _moving.is_empty():
		_step_moving(delta)
	elif not _seeking.is_empty():
		_step_seeking(delta)
	elif not _vantage.is_empty():
		_step_vantage(delta)
	elif not _arriving.is_empty():
		_step_arriving(delta)
	var eye := _camera.global_position
	_settle_in -= delta
	if _settle_in <= 0.0:
		_settle_in = SETTLE_EVERY
		var distances: PackedFloat32Array = _marks.settle(eye)
		var facing: PackedFloat32Array = _marks.facing(eye, -_camera.global_basis.z)
		_labels.choose(distances, facing)
		_wear_near(distances)
	_labels.follow(eye, _camera.global_basis, delta)


## The pictures of every near mark that wears one, asked of the desk the first
## time each comes near, nearest first, and kept for the session.
func _wear_near(distances: PackedFloat32Array) -> void:
	if _marks.pictured.is_empty():
		return
	var only := distances.duplicate()
	for at in only.size():
		if not _marks.pictured.has(_marks.refs[at]):
			only[at] = INF
	_pictures = Lod.worn(only, _pictures, PICTURES_WITHIN, PICTURES_BEYOND)
	for at in Lod.to_ask(_pictures, _asked, _asking, PICTURES_MOST):
		_asked[at] = true
		_fetch_picture(_marks.refs[at])
	_marks.show_pictures(_pictures if settings.pictures else [])


func _fetch_picture(ref: String) -> void:
	_asking += 1
	var picture: Image = await Client.picture(project, ref)
	_asking -= 1
	if is_inside_tree() and picture != null:
		_marks.wear(ref, picture)


func _open(ref: String, pointer: Node3D) -> void:
	var was := _panel
	_panel = PANEL.instantiate()
	var menu := HandMenu.of(get_tree())
	if pointer.hand != null and menu != null:
		menu.hold(_panel)
	else:
		add_child(_panel)
		_panel.global_position = _beside(pointer.hand)
		var away := _panel.global_position - _camera.global_position
		_panel.global_basis = Basis.looking_at(Vector3(away.x, away.y * 0.5, away.z), Vector3.UP)
	if is_instance_valid(was):
		was.close()
	_opened = ref
	_focus()
	_panel.dress(_palette.ink, _palette.paper)
	_targets.push_front(_panel)
	_panel.closed.connect(_targets.erase.bind(_panel))
	_panel.open(project, ref, _notes.get(ref, {}), _marks.pulled.has(ref), _named)


## `target` is reached by this view's pointers before the field, until it closes.
func aim_at(target: Node3D) -> void:
	if _targets.has(target):
		return
	_targets.push_front(target)
	target.closed.connect(_targets.erase.bind(target))


## What each note in the field is called, by ref.
func named() -> Dictionary:
	return _named


func _beside(hand: XRController3D) -> Vector3:
	if hand == null:
		var facing := _camera.global_transform.basis
		return _camera.global_position - facing.z * 0.6 + facing.x * 0.15
	var side := 1.0 if hand == _right else -1.0
	var turn := _camera.global_transform.basis
	return hand.global_position + turn.x * BESIDE.x * side + Vector3.UP * BESIDE.y + turn.z * BESIDE.z


func _pointed_at(ref: String, pointer: Node3D) -> void:
	if ref != "":
		_let_line_go()
	_told.text = PULLED if _marks.pulled.has(ref) else _words()
	if ref != "" and ref != _marks.sought and _seeking.is_empty():
		_let_seeking_go()
	_pointed.erase(pointer)
	if ref != "":
		_pointed[pointer] = ref
	_labels.point(_marks.refs.find(_pointed.values().back()) if not _pointed.is_empty() else -1)
	_focus()


## A dense field's hand links come up round the note being read and the marks pointed at.
func _focus() -> void:
	var held: Array = _pointed.values()
	if _opened != "" and is_instance_valid(_panel):
		held.append(_opened)
	held.sort()
	_lines.focus(held)


## The line chosen and the marks it joins are lit, and the hand says what it is.
func _line_chosen(from: String, to: String, label: String, count: int) -> void:
	_marks.light_pair(from, to)
	var said := ["%s → %s" % [_named.get(from, ""), _named.get(to, "")]]
	if label != "":
		said.append(label)
	if count > 1:
		said.append(LINES % count)
	_line_said = "\n".join(said)
	_told.text = _words()


func _line_asked_about(from: String, to: String) -> void:
	var how := HOW_TO_CHANGE % [_named.get(from, ""), _named.get(to, "")]
	if not _line_said.ends_with(how):
		_line_said += "\n" + how
	_told.text = _words()


## The trigger pulled on nothing: no line, pair or sought note stays lit.
func _let_all_go() -> void:
	_let_line_go()
	_let_seeking_go()


func _let_line_go() -> void:
	if _marks == null or not _lines.holding():
		return
	_lines.let_go()
	_marks.light_pair("", "")
	_line_said = ""
	_told.text = _words()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		Views.back()


## Words for the reader, held at the left hand, or before them without a headset.
func _tell_at_hand() -> void:
	_told = Label3D.new()
	_told.pixel_size = 0.0004
	_told.font_size = 36
	_told.outline_size = 8
	_told.width = 700
	_dress_told()
	_told.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var menu := HandMenu.of(get_tree())
	if _left != null and menu != null:
		menu.hold_words(_told)
	else:
		_told.position = Vector3(0.0, -0.18, -0.6)
		_camera.add_child(_told)


func _dress_told() -> void:
	_told.font = Room.font("ui")
	_told.modulate = _palette.ink
	_told.outline_modulate = _palette.paper


func _say(text: String) -> void:
	_status = text
	_told.text = _words()


## While a project is drawn and nothing is under way, how to speak to the desk.
func _words() -> String:
	if _line_said != "":
		return _line_said
	return _status if _status != "" or _marks == null else Chat.unset.get(Client.desk, HandMenu.TALK)

