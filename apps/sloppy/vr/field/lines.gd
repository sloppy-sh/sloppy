## The field's lines: what sprang from what as the tree's own structure, solid
## and in ink, and what an author linked by hand thinner, fainter and broken;
## each kind and each relation the reader can turn off, and a dense field's hand
## links quiet but round the notes in hand — DESIGN.md § "The field in a room"
## and § Edges. A target for `interaction/pointer.gd`: the line pointed at
## lights, and the trigger chooses it and then asks how to change it.
extends Node3D

## A pointer pulled its trigger on a line between `from` and `to`, `count` the
## hand links bundled where it landed (1 for a tree stem).
signal chosen(from: String, to: String, label: String, count: int)
## The trigger again on the line already chosen.
signal asked_about(from: String, to: String)

const Palette := preload("res://field/palette.gd")
const Settings := preload("res://field/settings.gd")
const HAND_LINK := preload("res://field/hand_link.gdshader")

## In metres at the field's scale.
const TREE_RADIUS := 0.0016
const DASH := 0.02
const GAP := 0.014
## How much of the ink each kind is drawn in, over the paper.
const TREE_INK := 0.55
const HAND_INK := 0.35
## `DENSE_LINKS_MOST` and `DENSE_LINKS_PER_MARK` in `scene.ts`.
const DENSE_LINKS_MOST := 200
const DENSE_LINKS_PER_MARK := 2.0
## In radians: the most an arc turns between two of its points.
const ARC_STEP := 0.05
## Texels a row of the hand links' ends carries.
const ACROSS := 1024
## Seconds the marks stand still before hand links are dashed again where they stand.
const SETTLE_AFTER := 0.25
## In metres at the field's scale: how far from a line a ray may pass and still be on it.
const LINE_REACH := 0.02
## How much thicker than the stem under it a lit tree stem is drawn.
const LIT_WIDER := 1.8

## How much thicker than TREE_RADIUS the tree's lines are drawn.
var weight := 1.0
## Whether hand links bend round the field's origin, from one end's shell to the
## other's, rather than cutting straight across where the reader stands.
var arcing := false

var _at := {}
var _parents := {}
var _pairs: Array = []
## `[from, to, label]` per hand link, each pair of notes once.
var _links: Array = []
## Each of `_links`' dashes where its marks stood when it was last dashed, in the
## same order, and beside each its link's index as every point's UV.
var _dashed: Array = []
var _named: Array = []
## Per link, four texels: its ends when it was last dashed, then where they stand now.
var _ends := PackedFloat32Array()
var _ends_image: Image
var _ends_texture := ImageTexture.new()
var _tree := MultiMeshInstance3D.new()
var _hand := MeshInstance3D.new()
var _near := MeshInstance3D.new()
var _struck := MeshInstance3D.new()
var _tree_ink := StandardMaterial3D.new()
var _hand_ink := ShaderMaterial.new()
var _quiet_ink := ShaderMaterial.new()
var _struck_ink := ShaderMaterial.new()
var _showing_tree := true
var _relations_off := {}
var _hand_off := false
var _focus: Array = []
var _settle_in := 0.0
## Per link, the path its dashes were laid along and that path's box grown by LINE_REACH.
var _paths: Array = []
var _boxes: Array[AABB] = []
## What each pointer's ray last met: `{tree, at, from, to, links}`; `at` indexes
## `_pairs` on a stem and `_links` on a hand link, `links` being its bundle in `_links`.
var _met := {}
var _on := {}
## The line chosen by the trigger, as `_met` holds one; empty while none is.
var _held := {}
var _lit_stem := MeshInstance3D.new()
var _lit_stem_ink := StandardMaterial3D.new()


## Draw the lines among `placed` (`Field.derive`'s answer), with the hand links
## each of `notes` (by ref) carries.
func build(placed: Dictionary, notes: Dictionary, palette: Palette) -> void:
	_tree_ink.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_lit_stem_ink.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	for ink in [_hand_ink, _quiet_ink, _struck_ink]:
		ink.shader = HAND_LINK
		ink.set_shader_parameter("ends", _ends_texture)
		ink.set_shader_parameter("across", ACROSS)
	dress(palette)
	var refs: Array = placed.keys()
	refs.sort()
	var drawn := {}
	for ref in refs:
		_at[ref] = placed[ref].position
		if placed[ref].parent != "":
			_parents[ref] = placed[ref].parent
			_pairs.append(ref)
		for link in notes.get(ref, {}).get("links", []):
			var other = link.get("to") if link is Dictionary else link
			if not other is String or not placed.has(other) or other == ref:
				continue
			var key: String = ref + " " + other if ref < other else other + " " + ref
			if drawn.has(key):
				continue
			drawn[key] = true
			var label = link.get("label", "") if link is Dictionary else ""
			_links.append([ref, other, label if label is String else ""])
	_tree.multimesh = _stems()
	add_child(_tree)
	for shown in [_hand, _near, _struck]:
		add_child(shown)
	_lit_stem.mesh = _stem(_lit_stem_ink)
	_lit_stem.visible = false
	add_child(_lit_stem)
	_draw_tree()
	settle()


## Draw every line in `palette`'s ink, over its paper.
func dress(palette: Palette) -> void:
	_tree_ink.albedo_color = palette.paper.lerp(palette.ink, TREE_INK)
	_hand_ink.set_shader_parameter("ink", palette.paper.lerp(palette.ink, HAND_INK))
	_quiet_ink.set_shader_parameter("ink", Color(palette.ink, Palette.DIM))
	_struck_ink.set_shader_parameter("ink", palette.ink)
	_lit_stem_ink.albedo_color = palette.ink


## The rows a reader turns lines off by, as `Settings.lines` holds them.
func rows() -> Array:
	var rows: Array = []
	if not _pairs.is_empty():
		rows.append({"key": Settings.SPRANG, "count": _pairs.size()})
	if _links.is_empty():
		return rows
	rows.append({"key": Settings.BY_HAND, "count": _links.size()})
	var carried := {}
	for link in _links:
		carried[link[2]] = carried.get(link[2], 0) + 1
	var labels: Array = carried.keys()
	labels.sort_custom(func(a, b): return carried[a] > carried[b] or (carried[a] == carried[b] and a < b))
	for label in labels:
		rows.append({"key": Settings.relation(label), "count": carried[label], "label": label})
	return rows


## Draw what `settings` has on, and nothing for the rest.
func show_only(settings) -> void:
	_showing_tree = settings.is_on(Settings.SPRANG)
	_hand_off = not settings.is_on(Settings.BY_HAND)
	_relations_off.clear()
	for link in _links:
		if not settings.is_on(Settings.relation(link[2])):
			_relations_off[link[2]] = true
	_tree.visible = _showing_tree
	_relight()


## Whether the hand links are past where they read as lines.
func dense() -> bool:
	return _links.size() > DENSE_LINKS_MOST or _links.size() > DENSE_LINKS_PER_MARK * _at.size()


## The notes in hand: the one being read and the ones pointed at. A dense
## field strikes their hand links whole and its own weight between their neighbours.
func focus(refs: Array) -> void:
	if refs == _focus:
		return
	_focus = refs.duplicate()
	if dense():
		_draw_hand()


## Every note's mark now stands at `positions`, by ref. The hand links' dashes
## are carried with their ends, and dashed again once the marks stand still.
func move(positions: Dictionary) -> void:
	for ref in positions:
		_at[ref] = positions[ref]
	_draw_tree()
	_carry()
	var bounds := _bounds()
	for shown in [_hand, _near, _struck]:
		if shown.mesh != null:
			shown.mesh.custom_aabb = bounds
	_settle_in = SETTLE_AFTER


## Dash every hand link again where its marks stand now.
func settle() -> void:
	_settle_in = 0.0
	_dash()
	_draw_hand()


func _process(delta: float) -> void:
	if _settle_in <= 0.0:
		return
	_settle_in -= delta
	if _settle_in <= 0.0:
		settle()


func _stems() -> MultiMesh:
	var many := MultiMesh.new()
	many.transform_format = MultiMesh.TRANSFORM_3D
	many.mesh = _stem(_tree_ink)
	many.instance_count = _pairs.size()
	return many


static func _stem(ink: Material) -> CylinderMesh:
	var stem := CylinderMesh.new()
	stem.top_radius = TREE_RADIUS
	stem.bottom_radius = TREE_RADIUS
	stem.height = 1.0
	stem.radial_segments = 5
	stem.rings = 1
	stem.cap_top = false
	stem.cap_bottom = false
	stem.material = ink
	return stem


func _draw_tree() -> void:
	var thick := Basis.from_scale(Vector3(weight, 1.0, weight))
	for at in _pairs.size():
		var ref: String = _pairs[at]
		var stood := along(_at[_parents[ref]], _at[ref])
		_tree.multimesh.set_instance_transform(at, Transform3D(stood.basis * thick, stood.origin))
	_stand_lit_stem()


## The transform that stands a unit-high cylinder from `from` to `to`.
static func along(from: Vector3, to: Vector3) -> Transform3D:
	var span := to - from
	var up := span.normalized() if span.length_squared() > 1e-12 else Vector3.UP
	var side := up.cross(Vector3.FORWARD if absf(up.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
	var front := side.cross(up)
	return Transform3D(Basis(side, up * span.length(), front), (from + to) * 0.5)


func _dash() -> void:
	_dashed.resize(_links.size())
	_named.resize(_links.size())
	_paths.resize(_links.size())
	_boxes.resize(_links.size())
	_ends.resize(_links.size() * 16)
	for at in _links.size():
		var from: Vector3 = _at[_links[at][0]]
		var to: Vector3 = _at[_links[at][1]]
		var path := arc(from, to) if arcing else PackedVector3Array([from, to])
		var dashes := dash_run(path)
		var named := PackedVector2Array()
		named.resize(dashes.size())
		named.fill(Vector2(at, 0.0))
		_dashed[at] = dashes
		_named[at] = named
		_paths[at] = path
		_boxes[at] = _box(path)
		_put(at * 16, from)
		_put(at * 16 + 4, to)
	_carry()


## Where each hand link's ends stand now, for the dashes to be carried to.
func _carry() -> void:
	if _links.is_empty():
		return
	for at in _links.size():
		_put(at * 16 + 8, _at[_links[at][0]])
		_put(at * 16 + 12, _at[_links[at][1]])
	var high := ceili(_links.size() * 4.0 / ACROSS)
	var bytes := _ends.to_byte_array()
	bytes.resize(ACROSS * high * 16)
	if _ends_image == null or _ends_image.get_height() != high:
		_ends_image = Image.create_from_data(ACROSS, high, false, Image.FORMAT_RGBAF, bytes)
		_ends_texture.set_image(_ends_image)
	else:
		_ends_image.set_data(ACROSS, high, false, Image.FORMAT_RGBAF, bytes)
		_ends_texture.update(_ends_image)


func _put(at: int, point: Vector3) -> void:
	_ends[at] = point.x
	_ends[at + 1] = point.y
	_ends[at + 2] = point.z


func _draw_hand() -> void:
	var held := []
	var near := []
	var struck := []
	var crowded := dense()
	var focused := {}
	var reached := {}
	var lit := {}
	for met in _on.values() + [_held]:
		for at in met.get("links", []):
			lit[at] = true
	if crowded:
		for ref in _focus:
			focused[ref] = true
		for link in _links:
			if focused.has(link[0]) or focused.has(link[1]):
				reached[link[0]] = true
				reached[link[1]] = true
	for at in _links.size():
		var link: Array = _links[at]
		if _hand_off or _relations_off.has(link[2]):
			continue
		held.append(at)
		if not crowded:
			if lit.has(at):
				struck.append(at)
			continue
		if lit.has(at) or focused.has(link[0]) or focused.has(link[1]):
			struck.append(at)
		elif reached.has(link[0]) and reached.has(link[1]):
			near.append(at)
	_hand.mesh = _mesh(held, _quiet_ink if crowded else _hand_ink)
	_near.mesh = _mesh(near, _hand_ink)
	_struck.mesh = _mesh(struck, _struck_ink)


## The dashes of the links at `chosen` (indices into `_links`) as one mesh, each
## point naming its link in its UV.
func _mesh(chosen: Array, ink: ShaderMaterial) -> ArrayMesh:
	var points := PackedVector3Array()
	var named := PackedVector2Array()
	for at in chosen:
		points.append_array(_dashed[at])
		named.append_array(_named[at])
	if points.is_empty():
		return null
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_TEX_UV] = named
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
	mesh.surface_set_material(0, ink)
	mesh.custom_aabb = _bounds()
	return mesh


## Room for every place the dashes can be carried to: arcs and straight runs
## alike stay inside the ball through the farthest mark.
func _bounds() -> AABB:
	var farthest := 0.0
	for ref in _at:
		farthest = maxf(farthest, _at[ref].length())
	return AABB(-Vector3.ONE * farthest, Vector3.ONE * farthest * 2.0)


## The dashes along the path through `path`'s points, as pairs of points.
static func dash_run(path: PackedVector3Array) -> PackedVector3Array:
	var points := PackedVector3Array()
	var length := 0.0
	var reached := PackedFloat32Array([0.0])
	for at in range(1, path.size()):
		length += path[at - 1].distance_to(path[at])
		reached.append(length)
	if length < 1e-6:
		return points
	var segment := 1
	var at := 0.0
	while at < length:
		for distance in [at, minf(at + DASH, length)]:
			while segment < path.size() - 1 and reached[segment] < distance:
				segment += 1
			var span := reached[segment] - reached[segment - 1]
			points.append(path[segment - 1] if span < 1e-9 else path[segment - 1].lerp(path[segment], (distance - reached[segment - 1]) / span))
		at += DASH + GAP
	return points


## The path from `from` to `to` turning round the origin: its bearing swung
## along the great circle between theirs, its distance going from one's to the
## other's, so no point of it is nearer the origin than the nearer end.
static func arc(from: Vector3, to: Vector3) -> PackedVector3Array:
	var near := from.length()
	var far := to.length()
	if near < 1e-6 or far < 1e-6:
		return PackedVector3Array([from, to])
	var start := from / near
	var end := to / far
	var turn := start.angle_to(end)
	var axis := start.cross(end)
	if axis.length_squared() < 1e-12:
		if turn < 0.5:
			return PackedVector3Array([from, to])
		axis = start.cross(Vector3.UP if absf(start.y) < 0.9 else Vector3.RIGHT)
	axis = axis.normalized()
	var steps := maxi(1, ceili(turn / ARC_STEP))
	var path := PackedVector3Array()
	for step in steps + 1:
		var share := float(step) / steps
		path.append(start.rotated(axis, turn * share) * lerpf(near, far, share))
	return path


## How far along `pointer`'s ray, in metres in the room, it passes within
## LINE_REACH of a line drawn; INF where it passes none.
func hit(pointer: Node3D) -> float:
	_met.erase(pointer)
	if _at.is_empty():
		return INF
	var ray: Array = pointer.ray()
	var place := global_transform
	var inverse := place.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = (inverse.basis * ray[1]).normalized()
	var bounds := _bounds().grow(LINE_REACH)
	if not _meets(bounds, from, along):
		return INF
	var far := from.distance_to(bounds.get_center()) + bounds.size.length()
	var best := INF
	var met := {}
	if _showing_tree:
		for at in _pairs.size():
			var ref: String = _pairs[at]
			var crossing := crossed(from, along, far, _at[_parents[ref]], _at[ref])
			if crossing[1] <= LINE_REACH and crossing[0] < best:
				best = crossing[0]
				met = {"tree": true, "at": at, "from": _parents[ref], "to": ref}
	if not _hand_off and _settle_in <= 0.0:
		for at in _paths.size():
			if _relations_off.has(_links[at][2]) or not _meets(_boxes[at], from, along):
				continue
			var crossing := crossed_path(from, along, far, _paths[at])
			if crossing[1] <= LINE_REACH and crossing[0] < best:
				best = crossing[0]
				met = {"tree": false, "at": at, "from": _links[at][0], "to": _links[at][1]}
	if met.is_empty():
		return INF
	var landed := from + along * best
	if not met.tree:
		met.links = _bundled(landed)
	_met[pointer] = met
	return (place * landed).distance_to(ray[0])


func point(pointer: Node3D) -> void:
	var met: Dictionary = _met.get(pointer, {})
	var was: Dictionary = _on.get(pointer, {})
	if _same(met, was) or (met.is_empty() and was.is_empty()):
		return
	_on[pointer] = met
	_relight()


func unpoint(pointer: Node3D) -> void:
	if _on.erase(pointer):
		_relight()


func press(pointer: Node3D) -> void:
	var met: Dictionary = _on.get(pointer, {})
	if met.is_empty():
		return
	if _holds(met):
		asked_about.emit(_held.from, _held.to)
		return
	_held = met
	_relight()
	var label: String = "" if met.tree else _links[met.at][2]
	chosen.emit(met.from, met.to, label, met.get("links", [0]).size())


func release(_pointer: Node3D) -> void:
	pass


func scroll(_pointer: Node3D, _amount: float) -> bool:
	return false


## The line the trigger chose is lit no more.
func let_go() -> void:
	if not _held.is_empty():
		_held = {}
		_relight()


## Whether a line is chosen, and lit as one.
func holding() -> bool:
	return not _held.is_empty()


## Every hand link whose path passes within LINE_REACH of `landed`, as indices into `_links`.
func _bundled(landed: Vector3) -> Array:
	var bundle: Array = []
	for at in _paths.size():
		if _relations_off.has(_links[at][2]) or not _boxes[at].has_point(landed):
			continue
		var path: PackedVector3Array = _paths[at]
		for step in range(1, path.size()):
			if Geometry3D.get_closest_point_to_segment(landed, path[step - 1], path[step]).distance_to(landed) <= LINE_REACH:
				bundle.append(at)
				break
	return bundle


## Whether `met` lands on the line already chosen: its stem, or any link of its bundle.
func _holds(met: Dictionary) -> bool:
	if _held.is_empty() or met.tree != _held.tree:
		return false
	return met.at == _held.at if met.tree else _held.links.has(met.at)


static func _same(one: Dictionary, other: Dictionary) -> bool:
	return not one.is_empty() and not other.is_empty() and one.tree == other.tree and one.at == other.at


func _relight() -> void:
	_stand_lit_stem()
	_draw_hand()


func _stand_lit_stem() -> void:
	var stem := -1
	for met in _on.values() + [_held]:
		if met.get("tree", false):
			stem = met.at
	_lit_stem.visible = stem >= 0 and _showing_tree
	if stem < 0:
		return
	var ref: String = _pairs[stem]
	var stood := along(_at[_parents[ref]], _at[ref])
	var thick := Basis.from_scale(Vector3(weight * LIT_WIDER, 1.0, weight * LIT_WIDER))
	_lit_stem.transform = Transform3D(stood.basis * thick, stood.origin)


static func _box(path: PackedVector3Array) -> AABB:
	var box := AABB(path[0], Vector3.ZERO)
	for point in path:
		box = box.expand(point)
	return box.grow(LINE_REACH)


static func _meets(box: AABB, from: Vector3, along: Vector3) -> bool:
	return box.has_point(from) or box.intersects_ray(from, along) != null


## How far along the ray from `from` heading `along` (unit), reaching `far`, it
## comes nearest the segment from `start` to `end`, and how near:
## `[along_ray, apart]`, with a ray that only nears it at its start at INF.
static func crossed(from: Vector3, along: Vector3, far: float, start: Vector3, end: Vector3) -> Array:
	var nearest := Geometry3D.get_closest_points_between_segments(from, from + along * far, start, end)
	var reached := (nearest[0] - from).dot(along)
	if reached <= 0.0:
		return [INF, INF]
	return [reached, nearest[0].distance_to(nearest[1])]


## `crossed` over every segment of `path`, the nearest pass kept.
static func crossed_path(from: Vector3, along: Vector3, far: float, path: PackedVector3Array) -> Array:
	var best := [INF, INF]
	for step in range(1, path.size()):
		var crossing := crossed(from, along, far, path[step - 1], path[step])
		if crossing[1] < best[1]:
			best = crossing
	return best
