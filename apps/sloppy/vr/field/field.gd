## Where every note stands in the room, derived from the genealogy alone and
## kept for this session only — DESIGN.md § "The field in a room", carried from
## packages/ts/graph/src/layout/geometry.ts into three dimensions. No address
## is read: a label moves no mark.
extends Node

## The reader standing at the root, each generation a shell around them.
const INSIDE := "inside"
## The field stood before the reader as an object.
const TREE := "tree"

## In metres. The farthest the branches stand from the field's centre.
const ROOT_RADIUS := 1.6
## How far apart two branches stand while the sphere has room for them.
const ROOT_SPACING := 0.4
## How far the branches reach above and below the centre, as a share of the radius.
const ROOT_RISE := 0.7
const STEP_FIRST := 0.5
const STEP_DECAY := 0.8
## In radians: the widest a child leans off its parent's outward direction.
const SPREAD_FIRST := 1.15
const SPREAD_DECAY := 0.66
## Saturates a run's fan, so 23 siblings still fit inside one spread.
const FAN_SOFT := 3.0
## In metres: the least room between two marks once the field is eased apart.
const ROOM := 0.03
## How many passes ease a crowded field apart.
const EASING := 24
## In metres, inside: the first generation's shell, an arm's length and a step
## out, and how much further each one after it stands.
const FIRST := 1.1
const STEP := 0.6
## The share of a cone its children spiral over, and of their share of it each
## one's own cone is drawn at, so neighbouring cones leave sky between them.
const PACKING := 0.8
const GOLDEN := PI * (3.0 - sqrt(5.0))


## Every note in `graph` — `field/list`'s answer, `{notes: [{note, parent?}]}` —
## by its ref, stood in `arrangement` (INSIDE or TREE) with every distance the
## genealogy decides multiplied by `spread`: `{position: Vector3, seed: Vector3,
## outward: Vector3, across: Vector3, depth: int, parent: String, ordinal: int,
## of: int}`. `position` is where the mark stands, `seed` where the genealogy
## put it before crowding eased it. `parent` is "" for a note with none in
## `graph`: a branch, an independent note, or one whose parent is not listed.
## `ordinal` is its place in its run from 1, of `of`; `outward` and `across` are
## the line its own children leave it along and the line they fan across.
## Inside, each note also carries `cone`, the half-angle in radians of the sky
## its subtree owns about `outward`, and `shell`, its generation out from the
## reader; the root of a graph with one stands at the origin, on shell 0.
func derive(graph: Dictionary, arrangement := TREE, spread := 1.0) -> Dictionary:
	var by_ref := {}
	for note in graph.get("notes", []):
		if note is Dictionary and note.get("note") is String:
			by_ref[note.note] = note
	var parents := {}
	for ref in by_ref:
		var parent = by_ref[ref].get("parent")
		parents[ref] = parent if parent is String and by_ref.has(parent) else ""
	var ordinals := _run_ordinals(parents)
	var placed := _inside(parents, ordinals, spread) if arrangement == INSIDE else _tree(parents, ordinals, spread)
	_ease_apart(placed)
	return placed


func _tree(parents: Dictionary, ordinals: Dictionary, spread: float) -> Dictionary:
	var on_sphere := 0
	for ref in parents:
		if parents[ref] == "":
			on_sphere += 1
	var radius := minf(ROOT_RADIUS, sqrt(on_sphere * ROOT_SPACING * ROOT_SPACING / (4.0 * PI)))
	var placed := {}
	for ref in parents:
		_place(ref, parents, ordinals, radius, placed)
	for ref in placed:
		placed[ref].position *= spread
		placed[ref].seed *= spread
	return placed


## The sector `refSector` in `@sloppy/types` gives the same ref, in `[0, TAU)`.
static func sector(ref: String) -> float:
	return float(fnv1a32(ref)) / 4294967296.0 * TAU


## FNV-1a, 32-bit, over the string's UTF-16 units — the hash `@sloppy/types`
## seeds every sector with, so a peer's field and this one turn alike.
static func fnv1a32(value: String) -> int:
	var hash := 0x811c9dc5
	var bytes := value.to_utf16_buffer()
	for at in range(0, bytes.size(), 2):
		hash ^= bytes[at] | (bytes[at + 1] << 8)
		hash = (hash * 0x01000193) & 0xFFFFFFFF
	return hash


func _run_ordinals(parents: Dictionary) -> Dictionary:
	var runs := {}
	for ref in parents:
		var parent: String = parents[ref]
		if parent == "":
			continue
		if not runs.has(parent):
			runs[parent] = []
		runs[parent].append(ref)
	var ordinals := {}
	for parent in runs:
		var run: Array = runs[parent]
		run.sort_custom(_written_before)
		for at in run.size():
			ordinals[run[at]] = Vector2i(at + 1, run.size())
	return ordinals


## The order a run was written in: a ref's ULID leads with the time it was made.
static func _written_before(one: String, two: String) -> bool:
	var first := one.get_slice("/", one.get_slice_count("/") - 1)
	var second := two.get_slice("/", two.get_slice_count("/") - 1)
	return first < second if first != second else one < two


func _place(ref: String, parents: Dictionary, ordinals: Dictionary, radius: float, placed: Dictionary) -> void:
	var chain: Array[String] = []
	var walking := {}
	var at := ref
	while at != "" and not placed.has(at) and not walking.has(at):
		walking[at] = true
		chain.append(at)
		at = parents[at]
	for index in range(chain.size() - 1, -1, -1):
		var under: String = chain[index]
		var parent: String = parents[under]
		if parent == "" or not placed.has(parent):
			placed[under] = _on_sphere(under, radius)
		else:
			placed[under] = _lean_off(under, parent, placed[parent], ordinals.get(under, Vector2i(1, 1)))


func _on_sphere(ref: String, radius: float) -> Dictionary:
	var rise := (1.0 - 2.0 * float(fnv1a32(ref + "#rise")) / 4294967296.0) * ROOT_RISE
	var around := sector(ref)
	var level := sqrt(1.0 - rise * rise)
	var outward := Vector3(level * cos(around), rise, level * sin(around))
	return _note(outward * radius, outward, ref, 1, "", 1, 1)


func _lean_off(ref: String, parent: String, from: Dictionary, ordinal: Vector2i) -> Dictionary:
	var depth: int = from.depth + 1
	var width := _fan_width(ordinal.y)
	var turn := (sector(parent) / PI - 1.0) * (1.0 - width)
	var lean := _spread_at(depth) * (_fan_offset(ordinal.x, ordinal.y) + turn)
	var outward: Vector3 = (from.outward * cos(lean) + from.across * sin(lean)).normalized()
	var step := STEP_FIRST * pow(STEP_DECAY, depth - 2)
	var position: Vector3 = from.position + outward * step
	return _note(position, position.normalized(), ref, depth, parent, ordinal.x, ordinal.y)


## Marks crowded closer than ROOM pushed apart across the shell each stands on,
## as the canvas's force pass resolves the crowding around the shape its seeds
## fix. None moves nearer the centre or further out, so a child stays further
## out than its parent; the refs are taken in their own order, so the field
## eases the same way every time it is read.
func _ease_apart(placed: Dictionary) -> void:
	var refs: Array = placed.keys()
	refs.sort()
	var at: Array[Vector3] = []
	var shell: Array[float] = []
	for ref in refs:
		at.append(placed[ref].position)
		shell.append(placed[ref].position.length())
	for _pass in EASING:
		var cells := {}
		for index in at.size():
			var cell := Vector3i((at[index] / ROOM).floor())
			if not cells.has(cell):
				cells[cell] = []
			cells[cell].append(index)
		var moved := false
		for index in at.size():
			var cell := Vector3i((at[index] / ROOM).floor())
			for dx in range(-1, 2):
				for dy in range(-1, 2):
					for dz in range(-1, 2):
						for other in cells.get(cell + Vector3i(dx, dy, dz), []):
							if other > index:
								moved = _push(at, shell, index, other, refs) or moved
		if not moved:
			break
	for index in refs.size():
		placed[refs[index]].position = at[index]


func _push(at: Array[Vector3], shell: Array[float], one: int, two: int, refs: Array) -> bool:
	var apart := at[one] - at[two]
	var distance := apart.length()
	if distance >= ROOM:
		return false
	var away := apart / distance if distance > 1e-9 else _across(at[one].normalized(), refs[one] + refs[two])
	var half := (ROOM - distance) * 0.5
	at[one] = _along_shell(at[one], away * half, shell[one])
	at[two] = _along_shell(at[two], -away * half, shell[two])
	return true


static func _along_shell(position: Vector3, push: Vector3, radius: float) -> Vector3:
	var outward := position.normalized()
	return (position + push - outward * push.dot(outward)).normalized() * radius


func _note(position: Vector3, outward: Vector3, ref: String, depth: int, parent: String, at: int, of: int) -> Dictionary:
	return {
		"position": position,
		"seed": position,
		"outward": outward,
		"across": _across(outward, ref),
		"depth": depth,
		"parent": parent,
		"ordinal": at,
		"of": of,
	}


## A line square to `outward`, turned about it by the note's own sector, so
## each subtree fans in a plane of its own.
static func _across(outward: Vector3, ref: String) -> Vector3:
	var square := outward.cross(Vector3.UP)
	if square.length_squared() < 1e-6:
		square = outward.cross(Vector3.RIGHT)
	return square.normalized().rotated(outward, sector(ref))


static func _spread_at(depth: int) -> float:
	return SPREAD_FIRST * pow(SPREAD_DECAY, depth - 2)


## A sibling's place across its parent's fan, in `(-1, 1)`, in the order the run
## was written.
static func _fan_offset(at: int, of: int) -> float:
	if of < 2:
		return 0.0
	return _fan_width(of) * (2.0 * (at - 1) / (of - 1) - 1.0)


static func _fan_width(of: int) -> float:
	if of < 2:
		return 0.0
	var half := (of - 1) / 2.0
	return half / (half + FAN_SOFT)


func _inside(parents: Dictionary, ordinals: Dictionary, spread: float) -> Dictionary:
	var family := _family(parents, ordinals)
	var under: Dictionary = family.under
	var weight: Dictionary = family.weight
	var tops: Array = family.tops
	var placed := {}
	var first: Array = tops
	var depth_of_first := 1
	if tops.size() == 1:
		var root: String = tops[0]
		placed[root] = _note(Vector3.ZERO, Vector3.FORWARD, root, 1, "", 1, 1)
		placed[root].cone = PI
		placed[root].shell = 0
		first = under.get(root, [])
		depth_of_first = 2
	var cones := _around(first, weight)
	var reach := []
	for at in first.size():
		reach.append([first[at], cones[at][0], cones[at][1], 1, depth_of_first])
	while not reach.is_empty():
		var next := []
		for held in reach:
			var ref: String = held[0]
			var axis: Vector3 = held[1]
			var shell: int = held[3]
			var position := axis * spread * (FIRST + (shell - 1) * STEP)
			var ordinal: Vector2i = ordinals.get(ref, Vector2i(1, 1))
			placed[ref] = _note(position, axis, ref, held[4], parents[ref], ordinal.x, ordinal.y)
			placed[ref].cone = held[2]
			placed[ref].shell = shell
			var run: Array = under.get(ref, [])
			var spiral := _spiral(axis, held[2], placed[ref].across, ref, run, weight)
			for at in run.size():
				next.append([run[at], spiral[at][0], spiral[at][1], shell + 1, held[4] + 1])
		reach = next
	return placed


## Who springs from whom, each run in its order; how many notes each subtree
## holds; and the notes nothing in `parents` springs them from. A note on a
## loop of parents is taken as springing from nothing, the first of the loop by
## ref, as the tree arrangement seats one.
func _family(parents: Dictionary, ordinals: Dictionary) -> Dictionary:
	var under := {}
	var tops: Array = []
	var refs: Array = parents.keys()
	refs.sort()
	for ref in refs:
		if parents[ref] == "":
			tops.append(ref)
		else:
			if not under.has(parents[ref]):
				under[parents[ref]] = []
			under[parents[ref]].append(ref)
	for parent in under:
		under[parent].sort_custom(func(a, b): return ordinals[a].x < ordinals[b].x)
	var order: Array = []
	var reached := {}
	var walk := tops.duplicate()
	for ref in refs:
		while not walk.is_empty():
			var at: String = walk.pop_back()
			reached[at] = true
			order.append(at)
			walk.append_array(under.get(at, []))
		if not reached.has(ref):
			tops.append(ref)
			under[parents[ref]].erase(ref)
			parents[ref] = ""
			walk.append(ref)
	while not walk.is_empty():
		var at: String = walk.pop_back()
		order.append(at)
		walk.append_array(under.get(at, []))
	var weight := {}
	for at in range(order.size() - 1, -1, -1):
		var ref: String = order[at]
		var held := 1
		for child in under.get(ref, []):
			held += weight[child]
		weight[ref] = held
	return {"under": under, "weight": weight, "tops": tops}


## The first generation round the reader: each by its ref's own bearing, in
## that order round the horizon, owning an arc of it as wide as its share of
## the notes, and a cone that wide.
func _around(first: Array, weight: Dictionary) -> Array:
	var cones := []
	cones.resize(first.size())
	if first.is_empty():
		return cones
	var order := range(first.size())
	order.sort_custom(func(a, b): return sector(first[a]) < sector(first[b]) or (sector(first[a]) == sector(first[b]) and first[a] < first[b]))
	var total := 0.0
	for ref in first:
		total += weight[ref]
	var start: float = sector(first[order[0]]) - PI * weight[first[order[0]]] / total
	var before := 0.0
	for at in order:
		var share: float = weight[first[at]] / total
		var bearing := start + TAU * (before + share * 0.5)
		before += share
		cones[at] = [Vector3(cos(bearing), 0.0, sin(bearing)), PACKING * PI * share]
	return cones


## A run of siblings over the cap of their parent's cone, `half` about `axis`:
## a spiral in run order, the first nearest the middle, each one as far out as
## the notes before it have used of the cap, each owning a cone its share wide,
## narrowed until it touches no sibling's and stays inside its parent's.
func _spiral(axis: Vector3, half: float, across: Vector3, parent: String, run: Array, weight: Dictionary) -> Array:
	var placed := []
	if run.size() == 1:
		placed.append([axis, half])
		return placed
	var total := 0.0
	for ref in run:
		total += weight[ref]
	var aside := axis.cross(across).normalized()
	var turn := sector(parent)
	var before := 0.0
	var widest := 0.0
	for at in run.size():
		var share: float = weight[run[at]] / total
		var off := PACKING * half * sqrt(before + share * 0.5)
		before += share
		var around := turn + at * GOLDEN
		var bearing := (axis * cos(off) + (across * cos(around) + aside * sin(around)) * sin(off)).normalized()
		var cone := minf(PACKING * half * sqrt(share), half - off)
		widest = maxf(widest, cone)
		placed.append([bearing, cone])
	_part(placed, widest)
	return placed


## Narrows each of `cones` (`[bearing, half-angle]`) by every neighbour it
## reaches, each giving up its part of the overlap in proportion to its width,
## so no two meet.
static func _part(cones: Array, widest: float) -> void:
	var cell := maxf(2.0 * sin(minf(widest * 2.0, PI) * 0.5), 1e-3)
	var cells := {}
	for at in cones.size():
		var key := Vector3i((cones[at][0] / cell).floor())
		if not cells.has(key):
			cells[key] = []
		cells[key].append(at)
	var wanted: Array = cones.map(func(held): return held[1])
	for at in cones.size():
		var key := Vector3i((cones[at][0] / cell).floor())
		for dx in range(-1, 2):
			for dy in range(-1, 2):
				for dz in range(-1, 2):
					for other in cells.get(key + Vector3i(dx, dy, dz), []):
						if other == at:
							continue
						var apart: float = cones[at][0].angle_to(cones[other][0])
						var both: float = wanted[at] + wanted[other]
						if both > apart and both > 0.0:
							cones[at][1] = minf(cones[at][1], apart * wanted[at] / both)
