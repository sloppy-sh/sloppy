## Every note of the field as one mark, drawn in one call, the one a pointer
## is on lit, and the pictures of the near ones worn as discs facing the reader.
## A target for `interaction/pointer.gd`.
extends Node3D

const Lod := preload("res://field/lod.gd")
const Palette := preload("res://field/palette.gd")
const SHADER := preload("res://field/mark.gdshader")
const DISC := preload("res://field/disc.gdshader")

## A pointer pulled its trigger on the mark of `ref`.
signal chosen(ref: String, pointer: Node3D)
## The mark a pointer is on changed; "" is none.
signal pointed(ref: String, pointer: Node3D)

## How much wider than the mark a pointer may land and still be on it.
const REACH := 1.6
## How much wider than the mark its picture is worn.
const DISC_WIDER := 2.5
## How much wider than the mark the halo of the note sought stands, and how
## much of the mark's own colour shows in it.
const SOUGHT_WIDER := 2.4
const SOUGHT_ALPHA := 0.45
## In seconds: how long a picture takes to come up on its mark, or to go.
const FADING := 0.3

## In the order the marks are drawn in.
var refs: Array[String] = []
## Refs of the notes drawn hollow, as a set.
var pulled := {}
## Refs of the notes whose mark wears a picture, as a set.
var pictured := {}
## How many times MARK_RADIUS a mark is drawn at.
var size := 1.0
## The ref of the mark lit as the note sought; "" while none is.
var sought := ""
## The refs of the two marks a chosen line joins, lit in ink; empty while none is.
var paired: Array[String] = []

var _local := PackedVector3Array()
var _bands: Array = []
var _banding := PackedByteArray()
var _multimesh := MultiMesh.new()
var _on := {}
var _lit := MeshInstance3D.new()
var _depths := PackedInt32Array()
var _paint := ShaderMaterial.new()
var _halo := StandardMaterial3D.new()
var _sought := MeshInstance3D.new()
var _sought_paint := StandardMaterial3D.new()
var _ends: Array[MeshInstance3D] = []
var _ends_paint := StandardMaterial3D.new()
var _discs := {}
## How far each disc has come up, 0 to 1, by ref; a disc not in it is down.
var _shown := {}
## The refs whose discs are coming up or standing, as a set.
var _showing := {}
var _fills: Array[Color] = []
var _paper: Color


## Draw `placed` (`Field.derive`'s answer) for `notes` by ref, in `palette`'s
## colours, `drawn` being the sets in front of the reader. A note whose ref is
## not `owner`'s is pulled; with `owner` "" (unknown) none is.
func build(placed: Dictionary, notes: Dictionary, palette: Palette, drawn: Array[String], owner: String) -> void:
	refs.assign(placed.keys())
	refs.sort()
	_multimesh.transform_format = MultiMesh.TRANSFORM_3D
	_multimesh.use_colors = true
	_multimesh.use_custom_data = true
	var sphere := SphereMesh.new()
	sphere.radius = Lod.MARK_RADIUS
	sphere.height = Lod.MARK_RADIUS * 2.0
	sphere.radial_segments = 16
	sphere.rings = 8
	_multimesh.mesh = sphere
	_multimesh.instance_count = refs.size()
	_paint.shader = SHADER
	sphere.material = _paint
	_local.resize(refs.size())
	_depths.resize(refs.size())
	_banding.resize(refs.size())
	_bands.clear()
	for at in refs.size():
		var ref := refs[at]
		var note: Dictionary = notes.get(ref, {})
		_local[at] = placed[ref].position
		_multimesh.set_instance_transform(at, Transform3D(Basis.from_scale(Vector3.ONE * size), _local[at]))
		_depths[at] = placed[ref].depth
		var worn := Palette.bands(note.get("tags", []), drawn)
		if note.get("picture") == true:
			pictured[ref] = true
		_bands.append(worn)
		if owner != "" and not ref.begins_with(owner + "/"):
			pulled[ref] = true
		_banding[at] = 1
		_wear(at, worn.size())
	var shown := MultiMeshInstance3D.new()
	shown.multimesh = _multimesh
	add_child(shown)
	var shell := SphereMesh.new()
	shell.radius = Lod.MARK_RADIUS * 1.5
	shell.height = Lod.MARK_RADIUS * 3.0
	_halo.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_halo.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_halo.cull_mode = BaseMaterial3D.CULL_FRONT
	shell.material = _halo
	_lit.mesh = shell
	_lit.visible = false
	_lit.scale = Vector3.ONE * size
	add_child(_lit)
	var wide := SphereMesh.new()
	wide.radius = Lod.MARK_RADIUS * SOUGHT_WIDER
	wide.height = Lod.MARK_RADIUS * SOUGHT_WIDER * 2.0
	_sought_paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_sought_paint.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_sought_paint.cull_mode = BaseMaterial3D.CULL_FRONT
	wide.material = _sought_paint
	_sought.mesh = wide
	_sought.visible = false
	_sought.scale = Vector3.ONE * size
	add_child(_sought)
	_ends_paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_ends_paint.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_ends_paint.cull_mode = BaseMaterial3D.CULL_FRONT
	var end_shell := wide.duplicate() as SphereMesh
	end_shell.material = _ends_paint
	for _end in 2:
		var end := MeshInstance3D.new()
		end.mesh = end_shell
		end.visible = false
		end.scale = Vector3.ONE * size
		add_child(end)
		_ends.append(end)
	dress(palette)


## Draw every mark in `palette`'s colours.
func dress(palette: Palette) -> void:
	var slots := PackedVector3Array()
	for slot in Palette.SLOTS:
		var colour := palette.slot(slot + 1).srgb_to_linear()
		slots.append(Vector3(colour.r, colour.g, colour.b))
	_paint.set_shader_parameter("slots", slots)
	var paper := palette.paper.srgb_to_linear()
	_paint.set_shader_parameter("paper", Vector3(paper.r, paper.g, paper.b))
	_fills.clear()
	for at in refs.size():
		_multimesh.set_instance_color(at, palette.depth(_depths[at]).srgb_to_linear())
		var worn: Array = _bands[at]
		_fills.append(palette.slot(worn[0]) if not worn.is_empty() else palette.depth(_depths[at]))
	_halo.albedo_color = Color(palette.ink, 0.4)
	_ends_paint.albedo_color = Color(palette.ink, SOUGHT_ALPHA)
	_paint_sought()
	_paper = palette.paper
	for ref in _discs:
		var paint := _discs[ref].material_override as ShaderMaterial
		paint.set_shader_parameter("paper", _paper)
		paint.set_shader_parameter("rim", _fills[refs.find(ref)])


func _process(delta: float) -> void:
	fade(delta)


## In metres at the field's own scale.
func radius() -> float:
	return Lod.MARK_RADIUS * size


## Every mark drawn `times` MARK_RADIUS across.
func set_size(times: float) -> void:
	size = times
	_lit.scale = Vector3.ONE * size
	_sought.scale = Vector3.ONE * size
	for end in _ends:
		end.scale = Vector3.ONE * size
	for at in refs.size():
		_multimesh.set_instance_transform(at, Transform3D(Basis.from_scale(Vector3.ONE * size), _local[at]))
	for ref in _discs:
		_size_disc(_discs[ref])


## Every mark of `positions` (by ref) stands there now, in the field's own space.
func move(positions: Dictionary) -> void:
	for at in refs.size():
		if positions.has(refs[at]):
			_local[at] = positions[refs[at]]
			_multimesh.set_instance_transform(at, Transform3D(Basis.from_scale(Vector3.ONE * size), _local[at]))
			if _discs.has(refs[at]):
				_discs[refs[at]].position = _local[at]
	_relight()
	_sought.position = local_position(sought)
	_stand_ends()


## The mark of `ref` wears `picture` (an Image) whenever `show_pictures` names it.
func wear(ref: String, picture: Image) -> void:
	var at := refs.find(ref)
	if at < 0 or _discs.has(ref) or picture == null or picture.is_empty():
		return
	var paint := ShaderMaterial.new()
	paint.shader = DISC
	paint.render_priority = 1
	picture.generate_mipmaps()
	paint.set_shader_parameter("picture", ImageTexture.create_from_image(picture))
	var side := float(mini(picture.get_width(), picture.get_height()))
	paint.set_shader_parameter("crop", Vector2(side / picture.get_width(), side / picture.get_height()))
	paint.set_shader_parameter("paper", _paper)
	paint.set_shader_parameter("rim", _fills[at])
	paint.set_shader_parameter("broken", pulled.has(ref))
	paint.set_shader_parameter("alpha", 0.0)
	var disc := MeshInstance3D.new()
	disc.mesh = QuadMesh.new()
	disc.material_override = paint
	disc.position = _local[at]
	disc.visible = false
	add_child(disc)
	_discs[ref] = disc
	_size_disc(disc)


## The marks at `shown` (indices into `refs`) that wear a picture bring it up
## over `FADING`; the rest let theirs go over the same.
func show_pictures(shown: Array) -> void:
	_showing.clear()
	for at in shown:
		if at >= 0 and at < refs.size():
			_showing[refs[at]] = true


## Every disc `delta` seconds further toward up or down, eased.
func fade(delta: float) -> void:
	for ref in _discs:
		var toward := 1.0 if _showing.has(ref) else 0.0
		var was: float = _shown.get(ref, 0.0)
		if was == toward:
			continue
		var now := move_toward(was, toward, delta / FADING)
		var disc: MeshInstance3D = _discs[ref]
		(disc.material_override as ShaderMaterial).set_shader_parameter("alpha", smoothstep(0.0, 1.0, now))
		disc.visible = now > 0.0
		if now > 0.0:
			_shown[ref] = now
		else:
			_shown.erase(ref)


## Whether the mark of `ref` has a picture showing, or coming up or going.
func showing_picture(ref: String) -> bool:
	return _discs.has(ref) and _discs[ref].visible


## In metres at the field's own scale: how far from the mark's middle its
## picture reaches while one shows, 0 while none does.
func wearing(at: int) -> float:
	if at < 0 or at >= refs.size() or not _shown.has(refs[at]):
		return 0.0
	return radius() * DISC_WIDER


func _size_disc(disc: MeshInstance3D) -> void:
	(disc.mesh as QuadMesh).size = Vector2.ONE * radius() * DISC_WIDER * 2.0
	(disc.material_override as ShaderMaterial).set_shader_parameter("lift", radius() * 1.05)


func _wear(at: int, count: int) -> void:
	var worn: Array = _bands[at]
	var digits := [0, 0, 0]
	for index in worn.size():
		digits[index / 3] += worn[index] * int(pow(9, index % 3))
	var held := count + (16 if pulled.has(refs[at]) else 0)
	_multimesh.set_instance_custom_data(at, Color(digits[0], digits[1], digits[2], held))


## Where the mark of `ref` stands in the field's own space.
func local_position(ref: String) -> Vector3:
	return local_at(refs.find(ref))


## Where the `at`th mark stands in the field's own space.
func local_at(at: int) -> Vector3:
	return _local[at] if at >= 0 and at < _local.size() else Vector3.ZERO


## Every mark's distance from `eye`, in metres in the room, with each mark's
## bands worn or let go for that distance.
func settle(eye: Vector3) -> PackedFloat32Array:
	var place := global_transform
	var across := radius() * place.basis.get_scale().x
	var distances := PackedFloat32Array()
	distances.resize(refs.size())
	for at in refs.size():
		var distance := (place * _local[at]).distance_to(eye)
		distances[at] = distance
		var count: int = _bands[at].size()
		var shown := Lod.bands_shown(across, distance, count, _banding[at] == 1)
		if shown != (_banding[at] == 1):
			_banding[at] = 1 if shown else 0
			_wear(at, count if shown else mini(count, 1))
	return distances


## Every mark's cosine off `ahead`, the eyes' forward axis, seen from `eye`.
func facing(eye: Vector3, ahead: Vector3) -> PackedFloat32Array:
	var place := global_transform
	var forward := ahead.normalized()
	var cosines := PackedFloat32Array()
	cosines.resize(refs.size())
	for at in refs.size():
		var toward := place * _local[at] - eye
		cosines[at] = toward.normalized().dot(forward) if toward.length_squared() > 1e-12 else 1.0
	return cosines


## The nearest mark along a ray, as its index, and how far along it is; -1 and
## INF where the ray meets none.
func nearest(origin: Vector3, direction: Vector3) -> Array:
	var inverse := global_transform.affine_inverse()
	var from := inverse * origin
	var along := (inverse.basis * direction).normalized()
	var reach := radius() * REACH
	var best := -1
	var best_t := INF
	for at in _local.size():
		var off := from - _local[at]
		var b := off.dot(along)
		var gap := b * b - (off.length_squared() - reach * reach)
		if gap < 0.0:
			continue
		var t := -b - sqrt(gap)
		if t > 0.0 and t < best_t:
			best_t = t
			best = at
	if best < 0:
		return [-1, INF]
	return [best, (global_transform * (from + along * best_t)).distance_to(origin)]


func hit(pointer: Node3D) -> float:
	var ray: Array = pointer.ray()
	return nearest(ray[0], ray[1])[1]


## Light the mark of `ref` as the note sought, in a halo of its own colour; "" lights none.
func seek(ref: String) -> void:
	sought = ref if refs.has(ref) else ""
	_sought.visible = sought != ""
	_sought.position = local_position(sought)
	_paint_sought()


## Light the marks of `from` and `to` as the ends of a chosen line, in ink;
## `light_pair("", "")` lights neither.
func light_pair(from: String, to: String) -> void:
	paired.clear()
	for ref in [from, to]:
		if refs.has(ref):
			paired.append(ref)
	_stand_ends()


func _stand_ends() -> void:
	for at in _ends.size():
		_ends[at].visible = at < paired.size()
		if at < paired.size():
			_ends[at].position = local_position(paired[at])


func _paint_sought() -> void:
	var at := refs.find(sought)
	if at >= 0 and at < _fills.size():
		_sought_paint.albedo_color = Color(_fills[at], SOUGHT_ALPHA)


func point(pointer: Node3D) -> void:
	var ray: Array = pointer.ray()
	var at: int = nearest(ray[0], ray[1])[0]
	var ref := refs[at] if at >= 0 else ""
	if _on.get(pointer, "") != ref:
		_on[pointer] = ref
		_relight()
		pointed.emit(ref, pointer)


func unpoint(pointer: Node3D) -> void:
	if _on.erase(pointer):
		_relight()
		pointed.emit("", pointer)


func press(pointer: Node3D) -> void:
	var ref: String = _on.get(pointer, "")
	if ref != "":
		chosen.emit(ref, pointer)


func release(_pointer: Node3D) -> void:
	pass


func scroll(_pointer: Node3D, _amount: float) -> bool:
	return false


func _relight() -> void:
	var lit := ""
	for pointer in _on:
		if _on[pointer] != "":
			lit = _on[pointer]
	_lit.visible = lit != ""
	if lit != "":
		_lit.position = local_position(lit)
