## The notes standing in Sets, as a target the reading's pointers land on
## (`interaction/pointer.gd`), the halo round the note sought, and the pictures
## near ones wear, as the field's marks wear theirs (`field/marks.gd`).
extends Node3D

const Marks := preload("res://field/marks.gd")
const Palette := preload("res://field/palette.gd")
const DISC := preload("res://field/disc.gdshader")

## How much wider than the mark a pointer may land and still be on it, and the
## halo stands round it.
const REACH := 1.6
const HALO_WIDER := 2.4
const HALO_ALPHA := 0.6

## A pointer came onto the note of `ref`, or off every note where it is "".
signal pointed(ref: String, pointer: Node3D)
signal chosen(ref: String, pointer: Node3D)

## In the order the marks stand in `local`.
var refs: Array[String] = []
## Each mark's middle in the field's own units.
var local: Array[Vector3] = []
## In the field's own units.
var mark_radius := 0.0
## The ref of the note sought; "" while none is.
var sought := ""
## Refs of the notes whose mark wears a picture, as a set.
var pictured := {}

var _on := {}
var _discs := {}
## How far each disc has come up, 0 to 1, by ref; a disc not in it is down.
var _shown := {}
## The refs whose discs are coming up or standing, as a set.
var _showing := {}
## The refs whose marks are dimmed, as a set; their pictures dim with them.
var _dimmed := {}
var _halo := MeshInstance3D.new()
var _halo_paint := StandardMaterial3D.new()


func _init(radius: float) -> void:
	mark_radius = radius
	var ring := TorusMesh.new()
	ring.inner_radius = radius * HALO_WIDER * 0.8
	ring.outer_radius = radius * HALO_WIDER
	ring.rings = 32
	ring.ring_segments = 8
	_halo_paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_halo_paint.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	ring.material = _halo_paint
	_halo.mesh = ring
	_halo.visible = false
	add_child(_halo)


func add(ref: String, at: Vector3) -> void:
	refs.append(ref)
	local.append(at)


func _process(delta: float) -> void:
	fade(delta)


## Every mark's distance from `eye`, in metres in the room.
func distances(eye: Vector3) -> PackedFloat32Array:
	var place := global_transform
	var away := PackedFloat32Array()
	away.resize(local.size())
	for at in local.size():
		away[at] = (place * local[at]).distance_to(eye)
	return away


## The mark of `ref` wears `picture` whenever `show_pictures` names it, edged
## in `rim` on `paper`, and broken where the note is `pulled`.
func wear(ref: String, picture: Image, rim: Color, paper: Color, pulled: bool) -> void:
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
	paint.set_shader_parameter("paper", paper)
	paint.set_shader_parameter("rim", rim)
	paint.set_shader_parameter("broken", pulled)
	paint.set_shader_parameter("alpha", 0.0)
	paint.set_shader_parameter("lift", mark_radius * 1.05)
	var disc := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE * mark_radius * Marks.DISC_WIDER * 2.0
	disc.mesh = quad
	disc.material_override = paint
	disc.position = local[at]
	disc.visible = false
	add_child(disc)
	_discs[ref] = disc


## Every picture worn drawn again on `paper`, each edged in `rim_of(ref)`.
func dress(paper: Color, rim_of: Callable) -> void:
	for ref in _discs:
		var paint := _discs[ref].material_override as ShaderMaterial
		paint.set_shader_parameter("paper", paper)
		paint.set_shader_parameter("rim", rim_of.call(ref))


## The marks at `shown` (indices into `refs`) that wear a picture bring it up
## over `Marks.FADING`; the rest let theirs go over the same.
func show_pictures(shown: Array) -> void:
	_showing.clear()
	for at in shown:
		if at >= 0 and at < refs.size():
			_showing[refs[at]] = true


## The pictures of the marks of `refs` (a set) are dimmed with their marks.
func dim(refs: Dictionary) -> void:
	_dimmed = refs


## Every disc `delta` seconds further toward up or down, eased.
func fade(delta: float) -> void:
	for ref in _discs:
		var now: float = move_toward(_shown.get(ref, 0.0), 1.0 if _showing.has(ref) else 0.0, delta / Marks.FADING)
		var disc: MeshInstance3D = _discs[ref]
		var alpha := smoothstep(0.0, 1.0, now) * (Palette.DIM if _dimmed.has(ref) else 1.0)
		(disc.material_override as ShaderMaterial).set_shader_parameter("alpha", alpha)
		disc.visible = now > 0.0
		if now > 0.0:
			_shown[ref] = now
		else:
			_shown.erase(ref)


## Whether the mark of `ref` has a picture showing, or coming up or going.
func showing_picture(ref: String) -> bool:
	return _discs.has(ref) and _discs[ref].visible


## In the field's own units: how far from the mark's middle its picture reaches
## while one shows, 0 while none does.
func wearing(at: int) -> float:
	if at < 0 or at >= refs.size() or not _shown.has(refs[at]):
		return 0.0
	return mark_radius * Marks.DISC_WIDER


## Light the note of `ref` in a halo of `colour`; "" lights none.
func seek(ref: String, colour := Color.WHITE) -> void:
	sought = ref if refs.has(ref) else ""
	_halo.visible = sought != ""
	if sought != "":
		_halo.position = local[refs.find(sought)]
		_halo_paint.albedo_color = Color(colour, HALO_ALPHA)


## The halo turned to face `eye`, so it reads as a ring from wherever it is seen.
func face(eye: Vector3) -> void:
	if not _halo.visible:
		return
	var at := _halo.global_position
	if at.distance_to(eye) > 1e-4:
		var toward := (eye - at).normalized()
		var up := Vector3.UP if absf(toward.y) < 0.99 else Vector3.FORWARD
		_halo.global_basis = Basis.looking_at(toward, up).scaled(_halo.global_basis.get_scale()) * Basis(Vector3.RIGHT, PI / 2.0)


## The nearest mark along a ray in the room, as its index, and how far along it
## is; -1 and INF where the ray meets none.
func nearest(origin: Vector3, direction: Vector3) -> Array:
	var inverse := global_transform.affine_inverse()
	var from := inverse * origin
	var along := (inverse.basis * direction).normalized()
	var reach := mark_radius * REACH
	var best := -1
	var best_t := INF
	for at in local.size():
		var off := from - local[at]
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


func point(pointer: Node3D) -> void:
	var ray: Array = pointer.ray()
	var at: int = nearest(ray[0], ray[1])[0]
	var ref := refs[at] if at >= 0 else ""
	if _on.get(pointer, "") != ref:
		_on[pointer] = ref
		pointed.emit(ref, pointer)


func unpoint(pointer: Node3D) -> void:
	if _on.erase(pointer):
		pointed.emit("", pointer)


func press(pointer: Node3D) -> void:
	var ref: String = _on.get(pointer, "")
	if ref != "":
		chosen.emit(ref, pointer)


func release(_pointer: Node3D) -> void:
	pass


func scroll(_pointer: Node3D, _amount: float) -> bool:
	return false
