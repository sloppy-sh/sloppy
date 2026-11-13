## The connect, projects and Sets views and the hand menu, driven the way a
## pointer would drive them, against the never-paired desk `tests/run.sh`
## names as SLOPPY_FRESH_DESK, and the desk showing no code it names as
## SLOPPY_RESTING_DESK. Exits 1 on a failure.
extends SceneTree

const WAIT := 10.0

var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	var ticket := OS.get_environment("SLOPPY_FRESH_DESK")
	var code := OS.get_environment("SLOPPY_FRESH_DESK_CODE")
	var resting := OS.get_environment("SLOPPY_RESTING_DESK")
	if ticket == "" or code == "" or resting == "":
		print("views_test: FAILED, no desk was named")
		quit(1)
		return
	await process_frame
	var client: Node = root.get_node("Client")
	var views: Node = root.get_node("Views")
	var stage := Node3D.new()
	root.add_child(stage)
	views.stage = stage

	views.show("connect")
	await _frames(2)
	_check(_label(_view(stage), "Choose a desk") != null, "opens on the desks")
	_check(_label(_view(stage), "Somewhere else") != null, "offers a desk somewhere else")
	_pick(_view(stage), "Somewhere else")
	await _frames(1)
	_pick(_view(stage), "Paste")
	await _frames(1)
	_check(_label(_view(stage), "Nothing has been copied on this headset yet.") != null, "says an empty paste")

	_view(stage)._pasted = resting
	_view(stage)._draw()
	await _frames(1)
	_pick(_view(stage), "Connect")
	await _until(func(): return client.state == client.State.UNPAIRED)
	await _frames(1)
	_check(_label_starting(_view(stage), "This headset is not paired with this desk yet. Ask the desk for a code") != null,
		"tells the person to ask a desk showing no code for one")
	_check(_label(_view(stage), "Clear") == null, "shows no keypad while the desk shows no code")
	_pick(_view(stage), "I have a code")
	await _frames(1)
	_check(_label(_view(stage), "Clear") != null, "brings the keypad once the person has a code")
	_pick(_view(stage), "Back")
	await _frames(1)
	_pick(_view(stage), "Somewhere else")
	await _frames(1)
	# A headless editor has no clipboard to paste from.
	_view(stage)._pasted = ticket
	_view(stage)._draw()
	await _frames(1)
	_pick(_view(stage), "Connect")
	await _until(func(): return client.state == client.State.UNPAIRED)
	await _frames(1)
	_check(_label(_view(stage), "Pair with this desk") != null, "asks a desk never paired for its code")

	for key in ["1", "1", "1", "1", "1", "1", "Pair"]:
		_pick(_view(stage), key)
	await _until(func(): return client.state == client.State.CONNECTING or client.state == client.State.PAIRING)
	await _until(func(): return client.state == client.State.UNPAIRED)
	await _frames(1)
	_check(_label_starting(_view(stage), "That is not a code") != null, "says the code was wrong")
	for key in code.split(""):
		_pick(_view(stage), key)
	_pick(_view(stage), "Pair")
	await _until(func(): return views.current() == "projects" and _label(_view(stage), "orchard") != null)
	_check(views.current() == "projects", "pairs on the right code and lists the projects")
	_check(_label(_view(stage), "orchard") != null, "names the project served")

	_pick(_view(stage), "orchard")
	await _frames(2)
	var menu: Node = root.find_child("HandMenu", true, false)
	_check(views.current() == "graph", "choosing a project shows its graph")
	_check(menu != null and menu.visible, "the hand menu stands at the hand")
	_check(menu.project != "", "the hand menu holds the project chosen")
	_check(menu.project_name != "" and _label(menu._faces[0], menu.project_name) != null, "and names it on its first panel")

	_pick(menu, "Sets")
	await _until(func(): return not _view(stage)._places.is_empty() or _label_starting(_view(stage), "No note") != null)
	var sets: Node = _view(stage)
	_check(views.current() == "sets", "the hand menu turns to Sets")
	_check(sets._places.keys().size() == 2 and sets._places.has("fruit") and sets._places.has("trees"),
		"a place for each tag the notes carry: %s" % [sets._places.keys()])
	var listed: Dictionary = await client.call_act(menu.project, "list_notes", {})
	_check(sets._notes.size() == listed.get("notes", []).size(), "every note stands in the room")
	if sets._places.has("fruit"):
		var fruit: Area3D = _place_area(sets, "fruit")
		fruit.get_meta("hover").call(true)
		_check(is_equal_approx(sets._places.fruit.paint.albedo_color.a, sets.PLACE_POINTED), "a place pointed at shows it")
		fruit.get_meta("hover").call(false)
		fruit.get_meta("pick").call()
		var dimmed := 0
		for ref in sets._notes:
			var note: Dictionary = sets._notes[ref]
			var dim: bool = note.mark.material_override.albedo_color.a < 1.0
			_check(dim != note.tags.has("fruit"), "%s lit only where it carries fruit" % ref)
			if dim:
				dimmed += 1
			_check(note.mark.visible and note.mark.is_inside_tree(), "%s still drawn: highlight, never filter" % ref)
		_check(dimmed > 0, "a note in no place is dimmed while fruit is lit")
		fruit.get_meta("pick").call()
		_check(sets.lit == "", "pointing again lets go")

	_pick(menu, "Field")
	await _frames(2)
	_check(views.current() == "graph", "the hand menu turns back to the graph")

	client._closed("The desk stopped serving this headset.")
	await _frames(2)
	_check(views.current() == "connect", "a desk lost while reading brings the connect view back")
	_check(_label_starting(_view(stage), "The desk is not answering") != null, "and says so")
	_pick(_view(stage), "Connect again")
	_check(client._retry_at < 0.0, "connecting again lets the client's own retry go")
	await _until(func(): return views.current() == "projects")
	_check(views.current() == "projects", "connecting again reaches the desk by its key, with no code")

	_pick(menu, "Disconnect")
	await _frames(2)
	_check(views.current() == "connect" and client.state == client.State.IDLE, "disconnect lets the desk go")

	print("views_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _place_area(sets: Node, tag: String) -> Area3D:
	return sets._places[tag].region.find_children("*", "Area3D", false, false)[0]


func _view(stage: Node) -> Node:
	for view in stage.get_children():
		if not view.is_queued_for_deletion():
			return view
	return null


func _label(under: Node, text: String) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		if not found.is_queued_for_deletion() and (found as Label3D).text == text:
			return found
	return null


func _label_starting(under: Node, text: String) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		if not found.is_queued_for_deletion() and (found as Label3D).text.begins_with(text):
			return found
	return null


## What the trigger does on the row whose first line reads `text`.
func _pick(under: Node, text: String) -> void:
	var label := _label(under, text)
	if label == null:
		_check(false, "there is a row %s" % text)
		return
	for area in label.get_parent().find_children("*", "Area3D", false, false):
		area.get_meta("pick").call()
		return
	_check(false, "%s can be chosen" % text)


func _frames(count: int) -> void:
	for _i in count:
		await process_frame


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("views_test: does not hold: %s" % what)
