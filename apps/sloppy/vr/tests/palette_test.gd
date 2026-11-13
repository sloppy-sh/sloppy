## Which colour a mark wears, by the canvas's rules. Run from apps/sloppy/vr
## with `Godot --headless --script res://tests/palette_test.gd`.
extends SceneTree

const Palette := preload("res://field/palette.gd")

var _failed := 0


func _initialize() -> void:
	_ranks_the_most_carried_first_then_by_name()
	_keeps_eight_at_most()
	_counts_a_tag_once_per_note()
	_bands_in_the_order_the_rail_lists_them()
	_converts_as_the_canvas_does()
	_every_slot_clears_the_floor_and_stays_apart()
	_ramps_depth_in_ordered_distinct_steps()

	print("palette_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check(holds: bool, said: String) -> void:
	if not holds:
		_failed += 1
		printerr("  FAIL: ", said)


func _ranks_the_most_carried_first_then_by_name() -> void:
	var notes := [
		{"tags": ["seed", "question"]},
		{"tags": ["seed", "biology"]},
		{"tags": ["seed", "question", "art"]},
		{"tags": ["biology"]},
		{"tags": []},
		{},
	]
	_check(Palette.drawn_sets(notes) == ["seed", "biology", "question", "art"], "ranked %s" % [Palette.drawn_sets(notes)])


func _keeps_eight_at_most() -> void:
	var notes := []
	for at in 12:
		var tags := []
		for tag in range(at, 12):
			tags.append("t%02d" % tag)
		notes.append({"tags": tags})
	var drawn := Palette.drawn_sets(notes)
	_check(drawn.size() == Palette.SLOTS, "eight drawn of twelve")
	_check(drawn[0] == "t11" and drawn[7] == "t04", "the most carried kept %s" % [drawn])


func _counts_a_tag_once_per_note() -> void:
	var drawn := Palette.drawn_sets([{"tags": ["b", "b", "b"]}, {"tags": ["a"]}, {"tags": ["a"]}])
	_check(drawn == ["a", "b"], "a repeated tag counted once %s" % [drawn])


func _bands_in_the_order_the_rail_lists_them() -> void:
	var drawn: Array[String] = ["seed", "biology", "question", "art"]
	_check(Palette.bands(["art", "seed"], drawn) == [1, 4], "bands follow the rail")
	_check(Palette.bands(["unranked"], drawn).is_empty(), "a tag past the eight wears nothing")
	_check(Palette.bands([], drawn).is_empty(), "a note carrying nothing wears its depth")


func _converts_as_the_canvas_does() -> void:
	# What `toSrgb8`, `contrastRatio` and `buildPalette` in @sloppy/graph give
	# for the Paper look's tokens.
	_check(Palette.to_color(Palette.PAPER).to_html(false) == "f8f5f1", "paper as bytes %s" % Palette.to_color(Palette.PAPER).to_html(false))
	_check(Palette.to_color(Palette.INK).to_html(false) == "29231c", "ink as bytes %s" % Palette.to_color(Palette.INK).to_html(false))
	_check(absf(Palette.contrast(Palette.INK, Palette.PAPER) - 14.2974) < 1e-3, "ink on paper %f" % Palette.contrast(Palette.INK, Palette.PAPER))
	var palette := Palette.new()
	var ramp := []
	for depth in range(1, 9):
		ramp.append(palette.depth(depth).to_html(false))
	_check(" ".join(ramp) == "29231c 39332c 49443d 5b554f 6d6761 7f7a74 928d88 928d88", "the depth ramp %s" % " ".join(ramp))
	var slots := []
	for slot in range(1, Palette.SLOTS + 1):
		slots.append(palette.slot(slot).to_html(false))
	_check(" ".join(slots) == "c5605a b47308 818c19 1d9a68 0095a1 3e87ce 8971c8 b5619b", "the slots %s" % " ".join(slots))


func _every_slot_clears_the_floor_and_stays_apart() -> void:
	var palette := Palette.new()
	var paper := _lch(palette.paper)
	for one in range(1, Palette.SLOTS + 1):
		_check(Palette.contrast(_lch(palette.slot(one)), paper) >= Palette.MARK_FLOOR - 0.01, "slot %d clears 3:1" % one)
		for two in range(one + 1, Palette.SLOTS + 1):
			_check(Palette.apart(_lch(palette.slot(one)), _lch(palette.slot(two))) >= 0.03, "slots %d and %d apart" % [one, two])


func _ramps_depth_in_ordered_distinct_steps() -> void:
	var palette := Palette.new()
	var paper := _lch(palette.paper)
	_check(palette.generations >= 2 and palette.generations <= Palette.DEPTH_STEPS + 1, "generations %d" % palette.generations)
	_check(palette.depth(1) == palette.ink, "a branch is in ink")
	var before := INF
	for depth in range(1, palette.generations + 1):
		var against := Palette.contrast(_lch(palette.depth(depth)), paper)
		_check(against >= Palette.MARK_FLOOR - 0.01, "depth %d clears 3:1" % depth)
		_check(against < before, "depth %d fainter than the one above it" % depth)
		before = against
	_check(palette.depth(palette.generations + 4) == palette.depth(palette.generations), "deeper than the ramp draws the last step")


## A drawn colour back as OKLCH, through the conversions the palette measures with.
func _lch(colour: Color) -> Array:
	var best := [0.0, 0.0, 0.0]
	var r := colour.r8
	var g := colour.g8
	var b := colour.b8
	var lin := []
	for c in [r, g, b]:
		var v: float = c / 255.0
		lin.append(v / 12.92 if v <= 0.04045 else pow((v + 0.055) / 1.055, 2.4))
	var l := pow(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2], 1.0 / 3.0)
	var m := pow(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2], 1.0 / 3.0)
	var s := pow(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2], 1.0 / 3.0)
	var lab_a := 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
	var lab_b := 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	best[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
	best[1] = Vector2(lab_a, lab_b).length()
	var h := rad_to_deg(atan2(lab_b, lab_a))
	best[2] = h + 360.0 if h < 0.0 else h
	return best
