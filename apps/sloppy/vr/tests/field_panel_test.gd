## The field panel on the palette: the arrangement, pictures, a slider taking the
## stick, the lines turned off per graph, and all of it kept on the headset.
## Exits 1 on a failure.
extends SceneTree

const Settings := preload("res://field/settings.gd")
const Fit := preload("res://tests/fit.gd")

var HandMenu: GDScript
var FieldPanel: GDScript
var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	HandMenu = load("res://ui/hand_menu.gd")
	FieldPanel = load("res://ui/field_panel.gd")
	var kept := FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	var settings = Settings.shared()
	settings.set_arrangement(Settings.INSIDE)
	settings.set_room(1.0)
	settings.set_pictures(true)

	var scene := Node3D.new()
	root.add_child(scene)
	current_scene = scene
	var camera := Camera3D.new()
	scene.add_child(camera)
	camera.global_position = Vector3(0.0, 1.6, 0.0)
	camera.current = true
	var views := root.get_node("Views")
	views.stage = Node3D.new()
	scene.add_child(views.stage)
	views.show("projects")
	HandMenu.ensure(self)
	await process_frame
	await process_frame
	var menu: Node3D = HandMenu.of(self)
	menu.turn_to(HandMenu.Pane.FIELD)
	await _settle()
	var face: Node3D = menu._faces[HandMenu.Pane.FIELD]
	_check(_choosable(face, "Tree") and not _choosable(menu._faces[HandMenu.Pane.READING], "Graph"), "the field panel is chosen from once it faces the reader")
	_check(_label(face, FieldPanel.TITLE) != null and _label(face, FieldPanel.NOW_INSIDE) != null, "the panel names itself and the arrangement standing")
	_check(_chosen(face, "Inside") and not _chosen(face, "Tree"), "the arrangement standing now is the one chosen")
	_check_words_fit(face, "the field's rows")

	_pick(face, "Tree")
	await process_frame
	_check(settings.arrangement == Settings.TREE, "choosing the tree stands the field before the reader")
	_check(_chosen(face, "Tree") and not _chosen(face, "Inside") and _label(face, FieldPanel.NOW_TREE) != null, "and is the one chosen")
	_pick(face, "Inside")
	await process_frame
	_check(settings.arrangement == Settings.INSIDE, "and inside again")

	_check(_chosen(face, FieldPanel.PICTURES), "pictures are shown, and their row chosen")
	_pick(face, FieldPanel.PICTURES)
	await process_frame
	_check(not settings.pictures and not _chosen(face, FieldPanel.PICTURES), "pictures are hidden")
	_pick(face, FieldPanel.PICTURES)
	await process_frame
	_check(settings.pictures, "and shown again")

	var room := _area(face, "Spacing", true)
	_check(room != null, "there is a slider for the room between marks")
	if room != null:
		room.get_meta("hover").call(true)
		_check(menu._field_panel.holds_stick(), "a slider pointed at takes the stick from the palette")
		_press(KEY_BRACKETRIGHT)
		await process_frame
		_check(is_equal_approx(settings.room, 1.15), "and moves the room between marks: %f" % settings.room)
		room.get_meta("hover").call(false)
		_check(not menu._field_panel.holds_stick(), "and gives it back when no longer pointed at")
	var titles := _area(face, FieldPanel.HOW_MANY, true)
	if titles != null:
		titles.get_meta("hover").call(true)
		for _i in 20:
			_press(KEY_BRACKETLEFT)
		await process_frame
		titles.get_meta("hover").call(false)
		_check(settings.titles == Settings.TITLES.x, "titles go down to none and no further: %d" % settings.titles)
		settings.set_titles(8)

	var rows := [
		{"key": Settings.SPRANG, "count": 3},
		{"key": Settings.BY_HAND, "count": 2},
		{"key": Settings.relation("uses"), "count": 4, "label": "uses"},
		{"key": Settings.relation("long"), "count": 900, "label": "is the reason the whole of this part was written the way it was"},
	]
	settings.offer("desk one", rows)
	await process_frame
	_check(_label(face, FieldPanel.KINDS_SHOWN % [2, 2]) != null, "the lines' row says how many kinds are drawn")
	_pick(face, FieldPanel.DRAWN)
	await process_frame
	_check(_label(face, "Sprang from") != null and _label(face, "3 lines") != null and _label(face, "Drawn by hand") != null and _label(face, "2 lines") != null, "each kind of line is a row, with its count")
	_check(_label(face, "uses") != null and _label(face, "4 lines") != null, "and each relation a hand link names")
	_check(_chosen(face, "Sprang from") and _chosen(face, "uses"), "each chosen while it is drawn")
	_check(_label(face, "is the", true) != null and _label(face, "is the", true).text.ends_with("…") and _label(face, "900 lines") != null, "a relation too long for its row is cut short, its count kept")
	_check_words_fit(face, "the lines' rows")
	_pick(face, "uses")
	await process_frame
	_check(not settings.is_on(Settings.relation("uses")) and _label(face, "4 lines, hidden") != null and not _chosen(face, "uses"), "a relation turned off says so")
	_check_words_fit(face, "the lines' rows with one hidden")
	settings.offer("desk two", rows)
	_check(settings.is_on(Settings.relation("uses")), "another graph has said nothing about it")
	settings.offer("desk one", rows)
	_check(not settings.is_on(Settings.relation("uses")), "the graph it was turned off in keeps it off")
	await process_frame
	_pick(face, "Back")
	await process_frame
	_check(_label(face, "Inside") != null, "back is the field's rows")

	var again = load("res://field/settings.gd").new()
	again._read()
	_check(is_equal_approx(again.room, 1.15) and again.arrangement == Settings.INSIDE and again.pictures, "all of it is kept on the headset")
	again.offer("desk one", rows)
	_check(not again.is_on(Settings.relation("uses")), "the lines too")

	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(kept)
	print("field_panel_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check_words_fit(under: Node, what: String) -> void:
	for failure in Fit.words_fit(under, what):
		_check(false, failure)


func _press(key: Key) -> void:
	var event := InputEventKey.new()
	event.keycode = key
	event.pressed = true
	root.push_input(event)


func _settle() -> void:
	var by: float = Time.get_ticks_msec() + (HandMenu.TURNING + 0.3) * 1000.0
	while Time.get_ticks_msec() < by:
		await process_frame


## The words `text`, or with `leading`, the words that begin with it.
func _label(under: Node, text: String, leading := false) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		var says := (found as Label3D).text
		if not found.is_queued_for_deletion() and (says == text or (leading and says.begins_with(text))):
			return found
	return null


func _area(under: Node, text: String, leading := false) -> Area3D:
	var label := _label(under, text, leading)
	if label == null:
		return null
	for area in label.get_parent().find_children("*", "Area3D", false, false):
		return area
	return null


func _choosable(under: Node, text: String) -> bool:
	var area := _area(under, text)
	return area != null and area.collision_layer != 0


## Whether the row saying `text` is chosen, filled with ink.
func _chosen(under: Node, text: String) -> bool:
	return Fit.chosen(_label(under, text), load("res://ui/pieces.gd").INK)


func _pick(under: Node, text: String) -> void:
	var area := _area(under, text)
	if area == null:
		_check(false, "there is a row %s" % text)
		return
	area.get_meta("pick").call()


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("field_panel_test: does not hold: %s" % what)
