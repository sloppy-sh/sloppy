## Field.derive over a generated graph. Run from apps/sloppy/vr with
## `Godot --headless --script res://tests/field_test.gd`; it exits 1 on a failure.
extends SceneTree

const OWNER := "did:syr:z6MkFieldTestOwner"
const NOTES := 400

var _field: Node
var _failed := 0


func _initialize() -> void:
	_field = load("res://field/field.gd").new()
	var graph := _generated(NOTES, 7)
	var placed: Dictionary = _field.derive(graph)

	_hashes_as_the_canvas_does()
	_places_every_note(graph, placed)
	_is_deterministic_whatever_order_it_is_read_in(graph, placed)
	_stands_every_child_further_out_than_its_parent(placed)
	_keeps_each_run_in_the_order_it_was_written(placed)
	_moves_nothing_for_a_label(graph, placed)
	_puts_nothing_on_top_of_anything(placed)
	_seats_a_note_whose_parent_is_absent_on_the_sphere()
	_scales_every_distance_by_the_spread(graph, _field.TREE)

	for grown in [graph, _one_root(_generated(NOTES, 11))]:
		var inside: Dictionary = _field.derive(grown, _field.INSIDE)
		_places_every_note(grown, inside)
		_is_deterministic_inside(grown, inside)
		_stands_every_child_further_out_than_its_parent(inside)
		_stands_each_generation_on_its_shell(inside)
		_gives_no_two_subtrees_one_piece_of_sky(inside)
		_spirals_each_run_out_from_the_middle_in_order(inside)
		_moves_nothing_for_a_label_inside(grown, inside)
		_scales_every_distance_by_the_spread(grown, _field.INSIDE)
	_stands_the_reader_at_a_lone_root()
	_clusters_thirty_siblings()

	_field.free()
	print("field_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check(holds: bool, said: String) -> void:
	if not holds:
		_failed += 1
		printerr("  FAIL: ", said)


## A graph of `count` notes grown from a seed: a few branches, an independent
## note or two, runs of every width, some deep, some carrying an address.
func _generated(count: int, seed: int) -> Dictionary:
	var random := RandomNumberGenerator.new()
	random.seed = seed
	var notes: Array = []
	var refs: Array[String] = []
	for at in count:
		var ref := "%s/%s" % [OWNER, _ulid(at, random)]
		var note := {"note": ref, "title": "Note %d" % at, "tags": []}
		if at >= 6 and random.randf() > 0.02:
			var reach := mini(refs.size(), 40 if random.randf() < 0.5 else refs.size())
			note["parent"] = refs[refs.size() - 1 - random.randi_range(0, reach - 1)]
		if random.randf() < 0.5:
			note["address"] = "%d" % at
		notes.append(note)
		refs.append(ref)
	return {"notes": notes}


## Crockford base32, the time first, so the generated refs sort as written.
func _ulid(at: int, random: RandomNumberGenerator) -> String:
	const LETTERS := "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	var time := "%010d" % (1700000000 + at * 37)
	var rest := ""
	for _i in 16:
		rest += LETTERS[random.randi_range(0, 31)]
	return time + rest


func _hashes_as_the_canvas_does() -> void:
	# The values `refSector` in @sloppy/types gives for the same strings.
	_check(_field.fnv1a32("did:syr:z6MkAda/01J8ZQ7X9KACDEFGHJKMNPQRST") == 932989482, "fnv of a ref")
	_check(_field.fnv1a32("a") == 3826002220, "fnv of a letter")
	_check(_field.fnv1a32("") == 2166136261, "fnv of nothing")
	_check(absf(_field.sector("a") - 5.597127818954289) < 1e-9, "sector of a letter")


func _places_every_note(graph: Dictionary, placed: Dictionary) -> void:
	_check(placed.size() == graph.notes.size(), "every note placed")
	for ref in placed:
		var position: Vector3 = placed[ref].position
		_check(position.is_finite(), "a finite position for %s" % ref)


func _is_deterministic_whatever_order_it_is_read_in(graph: Dictionary, placed: Dictionary) -> void:
	var again: Dictionary = _field.derive(graph)
	var shuffled: Array = graph.notes.duplicate()
	var random := RandomNumberGenerator.new()
	random.seed = 99
	for at in range(shuffled.size() - 1, 0, -1):
		var other := random.randi_range(0, at)
		var held = shuffled[at]
		shuffled[at] = shuffled[other]
		shuffled[other] = held
	var reordered: Dictionary = _field.derive({"notes": shuffled})
	for ref in placed:
		_check(again[ref].position == placed[ref].position, "the same place twice for %s" % ref)
		_check(reordered[ref].position == placed[ref].position, "the same place read in another order for %s" % ref)


func _stands_every_child_further_out_than_its_parent(placed: Dictionary) -> void:
	var children := 0
	for ref in placed:
		var parent: String = placed[ref].parent
		if parent == "":
			_check(placed[ref].depth == 1, "a note on the sphere is at depth 1")
			continue
		children += 1
		_check(placed[ref].depth == placed[parent].depth + 1, "a child one deeper than its parent")
		_check(
			placed[ref].position.length() > placed[parent].position.length(),
			"%s further out than its parent" % ref
		)
		_check(
			absf(placed[ref].position.length() - placed[ref].seed.length()) < 1e-4,
			"%s eased across its shell, never in or out" % ref
		)
	_check(children > NOTES / 2, "the generated graph is mostly children")


func _keeps_each_run_in_the_order_it_was_written(placed: Dictionary) -> void:
	var runs := {}
	for ref in placed:
		var parent: String = placed[ref].parent
		if parent != "":
			if not runs.has(parent):
				runs[parent] = []
			runs[parent].append(ref)
	var wide := 0
	for parent in runs:
		var run: Array = runs[parent]
		run.sort()
		if run.size() > 2:
			wide += 1
		var from: Dictionary = placed[parent]
		var before := -INF
		for at in run.size():
			var note: Dictionary = placed[run[at]]
			_check(note.ordinal == at + 1 and note.of == run.size(), "ordinal %d of %d" % [at + 1, run.size()])
			var leaning: float = (note.seed - from.seed).normalized().dot(from.across)
			_check(leaning > before, "%s after the sibling before it" % run[at])
			before = leaning
	_check(wide > 5, "the generated graph has runs wider than two")


func _moves_nothing_for_a_label(graph: Dictionary, placed: Dictionary) -> void:
	var relabelled: Array = []
	for note in graph.notes:
		var held: Dictionary = note.duplicate()
		if held.has("address"):
			held.erase("address")
		else:
			held["address"] = "9z9"
		relabelled.append(held)
	var after: Dictionary = _field.derive({"notes": relabelled})
	for ref in placed:
		_check(after[ref].position == placed[ref].position, "a label moved %s" % ref)


func _puts_nothing_on_top_of_anything(placed: Dictionary) -> void:
	var positions: Array = []
	for ref in placed:
		positions.append(placed[ref].position)
	var nearest := INF
	for one in positions.size():
		for two in range(one + 1, positions.size()):
			nearest = minf(nearest, positions[one].distance_to(positions[two]))
	_check(nearest > _field.ROOM / 2.0, "two notes closer than half the room between marks (%f)" % nearest)


## `graph` with every note that springs from nothing but the first put under it.
func _one_root(graph: Dictionary) -> Dictionary:
	var root := ""
	for note in graph.notes:
		if not note.has("parent"):
			if root == "":
				root = note.note
			else:
				note["parent"] = root
	return graph


func _is_deterministic_inside(graph: Dictionary, placed: Dictionary) -> void:
	var shuffled: Array = graph.notes.duplicate()
	shuffled.reverse()
	var again: Dictionary = _field.derive({"notes": shuffled}, _field.INSIDE)
	for ref in placed:
		_check(again[ref].position == placed[ref].position, "the same place inside read in another order for %s" % ref)


func _stands_each_generation_on_its_shell(placed: Dictionary) -> void:
	for ref in placed:
		var shell: int = placed[ref].shell
		var radius: float = 0.0 if shell == 0 else _field.FIRST + (shell - 1) * _field.STEP
		_check(absf(placed[ref].seed.length() - radius) < 1e-4, "%s on shell %d" % [ref, shell])
		if placed[ref].parent != "":
			_check(shell == placed[placed[ref].parent].shell + 1, "%s one shell past its parent" % ref)


## Every pair of notes neither of which springs from the other owns sky apart.
func _gives_no_two_subtrees_one_piece_of_sky(placed: Dictionary) -> void:
	var refs: Array = placed.keys().filter(func(ref): return placed[ref].shell > 0)
	var overlaps := 0
	for one in refs.size():
		for two in range(one + 1, refs.size()):
			var a: String = refs[one]
			var b: String = refs[two]
			if _springs_from(placed, a, b) or _springs_from(placed, b, a):
				continue
			var apart: float = placed[a].outward.angle_to(placed[b].outward)
			if apart + 1e-5 < placed[a].cone + placed[b].cone:
				overlaps += 1
	_check(overlaps == 0, "%d pairs of subtrees share sky" % overlaps)
	for ref in refs:
		var parent: String = placed[ref].parent
		if parent != "" and placed[parent].shell > 0:
			var off: float = placed[ref].outward.angle_to(placed[parent].outward)
			_check(off + placed[ref].cone <= placed[parent].cone + 1e-5, "%s inside its parent's cone" % ref)
		_check(placed[ref].cone > 0.0, "%s owns some sky" % ref)


func _springs_from(placed: Dictionary, child: String, ancestor: String) -> bool:
	var at: String = placed[child].parent
	while at != "":
		if at == ancestor:
			return true
		at = placed[at].parent
	return false


func _spirals_each_run_out_from_the_middle_in_order(placed: Dictionary) -> void:
	var runs := {}
	for ref in placed:
		var parent: String = placed[ref].parent
		if parent != "" and placed[parent].shell > 0:
			if not runs.has(parent):
				runs[parent] = []
			runs[parent].append(ref)
	for parent in runs:
		var run: Array = runs[parent]
		run.sort_custom(func(a, b): return placed[a].ordinal < placed[b].ordinal)
		var before := -1.0
		for ref in run:
			var off: float = placed[ref].outward.angle_to(placed[parent].outward)
			_check(off > before or run.size() == 1, "%s further from the middle than the sibling before it" % ref)
			before = off


func _moves_nothing_for_a_label_inside(graph: Dictionary, placed: Dictionary) -> void:
	var relabelled: Array = []
	for note in graph.notes:
		var held: Dictionary = note.duplicate()
		held["address"] = "9z9" if not held.has("address") else held.address + "x"
		relabelled.append(held)
	var after: Dictionary = _field.derive({"notes": relabelled}, _field.INSIDE)
	for ref in placed:
		_check(after[ref].position == placed[ref].position, "a label moved %s inside" % ref)


func _scales_every_distance_by_the_spread(graph: Dictionary, arrangement: String) -> void:
	var near: Dictionary = _field.derive(graph, arrangement, 1.0)
	var far: Dictionary = _field.derive(graph, arrangement, 2.0)
	for ref in near:
		_check(far[ref].seed.is_equal_approx(near[ref].seed * 2.0), "%s %s twice as far at twice the room" % [ref, arrangement])
		_check(absf(far[ref].position.length() - near[ref].position.length() * 2.0) < 1e-4, "%s %s eased on a shell twice as wide" % [ref, arrangement])


func _stands_the_reader_at_a_lone_root() -> void:
	var root := OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQRS0"
	var notes: Array = [{"note": root}]
	for at in 3:
		notes.append({"note": OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQRT%d" % at, "parent": root})
	var placed: Dictionary = _field.derive({"notes": notes}, _field.INSIDE)
	_check(placed[root].position == Vector3.ZERO and placed[root].shell == 0, "a lone root stands where the reader does")
	for ref in placed:
		if ref != root:
			_check(absf(placed[ref].position.length() - _field.FIRST) < 1e-4, "a root's child at arm's length and a step")


## Thirty siblings stand as a cluster across both of their cap's directions, never along one line.
func _clusters_thirty_siblings() -> void:
	var root := OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQRS0"
	var branch := OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQRS1"
	var notes: Array = [{"note": root}, {"note": branch, "parent": root}, {"note": OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQRS2", "parent": root}]
	for at in 30:
		notes.append({"note": OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQ%03d" % at, "parent": branch})
	var placed: Dictionary = _field.derive({"notes": notes}, _field.INSIDE)
	var axis: Vector3 = placed[branch].outward
	var one: Vector3 = placed[branch].across
	var two := axis.cross(one)
	var reach := Vector2.ZERO
	for ref in placed:
		if placed[ref].parent == branch:
			var off: Vector3 = placed[ref].outward - axis * placed[ref].outward.dot(axis)
			reach = Vector2(maxf(reach.x, absf(off.dot(one))), maxf(reach.y, absf(off.dot(two))))
	_check(minf(reach.x, reach.y) > 0.5 * maxf(reach.x, reach.y), "thirty siblings spread both ways, %s" % reach)


func _seats_a_note_whose_parent_is_absent_on_the_sphere() -> void:
	var placed: Dictionary = _field.derive({"notes": [
		{"note": OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQRSA", "parent": OWNER + "/NOT-HERE"},
	]})
	var note: Dictionary = placed[OWNER + "/01J8ZQ7X9KACDEFGHJKMNPQRSA"]
	_check(note.parent == "" and note.depth == 1, "an absent parent seats a note on the sphere")
