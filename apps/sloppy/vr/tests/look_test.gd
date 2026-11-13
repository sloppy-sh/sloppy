## The look the headset draws in: a served look as colours, Sloppy's own five
## as `app.css` paints them, the contrast a room that is not the look's own
## paper is held to, what this headset chose over the desk, and the desk's
## look worn once it is reached — against a desk `tests/run.sh` starts, named
## by SLOPPY_DESK and SLOPPY_DESK_CODE, which wears Graphite. Exits 1 on a failure.
extends SceneTree

const WAIT := 10.0
const Look := preload("res://look/look.gd")
const Palette := preload("res://field/palette.gd")
const Room := preload("res://room/room.gd")
const APP_CSS := "../../../packages/ts/ui/src/lib/app.css"

var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	_reads_what_css_writes()
	_carries_the_five_as_the_app_paints_them()
	_maps_a_served_palette_over_what_it_is_laid_on()
	_holds_ink_and_hues_to_their_floors_on_a_dark_ground()
	_takes_what_this_headset_chose_over_the_desk()
	await _wears_the_desks_look()
	print("look_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _reads_what_css_writes() -> void:
	_near(Look.parse("oklch(0.61 0.13 25)"), [0.61, 0.13, 25.0], "oklch as written")
	_near(Look.parse("oklch(61% 0.13 25deg / 0.5)"), [0.61, 0.13, 25.0], "oklch in percent, degrees and alpha")
	_check(absf(Look.parse("#ffffff")[0] - 1.0) < 1e-3 and Look.parse("#ffffff")[1] < 1e-3, "white in hex")
	_check(Look.parse("#fff").size() == 3 and Look.parse("#ffff").size() == 3, "short hex, with and without alpha")
	_check(Palette.to_color(Look.parse("#3c3836")).to_html(false) == "3c3836", "hex comes back as the same bytes")
	for unread in ["rgb(1 2 3)", "var(--x)", "#ggg", "", 3]:
		_check(Look.parse(unread).is_empty(), "%s is not read" % [unread])


func _carries_the_five_as_the_app_paints_them() -> void:
	var css := FileAccess.get_file_as_string(ProjectSettings.globalize_path("res://").path_join(APP_CSS))
	_check(css != "", "app.css is beside the headset")
	var tokens := {"paper": "--background", "ink": "--foreground", "card": "--card", "edge": "--border", "pointed": "--secondary"}
	for id in Look.OWN_LOOKS:
		var painted := _painted(css, id)
		for drawn in tokens:
			_near(Look.parse(painted.get(tokens[drawn], "")), Look.OWN[id][drawn], "%s's %s is app.css's %s" % [id, drawn, tokens[drawn]])
		for slot in Palette.SLOTS:
			_near(Look.parse(painted.get("--facet-%d" % (slot + 1), "")), Look.facets_at(Look.OWN[id].facet)[slot], "%s's slot %d" % [id, slot + 1])


func _maps_a_served_palette_over_what_it_is_laid_on() -> void:
	var own := Look.colours(Look.chosen({"name": "Graphite", "based_on": "graphite"}, Look.NOTHING_CHOSEN))
	_check(own.paper == Look.OWN.graphite.paper and own.ink == Look.OWN.graphite.ink, "one of the five is carried by its name")
	var scheme := {
		"name": "Ember", "based_on": "ember",
		"palette": {"--background": "#282828", "--foreground": "#ebdbb2", "--card": "#32302f", "--facet-1": "#fb4934", "--facet-8": "oklch(0.7 0.1 300)", "--border": "not a colour"},
	}
	var drawn := Look.colours(Look.chosen(scheme, Look.NOTHING_CHOSEN))
	_check(Palette.to_color(drawn.paper).to_html(false) == "282828", "the paper is the look's background")
	_check(Palette.to_color(drawn.ink).to_html(false) == "ebdbb2", "the ink is its foreground")
	_check(Palette.to_color(drawn.facets[0]).to_html(false) == "fb4934", "slot 1 is its first facet")
	_near(drawn.facets[7], [0.7, 0.1, 300.0], "slot 8 its eighth")
	_check(drawn.facets[1] == Look.facets_at(Look.OWN.paper.facet)[1], "a slot it leaves out is the one under it")
	_check(drawn.edge == Look.OWN.paper.edge, "and so is a colour it cannot be read as")
	var graph_ends := Look.colours({"palette": {"--background": "#ffffff", "--graph-paper": "#000000"}})
	_check(Palette.to_color(graph_ends.paper).to_html(false) == "000000", "the graph's own paper wins over the page's")
	var palette := Palette.new(drawn.ink, drawn.paper, drawn.facets)
	_check(palette.slot(1).is_equal_approx(Palette.to_color(Palette.shade_to_floor(drawn.facets[0], drawn.paper, 1.0, Palette.MARK_FLOOR))), "the field's slots are the look's, held to the floor")


func _holds_ink_and_hues_to_their_floors_on_a_dark_ground() -> void:
	var looks: Array = []
	for id in Look.OWN_LOOKS:
		looks.append({"name": id, "based_on": id})
	looks.append({"name": "Pale", "palette": {"--background": "#fdf6e3", "--foreground": "#93a1a1", "--facet-3": "#111111"}})
	for look in looks:
		var own := Look.colours(look)
		var ground := Look.on_ground(own)
		_check(ground.paper == Look.OWN.dark.paper, "%s in the dark is on the Dark look's paper" % look.name)
		_check(Palette.contrast(ground.ink, ground.paper) >= Look.INK_FLOOR - 0.05, "%s's ink reads on it: %.2f" % [look.name, Palette.contrast(ground.ink, ground.paper)])
		var palette := Palette.new(ground.ink, ground.paper, ground.facets)
		var paper := Palette.from_color(palette.paper)
		for slot in range(1, Palette.SLOTS + 1):
			var against := Palette.contrast(Palette.from_color(palette.slot(slot)), paper)
			_check(against >= Palette.MARK_FLOOR - 0.05, "%s's slot %d clears the floor in the dark: %.2f" % [look.name, slot, against])
		_check(absf(Palette.from_color(palette.slot(1))[2] - own.facets[0][2]) < 6.0 or own.facets[0][1] < 0.02, "%s keeps its hue" % look.name)
	var paper_look := Look.on_ground(Look.colours({"based_on": "paper"}))
	_check(paper_look.ink[0] > 0.9 and paper_look.ink[2] > 60.0 and paper_look.ink[2] < 100.0, "a light look's ink in the dark is its own warm paper: %s" % [paper_look.ink])
	_check(Look.on_ground(Look.colours({"based_on": "graphite"})).ink == Look.OWN.graphite.ink, "a dark look keeps its own ink")


func _takes_what_this_headset_chose_over_the_desk() -> void:
	var desk := {"name": "Graphite", "based_on": "graphite", "density": "compact", "style": "hardline", "fonts": {"ui": "atkinson", "heading": "system", "mono": "firacode"}}
	var following := Look.chosen(desk, Look.NOTHING_CHOSEN)
	_check(following.based_on == "graphite" and following.density == "compact" and following.style == "hardline", "following, everything is the desk's")
	_check(following.fonts == {"ui": "atkinson", "heading": "atkinson", "mono": "firacode"}, "a heading naming no face reads in the app's: %s" % [following.fonts])
	var own_face := Look.chosen(desk, {"follow": true, "look": "", "face": "opendyslexic", "density": ""})
	_check(own_face.based_on == "graphite" and own_face.density == "compact", "a face chosen here keeps the desk's colours and spacing")
	_check(own_face.fonts.ui == "opendyslexic" and own_face.fonts.heading == "opendyslexic" and own_face.fonts.mono == "firacode", "and is read in, titles too: %s" % [own_face.fonts])
	var own_look := Look.chosen(desk, {"follow": true, "look": "light", "face": "", "density": "comfortable"})
	_check(own_look.based_on == "light" and not own_look.has("palette") and own_look.density == "comfortable" and own_look.fonts.ui == "atkinson", "a look and a density chosen here, the desk's face")
	var alone := Look.chosen(desk, {"follow": false, "look": "", "face": "", "density": ""})
	_check(alone.based_on == Look.FIRST_LOOK and alone.density == "comfortable" and alone.style == "default" and alone.fonts.ui == "system", "not following, nothing of the desk's")
	var alone_chose := Look.chosen(desk, {"follow": false, "look": "dark", "face": "", "density": "compact"})
	_check(alone_chose.based_on == "dark" and alone_chose.density == "compact", "and what was chosen here still stands")
	_check(Look.chosen({}, Look.NOTHING_CHOSEN).based_on == Look.FIRST_LOOK, "a desk sharing no look leaves the headset's first")
	_check(Look.face_file("mono", "system") == "res://fonts/jetbrains-mono.woff2" and Look.face_file("ui", "a face nobody ships") == "res://fonts/inter.woff2", "a role reads in its own face where it names none carried")
	for face in Look.FACE_FILES:
		_check(load(Look.face_file("ui", face)) is Font, "%s is carried" % face)


func _wears_the_desks_look() -> void:
	var ticket := OS.get_environment("SLOPPY_DESK")
	var code := OS.get_environment("SLOPPY_DESK_CODE")
	if ticket == "" or code == "":
		_check(false, "a desk was named")
		return
	var kept := FileAccess.get_file_as_bytes(Room.KEPT) if FileAccess.file_exists(Room.KEPT) else PackedByteArray()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	var client := root.get_node("Client")
	var main: Node3D = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	var room: Node = Room.of(self)
	var dressed := [0]
	room.dressed.connect(func(): dressed[0] += 1)
	client.connect_to(ticket)
	await _until(func(): return client.state in [client.State.OPEN, client.State.UNPAIRED])
	if client.state == client.State.UNPAIRED:
		client.connect_to(ticket, code)
	await _until(func(): return Room.look().get("based_on") == "graphite")
	_check((await client.look()).get("name") == "Graphite", "the desk says what it is wearing")
	_check(Room.look().based_on == "graphite" and Room.look().fonts.ui == "atkinson" and Room.look().density == "compact", "and once reached, it is worn: %s" % [Room.look()])
	_check(dressed[0] >= 1, "and what stands is told to draw again")
	_check(Room.font("ui") == load("res://fonts/atkinson-hyperlegible.woff2"), "the words read in the desk's face")
	_check(Room.paper().is_equal_approx(Palette.to_color(Look.OWN.dark.paper)), "in the dark room, on the dark ground")
	room.choose(Room.Kind.LOOK)
	_check(Room.paper().is_equal_approx(Palette.to_color(Look.OWN.graphite.paper)), "on the look's paper, Graphite's")
	_check(room.environment.background_color.is_equal_approx(Room.paper()), "which is what the room is")
	room.keep("face", "inter")
	_check(Room.font("ui") == load("res://fonts/inter.woff2") and Room.look().based_on == "graphite", "a face chosen here, the desk's colours kept")
	room.keep("follow", false)
	_check(Room.look().based_on == Look.FIRST_LOOK and Room.font("ui") == load("res://fonts/inter.woff2"), "not following, the headset's own")
	main.queue_free()
	await process_frame
	var again: Node3D = load("res://main.tscn").instantiate()
	root.add_child(again)
	await process_frame
	var reopened: Node = Room.of(self)
	_check(reopened.kind == Room.Kind.LOOK and reopened.kept == {"follow": false, "look": "", "face": "inter", "density": "", "sky": "night", "dim": 40, "panels": Room.LOOK_PANELS}, "what was chosen is kept on the headset: %s" % [reopened.kept])
	client.close()
	again.queue_free()
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)


## The tokens app.css paints `id` with, the bare root's for Paper, later blocks over earlier.
func _painted(css: String, id: String) -> Dictionary:
	var painted := {}
	var plain := RegEx.create_from_string("/\\*[\\s\\S]*?\\*/").sub(css, "", true)
	var blocks := RegEx.create_from_string("([^{}]+)\\{([^{}]*)\\}")
	var token := RegEx.create_from_string("(--[a-z0-9-]+)\\s*:\\s*([^;]+);")
	for block in blocks.search_all(plain):
		var selectors := []
		for one in block.get_string(1).split(","):
			selectors.append(one.strip_edges())
		var named := "[data-look='%s']" % id
		if not selectors.any(func(one): return one == ":root" + named or one == ".dark:root" + named):
			continue
		for found in token.search_all(block.get_string(2)):
			painted[found.get_string(1)] = found.get_string(2).strip_edges()
	return painted


func _near(read: Array, meant: Array, what: String, within := 1e-6) -> void:
	var holds := read.size() == 3
	for at in 3:
		holds = holds and absf(float(read[at]) - float(meant[at])) <= within
	_check(holds, "%s: %s against %s" % [what, read, meant])


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("look_test: does not hold: %s" % what)
