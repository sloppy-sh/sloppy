## One hand's ray into the room, or the mouse's where there is no headset: it
## lands on the nearest target, and the trigger presses what it lands on.
##
## A target has `hit(pointer) -> float` (how far along `ray()` it is met, INF
## where it is not), `point(pointer)`, `unpoint(pointer)`, `press(pointer)`,
## `release(pointer)` and `scroll(pointer, amount) -> bool` (whether it took the
## stick). One that can be carried also has `take(pointer)` and `let_go(pointer)`,
## which the grip does while the pointer is on it.
extends Node3D

## The trigger was pulled while this pointed at nothing.
signal missed

## In metres: the longest the drawn ray reaches when it meets nothing.
const REACH := 2.5
const BEAM_RADIUS := 0.0012
## How far the stick must lean before it scrolls.
const LEAN := 0.25
## A wheel notch, in the stick's units: a second of it leaned all the way.
const MOUSE_SCROLL := 0.15

## The hand this points from; null for the mouse.
var hand: XRController3D
var camera: Camera3D
## The targets, nearest wins. Shared with the view, which adds and removes.
var targets: Array = []
## Whether what this points at scrolls, and so takes this hand's stick and the wheel.
var holding_stick := false
## What the grip is carrying; null while it carries nothing.
var carrying: Object = null

var _on: Object = null
var _beam := MeshInstance3D.new()


func _init(from: XRController3D, eye: Camera3D, aimed_at: Array, ink: Color) -> void:
	hand = from
	camera = eye
	targets = aimed_at
	if hand == null:
		return
	var stem := CylinderMesh.new()
	stem.top_radius = BEAM_RADIUS
	stem.bottom_radius = BEAM_RADIUS
	stem.height = 1.0
	stem.radial_segments = 4
	stem.rings = 1
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color = Color(ink, 0.35)
	stem.material = material
	_beam.mesh = stem
	add_child(_beam)


## Draw the beam in `ink`.
func dress(ink: Color) -> void:
	if _beam.mesh != null:
		_beam.mesh.material.albedo_color = Color(ink, 0.35)


func _ready() -> void:
	if hand != null:
		hand.button_pressed.connect(_pressed)
		hand.button_released.connect(_released)


## Where the ray starts and the way it points, in the room.
func ray() -> Array:
	if hand != null:
		var held := hand.global_transform
		return [held.origin, -held.basis.z.normalized()]
	var at := get_viewport().get_mouse_position()
	return [camera.project_ray_origin(at), camera.project_ray_normal(at)]


func _process(delta: float) -> void:
	var nearest: Object = null
	var best := INF
	for target in targets:
		if not is_instance_valid(target):
			continue
		var distance: float = target.hit(self)
		if distance < best:
			best = distance
			nearest = target
	if nearest != _on:
		if is_instance_valid(_on):
			_on.unpoint(self)
		_on = nearest
	if _on != null:
		_on.point(self)
	holding_stick = false
	if _on != null:
		var lean := hand.get_vector2("primary").y if hand != null else 0.0
		holding_stick = _on.scroll(self, -lean * delta if absf(lean) > LEAN else 0.0)
	if hand != null:
		var length := minf(best, REACH)
		_beam.transform = Transform3D(Basis(Vector3.RIGHT, PI / 2.0) * Basis.from_scale(Vector3(1.0, length, 1.0)), Vector3(0, 0, -length / 2.0))


## Whether this hand's grip is this pointer's, so it takes hold of nothing else.
func takes_grip() -> bool:
	return carrying != null or (is_instance_valid(_on) and _on.has_method("take"))


func _pressed(button: String) -> void:
	if button == "trigger_click" and not is_instance_valid(_on):
		missed.emit()
	elif button == "trigger_click":
		_on.press(self)
	elif button == "grip_click" and is_instance_valid(_on) and _on.has_method("take"):
		carrying = _on
		carrying.take(self)


func _released(button: String) -> void:
	if button == "trigger_click" and is_instance_valid(_on):
		_on.release(self)
	elif button == "grip_click" and carrying != null:
		var held := carrying
		carrying = null
		if is_instance_valid(held):
			held.let_go(self)


func _unhandled_input(event: InputEvent) -> void:
	if hand != null or not event is InputEventMouseButton:
		return
	if not is_instance_valid(_on):
		if event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			missed.emit()
		return
	if event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_on.press(self)
		else:
			_on.release(self)
	elif event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		var down := 1.0 if event.button_index == MOUSE_BUTTON_WHEEL_DOWN else -1.0
		if _on.scroll(self, down * MOUSE_SCROLL):
			get_viewport().set_input_as_handled()
