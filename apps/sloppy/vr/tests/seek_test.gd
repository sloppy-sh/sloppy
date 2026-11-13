## Being carried to a note: where the field stands to put a mark before the
## eyes, and, against the desk `tests/run.sh` starts (SLOPPY_DESK and
## SLOPPY_DESK_CODE), the glide from where the field stands straight to the note
## the assistant takes the reader to.
## Exits 1 on a failure.
extends SceneTree

const WAIT := 10.0
const NEAR_ENOUGH := 0.02
const Reach := preload("res://interaction/reach.gd")
const Settings := preload("res://field/settings.gd")

var _failed := 0
var _kept := PackedByteArray()
## Name the desk's own autoloads, so they are loaded once those stand.
var Chat: GDScript
var HandMenu: GDScript


func _initialize() -> void:
	_stands_a_mark_before_the_eyes()
	_run()


func _stands_a_mark_before_the_eyes() -> void:
	var mark := Vector3(0.7, -0.4, 1.3)
	for height in [1.15, 1.7]:
		for yaw in [0.0, 0.9, -2.4]:
			for size in [1.0, Reach.stand_before(Transform3D(), 2.5).basis.get_scale().x]:
				for tilt in [0.0, 0.6]:
					var eyes := Transform3D(Basis(Vector3.UP, yaw * 0.5 + 0.3) * Basis(Vector3.RIGHT, -0.4), Vector3(0.2, height, -0.5))
					var was := (Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, tilt)).scaled(Vector3.ONE * size)
					var stood := Reach.before_mark(eyes, mark, was)
					var want := eyes.origin + Reach.ahead(eyes.basis) * Reach.NEAR
					var what := "height %.2f, yaw %.1f, size %.2f, tilt %.1f" % [height, yaw, size, tilt]
					_check((stood * mark).is_equal_approx(want), "the mark stands within reach ahead at eye height: %s" % what)
					_check(stood.basis.y.normalized().is_equal_approx(Vector3.UP), "the field stands upright: %s" % what)
					_check(is_equal_approx(stood.basis.get_scale().x, size), "at the size it was: %s" % what)
					_check(is_equal_approx(Reach.heading(stood.basis), Reach.heading(Basis(Vector3.UP, yaw))), "turned the way it was: %s" % what)


func _run() -> void:
	var ticket := OS.get_environment("SLOPPY_DESK")
	var code := OS.get_environment("SLOPPY_DESK_CODE")
	if ticket == "" or code == "":
		print("seek_test: FAILED, no desk was named")
		quit(1)
		return
	await process_frame
	Chat = load("res://ui/chat.gd")
	HandMenu = load("res://ui/hand_menu.gd")
	_kept = FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	var settings = Settings.shared()
	settings.set_arrangement(Settings.TREE)
	var client := root.get_node("Client")
	var room: Node3D = load("res://main.tscn").instantiate()
	root.add_child(room)
	current_scene = room
	client.connect_to(ticket)
	await _until(func(): return client.state in [client.State.OPEN, client.State.UNPAIRED])
	if client.state == client.State.UNPAIRED:
		client.connect_to(ticket, code)
		await _until(func(): return client.state == client.State.OPEN)
	_check(client.state == client.State.OPEN, "reaches the desk")
	HandMenu.ensure(self)
	await process_frame
	root.get_node("Views").show("graph", {"project": ""})
	var view: Node3D = room.get_node("Stage").get_child(-1)
	await _until(func(): return view._marks != null)
	if view._marks == null:
		_check(false, "draws a field")
		_end()
		return
	_check(view._told.text == HandMenu.TALK, "the hand says how to speak to the desk: %s" % view._told.text)
	_check(view._marks.refs.size() == 2, "the field holds the desk's two notes")
	var second: String = view._marks.refs[1]

	var size: float = view._field.global_basis.get_scale().x
	client.heard.emit("view/show", {"note": second, "title": "a.ts", "address": "1a"})
	await _until(func(): return view._marks.sought != "")
	_check(view._marks.sought == second and view._marks._sought.visible, "the note shown lights")
	_check(view._marks._lit.visible == false, "in a halo of its own, not the pointer's")
	await _seeks_to(view, second, Settings.TREE, size)

	view._walk.moved.emit()
	_check(view._seeking.is_empty() and view._marks.sought == "" and not view._marks._sought.visible, "moving lets the note go")

	view.seek(second)
	await process_frame
	await process_frame
	var mid: Transform3D = view._field.global_transform
	view._reach.moved.emit()
	await process_frame
	_check(view._seeking.is_empty() and view._field.global_transform == mid, "a lean of the stick stops the glide where it is")

	view.seek(second)
	var pointing := _close_to(view, view._marks.refs[0])
	view._marks.point(pointing)
	_check(view._marks._on.get(pointing) == view._marks.refs[0], "the pointer is on the other mark")
	_check(view._marks.sought == second, "a pointer the field glides past leaves the note lit")
	view._reach.moved.emit()
	view.seek(second)
	view._seeking = {}
	view._marks.unpoint(pointing)
	view._marks.point(_close_to(view, view._marks.refs[0]))
	_check(view._marks.sought == "", "pointing at another mark lets the note go")
	view.bring_back()

	settings.set_arrangement(Settings.INSIDE)
	await _until(func(): return view._moving.is_empty())
	size = view._field.global_basis.get_scale().x
	var thread: Dictionary = (await client.chat_open("")).get("thread", {})
	await client.chat_say("", str(thread.get("id", "")), "take me to the second note")
	await _until(func(): return view._marks.sought == second)
	_check(view._marks.sought == second, "the assistant taking the reader somewhere lights the note")
	await _seeks_to(view, second, Settings.INSIDE, size)

	var chat: Node = HandMenu.of(self).chat()
	Chat.unset[client.desk] = "The desk has no speech set up. On the desk, Settings → AI."
	chat.changed.emit()
	_check(view._told.text.contains("Settings"), "a desk with no speech says where to set it up: %s" % view._told.text)
	Chat.unset.erase(client.desk)
	chat.changed.emit()
	_check(view._told.text == HandMenu.TALK, "and how to speak again once it hears")
	_end()


func _seeks_to(view: Node3D, ref: String, arrangement: String, size: float) -> void:
	var whole: Transform3D = Reach.stand_before(view._camera.global_transform, view._radius)
	var started: Transform3D = view._field.global_transform
	var drew_back := false
	var kept_size := true
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not view._seeking.is_empty() and Time.get_ticks_msec() < by:
		await process_frame
		var now: Transform3D = view._field.global_transform
		drew_back = drew_back or now.origin.distance_to(whole.origin) < 0.05 and is_equal_approx(now.basis.get_scale().x, whole.basis.get_scale().x)
		kept_size = kept_size and is_equal_approx(now.basis.get_scale().x, size)
	_check(not drew_back, "the field never draws back to stand whole before the reader (%s)" % arrangement)
	_check(kept_size, "and keeps its size all the way (%s)" % arrangement)
	_check(started != view._field.global_transform, "it glides from where it stood (%s)" % arrangement)
	await _settled(view)
	_check(not view._labels._shown.is_empty() and view._labels._shown[0] == view._marks.refs.find(ref), "the note's title stands (%s)" % arrangement)
	var eyes: Transform3D = view._camera.global_transform
	var at: Vector3 = view._marks.global_transform * view._marks.local_position(ref)
	var want := eyes.origin + Reach.ahead(eyes.basis) * Reach.NEAR
	_check(at.distance_to(want) <= NEAR_ENOUGH, "and the note comes within reach ahead (%s): %.3f m off" % [arrangement, at.distance_to(want)])
	_check(is_equal_approx(view._field.global_basis.get_scale().x, size), "at the size the field was (%s)" % arrangement)
	_check(view._marks.sought == ref and view._marks._sought.visible, "and stays lit (%s)" % arrangement)


## A pointer a hand's breadth from the mark of `ref`, on the reader's side of
## it, aimed at it, so no other mark stands between.
func _close_to(view: Node3D, ref: String) -> Node3D:
	var mark: Vector3 = view._field.global_transform * view._marks.local_position(ref)
	return _pointer(mark + (view._camera.global_position - mark).normalized() * 0.25, mark)


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


func _settled(view: Node3D) -> void:
	var by: float = Time.get_ticks_msec() + view.SETTLE_EVERY * 2500.0
	while Time.get_ticks_msec() < by:
		await process_frame


func _end() -> void:
	root.get_node("Client").close()
	if _kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(_kept)
	print("seek_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("seek_test: does not hold: %s" % what)
