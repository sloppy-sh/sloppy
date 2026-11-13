## The Sets reading over generated graphs: where it stands each place and note,
## at the field's size, arriving in it, and moving through it as the field is
## moved — walking, turning, a glide to a note, the vantage and back — and a
## pictured mark wearing its picture against the desk `tests/run.sh` names in
## SLOPPY_DESK. Run by `tests/run.sh`; it exits 1 on a failure.
extends SceneTree

const Places := preload("res://sets/places.gd")
const Arrival := preload("res://sets/arrival.gd")
const Titles := preload("res://sets/titles.gd")
const Reach := preload("res://interaction/reach.gd")
const Hues := preload("res://sets/hues.gd")
const Field := preload("res://field/field.gd")
const Lod := preload("res://field/lod.gd")
const Settings := preload("res://field/settings.gd")
const Marks := preload("res://field/marks.gd")
const WAIT := 10.0
const STEP := 1.0 / 60.0
const OWNER := "did:syr:z6MkSetsTestOwner"
const TAGS := ["seed", "soil", "water", "light", "root", "leaf", "flower", "fruit", "bark", "moss"]

var _failed := 0


func _initialize() -> void:
	var notes := _generated(240, 11)
	var placed := Places.place(notes)

	_ranks_as_the_canvas_does()
	_draws_eight_at_most(placed)
	_is_deterministic_whatever_order_it_is_read_in(notes, placed)
	_stands_tags_that_share_notes_nearer_than_tags_that_share_none()
	_overlaps_places_that_share_and_parts_those_that_do_not(notes, placed)
	_sizes_a_place_by_its_notes(placed)
	_spans_the_field_with_places_to_stand_in(placed)
	_stands_each_note_among_its_tags(placed)
	_stands_a_note_in_none_at_the_edge(placed)
	_schedules_the_arrival()
	_sizes_a_title_by_its_distance()
	_in_the_room.call_deferred(notes)


func _done() -> void:
	print("sets_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check(holds: bool, said: String) -> void:
	if not holds:
		_failed += 1
		printerr("  FAIL: ", said)


## Notes carrying a few tags each, some carrying none, the tags clustered so
## some pairs share many notes and some share none.
func _generated(count: int, seed: int) -> Array:
	var random := RandomNumberGenerator.new()
	random.seed = seed
	var notes: Array = []
	for at in count:
		var tags: Array = []
		if random.randf() > 0.08:
			var cluster := 0 if random.randf() < 0.5 else 5
			for _i in random.randi_range(1, 3):
				var tag: String = TAGS[cluster + random.randi_range(0, 4)]
				if not tags.has(tag):
					tags.append(tag)
		notes.append({"note": "%s/%010d%s" % [OWNER, at, "ABCDEFGHJKMNPQRS"], "tags": tags, "title": "Note %d" % at})
	return notes


func _ranks_as_the_canvas_does() -> void:
	var notes := [
		{"note": "a", "tags": ["b", "a"]},
		{"note": "b", "tags": ["b", "c"]},
		{"note": "c", "tags": ["a", "a"]},
	]
	_check(Places.drawn(notes) == ["a", "b", "c"], "ties by name, a tag once per note: %s" % [Places.drawn(notes)])
	_check(Places.drawn(notes, {"c": 9, "a": 1}) == ["c", "a"], "list_tags' counts rank when given")


func _draws_eight_at_most(placed: Dictionary) -> void:
	_check(placed.places.size() == Places.MOST, "eight places of ten tags: %d" % placed.places.size())
	var slots := []
	for tag in placed.places:
		slots.append(placed.places[tag].slot)
	slots.sort()
	_check(slots == [1, 2, 3, 4, 5, 6, 7, 8], "one slot each: %s" % [slots])


func _is_deterministic_whatever_order_it_is_read_in(notes: Array, placed: Dictionary) -> void:
	var again := Places.place(notes)
	var shuffled := notes.duplicate()
	var random := RandomNumberGenerator.new()
	random.seed = 5
	for at in range(shuffled.size() - 1, 0, -1):
		var other := random.randi_range(0, at)
		var held = shuffled[at]
		shuffled[at] = shuffled[other]
		shuffled[other] = held
	var reordered := Places.place(shuffled)
	for tag in placed.places:
		_check(again.places[tag].centre == placed.places[tag].centre, "%s stands the same twice" % tag)
		_check(reordered.places[tag].centre == placed.places[tag].centre, "%s stands the same read in another order" % tag)
	for ref in placed.notes:
		_check(reordered.notes[ref].position == placed.notes[ref].position, "%s stands the same read in another order" % ref)


func _stands_tags_that_share_notes_nearer_than_tags_that_share_none() -> void:
	var notes: Array = []
	for at in 6:
		notes.append({"note": "n%d" % at, "tags": ["ash", "elm"]})
	for at in 6:
		notes.append({"note": "m%d" % at, "tags": ["oak"]})
	var places: Dictionary = Places.place(notes).places
	var shared: float = places.ash.centre.distance_to(places.elm.centre)
	_check(shared < places.ash.centre.distance_to(places.oak.centre), "ash nearer elm than oak")
	_check(shared < places.elm.centre.distance_to(places.oak.centre), "elm nearer ash than oak")


func _overlaps_places_that_share_and_parts_those_that_do_not(notes: Array, placed: Dictionary) -> void:
	var tags: Array = placed.places.keys()
	var nearest_sharing := 0.0
	var nearest_apart := INF
	for one in tags.size():
		for two in range(one + 1, tags.size()):
			var a: Dictionary = placed.places[tags[one]]
			var b: Dictionary = placed.places[tags[two]]
			var gap: float = a.centre.distance_to(b.centre) - a.radius - b.radius
			if _share(notes, tags[one], tags[two]):
				nearest_sharing = maxf(nearest_sharing, gap)
				_check(gap < 0.0, "%s and %s share notes and overlap (%f)" % [tags[one], tags[two], gap])
			else:
				nearest_apart = minf(nearest_apart, gap)
				_check(gap > 0.0, "%s and %s share none and stand apart (%f)" % [tags[one], tags[two], gap])
	_check(nearest_sharing < nearest_apart, "every sharing pair nearer than every pair sharing none")


func _share(notes: Array, one: String, two: String) -> bool:
	return notes.any(func(note): return note.tags.has(one) and note.tags.has(two))


func _sizes_a_place_by_its_notes(placed: Dictionary) -> void:
	for one in placed.places:
		for two in placed.places:
			var a: Dictionary = placed.places[one]
			var b: Dictionary = placed.places[two]
			if a.notes > b.notes:
				_check(a.radius > b.radius, "%s carried by more is larger than %s" % [one, two])


func _spans_the_field_with_places_to_stand_in(placed: Dictionary) -> void:
	var reach := 0.0
	for tag in placed.places:
		var place: Dictionary = placed.places[tag]
		reach = maxf(reach, place.centre.length() + place.radius)
		_check(place.radius * 2.0 >= Places.STANDABLE - 1e-4, "%s is wide enough to stand in: %.2f m" % [tag, place.radius * 2.0])
	_check(reach >= Field.FIRST + 2.0 * Field.STEP - 1e-4, "the places reach as far as the field's third shell: %.2f m" % reach)
	_check(reach < (Field.FIRST + 2.0 * Field.STEP) * 2.0, "and about that far, not a room away: %.2f m" % reach)
	var one: Dictionary = Places.place([{"note": "a", "tags": ["ash"]}]).places
	_check(is_equal_approx(one.ash.radius, Field.FIRST + 2.0 * Field.STEP), "one place alone spans the field: %.2f m" % one.ash.radius)


func _stands_each_note_among_its_tags(placed: Dictionary) -> void:
	var among := 0
	var exactly := 0
	for ref in placed.notes:
		var note: Dictionary = placed.notes[ref]
		if note.tags.is_empty():
			continue
		among += 1
		var only := true
		for tag in placed.places:
			var place: Dictionary = placed.places[tag]
			var within: bool = note.position.distance_to(place.centre) < place.radius
			if note.tags.has(tag):
				_check(within, "%s inside %s, which it carries" % [ref, tag])
			elif within:
				only = false
		if only:
			exactly += 1
	# Spheres cannot draw every region five overlapping sets make, so a few
	# notes stand inside a place they do not carry; never one outside a place they do.
	_check(among > 0 and exactly >= among * 0.95, "%d of %d notes in no place they do not carry" % [exactly, among])


func _stands_a_note_in_none_at_the_edge(placed: Dictionary) -> void:
	var outermost := 0.0
	for tag in placed.places:
		outermost = maxf(outermost, placed.places[tag].centre.length() + placed.places[tag].radius)
	var edged := 0
	for ref in placed.notes:
		var note: Dictionary = placed.notes[ref]
		if note.tags.is_empty():
			edged += 1
			_check(Vector2(note.position.x, note.position.z).length() > outermost, "%s past every place" % ref)
	_check(edged > 0, "the generated graph has notes in no place")


func _schedules_the_arrival() -> void:
	_check(is_equal_approx(Arrival.span(1), Arrival.FADING), "one step takes a fade")
	_check(is_equal_approx(Arrival.span(5), 4 * Arrival.BETWEEN + Arrival.FADING), "each step starts a beat after the last")
	_check(Arrival.shown(0.0, 0) == 0.0 and Arrival.shown(Arrival.FADING, 0) == 1.0, "a step fades in over its own span")
	_check(Arrival.shown(Arrival.BETWEEN, 1) == 0.0 and Arrival.shown(Arrival.BETWEEN + Arrival.FADING / 2.0, 1) > 0.4,
		"the second starts as the first is under way")
	for at in 6:
		_check(Arrival.shown(0.3, at) >= Arrival.shown(0.3, at + 1), "step %d is never behind step %d" % [at, at + 1])
	_check(Arrival.step_of(["b", "a"], ["a", "b", "c"]) == 0, "a note comes up with the first place it stands in")
	_check(Arrival.step_of([], ["a", "b"]) == 2, "a note in none comes up after the last place")
	_check(is_equal_approx(Arrival.veil_far(0.0, 4, 9.0), Arrival.VEIL_FAR), "the veil starts near")
	_check(is_equal_approx(Arrival.veil_far(Arrival.span(4), 4, 9.0), 9.0), "and has fallen to the far side by the end")


func _sizes_a_title_by_its_distance() -> void:
	_check(Titles.apparent(3.0) == 3.0 * Titles.apparent(1.0), "a title three times as far is drawn three times as large")
	_check(Titles.apparent(0.1) == Titles.apparent(Titles.NEAREST), "and none drawn smaller than at half a metre")
	var mark := Vector3(1.0, 1.2, -2.0)
	var eye := Vector3(0.0, 1.6, 0.0)
	var at := Titles.stood(mark, eye, 0.03)
	_check(at.y > mark.y + 0.03, "a title stands above its mark")
	_check(at.distance_to(eye) < mark.distance_to(eye) - 0.03, "and nearer the eyes than the mark's near side")


## A Sets view stood in the room without a desk, drawn from generated notes.
func _in_the_room(notes: Array) -> void:
	await process_frame
	var room: Node3D = load("res://main.tscn").instantiate()
	root.add_child(room)
	current_scene = room
	await process_frame
	var view: Node3D = load("res://views/sets.tscn").instantiate()
	room.get_node("Stage").add_child(view)
	view._stand_in()
	for note in notes:
		view._named[note.note] = note.title
	var placed := Places.place(notes)
	view._draw(placed)
	view.set_process(false)
	var camera: Camera3D = view._camera
	var environment: Environment = room.get_node("Room").environment

	_arrives_veiled(view, environment, placed)
	_stands_ahead_to_walk_into(view, camera)
	await _walks_and_turns(view, camera)
	_glides_to_a_note(view, camera)
	_stands_at_the_vantage_and_comes_back(view, camera)
	_brings_it_back(view, camera)
	view.queue_free()
	await process_frame
	await _wears_a_picture(room)
	_done()


func _run(view: Node3D, seconds: float) -> void:
	for _frame in int(round(seconds / STEP)):
		view._process(STEP)


## Until the glide under way has ended.
func _glided(view: Node3D) -> void:
	for _frame in int(view.GLIDING / STEP) + 10:
		if view._glide.is_empty():
			return
		view._process(STEP)


func _arrives_veiled(view: Node3D, environment: Environment, placed: Dictionary) -> void:
	var order: Array = placed.places.keys()
	_check(environment.fog_enabled, "arriving, the room is veiled")
	var first: GeometryInstance3D = view._places[order[0]].region
	var last: GeometryInstance3D = view._places[order[-1]].region
	_check(first.transparency == 1.0 and last.transparency == 1.0, "nothing shows before arriving starts")
	_run(view, Arrival.BETWEEN * 2.0)
	_check(first.transparency < last.transparency, "the first place comes up before the last")
	var far_now := environment.fog_depth_end
	_run(view, Arrival.BETWEEN)
	_check(environment.fog_depth_end > far_now, "the veil recedes as they come up")
	_run(view, Arrival.span(view._arrival_steps))
	_check(not environment.fog_enabled, "arrived, the veil is gone")
	var shown := 0
	for tag in view._places:
		shown += int(view._places[tag].region.transparency == 0.0 and view._places[tag].named.transparency == 0.0)
	for ref in view._notes:
		shown += int(view._notes[ref].mark.transparency == 0.0)
	_check(shown == view._places.size() + view._notes.size(), "every place and note shows: %d" % shown)


func _stands_ahead_to_walk_into(view: Node3D, camera: Camera3D) -> void:
	var eyes := camera.global_transform
	var field: Transform3D = view._field.global_transform
	_check(is_equal_approx(field.basis.get_scale().x, 1.0), "Sets stands at its own size: %f" % field.basis.get_scale().x)
	_check(field.is_equal_approx(Reach.arrival(eyes, view._laid)), "about the reader, as the field stands inside")
	var nearest := INF
	for ref in view._laid:
		nearest = minf(nearest, (field * view._laid[ref].position).distance_to(eyes.origin))
	_check(nearest > view._mark * 2.0, "no mark in the reader's face: %.2f m" % nearest)
	var size: float = Lod.MARK_RADIUS * view.Graph.LARGER * Settings.shared().size
	_check(is_equal_approx(view._marks.mark_radius, size), "its marks drawn at the field's size: %f" % view._marks.mark_radius)
	_check(view._walk.fly and view._walk.origin == view._origin, "the left stick flies the reader through it")
	_check(view._reach.field == view._field, "the right stick turns and tilts it")


func _walks_and_turns(view: Node3D, camera: Camera3D) -> void:
	var before: Transform3D = view._field.global_transform
	var origin: Transform3D = view._origin.global_transform
	var eye := camera.global_position
	await _held(KEY_RIGHT)
	var after: Transform3D = view._field.global_transform
	_check(not after.basis.is_equal_approx(before.basis), "a lean across turns Sets")
	var level := func(at: Vector3) -> float: return Vector2(at.x - eye.x, at.z - eye.z).length()
	_check(is_equal_approx(level.call(after.origin), level.call(before.origin)), "about the reader")
	await _held(KEY_W)
	var walked: Vector3 = view._origin.global_position - origin.origin
	_check(walked.dot(-camera.global_basis.z) > 0.05, "the left stick flies the reader ahead: %s" % walked)
	view._origin.global_transform = origin
	view._field.global_transform = before


func _held(key: Key) -> void:
	var down := InputEventKey.new()
	down.physical_keycode = key
	down.pressed = true
	Input.parse_input_event(down)
	for _frame in 20:
		await process_frame
	var up := InputEventKey.new()
	up.physical_keycode = key
	Input.parse_input_event(up)
	for _frame in 3:
		await process_frame


func _glides_to_a_note(view: Node3D, camera: Camera3D) -> void:
	var ref: String = view._marks.refs[7]
	var local: Vector3 = view._marks.local[7]
	var size: float = view._field.global_basis.get_scale().x
	view.seek(ref)
	_check(view._marks.sought == ref and view._marks._halo.visible, "the note sought lights")
	_check(view._marks._halo.position.is_equal_approx(local), "its own mark")
	var hue: Color = Hues.of(view._notes[ref].slot)
	_check(Color(view._marks._halo_paint.albedo_color, 1.0).is_equal_approx(Color(hue, 1.0)), "in its set's colour")
	var smallest := INF
	for _frame in int(round(view.GLIDING / STEP)) + 2:
		view._process(STEP)
		smallest = minf(smallest, view._field.global_basis.get_scale().x)
	_check(is_equal_approx(smallest, size), "it glides at the size it was, never drawing back first")
	var eyes := camera.global_transform
	var want := eyes.origin + Reach.ahead(eyes.basis) * Reach.NEAR
	_check((view._field.global_transform * local).is_equal_approx(want), "the note stands within reach ahead")
	var titled: Array = view._titles._pool.filter(func(one: Label3D) -> bool: return one.visible and one.text == view._named[ref])
	_check(not titled.is_empty(), "its title stands")
	var said: Label3D = titled[0] if not titled.is_empty() else view._titles._pool[0]
	_check(is_equal_approx(said.scale.x, Titles.apparent(Reach.NEAR) * Titles.HELD_LARGER), "read larger than the rest")
	view.seek(ref)
	view._moved()
	_check(view._glide.is_empty() and view._marks.sought == "", "moving lets the glide and the light go")
	view.seek(ref)
	view._pointers[0].missed.emit()
	_check(view._marks.sought == "" and not view._marks._halo.visible, "the trigger on nothing lets the note sought go")
	_check(view._titles._pinned == -1, "and its title stands no longer")


## Stands in for the field panel: counts what it is told of the vantage.
func _listening_panel() -> Node:
	var script := GDScript.new()
	script.source_code = "extends Node\nvar told := 0\nfunc vantage_changed() -> void:\n\ttold += 1\n"
	script.reload()
	var panel: Node = script.new()
	root.add_child(panel)
	panel.add_to_group(load("res://ui/field_panel.gd").GROUP)
	return panel


func _stands_at_the_vantage_and_comes_back(view: Node3D, camera: Camera3D) -> void:
	var was: Transform3D = view._field.global_transform
	var panel := _listening_panel()
	view.vantage()
	_check(view.at_vantage(), "the vantage is taken")
	_check(panel.told == 1, "the field panel hears it, to offer the way back in")
	_glided(view)
	var stood := Reach.stand_before(camera.global_transform, view._radius)
	_check(view._field.global_transform.is_equal_approx(stood), "the whole of Sets stands before the reader, small")
	_run(view, 1.0)
	var turned: Transform3D = view._field.global_transform
	_check(turned.origin.is_equal_approx(stood.origin), "turning about its own middle")
	var angle := Reach.heading(turned.basis) - Reach.heading(stood.basis)
	_check(absf(wrapf(angle, -PI, PI)) > view.VANTAGE_TURN * 0.9, "turning: %f" % angle)
	view._moved()
	_check(not view.at_vantage(), "a stick leaves the vantage")
	_glided(view)
	_check(view._field.global_transform.is_equal_approx(was), "and glides back to where Sets was")
	_check(panel.told == 2, "and the panel hears that too")
	panel.free()
	view.vantage()
	_run(view, 0.5)
	view.vantage()
	_glided(view)
	_check(view._field.global_transform.is_equal_approx(was), "the row again glides back too")
	view.vantage()
	_run(view, 0.5)
	var held := Transform3D(Basis(Vector3.UP, 0.4).scaled(Vector3.ONE * 0.3), Vector3(1.0, 0.5, -2.0))
	view._field.global_transform = held
	view._taken_hold()
	_run(view, 0.5)
	_check(not view.at_vantage() and view._glide.is_empty(), "taking hold leaves the vantage and its glide")
	_check(view._field.global_transform.is_equal_approx(held), "and Sets stays where the hand put it")
	view._field.global_transform = was


func _brings_it_back(view: Node3D, camera: Camera3D) -> void:
	view._field.global_transform = Transform3D(Basis(Vector3.RIGHT, 1.0), Vector3(3.0, -1.0, 2.0))
	view.bring_back()
	_check(view._field.global_transform.is_equal_approx(view.standing(camera.global_transform, view._laid)),
		"Bring it back stands Sets as it arrived")


## The desk's notes stood in Sets: the one the desk says wears a picture wears
## the one it answers with, edged in its set's hue, and takes it off when
## pictures are hidden; the one wearing none has nothing to wear.
func _wears_a_picture(room: Node3D) -> void:
	var ticket := OS.get_environment("SLOPPY_DESK")
	var code := OS.get_environment("SLOPPY_DESK_CODE")
	if ticket == "" or code == "":
		_check(false, "a desk is named")
		return
	var client := root.get_node("Client")
	client.connect_to(ticket)
	await _until(func(): return client.state in [client.State.OPEN, client.State.UNPAIRED])
	if client.state == client.State.UNPAIRED:
		client.connect_to(ticket, code)
		await _until(func(): return client.state == client.State.OPEN)
	_check(client.state == client.State.OPEN, "reaches the desk")
	var listed: Array = (await client.field("")).get("notes", [])
	var worn: Array = listed.filter(func(one): return one.get("picture") == true)
	var bare: Array = listed.filter(func(one): return one.get("picture") != true)
	_check(worn.size() == 1 and not bare.is_empty(), "the desk has a note wearing a picture and one wearing none")
	if worn.is_empty() or bare.is_empty():
		return
	var kept := FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	var settings = Settings.shared()
	settings.set_pictures(true)
	var notes: Array = []
	for note in listed:
		var tagged: Dictionary = note.duplicate()
		tagged.tags = ["seed"]
		notes.append(tagged)
	var view: Node3D = load("res://views/sets.tscn").instantiate()
	room.get_node("Stage").add_child(view)
	view.project = ""
	view._stand_in()
	for note in notes:
		view._listed[note.note] = note
		view._named[note.note] = str(note.get("title", ""))
	view._draw(Places.place(notes))
	var pictured: String = worn[0].note
	_check(view._marks.pictured.has(pictured) and not view._marks.pictured.has(bare[0].note), "the marks the desk says wear pictures are the ones to wear them")
	await _until(func(): return view._marks.showing_picture(pictured))
	_check(view._marks.showing_picture(pictured), "a near pictured mark in Sets wears its picture")
	var disc: MeshInstance3D = view._marks._discs.get(pictured)
	if disc != null:
		var paint := disc.material_override as ShaderMaterial
		var picture: Texture2D = paint.get_shader_parameter("picture")
		_check(picture != null and picture.get_size() == Vector2(4, 2), "the one the desk answers with")
		_check(Color(paint.get_shader_parameter("rim"), 1.0).is_equal_approx(Hues.of(view._notes[pictured].slot)), "edged in its set's hue")
		_check(is_equal_approx((disc.mesh as QuadMesh).size.x, view._mark * 2.0 * Marks.DISC_WIDER), "as wide on its mark as the field wears one")
	_check(not view._marks.showing_picture(bare[0].note), "a mark with none wears nothing")
	settings.set_pictures(false)
	await _until(func(): return not view._marks.showing_picture(pictured))
	_check(not view._marks.showing_picture(pictured), "and takes it off when pictures are hidden")
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(kept)
	view.queue_free()
	await process_frame


func _until(holds: Callable) -> void:
	var waited := 0.0
	while not holds.call() and waited < WAIT:
		await process_frame
		waited += 1.0 / 60.0
