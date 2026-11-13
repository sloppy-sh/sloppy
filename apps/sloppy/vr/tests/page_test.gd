## One page of the palette: a title and a quiet line of state, rows one height
## and one gap apart under their headings, each with its glyph, Back last; a
## chosen row filled with ink, a pointed one lifted, a pressed one dipping; a
## slider taking the stick; and the Looks page reaching any one of hundreds of
## schemes in four picks. Exits 1 on a failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const Look := preload("res://look/look.gd")
const Fit := preload("res://tests/fit.gd")

## Loaded once the autoloads they speak to are there.
var Page: GDScript
var Pieces: GDScript

var _failed := 0
var _picked: Array[String] = []
var _value := -1.0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	Page = load("res://ui/page.gd")
	Pieces = load("res://ui/pieces.gd")
	var scene := Node3D.new()
	root.add_child(scene)
	current_scene = scene
	var room := WorldEnvironment.new()
	room.environment = Environment.new()
	room.set_script(Room)
	scene.add_child(room)
	var kept := FileAccess.get_file_as_bytes(Room.KEPT) if FileAccess.file_exists(Room.KEPT) else PackedByteArray()
	for axis in Look.NOTHING_CHOSEN:
		room.keep(axis, Look.NOTHING_CHOSEN[axis])
	await _a_page(scene)
	await _the_looks_page(scene, room)
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)
	print("page_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _a_page(scene: Node3D) -> void:
	var long := "A name far too long to stand on one row of the palette"
	var page: Node3D = Page.new("Room", [
		{"heading": "Light", "rows": [
			Page.choice("Dark", "moon", _pick.bind("dark"), true),
			Page.choice(long, "sun", _pick.bind("long")),
			Page.setting("Steady hands", "a little", "hand", _pick.bind("steady")),
			Page.onward("Skies", "Stars", "sparkles", _pick.bind("skies")),
		]},
		{"heading": "Moving", "rows": [
			Page.slider("Spacing", "unfold-horizontal", 1.0, Vector2(1.0, 2.0), func(value): return "%.1f×" % value, func(value): _value = value),
			Page.buttons([["Inside", _pick.bind("inside"), true], ["Tree", _pick.bind("tree"), false], ["Sets", _pick.bind("sets"), false]]),
			Page.words("Point at a slider and lean this stick to change it."),
		]},
		{"rows": [Page.back(_pick.bind("back"))]},
	], "Now: dark, with nothing but the field.")
	scene.add_child(page)
	await process_frame

	var title: Label3D = _label(page, "Room")
	_check(title != null and title.font_size == Page.TITLE and title.position.y == 0.0, "the page opens with its title")
	var state := _label(page, "Now: dark, with nothing but the field.")
	_check(state != null and state.font_size == Page.QUIET and state.position.y < 0.0, "and one quiet line of state under it")
	_check(_label(page, "Light") != null and _label(page, "Moving") != null, "its rows stand under their headings")

	var rows := _rows(page)
	_check(rows.size() == 9, "every row and button is a card: %d" % rows.size())
	for row in rows:
		_check(is_equal_approx(row.get_meta("height"), Page.ROW), "every row is one height: %s" % Page.words_of(row).text)
	var light := rows.slice(0, 4)
	for at in range(1, light.size()):
		var apart: float = light[at - 1].global_position.y - light[at].global_position.y
		_check(is_equal_approx(apart, Page.ROW + Page.GAP), "rows stand one gap apart: %.4f" % apart)
	var said: Label3D = Page.words_of(light[1])
	_check(said.font_size == Page.LETTERS and said.text.ends_with("…") and long.begins_with(said.text.trim_suffix("…")), "a name too long ends in an ellipsis, at the row's size: %s" % said.text)
	for row in light:
		var glyphs: Array = row.find_children("*", "Sprite3D", false, false)
		_check(not glyphs.is_empty() and glyphs[0].texture != null and glyphs[0].position.x < Page.words_of(row).position.x, "each row has its glyph on its left")
	_check(_label(light[2], "a little") != null, "a setting says what it is set to")
	_check(light[3].find_children("*", "Sprite3D", false, false).size() == 2, "a row to a sub-page carries a way on")
	var last: Node3D = rows.back()
	_check(Page.words_of(last).text == Page.BACK and last.global_position.y <= rows[rows.size() - 2].global_position.y, "Back is the last row")
	for failure in Fit.words_fit(page, "the page"):
		_check(false, failure)

	_check(Fit.chosen(Page.words_of(light[0]), Room.ink()) and Page.words_of(light[0]).modulate.is_equal_approx(Room.paper()), "a chosen row is filled with ink, its words in paper")
	_check(not Fit.chosen(Page.words_of(light[1]), Room.ink()) and Page.words_of(light[1]).modulate.is_equal_approx(Room.ink()), "the rest are not")
	var glyph: Sprite3D = light[0].find_children("*", "Sprite3D", false, false)[0]
	_check(glyph.modulate.is_equal_approx(Room.paper()), "and a chosen row's glyph is in paper")
	var buttons := rows.slice(5, 8)
	_check(Fit.chosen(Page.words_of(buttons[0]), Room.ink()) and not Fit.chosen(Page.words_of(buttons[1]), Room.ink()), "the chosen button is filled too")

	var row: Node3D = light[1]
	var area := _area(row)
	_check(area.has_meta("tick"), "a row ticks in the hand coming onto it")
	area.get_meta("hover").call(true)
	_check(_card(row).is_equal_approx(Room.pointed()), "pointed at, its card is lit")
	await _wait(Pieces.MOVING + 0.1)
	_check(is_equal_approx(row.position.z, Pieces.LIFT), "and it stands nearer the eyes: %.4f" % row.position.z)
	area.get_meta("pick").call()
	await process_frame
	await process_frame
	_check(row.position.z < Pieces.LIFT - 1e-4, "pressed, it dips: %.4f" % row.position.z)
	_check(_picked == ["long"], "and is chosen")
	await _wait(Pieces.MOVING + 0.1)
	_check(is_equal_approx(row.position.z, Pieces.LIFT), "and comes back")
	area.get_meta("hover").call(false)
	await _wait(Pieces.MOVING + 0.1)
	_check(is_zero_approx(row.position.z) and _card(row).is_equal_approx(Room.card()), "left, it stands back in its place")

	var slider: Node3D = rows[4]
	_check(Page.words_of(slider).text == "Spacing  1.0×", "a slider says its value: %s" % Page.words_of(slider).text)
	_area(slider).get_meta("hover").call(true)
	_check(page.holds_stick(), "pointed at, a slider takes the stick")
	_press(KEY_BRACKETRIGHT)
	await process_frame
	_check(is_equal_approx(_value, 1.1) and Page.words_of(slider).text == "Spacing  1.1×", "and moves: %f" % _value)
	_area(slider).get_meta("hover").call(false)
	_check(not page.holds_stick(), "and gives it back")
	page.queue_free()


## Hundreds of schemes either way, each reached from the Looks page with the
## light or dark, the letters, the letters within them, and the scheme itself.
func _the_looks_page(scene: Node3D, room: Node) -> void:
	var LooksPanel: GDScript = load("res://ui/looks_panel.gd")
	var held := FileAccess.get_file_as_bytes(Look.COLLECTION) if FileAccess.file_exists(Look.COLLECTION) else PackedByteArray()
	var names := _names(450)
	var looks: Array = [{"id": "paper", "name": "Paper", "variant": "light", "palette": {}}]
	for variant in ["light", "dark"]:
		for name in names:
			looks.append({"id": "%s-%s" % [variant, name.to_lower()], "name": name, "variant": variant, "palette": {"--background": "#fafafa" if variant == "light" else "#202020", "--foreground": "#202020" if variant == "light" else "#fafafa"}})
	Look.keep_collection(looks)
	var labels: Array = LooksPanel.runs_of(names).map(func(run): return run.label)
	_check(labels.size() == LooksPanel.RUNS and labels[0].begins_with(names[0].left(1)) and labels.back().ends_with(names.back().left(1)), "the letters are cut into runs, first to last: %s" % [labels])
	var panel: Node3D = LooksPanel.new()
	scene.add_child(panel)
	await process_frame
	var most := 0
	var least := 8
	var last := ""
	for at in range(0, names.size(), 7):
		var picks := _reach(panel, "dark", at, "dark-%s" % names[at].to_lower())
		most = maxi(most, picks)
		least = mini(least, picks)
		last = names[at]
	_check(least > 0 and most <= 4, "every scheme is four picks away at most: %d to %d" % [least, most])
	_check(Room.look().name == last and Room.paper().get_luminance() < 0.2, "and the scheme chosen is worn: %s" % Room.look().name)
	await process_frame
	for failure in Fit.words_fit(panel, "the looks page"):
		_check(false, failure)
	panel.queue_free()
	room.keep("look", "")
	if held.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Look.COLLECTION))
	else:
		FileAccess.open(Look.COLLECTION, FileAccess.WRITE).store_buffer(held)
	Look._listed = null


## How many picks from a fresh Looks page choose the `at`th of `variant`'s
## schemes, `id`; 0 where it was not reached.
func _reach(panel: Node3D, variant: String, at: int, id: String) -> int:
	panel._variant = ""
	panel._within = []
	panel.redraw()
	_choose(panel._page.keyed.get(variant))
	var picks := 1
	while picks < 8:
		var page: Node3D = panel._page
		if page.keyed.has(id):
			_choose(page.keyed[id])
			return picks + 1
		var into = null
		for key in page.keyed:
			if key is Array and key[0] <= at and at < key[1] and not page.keyed[key].get_meta("chosen", false):
				into = page.keyed[key]
		if into == null:
			return 0
		_choose(into)
		picks += 1
	return 0


func _choose(row: Node3D) -> void:
	if row != null:
		_area(row).get_meta("pick").call()


## Names as a collection's might be, in the order a desk lists them.
static func _names(count: int) -> Array:
	var made := {}
	var rng := RandomNumberGenerator.new()
	rng.seed = 21
	var sounds := ["ka", "lo", "mi", "ne", "su", "ta", "ri", "vo", "ze", "ba", "do", "gu", "ha", "ju", "py", "we", "xi", "fo", "co", "qua"]
	while made.size() < count:
		var name := ""
		for _i in rng.randi_range(2, 3):
			name += sounds[rng.randi() % sounds.size()]
		made[name.capitalize()] = true
	var names: Array = made.keys()
	names.sort_custom(func(a, b): return a.naturalnocasecmp_to(b) < 0)
	return names


func _pick(what: String) -> void:
	_picked.append(what)


func _rows(under: Node) -> Array:
	var found: Array = []
	for node in under.find_children("*", "Node3D", true, false):
		if node.has_meta("height") and node.find_children("*", "MeshInstance3D", false, false).any(func(piece): return piece.has_meta("card")):
			found.append(node)
	return found


func _card(row: Node3D) -> Color:
	for piece in row.get_children():
		if piece.has_meta("card"):
			return (piece.material_override as StandardMaterial3D).albedo_color
	return Color()


func _area(row: Node3D) -> Area3D:
	for piece in row.get_children():
		if piece is Area3D:
			return piece
	return null


func _label(under: Node, text: String) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		if not found.is_queued_for_deletion() and (found as Label3D).text == text:
			return found
	return null


func _press(key: Key) -> void:
	var event := InputEventKey.new()
	event.keycode = key
	event.pressed = true
	root.push_input(event)


func _wait(seconds: float) -> void:
	var by := Time.get_ticks_msec() + seconds * 1000.0
	while Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("page_test: does not hold: %s" % what)
