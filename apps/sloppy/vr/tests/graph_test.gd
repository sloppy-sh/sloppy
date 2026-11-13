## The graph view against a desk `tests/run.sh` starts, named by
## SLOPPY_DESK and SLOPPY_DESK_CODE: the field drawn from what the desk lists,
## the reader arriving inside it out of the fog, a mark pointed at and opened,
## a line pointed at, chosen and asked about,
## the marks walked to the tree at its own size and back, the vantage and back
## in, a near mark wearing its picture, and the field found as it was left.
## Exits 1 on a failure.
extends SceneTree

const WAIT := 10.0
const Lod := preload("res://field/lod.gd")
const Marks := preload("res://field/marks.gd")
const Palette := preload("res://field/palette.gd")
const Pointer := preload("res://interaction/pointer.gd")
const Room := preload("res://room/room.gd")
const Reach := preload("res://interaction/reach.gd")
const Settings := preload("res://field/settings.gd")

var _failed := 0
var _kept := PackedByteArray()


func _initialize() -> void:
	_run()


func _run() -> void:
	var ticket := OS.get_environment("SLOPPY_DESK")
	var code := OS.get_environment("SLOPPY_DESK_CODE")
	if ticket == "" or code == "":
		print("graph_test: FAILED, no desk was named")
		quit(1)
		return
	await process_frame
	_kept = FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	var settings = Settings.shared()
	settings.set_arrangement(Settings.INSIDE)
	settings.set_room(1.0)
	settings.set_pictures(true)
	var panel_script: GDScript = load("res://ui/note_panel.gd")
	var client := root.get_node("Client")
	var views := root.get_node("Views")
	var room: Node3D = load("res://main.tscn").instantiate()
	root.add_child(room)
	current_scene = room
	client.connect_to(ticket)
	await _until(func(): return client.state in [client.State.OPEN, client.State.UNPAIRED])
	if client.state == client.State.UNPAIRED:
		client.connect_to(ticket, code)
		await _until(func(): return client.state == client.State.OPEN)
	_check(client.state == client.State.OPEN, "reaches the desk")

	views.show("graph", {"project": ""})
	var view: Node3D = room.get_node("Stage").get_child(-1)
	await _until(func(): return view._marks != null)
	_check(view._marks != null, "draws a field")
	if view._marks == null:
		_end()
		return

	var listing: Dictionary = await client.field("")
	var notes: Array = listing.get("notes", [])
	_check(not notes.is_empty(), "the desk has notes to draw")
	_check(view._marks.refs.size() == notes.size(), "a mark for every note listed")
	var placed: Dictionary = root.get_node("Field").derive({"notes": notes}, Settings.INSIDE)
	for ref in placed:
		_check(view._marks.local_position(ref) == placed[ref].position, "%s stands where the genealogy puts it" % ref)
	var eye: Vector3 = room.get_node("XROrigin3D/XRCamera3D").global_position
	var root_ref: String = notes[0].note
	_check(settings.lines == [{"key": Settings.SPRANG, "count": 1}], "the lines it draws are offered to the panel: %s" % [settings.lines])
	await _arrives(view, placed)

	settings.set_arrangement(Settings.TREE)
	var tree: Dictionary = root.get_node("Field").derive({"notes": notes}, Settings.TREE)
	await process_frame
	await process_frame
	var leaf: String = notes[1].note
	var midway: Vector3 = view._marks.local_position(leaf)
	_check(not midway.is_equal_approx(placed[leaf].position) and not midway.is_equal_approx(tree[leaf].position), "switching walks the marks rather than jumping them")
	await _until(func(): return view._moving.is_empty())
	for ref in tree:
		_check(view._marks.local_position(ref).is_equal_approx(tree[ref].position), "%s stands where the tree puts it" % ref)
	_check(view._field.global_position.z < eye.z, "the tree stands in front of the reader")
	_check(is_equal_approx(view._field.global_basis.get_scale().x, 1.0), "at its own size")
	var nearest := INF
	for ref in tree:
		nearest = minf(nearest, eye.z - (view._field.global_transform * tree[ref].position).z)
	_check(is_equal_approx(nearest, Reach.NEAR + Reach.AT_SIZE_FURTHER), "its nearest mark a step beyond reach: %.3f" % nearest)
	_check(view._walk.fly, "and the reader flies in it as they do inside")
	settings.set_room(2.0)
	_check(view._marks.local_position(leaf).is_equal_approx(root.get_node("Field").derive({"notes": notes}, Settings.TREE, 2.0)[leaf].position), "more room moves the marks at once")
	settings.set_room(1.0)
	settings.set_arrangement(Settings.INSIDE)
	await process_frame
	var going: Transform3D = view._moving.get("field_to", Transform3D())
	_check(not view._moving.is_empty(), "the walk back inside is under way")
	settings.set_room(1.5)
	_check(view._moving.is_empty() and view._field.global_transform.is_equal_approx(going), "more room asked mid-walk ends the walk where it was going")
	settings.set_room(1.0)
	await _until(func(): return view._moving.is_empty())
	_check(view._field.global_transform.is_equal_approx(Reach.arrival(view._camera.global_transform, placed)), "and back inside, the reader stands where they first arrived")
	settings.set_arrangement(Settings.TREE)
	await _until(func(): return view._moving.is_empty())
	placed = tree

	await _until(func(): return view._marks.showing_picture(root_ref))
	_check(view._marks.showing_picture(root_ref), "a near mark with a picture wears it")
	_check(not view._marks.pictured.has(notes[1].note), "a mark without one does not")
	settings.set_pictures(false)
	await _until(func(): return not view._marks.showing_picture(root_ref))
	_check(not view._marks.showing_picture(root_ref), "and takes it off when pictures are hidden")
	settings.set_pictures(true)

	var ref: String = view._marks.refs[0]
	var mark: Vector3 = view._marks.global_transform * view._marks.local_at(0)
	var pointer := _pointer(eye, mark)
	_check(is_finite(view._marks.hit(pointer)), "a ray at a mark meets it")
	var aside := _pointer(eye, mark + Vector3(0.0, 0.5, 0.0))
	_check(view._marks.hit(aside) == INF or view._marks.nearest(aside.from, (aside.to - aside.from).normalized())[0] != 0, "a ray past it does not")
	view._marks.point(pointer)
	_check(view._marks._lit.visible, "the mark pointed at is lit")
	view._marks.press(pointer)
	await _until(func(): return is_instance_valid(view._panel) and view._panel._body.text != panel_script.READING)
	_check(is_instance_valid(view._panel), "the trigger opens the note")
	if is_instance_valid(view._panel):
		_check(view._panel._title.text == panel_script.named(view._notes[ref]), "the panel names the note")
		_check(view._panel._body.get_parsed_text().strip_edges() != "", "the panel reads it: %s" % view._panel._body.get_parsed_text())
		var face: Vector3 = view._panel.global_position
		_check(is_finite(view._panel.hit(_pointer(eye, face))), "a ray at the panel meets it")
		_check(view._targets[0] == view._panel, "the panel is pointed at before the field behind it")
		view._panel.close()
		await process_frame
		_check(not view._targets.has(view._panel), "a closed panel is pointed at no more")
	view._marks.unpoint(pointer)
	_check(not view._marks._lit.visible, "a mark let go is lit no more")

	await _drawn_again_in_the_room_chosen(view, pointer)

	var hand := XRController3D.new()
	root.add_child(hand)
	hand.global_position = mark + Vector3(0.0, 0.0, 0.4)
	var held := Pointer.new(hand, view._camera, view._targets, view._palette.ink)
	hand.add_child(held)
	held._process(0.016)
	var met: float = view._marks.hit(held)
	_check(is_finite(met), "a hand's ray at a mark meets it")
	_check(not held.holding_stick, "a mark does not take the stick")
	_check(is_equal_approx(held._beam.transform.basis.get_scale().y, met), "a hand's beam ends at the mark it is on")
	view._marks.unpoint(held)
	hand.queue_free()

	var unknown := Marks.new()
	var none: Array[String] = []
	unknown.build(placed, view._notes, view._palette, none, "")
	_check(unknown.pulled.is_empty(), "with whose graph it is unknown, no note is drawn pulled")
	unknown.free()

	eye = mark + Vector3(0.0, 0.0, 0.2)
	view._labels.choose(view._marks.settle(eye), view._marks.facing(eye, Vector3.FORWARD))
	_check(view._labels._shown.has(0), "a near mark is titled")
	view._labels.choose(view._marks.settle(eye), view._marks.facing(eye, Vector3.BACK))
	_check(not view._labels._shown.has(0), "a near mark behind the eyes is not")
	eye = mark + Vector3(0.0, 0.0, 50.0)
	view._labels.choose(view._marks.settle(eye), view._marks.facing(eye, Vector3.FORWARD))
	_check(view._labels._shown.size() <= Lod.TITLES_MOST, "no more than the most are titled from across the room")

	_line_pointed_at(view)
	await _stands_out_at_the_vantage(view)

	view._field.global_transform = Transform3D(Basis.from_scale(Vector3.ONE * 0.3).rotated(Vector3.UP, 0.4), Vector3(0.2, 1.1, -1.4))
	var left_as: Transform3D = view._field.global_transform
	views.show("connect")
	await process_frame
	views.back()
	view = room.get_node("Stage").get_child(-1)
	await _until(func(): return view._marks != null)
	_check(view._marks != null and view._field.global_transform.is_equal_approx(left_as), "the field is where it was left")
	_check(view._arriving.is_empty() and not Room.of(self).environment.fog_enabled, "and found again without the fog")
	_end()


## Opened for the first time, the field stands veiled and turned an eighth
## away, and turns into place as the fog draws back: the reader inside it, the
## root ahead, nothing at their eyes.
func _arrives(view: Node3D, placed: Dictionary) -> void:
	var environment: Environment = Room.of(self).environment
	var to: Transform3D = view._arriving.get("to", Transform3D())
	_check(not view._arriving.is_empty() and environment.fog_enabled, "a field opened for the first time is veiled")
	_check(environment.fog_depth_end < view.VEILED_FAR + 0.1, "showing only what is near: %.2f" % environment.fog_depth_end)
	_check(not view._field.global_transform.is_equal_approx(to), "and stands turned away from where it is going")
	await _until(func(): return view._arriving.get("done", 1.0) > 0.5)
	_check(environment.fog_depth_end > view.VEILED_FAR, "the fog draws back: %.2f" % environment.fog_depth_end)
	await _until(func(): return view._arriving.is_empty())
	_check(not environment.fog_enabled, "and lifts")
	_check(view._field.global_transform.is_equal_approx(to), "the field turned into place")
	var eyes: Transform3D = view._camera.global_transform
	_check(to.is_equal_approx(Reach.arrival(eyes, placed)), "where a reader arriving inside it stands")
	var eye_in: Vector3 = to.affine_inverse() * eyes.origin
	for ref in placed:
		_check(eye_in.distance_to(placed[ref].position) >= Reach.ARRIVAL_CLEAR, "no mark at the reader's eyes: %s" % ref)
	view.arrive()
	view._reach.moved.emit()
	_check(view._arriving.is_empty() and not environment.fog_enabled, "a stick moved ends the arrival where it is")
	view.bring_back()


## A ray across the stem between the root and its child lights it and both
## its ends, the hand saying which notes it joins; the trigger again says how to
## change it; the trigger on nothing, or pointing at a mark, lets it go.
func _line_pointed_at(view: Node3D) -> void:
	var lines: Node3D = view._lines
	var from: String = lines._parents[lines._pairs[0]]
	var to: String = lines._pairs[0]
	var start: Vector3 = lines.global_transform * view._marks.local_position(from)
	var end: Vector3 = lines.global_transform * view._marks.local_position(to)
	var middle := (start + end) * 0.5
	var across := (end - start).cross(Vector3.UP if absf((end - start).normalized().y) < 0.9 else Vector3.RIGHT).normalized()
	var pointer := _pointer(middle + across * 0.3, middle)
	_check(_aimed(view, pointer) == lines, "a ray across a line meets the line before the marks")
	_check(lines._lit_stem.visible, "and lights it")
	lines.press(pointer)
	_check(view._marks.paired == [from, to] and view._marks._ends[0].visible and view._marks._ends[1].visible, "the trigger lights the marks it joins")
	_check(view._told.text == "%s → %s" % [view._named[from], view._named[to]], "and the hand says which notes it joins: %s" % view._told.text)
	lines.press(pointer)
	var how: String = view.HOW_TO_CHANGE % [view._named[from], view._named[to]]
	_check(view._told.text == "%s → %s\n%s" % [view._named[from], view._named[to], how], "the trigger again keeps the line named and says how to change it: %s" % view._told.text)
	lines.unpoint(pointer)
	_check(lines._lit_stem.visible, "a line chosen stays lit once the pointer leaves it")
	view._pointers[0].missed.emit()
	_check(not lines.holding() and not lines._lit_stem.visible and view._marks.paired.is_empty(), "the trigger on nothing lets it go")
	_check(not view._told.text.contains(how), "and the hand says it no more")
	var sought: String = view._marks.refs[0]
	view.seek(sought)
	view._pointers[0].missed.emit()
	_check(view._marks.sought == "" and not view._marks._sought.visible and view._seeking.is_empty(), "the trigger on nothing lets the note sought go")
	_check(view._labels._pinned == -1, "and its title stands no longer")
	_aimed(view, pointer)
	lines.press(pointer)
	lines.unpoint(pointer)
	var mark := _pointer(middle + across * 0.3, start)
	_check(_aimed(view, mark) == view._marks, "a ray at a mark meets the mark")
	_check(not lines.holding() and view._marks.paired.is_empty(), "and pointing at a mark lets the line go")
	view._marks.unpoint(mark)
	pointer.queue_free()
	mark.queue_free()


## Whichever of the view's targets `pointer` meets first, pointed at as the
## pointer would; null where it meets none.
func _aimed(view: Node3D, pointer: Node3D) -> Object:
	var nearest: Object = null
	var best := INF
	for target in view._targets:
		var distance: float = target.hit(pointer)
		if distance < best:
			best = distance
			nearest = target
	if nearest != null:
		nearest.point(pointer)
	return nearest


## The vantage stands the whole field small before the reader, turning, and
## the row again or a stick moved brings it back to where it stood.
func _stands_out_at_the_vantage(view: Node3D) -> void:
	var HandMenu: GDScript = load("res://ui/hand_menu.gd")
	HandMenu.ensure(self)
	await process_frame
	await process_frame
	var panel: Node3D = HandMenu.of(self)._faces[HandMenu.Pane.ROOM]
	_check(_says(panel, HandMenu.VANTAGE), "the room panel offers the vantage")
	var was: Transform3D = view._field.global_transform
	view.vantage()
	await process_frame
	_check(_says(panel, HandMenu.BACK_IN), "and once there, a way back in")
	await _until(func(): return view._vantage.get("done", 1.0) >= 1.0)
	var whole := Reach.stand_before(view._camera.global_transform, view._radius)
	var there: Transform3D = view._field.global_transform
	_check(there.origin.is_equal_approx(whole.origin) and is_equal_approx(there.basis.get_scale().x, whole.basis.get_scale().x), "the whole field stands before the reader, small")
	await process_frame
	await process_frame
	var turning: Transform3D = view._field.global_transform
	_check(turning.origin.is_equal_approx(there.origin) and not turning.basis.is_equal_approx(there.basis), "and turns about its own middle")
	_check(turning.basis.y.normalized().is_equal_approx(Vector3.UP), "upright")
	view.vantage()
	await _until(func(): return view._vantage.is_empty())
	_check(view._field.global_transform.is_equal_approx(was), "the row again brings it back to where it stood")
	await process_frame
	_check(_says(panel, HandMenu.VANTAGE), "and the panel offers the vantage again")
	view.vantage()
	await _until(func(): return view._vantage.get("done", 1.0) >= 1.0)
	view._reach.moved.emit()
	_check(not view.at_vantage(), "a stick moved at the vantage goes back")
	await _until(func(): return view._vantage.is_empty())
	_check(view._field.global_transform.is_equal_approx(was), "to where it stood")


static func _says(panel: Node, words: String) -> bool:
	for said in panel.find_children("*", "Label3D", true, false):
		if said.text == words and not _going(said, panel):
			return true
	return false


## Whether `node`, or anything it stands in up to `top`, is to be freed.
static func _going(node: Node, top: Node) -> bool:
	while node != null and node != top:
		if node.is_queued_for_deletion():
			return true
		node = node.get_parent()
	return false


## The field standing is drawn again in the look's own room and back in the
## dark, without being read again or moved.
func _drawn_again_in_the_room_chosen(view: Node3D, pointer: Node3D) -> void:
	var kept := FileAccess.get_file_as_bytes(Room.KEPT) if FileAccess.file_exists(Room.KEPT) else PackedByteArray()
	var room: Node = Room.of(self)
	var marks: Node3D = view._marks
	var standing: Transform3D = view._field.global_transform
	view._marks.point(pointer)
	var root_ref: String = view._marks.refs[0]
	for kind in [Room.Kind.LOOK, Room.Kind.SURROUNDINGS, Room.Kind.DARK]:
		room.choose(kind)
		var paper := Room.paper().srgb_to_linear()
		_check(view._palette.paper == Room.paper() and view._told.modulate == Room.ink(), "the words are drawn on the room's paper")
		_check(view._marks._paint.get_shader_parameter("paper").is_equal_approx(Vector3(paper.r, paper.g, paper.b)), "and so are the marks")
		_check(view._lines._tree_ink.albedo_color == Room.paper().lerp(Room.ink(), view._lines.TREE_INK), "and the lines")
		_check(view._lines._hand_ink.get_shader_parameter("ink") == Room.paper().lerp(Room.ink(), view._lines.HAND_INK), "and the hand links")
		_check(view._lines._quiet_ink.get_shader_parameter("ink") == Color(Room.ink(), Palette.DIM), "and a dense field's quiet ones")
		if view._marks._discs.has(root_ref):
			var disc: ShaderMaterial = view._marks._discs[root_ref].material_override
			_check(disc.get_shader_parameter("paper") == Room.paper(), "and the pictures worn")
		else:
			_check(false, "a picture is worn to be drawn again")
		_check(view._labels._ink == Room.ink(), "and the titles")
	_check(view._marks == marks and view._marks._lit.visible and view._field.global_transform == standing, "the field drawn again is the one standing, as it stood")
	view._marks.unpoint(pointer)
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)


func _end() -> void:
	root.get_node("Client").close()
	if _kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(_kept)
	print("graph_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


## A pointer whose ray runs from `from` through `to`.
func _pointer(from: Vector3, to: Vector3) -> Node3D:
	var source := GDScript.new()
	source.source_code = "extends Node3D\nvar from: Vector3\nvar to: Vector3\nvar hand = null\nvar holding_stick := false\nfunc ray() -> Array:\n\treturn [from, (to - from).normalized()]\n"
	source.reload()
	var pointer := Node3D.new()
	pointer.set_script(source)
	pointer.from = from
	pointer.to = to
	root.add_child(pointer)
	return pointer


## Long enough for the view to read what is near the eyes twice.
func _settled(view: Node3D) -> void:
	var by: float = Time.get_ticks_msec() + view.SETTLE_EVERY * 2500.0
	while Time.get_ticks_msec() < by:
		await process_frame


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("graph_test: does not hold: %s" % what)
