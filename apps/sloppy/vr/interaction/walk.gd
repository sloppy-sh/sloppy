## Walking the room: the left thumbstick walks ahead of where the reader is
## looking and aside of it, and inside a field flies there, up and down with
## the eyes. Without a headset, WASD walks.
extends Node

## In metres a second.
const PACE := 1.2
const DEAD := 0.2

## The stick is walking the reader, as it does so.
signal moved

var origin: XROrigin3D
var camera: XRCamera3D
var left: XRController3D
## The left hand's pointer: while it is on something that scrolls, its stick scrolls.
var left_pointer: Node3D
## The palette on the left hand: while it faces the reader, its stick turns the palette.
var palette: Node3D
## Whether ahead is where the eyes look, up or down, rather than across the floor.
var fly := false


## What of `stick` walks: none of it while the pointer scrolls with it; while
## the palette faces the reader, a lean mostly ahead or back walks straight and
## a lean mostly sideways is the palette's turn.
static func walked(stick: Vector2, pointer_scrolls: bool, palette_faces: bool) -> Vector2:
	if pointer_scrolls:
		return Vector2.ZERO
	if palette_faces:
		return Vector2(0.0, stick.y) if absf(stick.y) > absf(stick.x) else Vector2.ZERO
	return stick


func _process(delta: float) -> void:
	if origin == null or camera == null:
		return
	var stick := Vector2.ZERO
	if left != null:
		stick = walked(left.get_vector2("primary"),
			left_pointer != null and left_pointer.holding_stick,
			palette != null and palette.takes_stick())
	else:
		stick = Vector2(
			float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A)),
			float(Input.is_physical_key_pressed(KEY_W)) - float(Input.is_physical_key_pressed(KEY_S)),
		)
	if stick.length() > DEAD:
		moved.emit()
		var facing := camera.global_transform.basis
		var ahead := -facing.z.normalized() if fly else Vector3(-facing.z.x, 0.0, -facing.z.z).normalized()
		var aside := Vector3(facing.x.x, 0.0, facing.x.z).normalized()
		origin.global_position += (aside * stick.x + ahead * stick.y) * PACE * delta
