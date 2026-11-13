## The one pointer the connect, projects and Sets views and the hand menu are
## chosen with: each hand's aim and its trigger, or the mouse and a click where
## there is no headset. Something pickable is an Area3D on LAYER whose "pick"
## meta is a Callable, with a "hover" meta taking whether it is pointed at, and
## a "tick" meta where the hand that comes onto it is to feel it.
extends Node3D

const Room := preload("res://room/room.gd")

const LAYER := 1 << 19
## In metres.
const REACH := 8.0
const RAY_WIDTH := 0.002
const PRESS := "trigger_click"
## The readings whose own pointers draw the ray; this one draws it there only
## when it is on something of its own.
const DRAWS_ITS_OWN := ["graph", "sets"]
## How strong and how long the tick a hand feels coming onto a row is, in seconds.
const TICK := 0.2
const TICK_FOR := 0.02

var _hands: Array[XRController3D] = []
var _rays: Dictionary = {}
var _over: Dictionary = {}
var _mouse_over: Area3D = null
var _hovered: Dictionary = {}
var _mouse_at := Vector2(-1.0, -1.0)


## The pointer, made once for the whole session.
static func ensure(tree: SceneTree) -> void:
	if tree.root.get_node_or_null("Pointing") != null:
		return
	var made: Node3D = load("res://ui/pointing.gd").new()
	made.name = "Pointing"
	tree.root.add_child.call_deferred(made)


## A pickable: `shape` on the pointer's layer, choosing `on_pick`, told
## `on_hover(pointed)` where given.
static func pickable(shape: Shape3D, on_pick: Callable, on_hover := Callable()) -> Area3D:
	var area := Area3D.new()
	area.collision_layer = LAYER
	area.collision_mask = 0
	area.monitoring = false
	var held := CollisionShape3D.new()
	held.shape = shape
	area.add_child(held)
	area.set_meta("pick", on_pick)
	if on_hover.is_valid():
		area.set_meta("hover", on_hover)
	return area


func _ready() -> void:
	for found in get_tree().root.find_children("*", "XRController3D", true, false):
		var hand := found as XRController3D
		_hands.append(hand)
		_rays[hand] = _ray()
		hand.button_pressed.connect(func(button: String): _pressed(hand, button))
	var room := Room.of(get_tree())
	if room != null:
		room.dressed.connect(_dress_rays)


func _dress_rays() -> void:
	for ray in _rays.values():
		ray.mesh.material.albedo_color = Color(Room.ink(), 0.5)


func _xr() -> bool:
	return get_viewport().use_xr


func _physics_process(_delta: float) -> void:
	var space := get_world_3d().direct_space_state
	for hand in _hands:
		var ray: MeshInstance3D = _rays[hand]
		if not _xr() or not is_instance_valid(hand) or not hand.get_has_tracking_data():
			_set_over(hand, null)
			ray.visible = false
			continue
		var from := hand.global_position
		var toward := -hand.global_basis.z.normalized()
		var hit := _cast(space, from, from + toward * REACH)
		_set_over(hand, hit.get("collider"))
		var length: float = from.distance_to(hit.position) if hit.has("position") else REACH
		ray.visible = hit.has("collider") or not DRAWS_ITS_OWN.has(Views.current())
		ray.global_transform = Transform3D(Basis.looking_at(toward), from + toward * length * 0.5)
		ray.scale = Vector3(1.0, 1.0, length)
	if not _xr() and _mouse_at.x >= 0.0:
		var camera := get_viewport().get_camera_3d()
		if camera != null:
			var from := camera.project_ray_origin(_mouse_at)
			var hit := _cast(space, from, from + camera.project_ray_normal(_mouse_at) * REACH)
			_set_over(null, hit.get("collider"))
	_say_hovered()


func _unhandled_input(event: InputEvent) -> void:
	if _xr():
		return
	if event is InputEventMouseMotion:
		_mouse_at = event.position
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_mouse_at = event.position
		_choose(_mouse_over)


func _pressed(hand: XRController3D, button: String) -> void:
	if button == PRESS:
		_choose(_over.get(hand))


func _choose(area) -> void:
	if area is Area3D and is_instance_valid(area) and area.has_meta("pick"):
		var pick: Callable = area.get_meta("pick")
		if pick.is_valid():
			pick.call()


func _cast(space: PhysicsDirectSpaceState3D, from: Vector3, to: Vector3) -> Dictionary:
	var query := PhysicsRayQueryParameters3D.create(from, to, LAYER)
	query.collide_with_areas = true
	query.collide_with_bodies = false
	return space.intersect_ray(query)


func _set_over(hand, area) -> void:
	if hand == null:
		_mouse_over = area
	else:
		_over[hand] = area


## Every pickable some hand or the mouse is on, told when that starts and stops.
func _say_hovered() -> void:
	var now := {}
	for area in _over.values() + [_mouse_over]:
		if area is Area3D and is_instance_valid(area):
			now[area] = true
	for area in _hovered:
		if not now.has(area):
			_hover(area, false)
	for area in now:
		if not _hovered.has(area):
			_hover(area, true)
			_tick(area)
	_hovered = now


func _tick(area: Area3D) -> void:
	if not area.has_meta("tick"):
		return
	for hand in _over:
		if _over[hand] == area and is_instance_valid(hand):
			(hand as XRController3D).trigger_haptic_pulse("haptic", 0.0, TICK, TICK_FOR, 0.0)


func _hover(area, pointed: bool) -> void:
	if area is Area3D and is_instance_valid(area) and area.has_meta("hover"):
		var hover: Callable = area.get_meta("hover")
		if hover.is_valid():
			hover.call(pointed)


func _ray() -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(RAY_WIDTH, RAY_WIDTH, 1.0)
	var paint := StandardMaterial3D.new()
	paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	paint.albedo_color = Color(Room.ink(), 0.5)
	paint.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mesh.material = paint
	var ray := MeshInstance3D.new()
	ray.mesh = mesh
	ray.visible = false
	add_child(ray)
	return ray
