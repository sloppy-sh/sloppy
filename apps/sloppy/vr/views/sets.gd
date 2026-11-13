## Sets: the tags as translucent places the reader stands among, each note
## standing among the tags it carries, moved through as the field is. Pointing at
## a place and pulling the trigger lights its notes and dims the rest; doing it
## again lets go. DESIGN.md § "The field in a room"; `sets/places.gd` stands everything.
extends Node3D

const Pieces := preload("res://ui/pieces.gd")
const Pointing := preload("res://ui/pointing.gd")
const HandMenu := preload("res://ui/hand_menu.gd")
const NotePanel := preload("res://ui/note_panel.gd")
const PANEL := preload("res://ui/note_panel.tscn")
const Places := preload("res://sets/places.gd")
const Hues := preload("res://sets/hues.gd")
const Notes := preload("res://sets/notes.gd")
const Titles := preload("res://sets/titles.gd")
const Arrival := preload("res://sets/arrival.gd")
const Room := preload("res://room/room.gd")
const Palette := preload("res://field/palette.gd")
const Pointer := preload("res://interaction/pointer.gd")
const Grab := preload("res://interaction/grab.gd")
const Walk := preload("res://interaction/walk.gd")
const Reach := preload("res://interaction/reach.gd")
const FieldPanel := preload("res://ui/field_panel.gd")
const Graph := preload("res://views/graph.gd")
const Labels := preload("res://field/labels.gd")
const Lod := preload("res://field/lod.gd")
const Settings := preload("res://field/settings.gd")

## How much of its hue a place is, at rest, lit and pointed at, and while
## another is lit.
const PLACE_ALPHA := 0.16
const PLACE_LIT := 0.3
const PLACE_POINTED := 0.24
const PLACE_DIM := 0.06
## How much larger than a title a place's name reads.
const NAME_LARGER := 2.0
## Seconds a glide to a note, out to the vantage or back from it takes.
const GLIDING := 1.2
## Radians a second Sets turns about its own middle seen from the vantage.
const VANTAGE_TURN := TAU / 60.0
## Seconds between one choice of the nearest titles and the next.
const SETTLE_EVERY := 0.2
## In metres, beside the hand that opened a note.
const BESIDE := Vector3(0.24, 0.08, -0.05)

## Where a reader left each project's Sets, for this session only.
static var _left_as := {}

var lit := ""
var project := ""
## How this reader has the field drawn, which Sets draws its marks and pictures by.
var settings = Settings.shared()

var _places: Dictionary = {}
var _notes: Dictionary = {}
var _paint: Dictionary = {}
var _saying := ""
var _marks: Node3D
var _titles: Node3D
## What each note is called where a note panel cites it, by ref.
var _named := {}
var _listed := {}
var _owner := ""
var _targets: Array = []
var _pointers: Array[Node3D] = []
var _pointed := {}
var _panel: Node3D
var _origin: XROrigin3D
var _camera: XRCamera3D
var _left: XRController3D
var _right: XRController3D
var _origin_was := Transform3D()
var _walk: Node
var _reach: Node
## In Sets' own units: how far the farthest place or note reaches from their middle.
var _radius := 0.0
## In Sets' own units: a mark's radius, the field's own.
var _mark := 0.0
## Where every note stands in Sets' own units, by ref: `{position}`.
var _laid := {}
var _asked := {}
var _asking := 0
var _pictures: Array[int] = []
var _settle_in := 0.0
## A glide under way: `{from, to, done, holds}`; `holds` keeps it going whatever
## the reader does. Empty while none is.
var _glide := {}
## Standing at the vantage: `{back, turning}`, `back` where Sets stood before. Empty while not.
var _vantage := {}
## Seconds into arriving; below 0 once arrived.
var _arriving := -1.0
var _arrival_steps := 0
## What comes up at each step of arriving: GeometryInstance3D → step.
var _steps := {}

@onready var _field: Node3D = $Field
@onready var _said: Node3D = $Said


func enter(args: Dictionary) -> void:
	project = str(args.get("project", HandMenu.project))
	_stand_in()
	_read()


## The reader's head and hands, and what moves Sets with them.
func _stand_in() -> void:
	Pointing.ensure(get_tree())
	HandMenu.ensure(get_tree())
	_origin = get_tree().current_scene.get_node("XROrigin3D")
	_camera = _origin.get_node("XRCamera3D")
	_origin_was = _origin.global_transform
	if get_viewport().use_xr:
		_left = _origin.get_node("LeftHand")
		_right = _origin.get_node("RightHand")
	_interact()
	var room := Room.of(get_tree())
	if room != null:
		room.dressed.connect(_redress)
	Client.heard.connect(_heard_from_desk)


func _read() -> void:
	_say("Reading the notes…")
	var notes := await _notes_of(project)
	if not is_inside_tree():
		return
	if notes.has("error"):
		_say(notes.error)
		return
	var whose: Dictionary = await Client.call_act(project, "read_graph", {})
	var counts := {}
	var tags: Dictionary = await Client.call_act(project, "list_tags", {})
	if not is_inside_tree():
		return
	var owner: Variant = whose.get("owner")
	_owner = owner if owner is String else ""
	for held in tags.get("tags", []):
		if held is Dictionary and held.get("tag") is String:
			counts[held.tag] = int(held.get("notes", 1))
	for note in notes.notes:
		if note is Dictionary and note.get("note") is String:
			_listed[note.note] = note
			_named[note.note] = NotePanel.named(note)
	var placed := Places.place(notes.notes, counts)
	if placed.places.is_empty():
		_say("No note in this project carries a tag yet, so there are no sets to stand in.")
		return
	_say("")
	_draw(placed)


func _exit_tree() -> void:
	if _marks != null:
		var field: Transform3D = _vantage.back if at_vantage() else global_transform * _field.transform
		_left_as[project] = {"field": field, "origin": _origin.global_transform}
	if _arriving >= 0.0:
		_arrived()
	Client.heard.disconnect(_heard_from_desk)
	_origin.global_transform = _origin_was
	if is_instance_valid(_panel):
		_panel.close()
	for pointer in _pointers:
		if is_instance_valid(pointer):
			pointer.queue_free()


func _interact() -> void:
	var hands: Array = [_left, _right] if _left != null else [null]
	for hand in hands:
		var pointer := Pointer.new(hand, _camera, _targets, Room.ink())
		pointer.missed.connect(_let_seeking_go)
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
	grab.moved.connect(_taken_hold)
	_walk = Walk.new()
	_walk.origin = _origin
	_walk.camera = _camera
	_walk.left = _left
	_walk.left_pointer = _pointers[0]
	_walk.palette = HandMenu.of(get_tree())
	_walk.fly = true
	add_child(_walk)
	_reach = Reach.new()
	_reach.field = _field
	_reach.camera = _camera
	_reach.hand = _right
	_reach.pointer = _pointers[1] if _right != null else null
	add_child(_reach)
	for moving in [_walk, _reach]:
		moving.moved.connect(_moved)


## Every note in `project`'s graph, page after page.
func _notes_of(project: String) -> Dictionary:
	var page: Dictionary = await Client.field(project)
	if page.has("error"):
		return page
	var notes: Array = page.notes
	while page.get("next") is String:
		page = await Client.field(project, page.next)
		if page.has("error"):
			break
		notes.append_array(page.notes)
	return {"notes": notes}


func _say(text: String) -> void:
	_saying = text
	for piece in _said.get_children():
		piece.queue_free()
	if text != "":
		_said.add_child(Pieces.words(text, 0.7, Pieces.SMALL, Pieces.QUIET))


func _draw(placed: Dictionary) -> void:
	var order: Array = placed.places.keys()
	for tag in placed.places:
		var place: Dictionary = placed.places[tag]
		var paint := _translucent(Hues.of(place.slot), PLACE_ALPHA)
		var region := MeshInstance3D.new()
		var ball := SphereMesh.new()
		ball.radius = place.radius
		ball.height = place.radius * 2.0
		region.mesh = ball
		region.material_override = paint
		region.position = place.centre
		region.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var named := _name(tag)
		named.position = Vector3(0.0, place.radius, 0.0)
		region.add_child(named)
		var shape := SphereShape3D.new()
		shape.radius = place.radius
		region.add_child(Pointing.pickable(shape, _light.bind(tag), _point.bind(tag)))
		_field.add_child(region)
		_places[tag] = {"paint": paint, "region": region, "slot": place.slot, "named": named}
		_steps[region] = order.find(tag)
		_steps[named] = order.find(tag)
		_radius = maxf(_radius, place.centre.length() + place.radius)
	_mark = Lod.MARK_RADIUS * Graph.LARGER * settings.size
	_laid = placed.notes
	_marks = Notes.new(_mark)
	_marks.pointed.connect(_pointed_at)
	_marks.chosen.connect(_open)
	_field.add_child(_marks)
	var ball := SphereMesh.new()
	ball.radius = _mark
	ball.height = _mark * 2.0
	ball.radial_segments = 12
	ball.rings = 6
	for ref in placed.notes:
		var note: Dictionary = placed.notes[ref]
		var slot: int = placed.places[note.tags[0]].slot if not note.tags.is_empty() else 0
		var mark := MeshInstance3D.new()
		mark.mesh = ball
		mark.position = note.position
		_marks.add_child(mark)
		_marks.add(ref, note.position)
		_notes[ref] = {"mark": mark, "tags": note.tags, "slot": slot}
		if _listed.get(ref, {}).get("picture") == true:
			_marks.pictured[ref] = true
		_steps[mark] = Arrival.step_of(note.tags, order)
		_radius = maxf(_radius, note.position.length())
	_targets.append(_marks)
	_shade()
	var said: Array[String] = []
	for ref in _marks.refs:
		said.append(_named.get(ref, ""))
	_titles = Titles.new()
	add_child(_titles)
	_titles.build(_field, _marks.local, said, _mark, Room.ink(), Room.paper(), _marks.wearing)
	var held: Dictionary = _left_as.get(project, {})
	if held.is_empty():
		_field.global_transform = standing(_camera.global_transform, _laid)
		_arrive(order.size() + (1 if _steps.values().has(order.size()) else 0))
	else:
		_origin.global_transform = held.origin
		_field.global_transform = held.field


## Where Sets stands for `eyes` when the reader arrives or brings it back, its
## notes standing as `laid` puts them: at its own size about the reader, as the
## field stands inside.
static func standing(eyes: Transform3D, laid: Dictionary) -> Transform3D:
	return Reach.arrival(eyes, laid)


## A place's name, lettered as a place is (DESIGN.md § Typography).
func _name(tag: String) -> Label3D:
	var named := Label3D.new()
	named.text = tag.to_upper()
	named.font = Room.font("heading")
	named.font_size = Labels.FONT_SIZE
	named.pixel_size = Labels.LETTER_AT_1M / Labels.FONT_SIZE
	named.outline_size = Labels.OUTLINE * 2
	named.modulate = Hues.INK
	named.outline_modulate = Room.paper()
	named.alpha_cut = Label3D.ALPHA_CUT_OPAQUE_PREPASS
	named.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	named.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	named.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	return named


## `field` turned by `angle` about the upright line through its own middle.
static func spun(field: Transform3D, angle: float) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, angle), field.origin) * Transform3D(Basis(), -field.origin) * field


## Stand Sets as it stood on arriving, before the reader's eyes as they are now.
func bring_back() -> void:
	if _marks == null:
		return
	_end_arriving()
	_stand_at_vantage({})
	_glide = {}
	_let_seeking_go()
	_field.global_transform = standing(_camera.global_transform, _laid)


## Whether the reader is seeing the whole of Sets from the vantage.
func at_vantage() -> bool:
	return not _vantage.is_empty()


## Out to the vantage, where the whole of Sets stands before the reader small and
## turning, or back from it to where they were.
func vantage() -> void:
	if _marks == null:
		return
	_end_arriving()
	if at_vantage():
		_glide_to(_vantage.back, true)
		_stand_at_vantage({})
		return
	_stand_at_vantage({"back": _field.global_transform, "turning": false})
	_glide_to(Reach.stand_before(_camera.global_transform, _radius), true)


## Carry the reader to the note of `ref`: it lights, its title stands, and Sets
## glides from where it is until that note is within reach ahead of them. A ref
## Sets does not draw is let be.
func seek(ref: String) -> void:
	if _marks == null or not _marks.refs.has(ref):
		return
	_end_arriving()
	var was: Basis = _vantage.back.basis if at_vantage() else _field.global_basis
	_stand_at_vantage({})
	_marks.seek(ref, Hues.of(_notes[ref].slot))
	_titles.pin(_marks.refs.find(ref))
	_glide_to(Reach.before_mark(_camera.global_transform, _marks.local[_marks.refs.find(ref)], was), false)


func _stand_at_vantage(vantage: Dictionary) -> void:
	var was := at_vantage()
	_vantage = vantage
	if at_vantage() != was and is_inside_tree():
		get_tree().call_group(FieldPanel.GROUP, "vantage_changed")


func _glide_to(to: Transform3D, holds: bool) -> void:
	_glide = {"from": _field.global_transform, "to": to, "done": 0.0, "holds": holds}


func _step_glide(delta: float) -> void:
	_glide.done = minf(_glide.done + delta / GLIDING, 1.0)
	_field.global_transform = _glide.from.interpolate_with(_glide.to, smoothstep(0.0, 1.0, _glide.done))
	if _glide.done >= 1.0:
		_glide = {}
		if at_vantage():
			_vantage.turning = true


## The reader moved Sets or themselves: arriving ends with everything shown, a
## glide to a note stops where it is, and the vantage glides back.
func _moved() -> void:
	_end_arriving()
	_let_seeking_go()
	if at_vantage():
		_glide_to(_vantage.back, true)
		_stand_at_vantage({})
	elif not _glide.is_empty() and not _glide.holds:
		_glide = {}


## The reader took hold of Sets: it stays where the hand puts it.
func _taken_hold() -> void:
	_end_arriving()
	_let_seeking_go()
	_stand_at_vantage({})
	_glide = {}


func _let_seeking_go() -> void:
	if _marks != null and _marks.sought != "":
		_marks.seek("")
		_titles.pin(-1)


func _heard_from_desk(method: String, params: Dictionary) -> void:
	if method == "view/show":
		seek(str(params.get("note", "")))


func _arrive(steps: int) -> void:
	_arriving = 0.0
	_arrival_steps = steps
	for shown in _steps:
		shown.transparency = 1.0
	var room := Room.of(get_tree())
	if room != null:
		room.veil(Arrival.VEIL_NEAR, Arrival.VEIL_FAR)


func _step_arrival(delta: float) -> void:
	_arriving += delta
	for shown in _steps:
		shown.transparency = 1.0 - Arrival.shown(_arriving, _steps[shown])
	var room := Room.of(get_tree())
	if room != null:
		var farthest := (_field.global_position.distance_to(_camera.global_position) + _radius * _field.global_basis.get_scale().x) * 1.5
		room.veil(Arrival.VEIL_NEAR, Arrival.veil_far(_arriving, _arrival_steps, farthest))
	if _arriving >= Arrival.span(_arrival_steps):
		_arrived()


func _end_arriving() -> void:
	if _arriving >= 0.0:
		_arrived()


func _arrived() -> void:
	_arriving = -1.0
	for shown in _steps:
		shown.transparency = 0.0
	var room := Room.of(get_tree())
	if room != null:
		room.unveil()


func _process(delta: float) -> void:
	if _marks == null:
		return
	if _arriving >= 0.0:
		_step_arrival(delta)
	if not _glide.is_empty():
		_step_glide(delta)
	elif _vantage.get("turning", false):
		_field.global_transform = spun(_field.global_transform, VANTAGE_TURN * delta)
	var eye := _camera.global_position
	_settle_in -= delta
	if _settle_in <= 0.0:
		_settle_in = SETTLE_EVERY
		_titles.choose(eye, -_camera.global_basis.z)
		_wear_near(_marks.distances(eye))
	_titles.follow(eye)
	_marks.face(eye)
	_name_places(eye)


## Each place's name read at one apparent size, NAME_LARGER than a title's.
func _name_places(eye: Vector3) -> void:
	var larger := _field.global_basis.get_scale().x
	for tag in _places:
		var named: Label3D = _places[tag].named
		var size := Labels.apparent(named.global_position.distance_to(eye)) * NAME_LARGER
		named.scale = Vector3.ONE * size / maxf(larger, 1e-6)


## The pictures of every near mark that wears one, by the field's own rule
## (`views/graph.gd`), asked of the desk the first time each comes near.
func _wear_near(distances: PackedFloat32Array) -> void:
	if _marks.pictured.is_empty():
		return
	var only := distances.duplicate()
	for at in only.size():
		if not _marks.pictured.has(_marks.refs[at]):
			only[at] = INF
	_pictures = Lod.worn(only, _pictures, Graph.PICTURES_WITHIN, Graph.PICTURES_BEYOND)
	for at in Lod.to_ask(_pictures, _asked, _asking, Graph.PICTURES_MOST):
		_asked[at] = true
		_fetch_picture(_marks.refs[at])
	_marks.show_pictures(_pictures if settings.pictures else [])


func _fetch_picture(ref: String) -> void:
	_asking += 1
	var picture: Image = await Client.picture(project, ref)
	_asking -= 1
	if is_inside_tree() and picture != null:
		var pulled := _owner != "" and not ref.begins_with(_owner + "/")
		_marks.wear(ref, picture, Hues.of(_notes[ref].slot), Room.paper(), pulled)


## Everything standing drawn again in what the room is dressed in now.
func _redress() -> void:
	_say(_saying)
	for pointer in _pointers:
		pointer.dress(Room.ink())
	for tag in _places:
		var place: Dictionary = _places[tag]
		place.paint.albedo_color = Color(Hues.of(place.slot), place.paint.albedo_color.a)
		place.named.font = Room.font("heading")
		place.named.modulate = Hues.INK
		place.named.outline_modulate = Room.paper()
	_paint.clear()
	_shade()
	if _marks != null:
		_titles.dress(Room.ink(), Room.paper())
		_marks.dress(Room.paper(), func(ref: String) -> Color: return Hues.of(_notes[ref].slot))
		if _marks.sought != "":
			_marks.seek(_marks.sought, Hues.of(_notes[_marks.sought].slot))
	if is_instance_valid(_panel):
		_panel.dress(Room.ink(), Room.paper())


## A place is lit by the trigger unless a pointer is on a note in it, which the
## trigger opens instead.
func _light(tag: String) -> void:
	if not _pointed.is_empty():
		return
	lit = "" if lit == tag else tag
	_shade()


func _point(pointed: bool, tag: String) -> void:
	_places[tag].pointed = pointed
	_shade_place(tag)


func _pointed_at(ref: String, pointer: Node3D) -> void:
	if ref != "" and ref != _marks.sought and _glide.is_empty():
		_let_seeking_go()
	_pointed.erase(pointer)
	if ref != "":
		_pointed[pointer] = ref
	_titles.point(_marks.refs.find(_pointed.values().back()) if not _pointed.is_empty() else -1)


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
	_panel.dress(Room.ink(), Room.paper())
	_targets.push_front(_panel)
	_panel.closed.connect(_targets.erase.bind(_panel))
	_panel.notes = _listed
	_panel.pulled_of = func(other: String) -> bool: return _owner != "" and not other.begins_with(_owner + "/")
	_panel.open(project, ref, _listed.get(ref, {}), _panel.pulled_of.call(ref), _named)


func _beside(hand: XRController3D) -> Vector3:
	if hand == null:
		var facing := _camera.global_transform.basis
		return _camera.global_position - facing.z * 0.6 + facing.x * 0.15
	var side := 1.0 if hand == _right else -1.0
	var turn := _camera.global_transform.basis
	return hand.global_position + turn.x * BESIDE.x * side + Vector3.UP * BESIDE.y + turn.z * BESIDE.z


## `target` is reached by this view's pointers before the notes, until it closes.
func aim_at(target: Node3D) -> void:
	if _targets.has(target):
		return
	_targets.push_front(target)
	target.closed.connect(_targets.erase.bind(target))


## What each note in Sets is called, by ref.
func named() -> Dictionary:
	return _named


func _shade() -> void:
	for tag in _places:
		_shade_place(tag)
	var dimmed := {}
	for ref in _notes:
		var note: Dictionary = _notes[ref]
		var dim: bool = lit != "" and not note.tags.has(lit)
		note.mark.material_override = _mark_paint(note.slot, dim)
		if dim:
			dimmed[ref] = true
	if _marks != null:
		_marks.dim(dimmed)


func _shade_place(tag: String) -> void:
	var place: Dictionary = _places[tag]
	var alpha := PLACE_ALPHA
	if lit == tag:
		alpha = PLACE_LIT
	elif place.get("pointed", false):
		alpha = PLACE_POINTED
	elif lit != "":
		alpha = PLACE_DIM
	place.paint.albedo_color.a = alpha


## A mark's paint, one per hue and dimness, shared by every mark wearing it.
func _mark_paint(slot: int, dim: bool) -> StandardMaterial3D:
	var key := slot * 2 + (1 if dim else 0)
	if not _paint.has(key):
		var paint := _translucent(Hues.of(slot), Palette.DIM if dim else 1.0)
		if not dim:
			paint.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
		_paint[key] = paint
	return _paint[key]


## Matte: no gloss, nothing that reads as a light of its own.
func _translucent(colour: Color, alpha: float) -> StandardMaterial3D:
	var paint := StandardMaterial3D.new()
	paint.albedo_color = Color(colour, alpha)
	paint.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	paint.roughness = 1.0
	paint.metallic_specular = 0.0
	paint.cull_mode = BaseMaterial3D.CULL_BACK
	paint.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	return paint
