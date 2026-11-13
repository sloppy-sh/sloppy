## What a mark shows at the distance it is read from. Run from apps/sloppy/vr
## with `Godot --headless --script res://tests/lod_test.gd`.
extends SceneTree

const Lod := preload("res://field/lod.gd")
const Graph := preload("res://views/graph.gd")

var _failed := 0


func _initialize() -> void:
	_bands_go_with_distance_and_many_go_first()
	_bands_hang_on_past_the_floor()
	_one_band_is_always_worn()
	_titles_fade_from_the_nearest_to_the_farthest()
	_titles_the_nearest_and_no_more()
	_titles_the_nearest_wherever_the_reader_stands()
	_titles_only_what_the_eyes_face()
	_titles_hold_against_a_mark_barely_nearer()
	_pictures_are_worn_by_range_wherever_the_eyes_face()
	_pictures_hold_past_the_range_they_came_in_at()
	_pictures_stay_while_walking_through_them()
	_pictures_are_asked_for_a_few_at_a_time()

	print("lod_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check(holds: bool, said: String) -> void:
	if not holds:
		_failed += 1
		printerr("  FAIL: ", said)


## The distance at which `count` bands on a leaf come out exactly at the floor.
func _edge(count: int) -> float:
	return 2.0 * Lod.MARK_RADIUS / count / Lod.BAND_MIN_ANGLE


func _bands_go_with_distance_and_many_go_first() -> void:
	var r := Lod.MARK_RADIUS
	_check(Lod.bands_shown(r, 0.5, 3, false), "three bands at arm's length")
	_check(not Lod.bands_shown(r, _edge(2) * 1.01, 2, false), "two bands go past their edge")
	_check(Lod.bands_shown(r, _edge(2) * 0.99, 2, false), "two bands stay inside it")
	_check(_edge(8) < _edge(3) and _edge(3) < _edge(2), "a mark in many sets loses its bands first")
	_check(Lod.bands_shown(r * 3.0, _edge(2) * 2.5, 2, false), "a field made larger holds them further off")


func _bands_hang_on_past_the_floor() -> void:
	var r := Lod.MARK_RADIUS
	var past := _edge(3) * 1.2
	_check(not Lod.bands_shown(r, past, 3, false), "not taken up just past the edge")
	_check(Lod.bands_shown(r, past, 3, true), "kept just past the edge once worn")
	_check(not Lod.bands_shown(r, _edge(3) / Lod.BAND_HYSTERESIS * 1.01, 3, true), "let go past the hysteresis")


func _one_band_is_always_worn() -> void:
	_check(Lod.bands_shown(Lod.MARK_RADIUS, 1000.0, 1, false), "a mark in one set is that hue at any distance")
	_check(Lod.bands_shown(Lod.MARK_RADIUS, 1000.0, 0, false), "a mark in none keeps its depth")


func _titles_fade_from_the_nearest_to_the_farthest() -> void:
	_check(Lod.title_alpha(2.0, 2.0, 5.0) == 1.0, "the nearest is whole")
	_check(is_equal_approx(Lod.title_alpha(5.0, 2.0, 5.0), Lod.TITLE_FAINTEST), "the farthest is faintest")
	_check(Lod.title_alpha(3.0, 3.0, 3.0) == 1.0, "a lone title is whole")
	var before := 2.0
	for step in 20:
		var alpha := Lod.title_alpha(2.0 + 3.0 * step / 19.0, 2.0, 5.0)
		_check(alpha <= before and alpha >= Lod.TITLE_FAINTEST, "fading steadily")
		before = alpha


func _titles_the_nearest_and_no_more() -> void:
	var distances := PackedFloat32Array()
	for at in 40:
		distances.append(0.05 * (40 - at))
	var ahead := PackedFloat32Array()
	ahead.resize(distances.size())
	ahead.fill(1.0)
	var titled := Lod.titled(distances, ahead)
	_check(titled.size() == Lod.TITLES_MOST, "at most %d titles, gave %d" % [Lod.TITLES_MOST, titled.size()])
	_check(titled[0] == 39 and titled[1] == 38, "nearest first %s" % [titled.slice(0, 3)])
	for at in titled:
		_check(at >= 40 - Lod.TITLES_MOST, "only the nearest are titled")


func _titles_the_nearest_wherever_the_reader_stands() -> void:
	var far := Lod.titled(PackedFloat32Array([5.0, 9.0, 3.0]), PackedFloat32Array([1.0, 1.0, 1.0]))
	_check(far == [2, 0, 1], "titled from across the room too, nearest first: %s" % [far])


func _titles_only_what_the_eyes_face() -> void:
	var distances := PackedFloat32Array([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3])
	var facing := PackedFloat32Array([-1.0, -0.5, 0.0, 0.3, 0.5, 0.62, 0.98])
	var titled := Lod.titled(distances, facing)
	_check(titled == [6], "the one ahead is titled, the six nearer beside or behind are not: %s" % [titled])


func _titles_hold_against_a_mark_barely_nearer() -> void:
	var distances := PackedFloat32Array()
	var ahead := PackedFloat32Array()
	for at in Lod.TITLES_MOST + 1:
		distances.append(1.0 + 0.01 * at)
		ahead.append(1.0)
	var first := Lod.titled(distances, ahead)
	_check(not first.has(Lod.TITLES_MOST), "the farthest is left out at first")
	distances[Lod.TITLES_MOST] = distances[Lod.TITLES_MOST - 1] - 0.005
	var again := Lod.titled(distances, ahead, first)
	_check(again == first, "a mark barely nearer does not take a title: %s" % [again])
	distances[Lod.TITLES_MOST] = 0.5
	_check(Lod.titled(distances, ahead, first).has(Lod.TITLES_MOST), "a mark well nearer does")
	var edge := PackedFloat32Array([0.72])
	var held: Array[int] = [0]
	_check(Lod.titled(PackedFloat32Array([1.0]), edge).is_empty(), "not taken up just past the cone")
	_check(Lod.titled(PackedFloat32Array([1.0]), edge, held) == [0], "kept just past it once titled")


func _pictures_are_worn_by_range_wherever_the_eyes_face() -> void:
	var distances := PackedFloat32Array()
	for at in 60:
		distances.append(0.1 + 0.2 * (60 - at))
	distances[59] = INF
	var held: Array[int] = []
	var worn := Lod.worn(distances, held, Graph.PICTURES_WITHIN, Graph.PICTURES_BEYOND)
	var within := 0
	for at in distances.size():
		within += int(distances[at] >= Graph.PICTURES_BEYOND and distances[at] <= Graph.PICTURES_WITHIN)
	_check(worn.size() == within and within > Graph.PICTURES_MOST, "every one in range is worn, however many: %d of %d" % [worn.size(), within])
	_check(worn[0] == 58, "nearest first, none with nothing to wear: %s" % [worn.slice(0, 2)])
	_check(not worn.has(59), "none with nothing to wear")
	_check(Lod.worn(PackedFloat32Array([0.2]), held, Graph.PICTURES_WITHIN, Graph.PICTURES_BEYOND).is_empty(), "none the reader stands inside")


func _pictures_hold_past_the_range_they_came_in_at() -> void:
	var past := PackedFloat32Array([Graph.PICTURES_WITHIN * 1.1])
	var none: Array[int] = []
	var held: Array[int] = [0]
	_check(Lod.worn(past, none, Graph.PICTURES_WITHIN, Graph.PICTURES_BEYOND).is_empty(), "not taken up just past the range")
	_check(Lod.worn(past, held, Graph.PICTURES_WITHIN, Graph.PICTURES_BEYOND) == [0], "kept just past it once worn")
	var gone := PackedFloat32Array([Graph.PICTURES_WITHIN * Lod.PICTURES_HELD * 1.01])
	_check(Lod.worn(gone, held, Graph.PICTURES_WITHIN, Graph.PICTURES_BEYOND).is_empty(), "let go past the hold")


## Thirty pictured marks in a strip the reader walks down, 0.3 m between settles,
## some behind and some beside: a picture leaves only when its mark leaves the range.
func _pictures_stay_while_walking_through_them() -> void:
	var random := RandomNumberGenerator.new()
	random.seed = 7
	var marks: Array[Vector3] = []
	for at in 30:
		marks.append(Vector3(random.randf_range(-4.0, 4.0), 0.0, random.randf_range(-40.0, 0.0)))
	var worn: Array[int] = []
	var changes := 0
	for step in 120:
		var eye := Vector3(0.0, 0.0, 6.0 - 0.3 * step)
		var distances := PackedFloat32Array()
		for at in marks.size():
			distances.append(eye.distance_to(marks[at]))
		var now := Lod.worn(distances, worn, Graph.PICTURES_WITHIN, Graph.PICTURES_BEYOND)
		for at in worn:
			if not now.has(at):
				changes += 1
				_check(distances[at] > Graph.PICTURES_WITHIN * Lod.PICTURES_HELD or distances[at] < Graph.PICTURES_BEYOND, "a picture in range stays, mark %d at step %d" % [at, step])
		for at in now:
			if not worn.has(at):
				changes += 1
		worn = now
	_check(changes <= 30 * 4, "each picture comes and goes no more than twice on one walk, %d changes" % changes)


func _pictures_are_asked_for_a_few_at_a_time() -> void:
	var worn: Array[int] = [7, 3, 9, 1, 4]
	_check(Lod.to_ask(worn, {}, 0, 3) == [7, 3, 9], "the nearest first, no more than the most at once")
	_check(Lod.to_ask(worn, {7: true, 3: true}, 1, 3) == [9, 1], "none asked twice, and only while room remains")
	_check(Lod.to_ask(worn, {}, 3, 3).is_empty(), "none while the most are being asked")
