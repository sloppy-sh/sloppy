## What the reader can do from the field, held on the left hand as a palette:
## six panels round the controller, each a `Page`, the one facing them chosen
## from with the other hand's pointer, a swipe of this hand's stick turning the
## next one to them — DESIGN.md § "The field in a room". Here (the desk's
## projects, leaving this one, letting the desk go, and the browser), the room
## (its light, and moving the field), the note open now, which the other hand's grip pulls off and
## leaves in the room, or puts back, the look (following the desk's, and this
## headset's own look, face and density), how the field is drawn
## (`ui/field_panel.gd`), and the desk's chat (`ui/chat.gd`), its thread held
## as a note is. It comes up at the left hand's menu button and goes away at it
## again, and a note opened brings it up; it is never up while a desk is
## chosen. It holds still while the other hand's ray is near it. Without a
## headset it is up from the start and M puts it away and up again. A desk lost
## while reading brings the connect view back, saying so.
extends Node3D

const Page := preload("res://ui/page.gd")
const Pieces := preload("res://ui/pieces.gd")
const Pointing := preload("res://ui/pointing.gd")
const Reach := preload("res://interaction/reach.gd")
const Room := preload("res://room/room.gd")
const Look := preload("res://look/look.gd")
const FieldPanel := preload("res://ui/field_panel.gd")
const SkiesPanel := preload("res://ui/skies_panel.gd")
const LooksPanel := preload("res://ui/looks_panel.gd")
const Chat := preload("res://ui/chat.gd")
const Settings := preload("res://field/settings.gd")
const Dressing := preload("res://ui/theme.gd")
const Browser := preload("res://ui/browser_panel.gd")

enum Pane { READING, ROOM, NOTE, LOOK, FIELD, CHAT }

const PANELS := 6
## In metres: how far each panel stands from the controller's long axis, how far
## forward along it a panel's middle is, and how wide a panel is.
const RADIUS := 0.16
const MIDDLE := 0.11
const WIDTH := 0.18
## In metres from a panel's middle to its top edge, forward along the controller.
const HALF := 0.09
## In degrees: a panel turned further than this from the reader's eyes cannot be
## chosen from, nor can any but the one turned most to them, and one turned away
## altogether is not drawn.
const FACING_AT_MOST := 70.0
## How far the stick must lean to turn to the next panel, and come back before
## it turns again.
const TURN_AT := 0.7
const TURN_AGAIN := 0.3
## Seconds a turn to the next panel takes.
const TURNING := 0.1
## How large a note stands on the palette, of its size in the room, and how far
## forward its middle is.
const NOTE_ON_PALETTE := 0.55
const NOTE_MIDDLE := 0.16
## In metres: how tall a page held on the palette is at its own size.
const PAGE_TALL := 0.5133
## In metres: a note let go this near its place on the palette goes back on it.
const PUT_BACK_WITHIN := 0.12
## Where it stands with no headset: low on the left of the view, facing it.
const ON_SCREEN := Vector3(-0.55, 1.3, -0.9)
## In metres: the other hand's ray this near a panel holds the palette still.
## In seconds: how long the ray must have left before it follows the hand
## again, and how long it takes to come back under it.
const HOLD_WITHIN := 0.12
const LET_GO_AFTER := 0.3
const FOLLOW_AGAIN := 0.2

const HERE := "Here"
const DESK := "Desk"
const PROJECTS := "Projects"
const LEAVE := "Leave project"
const DISCONNECT := "Disconnect"
const WEB := "Web"
const BROWSER := "Browser"
const CLOSE_BROWSER := "Close browser"
const BRING_BROWSER := "Bring browser here"
const ROOM_TITLE := "Room"
const LIGHT := "Light"
const MOVING := "Moving"
const NOTE_TITLE := "Note"
const LOOK_TITLE := "Look"
const CHAT_TITLE := "Chat"
const THREADS := "Threads"
const EMPTY_NOTE := "Point at a note and pull the trigger to read it here."
const ON_THE_LOOK := "The look's paper"
const DARK := "Dark"
const SURROUNDINGS := "My surroundings"
const NIGHT := "Night sky"
const BRING_BACK := "Bring it back"
const VANTAGE := "Vantage"
const BACK_IN := "Back in"
const STEADY := "Steady hands"
const STEADY_SAID := {"off": "off", "some": "a little", "most": "a lot"}
const NOW_ON_THE_LOOK := "Now: on the paper of the look you are reading in."
const NOW_DARK := "Now: dark, with nothing but the field."
const NOW_SURROUNDINGS := "Now: the field in the room you are in."
const NOW_NIGHT := "Now: under a night sky."
const SKIES := "Skies"
const CANNOT_SHOW := "This headset cannot show your surroundings."
const FOLLOWING := "Following"
const FOLLOW := "Follow the desk"
const COLOURS_AND_TYPE := "Colours and type"
const PANELS_HEADING := "Panels"
const NOW_LOOK := "Now: %s"
const LOOK := "Look"
const FACE := "Face"
const DENSITY := "Density"
const PANELS_ROW := "Panels"
const THE_DESKS := "the desk's"
const THE_LOOKS := "the look's"
const NEW_THREAD := "New thread"
const ALL_THREADS := "All threads"
const NEWER_THREADS := "Newer threads"
const OLDER_THREADS := "Older threads"
const STOP := "Stop"
const TALK := "Hold A and speak to ask."
## The most of the desk's threads listed at once, newest first.
const THREADS_LISTED := 4

## The project being read; "" before one is chosen.
static var project := ""
## What the project being read is called.
static var project_name := ""
static var _made: Node3D

## The panel turned to the reader.
var showing: int = Pane.READING
## The note on the palette or left in the room; null while none is open.
var note:
	get:
		return _held.get(Pane.NOTE)
## Whether `note` is left in the room rather than held on the palette.
var note_floating: bool:
	get:
		return _floating.get(Pane.NOTE, false)
## Whether the reader has the palette up.
var up := true

var _sets_from_graph := false
var _spin := Node3D.new()
var _faces: Array[Node3D] = []
var _angle := 0.0
var _swiped := false
var _words: Node3D
## What each panel holding a page holds, by pane, and whether it is left in the room.
var _held := {}
var _floating := {}
var _carried: Node3D
var _carried_by: Node3D
var _carry := Transform3D()
var _chat := Chat.new()
var _field_panel: Node3D
var _skies_panel: Node3D
var _on_skies := false
var _looks_panel: Node3D
var _on_looks := false
var _settings = Settings.shared()
var _in_a_view := false
## Where the palette stands under the hand, and while it holds still, where it
## stands in the room, how long the other hand's ray has been away, and how
## far back under the hand it has come.
var _rest := Transform3D()
var _still := false
var _still_at := Transform3D()
var _away_for := 0.0
var _coming_back := 0.0
var _other_hand: XRController3D


## The menu, made once for the session and put on the left hand.
static func ensure(tree: SceneTree) -> void:
	if is_instance_valid(_made) or of(tree) != null:
		return
	var hand: Node = null
	for found in tree.root.find_children("*", "XRController3D", true, false):
		if (found as XRController3D).tracker == &"left_hand":
			hand = found
	var made: Node3D = load("res://ui/hand_menu.tscn").instantiate()
	made.name = "HandMenu"
	_made = made
	(hand if hand != null else tree.root).add_child.call_deferred(made)


## The menu, once `ensure` has made it and it stands.
static func of(tree: SceneTree) -> Node3D:
	return tree.root.find_child("HandMenu", true, false)


## Where panel `at` stands about the controller, turned `angle` round its long
## axis: its face outward, its top forward along the controller.
static func face(at: int, angle: float) -> Transform3D:
	var round := Basis(Vector3.BACK, angle + at * TAU / PANELS)
	return Transform3D(round, Vector3.ZERO) * Transform3D(Basis(Vector3.RIGHT, Vector3.FORWARD, Vector3.UP), Vector3(0.0, RADIUS, -MIDDLE))


## How the palette is turned with panel `at` facing the reader.
static func turned_to(at: int) -> float:
	return -at * TAU / PANELS


## Whether a panel standing at `placed` faces `eye` closely enough to choose from.
static func faces_eye(placed: Transform3D, eye: Vector3) -> bool:
	var outward := placed.basis.z.normalized()
	var toward := (eye - placed.origin).normalized()
	return outward.dot(toward) >= cos(deg_to_rad(FACING_AT_MOST))


func _ready() -> void:
	if get_viewport().use_xr:
		transform = Transform3D()
		up = false
		(get_parent() as XRController3D).button_pressed.connect(_button)
	else:
		var toward_eyes := Basis(Vector3.UP, atan2(-ON_SCREEN.x, -ON_SCREEN.z))
		transform = Transform3D(toward_eyes * Basis(Vector3.RIGHT, Vector3.BACK, Vector3.DOWN), ON_SCREEN)
	_rest = transform
	add_to_group(FieldPanel.GROUP)
	add_to_group(Browser.WATCHING)
	add_child(_spin)
	_chat.named = _named_in_view
	add_child(_chat)
	_chat.changed.connect(_draw_chat)
	_chat.opened.connect(_hold.bind(Pane.CHAT))
	_chat.wants_seen.connect(_see_chat)
	for at in PANELS:
		var panel := Node3D.new()
		panel.name = Pane.keys()[at].capitalize()
		_spin.add_child(panel)
		_faces.append(panel)
	_draw()
	_place()
	Views.shown.connect(_shown)
	Client.state_changed.connect(_state_changed)
	var room := Room.of(get_tree())
	if room != null:
		room.dressed.connect(_draw)
	_settings.changed.connect(_setting_changed)
	_shown(Views.current())


## Turn panel `at` to the reader.
func turn_to(at: int) -> void:
	showing = at


## Put the palette up, or away again.
func toggle() -> void:
	up = not up
	_show()
	if up:
		_chat.refresh()


## Whether this hand's stick is the palette's now: while a panel faces the reader.
func takes_stick() -> bool:
	if not visible:
		return false
	var eye := _eye()
	for panel in _faces:
		if faces_eye(panel.global_transform, eye):
			return true
	return false


## Hold `opened` on the note panel and turn it to the reader; where the note
## before it was left in the room, `opened` takes its place there instead.
func hold(opened: Node3D) -> void:
	_hold(opened, Pane.NOTE)


## Leave the note in the room as it stands now, at its own size.
func float_note() -> void:
	_float(Pane.NOTE)


## Put the note back on its panel, and turn the panel to the reader.
func put_back() -> void:
	_put_back(Pane.NOTE)


## Where `note` rests on the palette, in the room.
func note_rest() -> Transform3D:
	return rest_on(Pane.NOTE)


## Where a page held on `pane` rests on the palette, in the room.
func rest_on(pane: int) -> Transform3D:
	return _faces[pane].global_transform * _note_on_face()


## The desk's chat this palette speaks to.
func chat() -> Node:
	return _chat


func _hold(opened: Node3D, pane: int) -> void:
	var was = _held.get(pane)
	_held[pane] = opened
	opened.taken.connect(_taken.bind(opened))
	opened.let_go_of.connect(_let_go.bind(opened))
	opened.closed.connect(_closed.bind(opened))
	if is_instance_valid(was) and _floating.get(pane, false):
		_room_holder().add_child(opened)
		opened.global_transform = was.global_transform
	else:
		_floating[pane] = false
		_put_on_palette(pane, opened)
		up = true
		_show()
	if pane == Pane.CHAT:
		_aim_at(opened)
	_draw_pane(pane)


func _float(pane: int) -> void:
	var held = _held.get(pane)
	if not is_instance_valid(held) or _floating.get(pane, false):
		return
	var standing := Transform3D(held.global_basis.orthonormalized(), held.global_position)
	held.reparent(_room_holder(), false)
	held.global_transform = standing
	_floating[pane] = true
	_draw_pane(pane)


func _put_back(pane: int) -> void:
	var held = _held.get(pane)
	if not is_instance_valid(held):
		return
	_floating[pane] = false
	_put_on_palette(pane, held)
	_draw_pane(pane)


func _pane_of(held: Node3D) -> int:
	for pane in _held:
		if _held[pane] == held:
			return pane
	return -1


## A page the palette holds is reached by the view's pointers before the field.
func _aim_at(held: Node3D) -> void:
	var view := _view()
	if view != null and view.has_method("aim_at") and is_instance_valid(held):
		view.aim_at(held)


func _view() -> Node:
	var view: Node = null
	for child in Views.stage.get_children():
		if not child.is_queued_for_deletion():
			view = child
	return view


func _named_in_view() -> Dictionary:
	var view := _view()
	return view.named() if view != null and view.has_method("named") else {}


## Words for the reader under the reading panel's rows, a panel wide.
func hold_words(label: Label3D) -> void:
	if label.is_inside_tree():
		label.reparent(_words, false)
	else:
		_words.add_child(label)
	label.transform = Transform3D()
	label.width = WIDTH / label.pixel_size
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	label.vertical_alignment = VERTICAL_ALIGNMENT_TOP


func _process(delta: float) -> void:
	_hold_still(delta)
	_steer()
	var target := turned_to(showing)
	var step := TAU / PANELS / TURNING * delta
	_angle += clampf(wrapf(target - _angle, -PI, PI), -step, step)
	_place()
	if _carried_by != null and is_instance_valid(_carried) and is_instance_valid(_carried_by.hand):
		_carried.global_transform = _carried_by.hand.global_transform * _carry


## In metres: how far from the rectangle `laid` (in the plane of `panel`, as
## `_lay` keeps it) a ray from `from` toward `toward` passes; INF where it never
## meets the panel's plane ahead of it.
static func ray_gap(panel: Transform3D, laid: Rect2, from: Vector3, toward: Vector3) -> float:
	var inverse := panel.affine_inverse()
	var start := inverse * from
	var along := inverse.basis * toward
	if absf(along.z) < 1e-6:
		return INF
	var ahead := -start.z / along.z
	if ahead < 0.0 or ahead > Pointing.REACH:
		return INF
	var met := start + along * ahead
	var nearest := Vector2(clampf(met.x, laid.position.x, laid.end.x), clampf(met.y, laid.position.y, laid.end.y))
	return Vector2(met.x, met.y).distance_to(nearest)


## While the other hand's ray is near a panel, the palette stands where it is
## in the room; once the ray has been away a moment it eases back under the hand.
func _hold_still(delta: float) -> void:
	var hand := get_parent() as XRController3D
	if hand == null:
		return
	if _ray_near():
		if not _still or _coming_back > 0.0:
			_still_at = global_transform
		_still = true
		_away_for = 0.0
		_coming_back = 0.0
		top_level = true
		global_transform = _still_at
		return
	if not _still:
		return
	_away_for += delta
	if _away_for < LET_GO_AFTER:
		return
	_coming_back = minf(_coming_back + delta / FOLLOW_AGAIN, 1.0)
	global_transform = _still_at.interpolate_with(hand.global_transform * _rest, ease(_coming_back, -2.0))
	if _coming_back >= 1.0:
		_still = false
		top_level = false
		transform = _rest


func _ray_near() -> bool:
	if not visible:
		return false
	if not is_instance_valid(_other_hand):
		_other_hand = null
		for found in get_tree().root.find_children("*", "XRController3D", true, false):
			if (found as XRController3D).tracker == &"right_hand":
				_other_hand = found
	if _other_hand == null or (get_viewport().use_xr and not _other_hand.get_has_tracking_data()):
		return false
	var from := _other_hand.global_position
	var toward := -_other_hand.global_basis.z.normalized()
	for panel in _faces:
		if panel.visible and panel.has_meta("laid") and ray_gap(panel.global_transform, panel.get_meta("laid"), from, toward) <= HOLD_WITHIN:
			return true
	return false


func _steer() -> void:
	var hand := get_parent() as XRController3D
	var lean := 0.0
	if hand != null:
		var stick := hand.get_vector2("primary")
		var sliding: bool = _field_panel.holds_stick() or (_on_skies and _skies_panel.holds_stick())
		if takes_stick() and absf(stick.x) >= absf(stick.y) and not sliding:
			lean = stick.x
	if absf(lean) < TURN_AGAIN:
		_swiped = false
	elif absf(lean) > TURN_AT and not _swiped:
		_swiped = true
		showing = wrapi(showing + (1 if lean > 0.0 else -1), 0, PANELS)


func _button(button: String) -> void:
	if button == "menu_button" and _in_a_view:
		toggle()


func _unhandled_input(event: InputEvent) -> void:
	if get_viewport().use_xr or not event is InputEventKey or not event.pressed:
		return
	if event.keycode == KEY_M and _in_a_view:
		toggle()
		get_viewport().set_input_as_handled()
	elif event.keycode == KEY_TAB and visible:
		showing = wrapi(showing + (-1 if event.shift_pressed else 1), 0, PANELS)
		get_viewport().set_input_as_handled()


## Only the panel facing the reader most is chosen from, so two beside each
## other are never both under the pointer.
func _place() -> void:
	var eye := _eye()
	var facing: Array[float] = []
	for at in PANELS:
		var panel := _faces[at]
		panel.transform = face(at, _angle)
		var placed := panel.global_transform
		facing.append(placed.basis.z.normalized().dot((eye - placed.origin).normalized()))
	var most := facing.find(facing.max())
	for at in PANELS:
		var panel := _faces[at]
		panel.visible = facing[at] > 0.0
		var choosable := visible and at == most and faces_eye(panel.global_transform, eye)
		for area in panel.find_children("*", "Area3D", true, false):
			(area as Area3D).collision_layer = Pointing.LAYER if choosable else 0


func _eye() -> Vector3:
	var camera := get_viewport().get_camera_3d()
	return camera.global_position if camera != null else Vector3(0.0, 1.6, 0.0)


func _shown(view: String) -> void:
	_in_a_view = view != "connect" and view != ""
	_show()
	_draw_reading()
	_draw_room()
	_chat.read(project, view == "graph" or view == "sets")
	if is_instance_valid(_chat.panel):
		_aim_at.call_deferred(_chat.panel)
	if _field_panel.in_sets != (view == "sets"):
		_field_panel.in_sets = view == "sets"
		_field_panel._redraw()


func _setting_changed(what: String) -> void:
	if what == "steady":
		_draw_room()


func _show() -> void:
	visible = _in_a_view and up


func _state_changed(state: int) -> void:
	var lost := state == Client.State.RETRYING or state == Client.State.UNPAIRED
	if lost and Views.current() != "connect":
		Views.show("connect", {"lost": true})


## Every panel drawn again in what the room is dressed in now.
func _draw() -> void:
	_draw_reading()
	_draw_room()
	_draw_note()
	_draw_look()
	_draw_field()
	_draw_chat()


## The words held under the rows stay what they are, and move to the rows drawn again.
func _draw_reading() -> void:
	var panel := _faces[Pane.READING]
	if _words == null:
		_words = Node3D.new()
		_words.set_meta("height", 0.0)
	elif _words.get_parent() != null:
		_words.get_parent().remove_child(_words)
	_clear(panel)
	var view := Views.current()
	var desk: Array = [Page.choice(PROJECTS, "folder-open", _to_projects, view == "projects")]
	if project != "":
		desk.append(Page.choice(LEAVE, "log-out", _leave))
	desk.append(Page.choice(DISCONNECT, "unplug", _disconnect))
	var browser := Browser.of(get_tree())
	var web: Array = [Page.choice(CLOSE_BROWSER if browser != null else BROWSER, "globe", _browser)]
	if browser != null and browser.away:
		web.append(Page.choice(BRING_BROWSER, "move", _bring_browser))
	var page := Page.new(HERE, [{"heading": DESK, "rows": desk}, {"heading": WEB, "rows": web}], project_name if project != "" else "", WIDTH)
	_lay(panel, [page, _words])


func browser_changed() -> void:
	_draw_reading()


func _browser() -> void:
	if Browser.of(get_tree()) != null:
		Browser.close_in(get_tree())
	else:
		Browser.open_blank(self)


func _bring_browser() -> void:
	Browser.bring_here(self)


func _draw_room() -> void:
	var panel := _faces[Pane.ROOM]
	if _skies_panel != null and _skies_panel.get_parent() != null:
		_skies_panel.get_parent().remove_child(_skies_panel)
	_clear(panel)
	var room := Room.of(get_tree())
	_on_skies = _on_skies and room != null and room.kind == Room.Kind.NIGHT
	if _on_skies:
		_lay(panel, [_skies_page()])
		return
	var said := NOW_DARK
	if room != null and room.kind == Room.Kind.LOOK:
		said = NOW_ON_THE_LOOK
	elif room != null and room.showing_surroundings():
		said = NOW_SURROUNDINGS
	elif room != null and room.kind == Room.Kind.SURROUNDINGS:
		said = CANNOT_SHOW
	elif room != null and room.kind == Room.Kind.NIGHT:
		said = NOW_NIGHT
	var kind: int = room.kind if room != null else Room.Kind.DARK
	var light: Array = [
		Page.choice(ON_THE_LOOK, "sun", _choose_room.bind(Room.Kind.LOOK), kind == Room.Kind.LOOK),
		Page.choice(DARK, "moon", _choose_room.bind(Room.Kind.DARK), kind == Room.Kind.DARK),
		Page.choice(NIGHT, "sparkles", _choose_room.bind(Room.Kind.NIGHT), kind == Room.Kind.NIGHT),
	]
	if kind == Room.Kind.NIGHT:
		light.append(Page.onward(SKIES, room.sky_shown().name, "sparkles", _to_skies.bind(true)))
	light.append(Page.choice(SURROUNDINGS, "eye", _choose_room.bind(Room.Kind.SURROUNDINGS), kind == Room.Kind.SURROUNDINGS))
	var at_vantage: bool = _view_says("at_vantage") == true
	_lay(panel, [Page.new(ROOM_TITLE, [
		{"heading": LIGHT, "rows": light},
		{"heading": MOVING, "rows": [
			Page.choice(BRING_BACK, "undo-2", _bring_back),
			Page.choice(BACK_IN if at_vantage else VANTAGE, "telescope", _vantage, at_vantage),
			Page.setting(STEADY, STEADY_SAID[_settings.steady], "hand", _steadier),
		]},
	], said, WIDTH)])


## The view in front tells the panels when it stands out at its vantage or comes back in.
func vantage_changed() -> void:
	_draw_room()


## Made once; turned to, it asks for the skies again.
func _skies_page() -> Node3D:
	if _skies_panel == null:
		_skies_panel = SkiesPanel.new()
		_skies_panel.width = WIDTH
		_skies_panel.back = _to_skies.bind(false)
	return _skies_panel


func _to_skies(on: bool) -> void:
	var again := on and _skies_panel != null
	_on_skies = on
	_draw_room()
	if again:
		_skies_panel.refresh()


## The next of off, a little and a lot, round again.
func _steadier() -> void:
	var levels: Array = Settings.STEADY.keys()
	_settings.set_steady(levels[(levels.find(_settings.steady) + 1) % levels.size()])


## Following the desk, and what this headset chose over its look: each row
## says what it is set to, and choosing it sets the next; the look itself is
## chosen on the Looks page.
func _draw_look() -> void:
	var panel := _faces[Pane.LOOK]
	if _looks_panel != null and _looks_panel.get_parent() != null:
		_looks_panel.get_parent().remove_child(_looks_panel)
	_clear(panel)
	var room := Room.of(get_tree())
	if room == null:
		return
	if _on_looks:
		_lay(panel, [_looks_page()])
		return
	var following: bool = room.kept.follow
	_lay(panel, [Page.new(LOOK_TITLE, [
		{"heading": FOLLOWING, "rows": [
			Page.choice(FOLLOW, "monitor", room.keep.bind("follow", not following), following),
		]},
		{"heading": COLOURS_AND_TYPE, "rows": [
			Page.onward(LOOK, _look_named(room), "palette", _to_looks.bind(true)),
			_setting(room, "face", FACE, "type", Look.READING_FACES, Look.READING_FACES[0], func(id): return Look.FACE_NAMES[id]),
			_setting(room, "density", DENSITY, "rows-3", Look.DENSITIES, Look.DENSITIES[0], func(id): return Look.DENSITY_NAMES[id]),
		]},
		{"heading": PANELS_HEADING, "rows": [_panels(room)]},
	], NOW_LOOK % Room.look().name, WIDTH)])


## What the look row says the look is: the one chosen here, or the desk's.
func _look_named(room: Node) -> String:
	var id := str(room.kept.look)
	if Look.OWN.has(id):
		return Look.OWN[id].name
	if id != "" and not Look.listed(id).is_empty():
		return str(Look.listed(id).name)
	return THE_DESKS if room.kept.follow else Look.OWN[Look.FIRST_LOOK].name


## Made once.
func _looks_page() -> Node3D:
	if _looks_panel == null:
		_looks_panel = LooksPanel.new()
		_looks_panel.width = WIDTH
		_looks_panel.back = _to_looks.bind(false)
	return _looks_panel


func _to_looks(on: bool) -> void:
	var again := on and _looks_panel != null
	_on_looks = on
	_draw_look()
	if again:
		_looks_panel.redraw()


## A row saying which theme pack the panels at the hand wear, choosing the next.
func _panels(room: Node) -> Dictionary:
	var offered: Array = [Room.LOOK_PANELS] + Dressing.held()
	var now := str(room.kept.panels)
	var shown: String = Dressing.PACKS[now].named if offered.has(now) and Dressing.PACKS.has(now) else THE_LOOKS
	var next: String = offered[(offered.find(now) + 1) % offered.size()]
	return Page.setting(PANELS_ROW, shown, "layout-panel-top", room.keep.bind("panels", next))


## A row saying what `axis` is set to, choosing the next of `choices`. Choosing
## none is the desk's while following it, and `first` otherwise, which is then
## not offered twice.
func _setting(room: Node, axis: String, said: String, glyph: String, choices: Array, first: String, named: Callable) -> Dictionary:
	var now := str(room.kept[axis])
	var offered: Array = [""]
	for choice in choices:
		if room.kept.follow or choice != first:
			offered.append(choice)
	var shown: String = named.call(now) if now != "" else (THE_DESKS if room.kept.follow else named.call(first))
	var next: String = offered[(offered.find(now) + 1) % offered.size()]
	return Page.setting(said, shown, glyph, room.keep.bind(axis, next))


## Drawn once; drawn again in what the room is dressed in, keeping what it holds.
func _draw_field() -> void:
	if _field_panel != null:
		_field_panel._redraw()
		return
	_field_panel = FieldPanel.new()
	_field_panel.width = WIDTH
	_field_panel.to_sets = _to_sets
	_field_panel.to_graph = _to_graph
	_lay(_faces[Pane.FIELD], [_field_panel])


func _draw_pane(pane: int) -> void:
	if pane == Pane.CHAT:
		_draw_chat()
	else:
		_draw_note()


func _draw_note() -> void:
	var panel := _faces[Pane.NOTE]
	for piece in panel.get_children():
		if piece != note:
			piece.queue_free()
	if not is_instance_valid(note) or note_floating:
		_lay(panel, [Page.new(NOTE_TITLE, [], EMPTY_NOTE, WIDTH)])


## The thread open, its rows under it where it is held here; or the desk's
## threads to open one of, and a new one.
func _draw_chat() -> void:
	var panel := _faces[Pane.CHAT]
	var open: Node3D = _held.get(Pane.CHAT) if is_instance_valid(_held.get(Pane.CHAT)) else null
	for piece in panel.get_children():
		if piece != open:
			piece.queue_free()
	var said := _chat.said if _chat.said != "" else TALK
	var on_palette: bool = open != null and not _floating.get(Pane.CHAT, false)
	var rows: Array = []
	if open != null:
		if _chat.answering():
			rows.append(Page.choice(STOP, "square", _chat.stop))
		rows.append(Page.choice(ALL_THREADS, "arrow-left", _chat.close_thread))
		var page := Page.new("" if on_palette else CHAT_TITLE, [{"rows": rows}], said, WIDTH)
		_lay(panel, [page], _under_a_page() if on_palette else HALF)
		return
	var from := _chat.listed_from
	if from > 0:
		rows.append(Page.choice(NEWER_THREADS, "chevron-up", _chat.page.bind(-THREADS_LISTED)))
	var room := WIDTH - Page.INSET * 2.0 - Page.GLYPH - Page.AFTER_GLYPH
	for thread in _chat.threads.slice(from, from + THREADS_LISTED):
		var id := str(thread.get("id", ""))
		rows.append(Page.choice(Chat.row_words(thread, room, Page.LETTERS, Page.LETTER), "message-square", _chat.open.bind(id)))
	if from + THREADS_LISTED < _chat.threads.size():
		rows.append(Page.choice(OLDER_THREADS, "chevron-down", _chat.page.bind(THREADS_LISTED)))
	rows.append(Page.choice(NEW_THREAD, "plus", _chat.open.bind("")))
	_lay(panel, [Page.new(CHAT_TITLE, [{"heading": THREADS, "rows": rows}], said, WIDTH)])


## In metres from a panel's middle: just below a page held on it.
func _under_a_page() -> float:
	return NOTE_MIDDLE - MIDDLE - PAGE_TALL * NOTE_ON_PALETTE / 2.0 - 0.01


## A was pressed: the chat is turned to, to hear it.
func _see_chat() -> void:
	up = true
	showing = Pane.CHAT
	_show()


## `pieces` stacked down a panel from its left edge, `top` metres above its
## middle; the panel keeps how tall they stand.
func _lay(panel: Node3D, pieces: Array, top := HALF) -> void:
	var column := Node3D.new()
	column.position = Vector3(-WIDTH / 2.0, top, 0.002)
	panel.add_child(column)
	Pieces.stack(column, pieces, Page.GAP)
	var tall := 0.0
	for piece in pieces:
		tall += Pieces._height(piece) + Page.GAP * Room.closeness()
	panel.set_meta("laid", Rect2(-WIDTH / 2.0, top - tall, WIDTH, tall))


func _clear(panel: Node3D) -> void:
	for piece in panel.get_children():
		piece.queue_free()


func _note_on_face() -> Transform3D:
	return Transform3D(Basis.from_scale(Vector3.ONE * NOTE_ON_PALETTE), Vector3(0.0, NOTE_MIDDLE - MIDDLE, 0.004))


func _put_on_palette(pane: int, held: Node3D) -> void:
	if held.is_inside_tree():
		held.reparent(_faces[pane], false)
	else:
		_faces[pane].add_child(held)
	held.transform = _note_on_face()
	showing = pane


func _room_holder() -> Node:
	var scene := get_tree().current_scene
	return scene if scene != null else get_tree().root


func _taken(pointer: Node3D, held: Node3D) -> void:
	var pane := _pane_of(held)
	if pane < 0 or pointer.hand == null:
		return
	_float(pane)
	_carried = held
	_carried_by = pointer
	_carry = pointer.hand.global_transform.affine_inverse() * held.global_transform


func _let_go(pointer: Node3D, held: Node3D) -> void:
	if held != _carried or pointer != _carried_by:
		return
	_carried = null
	_carried_by = null
	var pane := _pane_of(held)
	if pane >= 0 and held.global_position.distance_to(rest_on(pane).origin) < PUT_BACK_WITHIN:
		_put_back(pane)


func _closed(held: Node3D) -> void:
	var pane := _pane_of(held)
	if pane < 0:
		return
	_held.erase(pane)
	_floating.erase(pane)
	if held == _carried:
		_carried = null
		_carried_by = null
	_draw_pane(pane)


## What the view in front answers to `method`; null where it has none.
func _view_says(method: String) -> Variant:
	var view := _view()
	return view.call(method) if view != null and view.has_method(method) else null


func _vantage() -> void:
	_view_says("vantage")


func _choose_room(kind: Room.Kind) -> void:
	var room := Room.of(get_tree())
	if room != null:
		room.choose(kind)


## The view in front brought back before the reader: one that knows how stands
## itself; the rest stand where their stage is put.
func _bring_back() -> void:
	var view: Node = null
	for child in Views.stage.get_children():
		if not child.is_queued_for_deletion():
			view = child
	if view != null and view.has_method("bring_back"):
		view.bring_back()
		return
	var camera := get_viewport().get_camera_3d()
	if camera != null and Views.stage is Node3D:
		(Views.stage as Node3D).global_transform = Reach.stage_before(camera.global_transform)


func _to_graph() -> void:
	if Views.current() == "graph":
		return
	if Views.current() == "sets" and _sets_from_graph:
		_sets_from_graph = false
		Views.back()
	elif project != "":
		Views.show("graph", {"project": project})


func _to_sets() -> void:
	if project == "" or Views.current() == "sets":
		return
	_sets_from_graph = Views.current() == "graph"
	Views.show("sets", {"project": project})


func _to_projects() -> void:
	if Views.current() == "projects":
		return
	_sets_from_graph = false
	Views.show("projects")


## The project put down: its note and the chat's thread closed, and the
## desk's projects stood before the reader, wherever they have gone, to choose another.
func _leave() -> void:
	if is_instance_valid(note):
		note.close()
	_chat.close_thread()
	_sets_from_graph = false
	project = ""
	project_name = ""
	Views.show("projects")
	_bring_back()


func _disconnect() -> void:
	_sets_from_graph = false
	project = ""
	Client.close()
	Views.show("connect")
