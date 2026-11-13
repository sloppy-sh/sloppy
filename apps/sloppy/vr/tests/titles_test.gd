## Titles read from where a reader first stands before a field. Run from
## apps/sloppy/vr with `Godot --headless --script res://tests/titles_test.gd`.
extends SceneTree

const OWNER := "did:syr:z6MkTitlesTestOwner"
const NOTES := 60
## Where the eyes stand over the floor, as `main.tscn` stands the camera.
const EYES := Vector3(0.0, 1.6, 0.0)
const Palette := preload("res://field/palette.gd")
const Reach := preload("res://interaction/reach.gd")
const Room := preload("res://room/room.gd")
const Marks := preload("res://field/marks.gd")
const Labels := preload("res://field/labels.gd")
const Lod := preload("res://field/lod.gd")

var _failed := 0


func _initialize() -> void:
	_read_from_the_first_stand.call_deferred()


func _read_from_the_first_stand() -> void:
	var notes: Array = []
	var by_ref := {}
	for at in NOTES:
		var note := {"note": "%s/%010d%016d" % [OWNER, 1700000000 + at, at], "title": "Note %d" % at, "tags": []}
		if at >= 3:
			note["parent"] = notes[(at - 3) / 3].note
		notes.append(note)
		by_ref[note.note] = note
	var placed: Dictionary = root.get_node("Field").derive({"notes": notes})
	var palette := Room.palette()
	var field := Node3D.new()
	root.add_child(field)
	var marks := Marks.new()
	field.add_child(marks)
	marks.build(placed, by_ref, palette, Palette.drawn_sets(notes), OWNER)
	var radius := 0.0
	for ref in placed:
		radius = maxf(radius, placed[ref].position.length())
	field.global_transform = Reach.stand_before(Transform3D(Basis.IDENTITY, EYES), radius)
	var said: Array[String] = []
	var cited: Array[String] = []
	for ref in marks.refs:
		said.append(by_ref[ref].title)
		cited.append("")
	var labels := Labels.new()
	root.add_child(labels)
	labels.build(marks, said, cited, palette.ink, palette.paper)

	labels.choose(marks.settle(EYES), marks.facing(EYES, Vector3.FORWARD))
	labels.follow(EYES, Basis.IDENTITY)
	var standing := 0
	for label in labels.get_children():
		if label.visible and label.modulate.a > 0.0:
			standing += 1
			_check(label.modulate.get_luminance() > Room.paper().get_luminance(), "a title is light ink on the dark room")
	_check(standing >= 1, "a title stands from the first stand, %d did" % standing)
	_check(standing <= Lod.TITLES_MOST, "no more than the most stand")

	_check(Labels.apparent(0.2) == Labels.apparent(Labels.NEAREST), "nearer than the nearest a title keeps the size it has there")
	for distance in [0.5, 1.0, 2.0, 7.5, 40.0]:
		var letter: float = Labels.LETTER_AT_1M * Labels.apparent(distance)
		_check(is_equal_approx(letter / distance, Labels.LETTER_AT_1M), "a title at %.1f m reads as one at 1 m does" % distance)
	var letter_tall: float = labels.get_child(0).pixel_size * labels.get_child(0).font_size
	_check(is_equal_approx(letter_tall, Labels.LETTER_AT_1M), "letters stand %.4f m tall at 1 m" % letter_tall)

	var distances: PackedFloat32Array = marks.settle(EYES)
	var far := 0
	for at in distances.size():
		if distances[at] > distances[far]:
			far = at
	labels.point(far)
	_check(labels._shown[0] == far, "the mark pointed at is titled first, however far")
	labels.follow(EYES, Basis.IDENTITY, 0.05)
	var pointed: Label3D = labels.get_child(0)
	_check(pointed.visible and pointed.text == said[far], "and whole: %s" % pointed.text)
	_check(pointed.modulate.a == 1.0, "and in full ink")
	var reads := Labels.apparent(distances[far])
	_check(_seen_scale(pointed) > reads and _seen_scale(pointed) < reads * Labels.HELD_LARGER, "growing, not yet grown: %.2f" % (_seen_scale(pointed) / reads))
	labels.follow(EYES, Basis.IDENTITY, Labels.GROWING)
	_check(is_equal_approx(_seen_scale(pointed), reads * Labels.HELD_LARGER), "grown to read larger than the rest: %.2f of %.2f" % [_seen_scale(pointed), reads * Labels.HELD_LARGER])
	labels.point(-1)
	labels.follow(EYES, Basis.IDENTITY, Labels.GROWING)
	_check(not pointed.visible or is_equal_approx(_seen_scale(pointed), Labels.apparent(_marks_distance(marks, labels._shown[0]))), "and back to its size once let go")

	_stands_toward_the_eyes()
	_stands_above_a_picture(marks, labels)

	print("titles_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


## A title's scale as the eyes see it, undoing how far it was brought toward them.
func _seen_scale(label: Label3D) -> float:
	var lifted_by := label.global_position.distance_to(EYES)
	return label.scale.x * (lifted_by + _lift(label.get_parent())) / lifted_by


func _lift(labels: Node3D) -> float:
	return labels._marks.radius() * labels._marks.global_transform.basis.get_scale().x + Labels.LIFT


func _marks_distance(marks: Node3D, at: int) -> float:
	return EYES.distance_to(marks.global_transform * marks.local_at(at))


func _stands_toward_the_eyes() -> void:
	var mark := Vector3(0.3, 1.6, -3.0)
	var lifted := Labels.toward_eyes(mark, EYES, 0.05)
	_check(is_equal_approx(lifted.distance_to(mark), 0.05), "brought toward the eyes by what is asked")
	_check(is_equal_approx((lifted - EYES).normalized().dot((mark - EYES).normalized()), 1.0), "along the line to them, so it stands where it is seen")
	var close := Labels.toward_eyes(EYES + Vector3(0.0, 0.0, -0.04), EYES, 0.05)
	_check(is_equal_approx(close.distance_to(EYES), 0.02), "and never past halfway")


## A pictured mark's title stands centred over its picture, clear of it.
func _stands_above_a_picture(marks: Node3D, labels: Node3D) -> void:
	var box := Labels.above(Vector2(0.1, -0.2), 0.05, 0.3, 0.04)
	_check(is_equal_approx(box.get_center().x, 0.1) and is_equal_approx(box.position.y, -0.15), "centred above, starting where the picture ends: %s" % box)
	var ref: String = marks.refs[labels._shown[0]]
	var picture := Image.create(4, 4, false, Image.FORMAT_RGBA8)
	picture.fill(Color.WHITE)
	marks.wear(ref, picture)
	var at: int = marks.refs.find(ref)
	var shown: Array[int] = [at]
	marks.show_pictures(shown)
	marks.fade(Marks.FADING)
	_check(marks.wearing(at) > marks.radius(), "a mark wearing its picture says how far it reaches")
	labels.pin(at)
	labels.choose(marks.settle(EYES), marks.facing(EYES, Vector3.FORWARD))
	labels.follow(EYES, Basis.IDENTITY, Labels.GROWING)
	var title: Label3D = labels.get_child(0)
	var mark: Vector3 = marks.global_transform * marks.local_at(at)
	var depth := -(mark - EYES).z
	var disc_top: float = (mark.y - EYES.y + marks.wearing(at) * marks.global_transform.basis.get_scale().x) / depth
	var title_middle := (title.global_position.y - EYES.y) / -(title.global_position - EYES).z
	_check(title.visible and title_middle > disc_top, "the title stands above the picture, not over it: %.4f over %.4f" % [title_middle, disc_top])
	_check(title.global_position.distance_to(EYES) < mark.distance_to(EYES) - marks.radius() * marks.global_transform.basis.get_scale().x, "and nearer the eyes than its mark")
	labels.pin(-1)


func _check(holds: bool, said: String) -> void:
	if not holds:
		_failed += 1
		printerr("  FAIL: ", said)
