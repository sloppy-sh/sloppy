## The field's lines: the rows a reader turns them off by, off being off, a
## dense field's hand links quiet but round the notes in hand, and a line found
## by a ray, lit, chosen and asked about. Exits 1 on a failure.
extends SceneTree

const Field := preload("res://field/field.gd")
const Lines := preload("res://field/lines.gd")
const Lod := preload("res://field/lod.gd")
const Room := preload("res://room/room.gd")
const Settings := preload("res://field/settings.gd")

const OWNER := "did:syr:z6MkLinesTestOwner"

var _failed := 0


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var kept := FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))

	var few := _lines(10, 1)
	_check(few.rows() == [
		{"key": Settings.SPRANG, "count": 9},
		{"key": Settings.BY_HAND, "count": 10},
		{"key": Settings.relation(""), "count": 5, "label": ""},
		{"key": Settings.relation("uses"), "count": 5, "label": "uses"},
	], "a row per kind and per relation, with counts: %s" % [few.rows()])
	_check(not few.dense(), "one hand link a mark is not dense")
	var settings = Settings.shared()
	settings.offer("lines test", few.rows())
	var all := _drawn(few._hand)
	settings.turn(Settings.relation("uses"), false)
	few.show_only(settings)
	_check(_drawn(few._hand) < all and _drawn(few._hand) > 0, "a relation turned off draws nothing, the rest still draw")
	settings.turn(Settings.BY_HAND, false)
	settings.turn(Settings.SPRANG, false)
	few.show_only(settings)
	_check(_drawn(few._hand) == 0 and not few._tree.visible, "every kind turned off draws nothing at all")
	settings.turn(Settings.relation("uses"), true)
	settings.turn(Settings.BY_HAND, true)
	settings.turn(Settings.SPRANG, true)
	few.show_only(settings)
	few.focus([_ref(0)])
	_check(_drawn(few._struck) == 0, "a field that is not dense strikes nothing up")

	var crowded := _lines(40, 3)
	_check(crowded.dense(), "three hand links a mark is dense")
	_check((crowded._hand.mesh.surface_get_material(0) as ShaderMaterial).get_shader_parameter("ink").a < 1.0, "and its hand links are quiet")
	crowded.focus([_ref(0)])
	_check(_drawn(crowded._struck) > 0, "the note in hand has its hand links struck whole")
	_check(_drawn(crowded._near) > 0, "and the ones between its neighbours stand at their own weight")
	crowded.focus([])
	_check(_drawn(crowded._struck) == 0, "nothing is struck with nothing in hand")

	var inside := _shells(true)
	var nearest := _nearest(inside._hand)
	_check(nearest >= Field.FIRST - Lod.MARK_RADIUS, "inside, no hand link passes nearer the reader than the first shell: %.3f" % nearest)
	var straight := _shells(false)
	_check(_nearest(straight._hand) < Field.FIRST - Lod.MARK_RADIUS, "while in the tree a hand link between opposite marks runs straight across")

	var dashed: PackedVector3Array = few._hand.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var moved := {}
	for ref in few._at:
		moved[ref] = few._at[ref] * 2.0 + Vector3.UP
	few.move(moved)
	var carried: Image = few._ends_image
	_check(few._hand.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX] == dashed, "marks moving carry the hand links' dashes rather than dashing them again")
	_check(Vector3(carried.get_pixel(2, 0).r, carried.get_pixel(2, 0).g, carried.get_pixel(2, 0).b).is_equal_approx(moved[few._links[0][0]]) and Vector3(carried.get_pixel(0, 0).r, carried.get_pixel(0, 0).g, carried.get_pixel(0, 0).b).is_equal_approx(dashed[0]), "to where their ends stand now, from where they were dashed")
	few.settle()
	_check(few._hand.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX][0].is_equal_approx(moved[few._links[0][0]]), "and once the marks stand still they are dashed where they stand")

	_pointed_at()

	few.free()
	crowded.free()
	inside.free()
	straight.free()
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(kept)
	print("lines_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


## A stem from a root to its child, and three hand links running side by side
## a few millimetres apart: a ray across the stem meets it alone, one across the
## three meets the bundle, and one far off meets nothing.
func _pointed_at() -> void:
	var placed := {
		_ref(0): {"position": Vector3(0, 0, -1), "parent": ""},
		_ref(1): {"position": Vector3(1, 0, -1), "parent": _ref(0)},
	}
	var notes := {}
	for at in 3:
		var from := _ref(10 + at)
		var to := _ref(20 + at)
		placed[from] = {"position": Vector3(at * 0.005, 0, 1), "parent": ""}
		placed[to] = {"position": Vector3(at * 0.005, 2, 1), "parent": ""}
		notes[from] = {"note": from, "links": [{"to": to, "label": "uses"}]}
	var lines := Lines.new()
	root.add_child(lines)
	lines.build(placed, notes, Room.palette())
	var chosen: Array = []
	var asked: Array = []
	lines.chosen.connect(func(from, to, label, count): chosen.append([from, to, label, count]))
	lines.asked_about.connect(func(from, to): asked.append([from, to]))

	var at_stem := _pointer(Vector3(0.5, 1, -1), Vector3.DOWN)
	_check(is_equal_approx(lines.hit(at_stem), 1.0), "a ray across a stem meets it where it crosses: %.3f" % lines.hit(at_stem))
	lines.point(at_stem)
	_check(lines._lit_stem.visible, "and the stem pointed at is lit")
	lines.unpoint(at_stem)
	_check(not lines._lit_stem.visible, "and lit no more once the pointer leaves it")
	var far_off := _pointer(Vector3(50, 50, 50), Vector3.RIGHT)
	_check(lines.hit(far_off) == INF, "a ray far from every line meets none")
	var beside := _pointer(Vector3(0.5, 1, -0.9), Vector3.DOWN)
	_check(lines.hit(beside) == INF, "nor one passing a stem further off than a line's reach")

	var at_bundle := _pointer(Vector3(-1, 1, 1), Vector3.RIGHT)
	_check(is_equal_approx(lines.hit(at_bundle), 1.0), "a ray across hand links meets the first it crosses: %.3f" % lines.hit(at_bundle))
	lines.point(at_bundle)
	_check(_drawn(lines._struck) > 0, "and the links pointed at are struck in full ink")
	lines.press(at_bundle)
	_check(chosen == [[_ref(10), _ref(20), "uses", 3]], "the trigger chooses the line, its label and the links bundled with it: %s" % [chosen])
	_check(asked.is_empty(), "and asks nothing yet")
	lines.unpoint(at_bundle)
	_check(_drawn(lines._struck) > 0, "a line chosen stays lit once the pointer leaves it")
	lines.hit(at_bundle)
	lines.point(at_bundle)
	lines.press(at_bundle)
	_check(asked == [[_ref(10), _ref(20)]], "the trigger again on the line chosen asks how to change it")
	var across_bundle := _pointer(Vector3(1, 1, 1.001), Vector3.LEFT)
	lines.hit(across_bundle)
	_check(lines._met[across_bundle].at != lines._held.at, "a ray a few millimetres over meets another link of the bundle first")
	lines.point(across_bundle)
	lines.press(across_bundle)
	_check(chosen.size() == 1 and asked == [[_ref(10), _ref(20)], [_ref(10), _ref(20)]], "the trigger again anywhere on the bundle chosen asks about the line chosen: %s %s" % [chosen, asked])
	lines.unpoint(across_bundle)
	lines.let_go()
	lines.unpoint(at_bundle)
	_check(_drawn(lines._struck) == 0 and not lines.holding(), "a line let go is lit no more")
	lines.hit(at_stem)
	lines.point(at_stem)
	lines.press(at_stem)
	_check(chosen.back() == [_ref(0), _ref(1), "", 1], "a stem is chosen alone, from its parent to its child: %s" % [chosen.back()])
	lines.free()
	for pointer in [at_stem, far_off, beside, at_bundle, across_bundle]:
		pointer.free()


## A pointer whose ray runs from `from` heading `toward`.
func _pointer(from: Vector3, toward: Vector3) -> Node3D:
	var source := GDScript.new()
	source.source_code = "extends Node3D\nvar from: Vector3\nvar toward: Vector3\nfunc ray() -> Array:\n\treturn [from, toward.normalized()]\n"
	source.reload()
	var pointer := Node3D.new()
	pointer.set_script(source)
	pointer.from = from
	pointer.toward = toward
	return pointer


func _ref(at: int) -> String:
	return "%s/%010d%016d" % [OWNER, 1700000000 + at, at]


## `count` notes in a line of descent, each linked by hand to the `per` after it
## round the ring, every other link labelled `uses`.
func _lines(count: int, per: int) -> Node3D:
	var placed := {}
	var notes := {}
	var made := 0
	for at in count:
		var links: Array = []
		for step in range(1, per + 1):
			links.append({"to": _ref((at + step) % count), "label": "uses"} if made % 2 == 0 else {"to": _ref((at + step) % count)})
			made += 1
		notes[_ref(at)] = {"note": _ref(at), "links": links}
		placed[_ref(at)] = {"position": Vector3(at * 0.1, 0.0, 0.0), "parent": _ref(at - 1) if at > 0 else ""}
	var lines := Lines.new()
	lines.build(placed, notes, Room.palette())
	return lines


## Marks on the first two shells round the origin, linked by hand: two
## opposite, two a right angle apart, and one across from a shell to the next.
func _shells(arcing: bool) -> Node3D:
	var first := Field.FIRST
	var second := Field.FIRST + Field.STEP
	var at := [Vector3(first, 0, 0), Vector3(-first, 0, 0), Vector3(0, 0, -first), Vector3(0, first, 0), Vector3(-second, 0, 0.0).rotated(Vector3.UP, 0.3)]
	var placed := {}
	var notes := {}
	for index in at.size():
		placed[_ref(index)] = {"position": at[index], "parent": ""}
		notes[_ref(index)] = {"note": _ref(index), "links": []}
	notes[_ref(0)].links = [_ref(1), _ref(2), _ref(4)]
	notes[_ref(3)].links = [_ref(2), _ref(4)]
	var lines := Lines.new()
	lines.arcing = arcing
	lines.build(placed, notes, Room.palette())
	return lines


func _nearest(shown: MeshInstance3D) -> float:
	var nearest := INF
	for point in shown.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]:
		nearest = minf(nearest, point.length())
	return nearest


func _drawn(shown: MeshInstance3D) -> int:
	return 0 if shown.mesh == null else shown.mesh.surface_get_array_len(0)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("lines_test: does not hold: %s" % what)
