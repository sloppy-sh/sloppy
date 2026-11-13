## The room: which one is kept on the headset, what is behind the field in
## each, the night sky and its drift, the palette's row for it, and the
## field's colours clearing their floors on the room's paper. Exits 1 on a
## failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const Palette := preload("res://field/palette.gd")
const Look := preload("res://look/look.gd")

var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	var kept := FileAccess.get_file_as_bytes(Room.KEPT) if FileAccess.file_exists(Room.KEPT) else PackedByteArray()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))

	var room := _room()
	_check(room.kind == Room.Kind.DARK, "a headset that has chosen nothing is in the dark")
	_check(room.environment.background_color.is_equal_approx(Room.paper()), "the dark is the room's paper, opaque")
	_check(not room.can_show_surroundings(), "nothing here can show the surroundings")
	var told: Array = []
	room.changed.connect(func(kind): told.append(kind))
	room.choose(Room.Kind.SURROUNDINGS)
	_check(told == [Room.Kind.SURROUNDINGS], "choosing says so")
	_check(room.kind == Room.Kind.SURROUNDINGS and not room.showing_surroundings(), "a headset that cannot show them keeps the choice and stays dark")
	_check(not room.get_viewport().transparent_bg, "and draws nothing through")
	room.queue_free()
	await process_frame

	var again := _room()
	_check(again.kind == Room.Kind.SURROUNDINGS, "the choice is kept on the headset")
	again.choose(Room.Kind.DARK)
	again.queue_free()
	await process_frame
	var dark := _room()
	_check(dark.kind == Room.Kind.DARK, "and so is the dark")
	dark.choose(Room.Kind.LOOK)
	_check(dark.environment.background_color.is_equal_approx(Palette.to_color(Look.OWN[Look.FIRST_LOOK].paper)), "the look's own room is its paper")
	_reads_on_its_paper(Room.palette())
	dark.choose(Room.Kind.DARK)
	var in_the_dark := [Room.ink(), Room.paper()]
	dark.queue_free()
	await process_frame

	var night := _room()
	night.choose(Room.Kind.NIGHT)
	_check(night.environment.background_mode == Environment.BG_SKY, "the night is a sky")
	var sky: ShaderMaterial = night.environment.sky.sky_material if night.environment.sky != null else null
	_check(sky != null and sky.shader == Room.NIGHT_SKY, "drawn by the night's own shader")
	_check(sky != null and (sky.get_shader_parameter("paper") as Color).is_equal_approx(Room.paper()), "on the room's paper")
	_check(Room.ink() == in_the_dark[0] and Room.paper() == in_the_dark[1], "the field's ink and paper are the dark room's")
	_check(not night.get_viewport().transparent_bg, "nothing is drawn through it")
	_reads_on_its_paper(Room.palette())
	var started: float = night.environment.sky_rotation.y
	var by := Time.get_ticks_msec() + 500
	while Time.get_ticks_msec() < by:
		await process_frame
	var drifted: float = night.environment.sky_rotation.y - started
	_check(drifted > 0.0 and drifted < TAU / Room.NIGHT_TURN * 2.0, "it drifts, a turn an hour: %f in half a second" % drifted)
	night.veil(0.5, 1.5)
	_check(night.environment.fog_sky_affect > 0.99, "veiled, the stars are hidden with the rest")
	night.veil(0.5, 15.0)
	_check(night.environment.fog_sky_affect < 0.2, "and come out as the veil falls back")
	night.unveil()
	night.queue_free()
	await process_frame
	var kept_night := _room()
	_check(kept_night.kind == Room.Kind.NIGHT and kept_night.environment.background_mode == Environment.BG_SKY, "the night is kept on the headset")
	kept_night.choose(Room.Kind.DARK)
	_check(kept_night.environment.background_mode == Environment.BG_COLOR and kept_night.environment.sky == null, "and the dark has no sky")
	_check(kept_night.environment.sky_rotation == Vector3.ZERO, "nor any drift")
	kept_night.queue_free()
	await process_frame

	await _a_photographed_sky()
	await _the_palette_offers_the_night()
	_reads_on_its_paper(Room.palette())

	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		var file := FileAccess.open(Room.KEPT, FileAccess.WRITE)
		file.store_buffer(kept)
	print("room_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


## A sky fetched to the headset hangs the night in its panorama, as dim as kept,
## and both come back when the room is made again.
func _a_photographed_sky() -> void:
	const Skies := preload("res://room/skies.gd")
	Skies.dir = "user://skies-room-test"
	var panorama := Image.create(16, 8, false, Image.FORMAT_RGBF)
	panorama.fill(Color(0.02, 0.03, 0.08))
	DirAccess.make_dir_recursive_absolute(Skies.dir)
	FileAccess.open(Skies.dir.path_join("lake_night.exr"), FileAccess.WRITE).store_buffer(panorama.save_exr_to_buffer())
	FileAccess.open(Skies.kept_path(), FileAccess.WRITE).store_string(JSON.stringify({"lake_night": {"id": "lake_night", "name": "Lake Night", "authors": ["A. Walker"]}}))

	var room := _room()
	_check(room.kept.sky == Skies.NIGHT and is_equal_approx(float(room.kept.dim), 40.0), "the night is the stars, dimmed 40, before anything is chosen")
	room.choose(Room.Kind.NIGHT)
	room.choose_sky("polyhaven:lake_night")
	_check(room.environment.sky.sky_material is ShaderMaterial, "the stars stay while they fade")
	await _wait(Room.SKY_FADE * 0.25)
	_check(room.environment.background_energy_multiplier < 1.0, "the sky fades out: %f" % room.environment.background_energy_multiplier)
	await _wait(Room.SKY_FADE)
	var photographed := room.environment.sky.sky_material as PanoramaSkyMaterial
	_check(photographed != null and photographed.panorama.get_width() == 16, "and comes back as the panorama")
	_check(is_equal_approx(room.environment.background_energy_multiplier, 1.0), "at its whole brightness")
	_check(photographed != null and is_equal_approx(photographed.energy_multiplier, Skies.energy(40.0)), "dimmed as kept")
	_check(room.sky_shown().name == "Lake Night", "and named")
	_check(room.saved.is_empty() and not room.is_saved("polyhaven:lake_night"), "a sky chosen is not saved until the reader saves it")
	room.save_sky(room.sky_shown())
	_check(room.saved == [{"key": "polyhaven:lake_night", "name": "Lake Night"}] and room.is_saved("polyhaven:lake_night"), "saved, it is kept by its key and name")
	room.save_sky(room.sky_shown())
	_check(room.saved.size() == 1, "and saving it again keeps it once")
	room.dim_sky(70.0)
	_check(photographed != null and is_equal_approx(photographed.energy_multiplier, Skies.energy(70.0)), "dimming it more darkens it")
	room.queue_free()
	await process_frame

	var again := _room()
	_check(again.kept.sky == "polyhaven:lake_night" and is_equal_approx(float(again.kept.dim), 70.0), "the sky and its dim are kept on the headset")
	_check(again.environment.sky != null and again.environment.sky.sky_material is PanoramaSkyMaterial, "and drawn again when the room is")
	_check(again.is_saved("polyhaven:lake_night") and again.saved[0].name == "Lake Night", "the saved skies are kept on the headset")
	again.save_sky(again.sky_shown(), false)
	var file := ConfigFile.new()
	file.load(Room.KEPT)
	_check(not again.is_saved("polyhaven:lake_night") and (file.get_value("sky", "saved", null) as Array).is_empty(), "and one unsaved is let go of there too")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Skies.dir.path_join("lake_night.exr")))
	again.choose(Room.Kind.DARK)
	again.choose(Room.Kind.NIGHT)
	_check(again.environment.sky.sky_material is ShaderMaterial and again.sky_shown().source == Skies.NIGHT, "a sky no longer on the headset is the stars")
	again.choose_sky(Skies.NIGHT)
	again.dim_sky(40.0)
	again.choose(Room.Kind.DARK)
	again.queue_free()
	await process_frame
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Skies.kept_path()))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Skies.dir))
	Skies.dir = "user://skies"


func _wait(seconds: float) -> void:
	var by := Time.get_ticks_msec() + seconds * 1000.0
	while Time.get_ticks_msec() < by:
		await process_frame


## The room panel's "Night sky" row chooses it, and the panel says so.
func _the_palette_offers_the_night() -> void:
	var HandMenu: GDScript = load("res://ui/hand_menu.gd")
	var scene := Node3D.new()
	root.add_child(scene)
	current_scene = scene
	var room := _room()
	room.reparent(scene)
	var camera := Camera3D.new()
	scene.add_child(camera)
	camera.current = true
	var views := root.get_node("Views")
	views.stage = Node3D.new()
	scene.add_child(views.stage)
	views.show("projects")
	HandMenu.ensure(self)
	await process_frame
	await process_frame
	var panel: Node3D = HandMenu.of(self)._faces[HandMenu.Pane.ROOM]
	var row := _label(panel, HandMenu.NIGHT)
	_check(row != null, "the room panel has a row for the night")
	if row != null:
		for area in row.get_parent().find_children("*", "Area3D", false, false):
			area.get_meta("pick").call()
	await process_frame
	_check(room.kind == Room.Kind.NIGHT and _label(panel, HandMenu.NOW_NIGHT) != null, "choosing it stands the field under the night, and says so")
	room.choose(Room.Kind.DARK)
	scene.queue_free()
	await process_frame


func _label(under: Node, text: String) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		if not found.is_queued_for_deletion() and (found as Label3D).text == text:
			return found
	return null


func _room() -> WorldEnvironment:
	var made := WorldEnvironment.new()
	made.environment = Environment.new()
	made.set_script(Room)
	root.add_child(made)
	return made


## Every hue and every step of depth clears the mark floor against the room's
## paper, and depth grows fainter going down.
func _reads_on_its_paper(palette: Palette) -> void:
	_check(palette.paper.is_equal_approx(Room.paper()), "the field is drawn on the room's paper")
	_check(_contrast(Room.ink(), Room.paper()) >= 7.0, "ink reads on it")
	for slot in range(1, Palette.SLOTS + 1):
		var against := _contrast(palette.slot(slot), palette.paper)
		_check(against >= Palette.MARK_FLOOR - 0.05, "slot %d clears the floor: %.2f" % [slot, against])
	var before := INF
	for depth in range(1, palette.generations + 1):
		var against := _contrast(palette.depth(depth), palette.paper)
		_check(against >= Palette.MARK_FLOOR - 0.05, "depth %d clears the floor: %.2f" % [depth, against])
		_check(against < before, "depth %d is fainter than the one above it" % depth)
		before = against


func _contrast(one: Color, two: Color) -> float:
	var a := one.srgb_to_linear().get_luminance()
	var b := two.srgb_to_linear().get_luminance()
	return (maxf(a, b) + 0.05) / (minf(a, b) + 0.05)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("room_test: does not hold: %s" % what)
