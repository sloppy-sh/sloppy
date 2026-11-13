## The notes standing in Sets, as a target the reading's pointers land on
## (`interaction/pointer.gd`), and the halo round the note sought.
extends Node3D

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

var _on := {}
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
