## The palette on the left hand: where its panels stand round the controller,
## which can be chosen from, turning to the next, each panel's title and the
## groups its rows stand in, the room's rows, every row's words inside its card,
## the looks page reaching the desk's schemes, holding still while the other
## hand points at it, and a note held on it, pulled off into the room and put
## back. Against the desk `tests/run.sh` starts (SLOPPY_DESK and
## SLOPPY_DESK_CODE). Exits 1 on a failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const Settings := preload("res://field/settings.gd")
const Dressing := preload("res://ui/theme.gd")
const Look := preload("res://look/look.gd")
const Fit := preload("res://tests/fit.gd")

## Loaded once the autoloads they speak to are there.
var HandMenu: GDScript
var Page: GDScript
var PANEL: PackedScene

var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	HandMenu = load("res://ui/hand_menu.gd")
	Page = load("res://ui/page.gd")
	PANEL = load("res://ui/note_panel.tscn")
	_stands_round_the_controller()
	_faces_only_a_reader_it_turns_to()

	var kept := FileAccess.get_file_as_bytes(Room.KEPT) if FileAccess.file_exists(Room.KEPT) else PackedByteArray()
	var kept_field := FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	var settings = Settings.shared()
	settings.set_steady("off")
	var scene := Node3D.new()
	root.add_child(scene)
	current_scene = scene
	var room := WorldEnvironment.new()
	room.environment = Environment.new()
	room.set_script(Room)
	scene.add_child(room)
	for axis in Room.Look.NOTHING_CHOSEN:
		room.keep(axis, Room.Look.NOTHING_CHOSEN[axis])
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
	_check(menu != null and menu.visible, "the palette stands while a project is read")
	menu.toggle()
	_check(not menu.visible and not menu.takes_stick(), "put away, it is gone and the stick is the reader's")
	_press_key(KEY_M)
	await process_frame
	_check(menu.visible, "and comes back")

	_check(menu.showing == HandMenu.Pane.READING, "it opens on reading")
	_check(_choosable(menu, HandMenu.PROJECTS) and not _choosable(menu, "Bring it back"), "only the panel facing the reader is chosen from")
	_check(Fit.chosen(_label(menu, HandMenu.PROJECTS), Room.ink()), "the reading in front is the one chosen")
	var titles := [HandMenu.HERE, HandMenu.ROOM_TITLE, HandMenu.NOTE_TITLE, HandMenu.LOOK_TITLE, load("res://ui/field_panel.gd").TITLE, HandMenu.CHAT_TITLE]
	for pane in HandMenu.PANELS:
		_check(_label(menu._faces[pane], titles[pane]) != null, "the %s panel opens with its title" % titles[pane])
	var here: Node3D = menu._faces[HandMenu.Pane.READING]
	_check(_label(here, "Read") == null and _label(here, "Field") == null and _label(here, "Sets") == null, "the arrangements are the field panel's alone, not here")
	_check(_label(here, HandMenu.LEAVE) == null, "and with no project in hand there is none to leave")
	for heading in [[HandMenu.Pane.READING, HandMenu.DESK], [HandMenu.Pane.ROOM, HandMenu.LIGHT], [HandMenu.Pane.ROOM, HandMenu.MOVING], [HandMenu.Pane.LOOK, HandMenu.FOLLOWING], [HandMenu.Pane.LOOK, HandMenu.COLOURS_AND_TYPE], [HandMenu.Pane.LOOK, HandMenu.PANELS_HEADING], [HandMenu.Pane.CHAT, HandMenu.THREADS]]:
		_check(_label(menu._faces[heading[0]], heading[1]) != null, "rows stand under %s" % heading[1])
	_check(_label(menu._faces[HandMenu.Pane.ROOM], HandMenu.VANTAGE) != null, "the vantage is the room's, with where the reader stands")
	_press_tab(false)
	await _settle()
	_check(menu.showing == HandMenu.Pane.ROOM, "turning goes to the room")
	_check(is_equal_approx(menu._angle, HandMenu.turned_to(HandMenu.Pane.ROOM)), "and is turned there in a moment")
	_check(_choosable(menu, "Bring it back") and not _choosable(menu, "Graph"), "the room's rows are chosen from once it faces the reader")
	_press_tab(true)
	await _settle()
	_check(menu.showing == HandMenu.Pane.READING, "turning the other way comes back")

	_pick(menu, HandMenu.SURROUNDINGS)
	await process_frame
	_check(room.kind == Room.Kind.SURROUNDINGS, "choosing the surroundings is kept")
	_check(_label(menu, HandMenu.CANNOT_SHOW) != null, "and says where the headset cannot show them")
	_pick(menu, HandMenu.ON_THE_LOOK)
	await process_frame
	_check(room.kind == Room.Kind.LOOK and _label(menu, HandMenu.NOW_ON_THE_LOOK) != null, "the look's own paper is chosen, and said")
	_check(Fit.chosen(_label(menu, HandMenu.ON_THE_LOOK), Room.ink()) and not Fit.chosen(_label(menu, HandMenu.DARK), Room.ink()), "and its row is the one filled")
	_check(room.environment.background_color.is_equal_approx(Room.paper()) and Room.paper().get_luminance() > 0.8, "a light look's room is its light paper")
	_pick(menu, HandMenu.DARK)
	await process_frame
	_check(room.kind == Room.Kind.DARK and _label(menu, HandMenu.NOW_DARK) != null, "dark is chosen back")

	_check(_label(menu, HandMenu.STEADY_SAID.off) != null, "the steadying row says what it is set to")
	_pick(menu, HandMenu.STEADY)
	await process_frame
	_check(settings.steady == "some" and settings.steadying() > 0.0 and _label(menu, HandMenu.STEADY_SAID.some) != null, "a shaking hand is steadied a little")
	_check_words_fit(menu._faces[HandMenu.Pane.ROOM], "the room's rows, steadied a little")
	_pick(menu, HandMenu.STEADY)
	await process_frame
	_check(settings.steady == "most" and settings.steadying() > Settings.STEADY.some, "then a lot")
	_pick(menu, HandMenu.STEADY)
	await process_frame
	_check(settings.steady == "off" and settings.steadying() == 0.0 and _label(menu, HandMenu.STEADY_SAID.off) != null, "then not at all, round again")
	_check_words_fit(menu._faces[HandMenu.Pane.ROOM], "the room's rows")
	_check_words_fit(menu._faces[HandMenu.Pane.READING], "the reading's rows")
	await _the_skies_page(menu, room)

	var look_panel: Node3D = menu._faces[HandMenu.Pane.LOOK]
	_check(Fit.chosen(_label(look_panel, HandMenu.FOLLOW), Room.ink()) and _label(look_panel, HandMenu.THE_DESKS) != null, "the look panel follows the desk, choosing nothing over it")
	_pick(look_panel, HandMenu.LOOK)
	await process_frame
	var Looks: GDScript = load("res://ui/looks_panel.gd")
	_check(_label(look_panel, Looks.TITLE) != null and Fit.chosen(_label(look_panel, Looks.THE_DESKS), Room.ink()), "the look row opens the looks, the desk's chosen")
	_pick(look_panel, "Paper")
	await process_frame
	_check(room.kept.look == "paper" and Fit.chosen(_label(look_panel, "Paper"), Room.ink()), "a look is chosen over the desk's")
	_pick(look_panel, Page.BACK)
	await process_frame
	_check(_label(look_panel, "Paper") != null and _label(look_panel, HandMenu.FACE) != null, "and is said on the look panel")
	_pick(look_panel, HandMenu.FACE)
	await process_frame
	_check(room.kept.face == "inter" and Room.font("ui") == load("res://fonts/inter.woff2"), "so is a face, and read in")
	_pick(look_panel, HandMenu.FOLLOW)
	await process_frame
	_check(not room.kept.follow and not Fit.chosen(_label(look_panel, HandMenu.FOLLOW), Room.ink()), "following the desk is turned off")
	_check(_label(look_panel, "Comfortable") != null, "and what was not chosen is the headset's own")
	_pick(look_panel, HandMenu.DENSITY)
	await process_frame
	_check(room.kept.density == "compact", "where its own first is not offered twice")
	_check_words_fit(look_panel, "the look's rows")

	_check(_label(look_panel, HandMenu.THE_LOOKS) != null, "the panels wear the look's own")
	_check(Dressing.held() == Dressing.PACKS.keys(), "every pack is on this headset: %s" % [Dressing.held()])
	var shown: String = HandMenu.THE_LOOKS
	for pack in Dressing.held():
		_pick(look_panel, HandMenu.PANELS_ROW)
		await process_frame
		shown = Dressing.PACKS[pack].named
		_check(room.kept.panels == pack and Room.panels() == pack and _label(look_panel, shown) != null, "the panels are dressed in %s next, and it is said" % shown)
		_check_words_fit(menu._faces[HandMenu.Pane.LOOK], "the look's rows, the panels in %s" % shown)
	var file := ConfigFile.new()
	file.load(Room.KEPT)
	_check(file.get_value("look", "panels", "") == Dressing.PACKS.keys().back(), "the pack chosen is kept on the headset")
	_pick(look_panel, HandMenu.PANELS_ROW)
	await process_frame
	_check(room.kept.panels == Room.LOOK_PANELS and _label(look_panel, HandMenu.THE_LOOKS) != null, "and round again to the look's own")
	for axis in ["look", "face", "density"]:
		room.keep(axis, "")
	room.keep("follow", true)
	await process_frame
	await _the_looks_page(menu, room)

	views.stage.global_transform = Transform3D(Basis(), Vector3(4.0, 0.0, 4.0))
	camera.global_transform = Transform3D(Basis(Vector3.UP, 1.0), Vector3(1.0, 1.1, 0.5))
	_pick(menu, HandMenu.BRING_BACK)
	var laid: Vector3 = views.stage.global_transform * Vector3(0.0, 1.6, -1.0)
	_check(is_equal_approx(laid.y, 1.1), "bringing it back puts a view at the reader's eyes, seated: %s" % laid)
	_check((laid - camera.global_position).normalized().dot(-camera.global_basis.z) > 0.99, "and ahead of them")

	var note: Node3D = PANEL.instantiate()
	menu.toggle()
	menu.hold(note)
	await process_frame
	_check(menu.visible, "a note opened brings the palette up")
	_check(note.get_parent() == menu._faces[HandMenu.Pane.NOTE], "a note opened is held on the palette")
	_check(menu.showing == HandMenu.Pane.NOTE, "and its panel turned to the reader")
	_check(is_equal_approx(note.global_basis.get_scale().x, HandMenu.NOTE_ON_PALETTE), "at the palette's size")
	_check(_label(menu, HandMenu.EMPTY_NOTE) == null, "with nothing said in its place")

	var hand := XRController3D.new()
	scene.add_child(hand)
	hand.global_position = note.global_position + Vector3(0.0, 0.0, 0.3)
	var pointer := _pointer(hand)
	var resting: Vector3 = note.global_position
	note.take(pointer)
	_check(menu.note_floating and note.get_parent() == scene, "the grip pulls it off into the room")
	_check(is_equal_approx(note.global_basis.get_scale().x, 1.0), "at its own size")
	_check(note.global_position.is_equal_approx(resting), "from where it was")
	hand.global_position += Vector3(0.6, 0.2, -0.4)
	await process_frame
	_check(note.global_position.is_equal_approx(resting + Vector3(0.6, 0.2, -0.4)), "it goes where the hand takes it")
	note.let_go(pointer)
	var left_at: Transform3D = note.global_transform
	hand.global_position += Vector3(0.3, 0.0, 0.0)
	await process_frame
	_check(menu.note_floating and note.global_transform.is_equal_approx(left_at), "let go away from the palette, it stays where it was left")
	_check(_label(menu, HandMenu.EMPTY_NOTE) != null, "and the palette says how to read one there")

	var next: Node3D = PANEL.instantiate()
	menu.hold(next)
	note.close()
	await process_frame
	_check(menu.note == next and menu.note_floating, "a note opened while one is in the room takes its place")
	_check(next.global_transform.is_equal_approx(left_at), "where the reader left it")

	hand.global_position = next.global_position
	next.take(pointer)
	hand.global_position += menu.note_rest().origin - next.global_position + Vector3(0.0, 0.03, 0.0)
	await process_frame
	next.let_go(pointer)
	_check(not menu.note_floating and next.get_parent() == menu._faces[HandMenu.Pane.NOTE], "let go by the palette, it goes back on it")
	_check(next.transform.is_equal_approx(menu._note_on_face()), "where a note rests on it")
	next.close()
	await process_frame
	_check(menu.note == null and _label(menu, HandMenu.EMPTY_NOTE) != null, "a note closed leaves the palette's place for one")

	await _leaving_a_project(menu, views, camera)
	await _holds_still(menu, scene)
	pointer.free()
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)
	if kept_field.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(kept_field)
	print("hand_menu_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check_words_fit(under: Node, what: String) -> void:
	for failure in Fit.words_fit(under, what):
		_check(false, failure)


## Leave project closes the note and stands the desk's projects before the
## reader, the project forgotten.
func _leaving_a_project(menu: Node3D, views: Node, camera: Camera3D) -> void:
	HandMenu.project = "garden"
	HandMenu.project_name = "Garden"
	menu._draw_reading()
	await process_frame
	var here: Node3D = menu._faces[HandMenu.Pane.READING]
	var rows: Array = here.find_children("*", "Label3D", true, false).filter(func(said): return not said.is_queued_for_deletion()).map(func(said): return said.text)
	var leave_at := rows.find(HandMenu.LEAVE)
	_check(leave_at > rows.find(HandMenu.PROJECTS) and leave_at < rows.find(HandMenu.DISCONNECT), "reading a project, Leave project stands between Projects and Disconnect: %s" % [rows])
	var note: Node3D = PANEL.instantiate()
	menu.hold(note)
	await process_frame
	views.stage.global_transform = Transform3D(Basis(), Vector3(3.0, 0.0, -2.0))
	_pick(here, HandMenu.LEAVE)
	await process_frame
	_check(HandMenu.project == "" and HandMenu.project_name == "", "leaving forgets the project")
	_check(menu.note == null and (not is_instance_valid(note) or note.is_queued_for_deletion()), "and closes its note")
	_check(views.current() == "projects", "and the desk's projects are listed")
	_check(views.stage.global_transform.is_equal_approx(load("res://interaction/reach.gd").stage_before(camera.global_transform)), "before the reader, wherever they are")
	_check(_label(menu._faces[HandMenu.Pane.READING], HandMenu.LEAVE) == null, "with no project left to leave")


## Under the night, the room panel names its sky and turns to the Skies page: a
## row for each sky with its picture, the one drawn edged in ink, and choosing
## another hangs the field in it, dimmed, and credits who made it.
func _the_skies_page(menu: Node3D, room: Node) -> void:
	const Skies := preload("res://room/skies.gd")
	var SkiesPanelWords: GDScript = load("res://ui/skies_panel.gd")
	Skies.dir = "user://skies-menu-test"
	var picture := Image.create(4, 4, false, Image.FORMAT_RGB8)
	picture.fill(Color(0.4, 0.4, 0.8))
	var panorama := Image.create(16, 8, false, Image.FORMAT_RGBF)
	panorama.fill(Color(0.02, 0.03, 0.08))
	var files := {"hdri": {"1k": {"exr": {"url": "https://files.example/quiet_meadow_night_1k.exr"}}}}
	var answers := {
		Skies.CATALOGUE_URL: FileAccess.get_file_as_bytes("res://tests/skies/hdris.json"),
		Skies.FILES_URL % "quiet_meadow_night": JSON.stringify(files).to_utf8_buffer(),
		"https://files.example/quiet_meadow_night_1k.exr": panorama.save_exr_to_buffer(),
	}
	room.skies.fetcher = func(url: String, _progress: Callable) -> PackedByteArray:
		await process_frame
		return answers.get(url, picture.save_png_to_buffer() if url.begins_with("https://cdn.example/") else PackedByteArray())
	var panel: Node3D = menu._faces[HandMenu.Pane.ROOM]
	_check(_label(panel, HandMenu.SKIES) == null, "the Skies row is the night's alone")
	_pick(menu, HandMenu.NIGHT)
	await process_frame
	_check(_label(panel, Skies.STARS) != null and Fit.chosen(_label(panel, HandMenu.NIGHT), Room.ink()), "under the night, the room panel names its sky")
	_pick(panel, HandMenu.SKIES)
	await _wait(0.3)
	var stars := _label(panel, Skies.STARS)
	_check(stars != null and Fit.chosen(stars, Room.ink()), "the Skies page lists the stars, chosen while they are the sky")
	var meadow := _sky_row(menu, "polyhaven:quiet_meadow_night")
	_check(meadow != null and not _chosen_row(meadow), "and the published skies beside them")
	_check(meadow != null and meadow.find_children("*", "Sprite3D", false, false).any(func(shown): return shown.visible and shown.texture != null), "each with its small picture")
	_check(_label(panel, SkiesPanelWords.YOUR_SKIES) != null, "and the person's own under their heading")
	_check_words_fit(panel, "the Skies page")
	if meadow != null:
		meadow.find_children("*", "Area3D", false, false)[0].get_meta("pick").call()
	await _wait(Room.SKY_FADE + 0.3)
	_check(room.kept.sky == "polyhaven:quiet_meadow_night" and room.environment.sky.sky_material is PanoramaSkyMaterial, "choosing a published sky fetches it and hangs the field in it")
	meadow = _sky_row(menu, "polyhaven:quiet_meadow_night")
	stars = _label(panel, Skies.STARS)
	_check(meadow != null and _chosen_row(meadow) and not Fit.chosen(stars, Room.ink()), "and it is the one chosen now")
	_check(_label(panel, Skies.CREDIT % "A. Walker") != null, "credited to who made it")
	_check(_label(panel, SkiesPanelWords.SHARPER) != null and _label(panel, "%s  %d%%" % [SkiesPanelWords.DIM, 40]) != null, "with Sharper and how dim it is drawn")
	_check_words_fit(panel, "the Skies page, a sky chosen")
	await _saving_and_paging_skies(menu, room, panel, SkiesPanelWords)
	_pick(panel, Page.BACK)
	await process_frame
	var named := _label(panel, HandMenu.SKIES)
	var told: Array = named.get_parent().find_children("*", "Label3D", false, false).map(func(said): return said.text) if named != null else []
	_check(told.size() == 2 and "Quiet Meadow Night".begins_with(told[1].trim_suffix("…")), "back on the room's rows, the sky is named: %s" % [told])
	room.choose_sky(Skies.NIGHT)
	room.choose(Room.Kind.DARK)
	await process_frame
	_clear(Skies.dir)
	Skies.dir = "user://skies"


## A chosen published sky is saved, standing first under Saved, and unsaved;
## the published skies page both ways and say where they are.
func _saving_and_paging_skies(menu: Node3D, room: Node, panel: Node3D, Words: GDScript) -> void:
	const Skies := preload("res://room/skies.gd")
	_check(_label(panel, Words.SAVED) == null and _label(panel, Words.UNSAVE) == null, "nothing is saved before the reader saves it")
	_pick(panel, Words.SAVE)
	await process_frame
	var meadow := _sky_row(menu, "polyhaven:quiet_meadow_night")
	var saved := _label(panel, Words.SAVED)
	var published := _label(panel, Words.PUBLISHED)
	_check(room.is_saved("polyhaven:quiet_meadow_night") and _label(panel, Words.UNSAVE) != null, "the chosen sky is saved, and can be unsaved")
	var down := func(piece: Node3D) -> float: return (panel.global_transform.affine_inverse() * piece.global_position).y if piece != null else 0.0
	_check(saved != null and published != null and meadow != null and down.call(saved) > down.call(meadow) and down.call(meadow) > down.call(published), "it stands first, under Saved")
	_check_words_fit(panel, "the Skies page, a sky saved")
	_pick(panel, Words.UNSAVE)
	await process_frame
	_check(not room.is_saved("polyhaven:quiet_meadow_night") and _label(panel, Words.SAVED) == null and _label(panel, Words.SAVE) != null, "unsaved, it goes back among the published")

	var looks: Node3D = menu._skies_panel
	var many: Array = [Skies.night()]
	for at in 9:
		many.append(Skies.Choice.published({"id": "sky_%d" % at, "name": "Sky %d" % at}))
	looks._skies = many
	looks._from = 0
	looks._redraw()
	await process_frame
	_check(_label(panel, Words.WHERE % [1, 4, 9]) != null and _label(panel, Words.MORE) != null and _label(panel, Words.PREVIOUS) == null, "the first page says where it is, with more after it and none before")
	_check_words_fit(panel, "the Skies page, paged")
	_pick(panel, Words.MORE)
	await process_frame
	_check(_label(panel, Words.WHERE % [5, 8, 9]) != null and _label(panel, Words.PREVIOUS) != null and _label(panel, Words.MORE) != null, "More skies turns to the next, and Previous skies is offered")
	_pick(panel, Words.MORE)
	await process_frame
	_check(_label(panel, Words.WHERE % [9, 9, 9]) != null and _label(panel, Words.MORE) == null and _label(panel, "Sky 8") != null, "the last page has no more after it, and does not go round")
	_pick(panel, Words.PREVIOUS)
	await process_frame
	_check(_label(panel, Words.WHERE % [5, 8, 9]) != null and _label(panel, "Sky 4") != null, "Previous skies turns back")
	looks.refresh()
	await _wait(0.3)


## Against the test desk's five canned looks: the collection kept once a desk
## is reached, the page offering Sloppy's own and the light and dark schemes, a
## scheme reached in four picks or fewer, and painted as the desk paints it.
func _the_looks_page(menu: Node3D, room: Node) -> void:
	var ticket := OS.get_environment("SLOPPY_DESK")
	var code := OS.get_environment("SLOPPY_DESK_CODE")
	if ticket == "" or code == "":
		_check(false, "a desk was named")
		return
	var Looks: GDScript = load("res://ui/looks_panel.gd")
	var held := FileAccess.get_file_as_bytes(Look.COLLECTION) if FileAccess.file_exists(Look.COLLECTION) else PackedByteArray()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Look.COLLECTION))
	Look._listed = null
	var panel: Node3D = menu._faces[HandMenu.Pane.LOOK]
	_pick(panel, HandMenu.LOOK)
	await process_frame
	_check(_label(panel, Looks.WITH_A_DESK) != null and _label(panel, "Graphite") != null, "before a desk is reached, Sloppy's five, and the rest said to come with one")

	var client := root.get_node("Client")
	client.connect_to(ticket)
	await _until(func(): return client.state in [client.State.OPEN, client.State.UNPAIRED])
	if client.state == client.State.UNPAIRED:
		client.connect_to(ticket, code)
	await _until(func(): return not Look.collection().is_empty())
	_check(Look.collection().size() == 5 and FileAccess.file_exists(Look.COLLECTION), "once a desk is reached, its looks are kept on the headset")
	_pick(panel, Page.BACK)
	await process_frame
	_pick(panel, HandMenu.LOOK)
	await process_frame
	var looks: Node3D = menu._looks_panel
	_choose(looks._page.keyed.get("light"))
	await process_frame
	var picks := 1
	_check(_label(panel, "Cupertino") != null and _label(panel, "One Light") != null and _label(panel, "Nord") == null, "light, the light schemes are listed")
	_check(_label(panel, "Graphite") == null, "and Sloppy's own stand aside for them")
	var cupertino := _label(panel, "Cupertino")
	var swatch: Array = cupertino.get_parent().get_children().filter(func(piece): return piece.has_meta("swatch")) if cupertino != null else []
	_check(swatch.size() == 2 and _near((swatch[0].material_override as StandardMaterial3D).albedo_color, Color("#ffffff")), "each beside a swatch of its paper and ink")
	_check_words_fit(panel, "the looks page")
	_pick(panel, "Cupertino")
	picks += 1
	await process_frame
	_check(picks <= 4 and room.kept.look == "base16-cupertino" and Fit.chosen(_label(panel, "Cupertino"), Room.ink()), "a scheme is chosen in four picks or fewer: %d" % picks)
	room.choose(Room.Kind.LOOK)
	_check(Room.look().name == "Cupertino" and _near(Room.paper(), Color("#ffffff")) and _near(Room.ink(), Color("#404040")), "and painted on the headset as the desk paints it")
	var file := ConfigFile.new()
	file.load(Room.KEPT)
	_check(file.get_value("look", "look", "") == "base16-cupertino", "and kept there")
	_pick(panel, Looks.THE_DESKS)
	await process_frame
	_check(room.kept.look == "" and Room.look().name == "Graphite", "the desk's is one pick away")
	_pick(panel, Page.BACK)
	room.choose(Room.Kind.DARK)
	client.close()
	await process_frame
	if held.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Look.COLLECTION))
	else:
		FileAccess.open(Look.COLLECTION, FileAccess.WRITE).store_buffer(held)
	Look._listed = null


## The palette stands where it is in the room while the other hand's ray is near
## it, and once the ray has been away a moment it comes back under the hand.
func _holds_still(menu: Node3D, scene: Node3D) -> void:
	var left := XRController3D.new()
	left.tracker = &"left_hand"
	scene.add_child(left)
	var right := XRController3D.new()
	right.tracker = &"right_hand"
	scene.add_child(right)
	left.global_position = Vector3(-0.2, 1.2, -0.4)
	root.get_viewport().get_camera_3d().global_transform = Transform3D(Basis(), Vector3(0.0, 1.6, 0.0))
	var was: Node = menu.get_parent()
	var rest: Transform3D = menu._rest
	menu.reparent(left, false)
	menu.transform = Transform3D()
	menu._rest = Transform3D()
	menu.turn_to(HandMenu.Pane.READING)
	await _settle()
	var panel: Node3D = menu._faces[HandMenu.Pane.READING]
	var laid: Rect2 = panel.get_meta("laid")
	var middle: Vector3 = panel.global_transform * Vector3(laid.get_center().x, laid.get_center().y, 0.0)
	right.look_at_from_position(middle + panel.global_basis.z * 0.3, middle, Vector3.FORWARD)
	_check(HandMenu.ray_gap(panel.global_transform, laid, right.global_position, -right.global_basis.z) < 1e-4, "a ray at a panel's middle meets it")
	await process_frame
	await process_frame
	var stood: Transform3D = menu.global_transform
	left.global_position += Vector3(0.2, 0.0, 0.1)
	await process_frame
	await process_frame
	_check(menu.global_transform.is_equal_approx(stood), "pointed at, the palette holds still in the room as the hand moves")
	var edge: Vector3 = panel.global_transform * Vector3(laid.end.x + HandMenu.HOLD_WITHIN * 0.5, laid.get_center().y, 0.0)
	right.look_at_from_position(edge + panel.global_basis.z * 0.3, edge, Vector3.FORWARD)
	await _wait(HandMenu.LET_GO_AFTER + 0.1)
	_check(menu.global_transform.is_equal_approx(stood), "and while the ray is just beside it")
	right.look_at_from_position(right.global_position, right.global_position + Vector3.RIGHT)
	await _wait(HandMenu.LET_GO_AFTER * 0.5)
	_check(menu.global_transform.is_equal_approx(stood), "a moment after the ray has left, still")
	await _wait(HandMenu.LET_GO_AFTER + HandMenu.FOLLOW_AGAIN + 0.2)
	_check(menu.global_transform.is_equal_approx(left.global_transform) and not menu.top_level, "then it comes back under the hand")
	menu.reparent(was, false)
	menu.transform = rest
	menu._rest = rest
	left.queue_free()
	right.queue_free()


func _choose(row: Node3D) -> void:
	if row == null:
		_check(false, "there is a row to choose")
		return
	for area in row.find_children("*", "Area3D", false, false):
		area.get_meta("pick").call()


func _near(a: Color, b: Color) -> bool:
	return absf(a.r - b.r) < 0.01 and absf(a.g - b.g) < 0.01 and absf(a.b - b.b) < 0.01


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + 10000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _sky_row(menu: Node3D, key: String) -> Node3D:
	var held: Array = menu._skies_panel._rows.get(key, [])
	return held[0] if not held.is_empty() and is_instance_valid(held[0]) and not held[0].is_queued_for_deletion() else null


func _chosen_row(row: Node) -> bool:
	return row != null and Fit.chosen(load("res://ui/page.gd").words_of(row), Room.ink())


func _wait(seconds: float) -> void:
	var by := Time.get_ticks_msec() + seconds * 1000.0
	while Time.get_ticks_msec() < by:
		await process_frame


func _clear(path: String) -> void:
	if not DirAccess.dir_exists_absolute(path):
		return
	for dir in DirAccess.get_directories_at(path):
		_clear(path.path_join(dir))
	for file in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(file))
	DirAccess.remove_absolute(path)


func _stands_round_the_controller() -> void:
	for at in HandMenu.PANELS:
		var turned: float = HandMenu.turned_to(at)
		var placed: Transform3D = HandMenu.face(at, turned)
		_check(placed.basis.z.is_equal_approx(Vector3.UP), "panel %d turned to faces up off the controller" % at)
		_check(placed.basis.y.is_equal_approx(Vector3.FORWARD), "its top is forward along the controller")
		_check(is_equal_approx(Vector2(placed.origin.x, placed.origin.y).length(), HandMenu.RADIUS), "it stands RADIUS off the controller's line")
		_check(placed.origin.z < 0.0, "and ahead of the hand")
		for other in HandMenu.PANELS:
			if other != at:
				var beside: Transform3D = HandMenu.face(other, turned)
				var steps := mini(absi(other - at), HandMenu.PANELS - absi(other - at))
				_check(is_equal_approx(placed.basis.z.angle_to(beside.basis.z), steps * TAU / HandMenu.PANELS), "panels %d and %d stand evenly round the controller" % [at, other])
	_check(HandMenu.RADIUS * tan(PI / HandMenu.PANELS) >= HandMenu.WIDTH / 2.0, "no panel's edge runs into the next one's")


func _faces_only_a_reader_it_turns_to() -> void:
	var placed := Transform3D(Basis(Vector3.RIGHT, Vector3.FORWARD, Vector3.UP), Vector3.ZERO)
	_check(HandMenu.faces_eye(placed, Vector3(0.0, 0.5, 0.1)), "a reader above it is faced")
	var off := deg_to_rad(HandMenu.FACING_AT_MOST + 5.0)
	_check(not HandMenu.faces_eye(placed, Vector3(sin(off), cos(off), 0.0)), "one past the facing angle is not")
	_check(not HandMenu.faces_eye(placed, Vector3(0.0, -0.5, 0.0)), "nor one below it")


func _press_tab(back: bool) -> void:
	var key := InputEventKey.new()
	key.keycode = KEY_TAB
	key.pressed = true
	key.shift_pressed = back
	root.push_input(key)


func _press_key(keycode: Key) -> void:
	var key := InputEventKey.new()
	key.keycode = keycode
	key.pressed = true
	root.push_input(key)


func _settle() -> void:
	var by: float = Time.get_ticks_msec() + (HandMenu.TURNING + 0.3) * 1000.0
	while Time.get_ticks_msec() < by:
		await process_frame


## A pointer on `hand`, as the grip would carry with it.
func _pointer(hand: XRController3D) -> Node3D:
	var source := GDScript.new()
	source.source_code = "extends Node3D\nvar hand: XRController3D\n"
	source.reload()
	var pointer := Node3D.new()
	pointer.set_script(source)
	pointer.hand = hand
	return pointer


func _label(under: Node, text: String) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		if not found.is_queued_for_deletion() and (found as Label3D).text == text:
			return found
	return null


func _choosable(menu: Node, text: String) -> bool:
	var label := _label(menu, text)
	if label == null:
		return false
	for area in label.get_parent().find_children("*", "Area3D", false, false):
		return (area as Area3D).collision_layer != 0
	return false


func _pick(under: Node, text: String) -> void:
	for found in under.find_children("*", "Label3D", true, false):
		if found.is_queued_for_deletion() or (found as Label3D).text != text:
			continue
		for area in found.get_parent().find_children("*", "Area3D", false, false):
			area.get_meta("pick").call()
			return
	_check(false, "there is a row %s to choose" % text)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("hand_menu_test: does not hold: %s" % what)
