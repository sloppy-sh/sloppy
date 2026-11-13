## Where the Sets reading stands each tag, and each note among the tags it
## carries — derived from the notes alone, never kept: DESIGN.md § "The field in
## a room". A small force layout over how many notes each two tags share,
## seeded from the tags' names, so the same graph always stands the same way.
extends RefCounted

const Field := preload("res://field/field.gd")

## The most places drawn at once: one per hue slot (`DRAWN_SETS_MOST`).
const MOST := 8
## In metres: how far the places reach from their middle, as far as the field's
## third shell stands inside it, and the least a place is across, so the
## reader can stand in the smallest.
const REACHES := Field.FIRST + 2.0 * Field.STEP
const STANDABLE := 1.2
## Every length below is in the figure's own units, before it is brought to
## the field's size. A place one note carries, and how it grows with the cube
## root of the notes carrying it, so its volume follows its count.
const SMALLEST := 0.12
const GROWTH := 0.07
## The least room between two places that share no note.
const GAP := 0.1
## How deep two places sink into each other, as a share of the distance at which
## they touch: the least for one note shared, the most for every note of the smaller.
const SINK_LEAST := 0.25
const SINK_MOST := 0.6
const SEED_RADIUS := 0.7
const STEPS := 400
const STEP_RATE := 0.25
## How far inside a place a note stands, and how far past the
## outermost place a note in none stands.
const INSET := 0.03
const EDGE := 0.25
const SETTLING := 24


## The tags in front of the reader, the way `drawnSetsOf` ranks them with
## nothing selected: by the notes carrying each, most first, then by name.
## `counts` is `list_tags`' `{tag: notes}`; where it is empty the notes count.
static func drawn(notes: Array, counts: Dictionary = {}) -> Array[String]:
	var carried := counts.duplicate() if not counts.is_empty() else _counted(notes)
	var tags: Array[String] = []
	for tag in carried:
		tags.append(str(tag))
	tags.sort_custom(func(a, b): return carried[a] > carried[b] if carried[a] != carried[b] else a < b)
	return tags.slice(0, MOST)


## `{places: {tag: {centre: Vector3, radius: float, notes: int, slot: int}},
## notes: {ref: {position: Vector3, tags: Array[String]}}}` for `notes`, each
## `{note, tags}` as `field/list` answers it, in metres. `slot` is the hue slot,
## 1 to 8, in the ranking's order; a note's `tags` are the drawn ones it carries,
## in it.
static func place(notes: Array, counts: Dictionary = {}) -> Dictionary:
	var tags := drawn(notes, counts)
	var carried := _counted(notes)
	var places := {}
	for at in tags.size():
		var tag: String = tags[at]
		var count: int = counts.get(tag, carried.get(tag, 1))
		places[tag] = {
			"centre": _seed(tag),
			"radius": SMALLEST + GROWTH * (pow(float(count), 1.0 / 3.0) - 1.0),
			"notes": count,
			"slot": at + 1,
		}
	_settle(tags, places, _shared(notes, tags), carried)
	var stood := _stand_notes(notes, tags, places)
	var times := _to_size(tags, places)
	for tag in tags:
		places[tag].centre *= times
		places[tag].radius *= times
	for ref in stood:
		stood[ref].position *= times
	return {"places": places, "notes": stood}


## How many times larger the figure is drawn than it was laid out: its places
## reaching REACHES, and larger still where that leaves one under STANDABLE across.
static func _to_size(tags: Array[String], places: Dictionary) -> float:
	if tags.is_empty():
		return REACHES / (SMALLEST + EDGE)
	var outermost := 0.0
	var smallest := INF
	for tag in tags:
		outermost = maxf(outermost, places[tag].centre.length() + places[tag].radius)
		smallest = minf(smallest, places[tag].radius)
	return maxf(REACHES / outermost, STANDABLE / (2.0 * smallest))


static func _counted(notes: Array) -> Dictionary:
	var carried := {}
	for note in notes:
		for tag in _tags_of(note):
			carried[tag] = carried.get(tag, 0) + 1
	return carried


static func _tags_of(note) -> Array[String]:
	var tags: Array[String] = []
	if note is Dictionary and note.get("tags") is Array:
		for tag in note.tags:
			if tag is String and not tags.has(tag):
				tags.append(tag)
	return tags


## How many notes carry both of two drawn tags, keyed `"a\nb"` with a before b.
static func _shared(notes: Array, tags: Array[String]) -> Dictionary:
	var shared := {}
	for note in notes:
		var held := _tags_of(note).filter(func(tag): return tags.has(tag))
		held.sort()
		for one in held.size():
			for two in range(one + 1, held.size()):
				var key: String = held[one] + "\n" + held[two]
				shared[key] = shared.get(key, 0) + 1
	return shared


static func _seed(tag: String) -> Vector3:
	var rise := 1.0 - 2.0 * float(Field.fnv1a32(tag + "#rise")) / 4294967296.0
	var around := Field.sector(tag)
	var level := sqrt(maxf(0.0, 1.0 - rise * rise))
	return Vector3(level * cos(around), rise, level * sin(around)) * SEED_RADIUS


## Each pair eased toward the distance what they share asks for, in the
## ranking's order, the same number of times whatever the graph: places that
## share notes sink into each other by how much they share, and places that
## share none are only ever pushed apart.
static func _settle(tags: Array[String], places: Dictionary, shared: Dictionary, carried: Dictionary) -> void:
	for _step in STEPS:
		for one in tags.size():
			for two in range(one + 1, tags.size()):
				var a: Dictionary = places[tags[one]]
				var b: Dictionary = places[tags[two]]
				var key: String = tags[one] + "\n" + tags[two] if tags[one] < tags[two] else tags[two] + "\n" + tags[one]
				var both: int = shared.get(key, 0)
				var touching: float = a.radius + b.radius
				var apart: Vector3 = b.centre - a.centre
				var distance := apart.length()
				var wanted: float
				if both > 0:
					var smaller := mini(carried.get(tags[one], 1), carried.get(tags[two], 1))
					wanted = touching * (1.0 - lerpf(SINK_LEAST, SINK_MOST, clampf(float(both) / smaller, 0.0, 1.0)))
				elif distance < touching + GAP:
					wanted = touching + GAP
				else:
					continue
				var along := apart / distance if distance > 1e-6 else Vector3.RIGHT
				var move := along * (distance - wanted) * 0.5 * STEP_RATE
				a.centre += move
				b.centre -= move
	var middle := Vector3.ZERO
	for tag in tags:
		middle += places[tag].centre
	if not tags.is_empty():
		middle /= tags.size()
	for tag in tags:
		places[tag].centre -= middle


## Every note inside each place it carries, and outside each it does not as
## near as spheres allow, from where the places it carries meet; a note
## carrying none stands on a ring past the outermost place.
static func _stand_notes(notes: Array, tags: Array[String], places: Dictionary) -> Dictionary:
	var outermost := 0.0
	for tag in tags:
		outermost = maxf(outermost, places[tag].centre.length() + places[tag].radius)
	var stood := {}
	for note in notes:
		if not note is Dictionary or not note.get("note") is String:
			continue
		var ref: String = note.note
		var held: Array[String] = []
		for tag in tags:
			if _tags_of(note).has(tag):
				held.append(tag)
		var position := _on_edge(ref, outermost) if held.is_empty() else _among(ref, held, tags, places)
		stood[ref] = {"position": position, "tags": held}
	return stood


static func _on_edge(ref: String, outermost: float) -> Vector3:
	var around := Field.sector(ref)
	var rise := (float(Field.fnv1a32(ref + "#rise")) / 4294967296.0 - 0.5) * 0.3
	return Vector3(cos(around), 0.0, sin(around)) * (outermost + EDGE) + Vector3(0.0, rise, 0.0)


static func _among(ref: String, held: Array[String], tags: Array[String], places: Dictionary) -> Vector3:
	var at := Vector3.ZERO
	var smallest := INF
	for tag in held:
		at += places[tag].centre
		smallest = minf(smallest, places[tag].radius)
	at /= held.size()
	var rise := 1.0 - 2.0 * float(Field.fnv1a32(ref + "#rise")) / 4294967296.0
	var level := sqrt(maxf(0.0, 1.0 - rise * rise))
	var around := Field.sector(ref)
	var reach := float(Field.fnv1a32(ref + "#reach")) / 4294967296.0
	at += Vector3(level * cos(around), rise, level * sin(around)) * smallest * 0.6 * reach
	for _pass in SETTLING:
		for tag in tags:
			at = _into(at, places[tag], held.has(tag))
	for _pass in SETTLING:
		for tag in held:
			at = _into(at, places[tag], true)
	return at


## `at` moved the least that puts it inside `place`, or outside it.
static func _into(at: Vector3, place: Dictionary, inside: bool) -> Vector3:
	var off: Vector3 = at - place.centre
	var reach: float = place.radius - INSET if inside else place.radius + INSET
	if inside == (off.length() <= reach):
		return at
	var away := off.normalized() if off.length() > 1e-6 else Vector3.UP
	return place.centre + away * reach
