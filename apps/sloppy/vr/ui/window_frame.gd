## What makes a panel left in the room a window: a control bar below it that the
## trigger takes hold of to move it, and handles on its corners that resize it
## from its middle — DESIGN.md § "The field in a room". A child of the panel at
## its middle, in its plane; the panel answers the pointer through `nearer` and
## hands it the calls that land here.
extends Node3D

const Room := preload("res://room/room.gd")

## In metres: the bar's height, from the window's foot to the bar, its share of
## the window's width, and how far round it the ray still takes it.
const BAR_TALL := 0.014
const BAR_GAP := 0.012
const BAR_SHARE := 0.4
const BAR_SLACK := 0.008
## In metres from the window's foot to the bar's.
const FOOT := BAR_GAP + BAR_TALL
## In metres: a handle's legs and stroke, how far out from the corner it stands,
## how near the ray shows it, and the band round the corner that takes hold of
## it, GRAB out past it and INSIDE along its edges, never over the window itself.
const HANDLE := 0.03
const HANDLE_STROKE := 0.004
const HANDLE_OUT := 0.006
const REVEAL := 0.06
const INSIDE := 0.012
const GRAB := 0.03
## In metres in front of the window, and the bar's line at rest.
const LIFT := 0.003
const RING := 0.002
## In metres from the eyes: the nearest and farthest a window is pushed.
const NEAREST := 0.35
const FARTHEST := 3.0
## In metres a second, for the stick leaned all the way.
const PUSH := 1.5
## Of the size the window was opened at.
const SMALLEST := 0.6
const LARGEST := 2.0
## The palette's own node, as `ui/hand_menu.gd`'s `of` finds it.
const PALETTE := &"HandMenu"
## Where a pinned window stands until it is placed elsewhere: degrees right of
## where the eyes look, degrees above it, and metres from them.
const PINNED_AT := Vector3(18.0, -8.0, 0.9)
## A pinned window stays put while the head turns less than STILL_WITHIN
## degrees from it or comes less than STILL_NEARER metres nearer or farther.
const STILL_WITHIN := 6.0
const STILL_NEARER := 0.1
## Seconds a pinned window takes to come within 5 % of where it is going.
const SETTLE := 0.25
## What a critically damped spring's error falls to 5 % within, in its rate's units.
const WITHIN_5_PERCENT := 4.744

## `pointer`'s ray came onto the bar or a handle off the window's content.
signal took_ray(pointer: Node3D)
## A pinned window was placed `at` in head space, as `pinned_at` holds it.
signal placed(at: Vector3)

## Told the window's new size in metres, live while a corner is held and
## `done` once it is let go.
var resize: Callable
## In metres.
var size: Vector2
## In metres of the panel's own bar standing over its page, inside the window.
var above := 0.0
## The size it was opened at, and the least and most it is drawn to.
var opened: Vector2
var least: Vector2
var most: Vector2

var _bar: MeshInstance3D
var _bar_fill: MeshInstance3D
var _handles: Array[Node3D] = []
var _paint := StandardMaterial3D.new()
var _fill_paint := StandardMaterial3D.new()
var _handle_paint := StandardMaterial3D.new()
## For each pointer, the corner its ray is within REVEAL of, or -1.
var _near := {}
## The pointers on the bar or a handle, and those of them pointing here now.
var _on := {}
var _lit := {}
var _held_by: Node3D
## The corner held, or -1 while the bar is.
var _holding := -1
var _distance := 0.0
var _grabbed_at := Vector3.ZERO
var _start := Transform3D()
var _start_size := Vector2.ZERO
var _start_corner := Vector2.ZERO
var _was_shown := false
## Whether the window follows the head, standing at `pinned_at` from the eyes.
var pinned := false
var pinned_at := PINNED_AT
## Whether a hand carries the window, so the head does not.
var carried := false
var _chasing := false
var _velocity := Vector3.ZERO
var _up := Vector3.UP
var _up_velocity := Vector3.ZERO


func _init(given_size: Vector2, resizing: Callable, given_above := 0.0) -> void:
	name = "Window"
	size = given_size
	above = given_above
	resize = resizing
	opened = given_size
	least = given_size * SMALLEST
	most = given_size * LARGEST


## Where the window's bar is, about the window's middle.
static func bar_at(window: Vector2) -> Vector2:
	return Vector2(0.0, -window.y / 2.0 - BAR_GAP - BAR_TALL / 2.0)


## The bar's width and height for a window `window` wide and tall.
static func bar_size(window: Vector2) -> Vector2:
	return Vector2(window.x * BAR_SHARE, BAR_TALL)


## Where a window held by its bar stands: the point taken at `grabbed` (in the
## window's own metres) at `distance` along the ray from `origin` toward
## `direction`, the window upright and turned to face `eyes`.
static func follow(origin: Vector3, direction: Vector3, distance: float, grabbed: Vector3, eyes: Vector3) -> Transform3D:
	var at := origin + direction.normalized() * distance
	var away := at - eyes
	away.y = 0.0
	var facing := Basis.looking_at(away.normalized(), Vector3.UP) if away.length() > 1e-3 else Basis()
	return Transform3D(facing, at - facing * grabbed)


## Where a window pinned `at` (degrees right, degrees up, metres) stands from
## the eyes seen by `head`.
static func head_place(head: Transform3D, at: Vector3) -> Vector3:
	var yaw := deg_to_rad(at.x)
	var pitch := deg_to_rad(at.y)
	var along := Vector3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
	return head * (along * at.z)


## Where `place` is from the eyes seen by `head`, as `head_place` reads it.
static func head_offset(head: Transform3D, place: Vector3) -> Vector3:
	var seen := head.affine_inverse() * place
	var level := Vector2(seen.x, seen.z).length()
	return Vector3(rad_to_deg(atan2(seen.x, -seen.z)), rad_to_deg(atan2(seen.y, level)), seen.length())


## A window at `place` turned to face `eyes` squarely, `up` its top.
static func facing(place: Vector3, eyes: Vector3, up: Vector3) -> Basis:
	var away := place - eyes
	if away.length() < 1e-3 or absf(away.normalized().dot(up.normalized())) > 0.999:
		return Basis()
	return Basis.looking_at(away.normalized(), up)


## A pinned window whose point taken at `grabbed` stands at `bar`, its centre
## turned to face the eyes of `head` as `follow_head` turns it; `near` is
## where the centre stood a moment ago.
static func held_pinned(bar: Vector3, grabbed: Vector3, head: Transform3D, near: Vector3) -> Transform3D:
	var centre := near
	for _i in 8:
		centre = bar - facing(centre, head.origin, head.basis.y) * grabbed
	return Transform3D(facing(centre, head.origin, head.basis.y), centre)


## Whether a pinned window standing at `place` has been left by the head, whose
## eyes are at `eyes` and would have it at `wanted`.
static func left_behind(place: Vector3, wanted: Vector3, eyes: Vector3) -> bool:
	var now := place - eyes
	var then := wanted - eyes
	if now.length() < 1e-3 or then.length() < 1e-3:
		return true
	return rad_to_deg(now.angle_to(then)) >= STILL_WITHIN or absf(now.length() - then.length()) >= STILL_NEARER


## `[at, velocity]` after `delta` seconds of a critically damped spring drawing
## `at`, moving at `velocity`, toward `to`, settling within SETTLE.
static func spring(at: Vector3, velocity: Vector3, to: Vector3, delta: float) -> Array:
	var rate := WITHIN_5_PERCENT / SETTLE
	var off := at - to
	var fall := exp(-rate * delta)
	var lean := (velocity + off * rate) * delta
	return [to + (off + lean) * fall, (velocity - lean * rate) * fall]


## The distances along the ray from `origin` toward `direction` where it stands
## NEAREST and FARTHEST from `eyes`.
static func reach(origin: Vector3, direction: Vector3, eyes: Vector3) -> Vector2:
	var along := direction.normalized()
	var from := origin - eyes
	var b := along.dot(from)
	var c := from.length_squared()
	var near := -b + sqrt(maxf(b * b - c + NEAREST * NEAREST, 0.0))
	var far := -b + sqrt(maxf(b * b - c + FARTHEST * FARTHEST, 0.0))
	return Vector2(maxf(near, 0.0), far)


## `distance` after the stick moved `amount` (its lean times the seconds, ahead
## negative), kept within `bounds` unless it already stood past one.
static func pushed(distance: float, amount: float, bounds: Vector2) -> float:
	return clampf(distance - amount * PUSH, minf(bounds.x, distance), maxf(bounds.y, distance))


## The size a window `start` big becomes when the corner that stood at `corner`
## from its middle is drawn to `meets`, its aspect kept, within `least` and `most`.
static func resized(start: Vector2, corner: Vector2, meets: Vector2, least_size: Vector2, most_size: Vector2) -> Vector2:
	var scale := meets.dot(corner) / corner.length_squared() if corner.length_squared() > 1e-9 else 1.0
	var lowest := maxf(least_size.x / start.x, least_size.y / start.y)
	var highest := minf(most_size.x / start.x, most_size.y / start.y)
	return start * clampf(scale, lowest, highest)


## The corner `at` (0 top left, 1 top right, 2 bottom right, 3 bottom left) of a
## window `window` big with `over` metres of bar above it, about its middle.
static func corner_of(at: int, window: Vector2, over := 0.0) -> Vector2:
	var x := window.x / 2.0 * (-1.0 if at == 0 or at == 3 else 1.0)
	var y := window.y / 2.0 + over if at < 2 else -window.y / 2.0
	return Vector2(x, y)


func _ready() -> void:
	for paint in [_paint, _fill_paint, _handle_paint]:
		paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		paint.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		paint.cull_mode = BaseMaterial3D.CULL_DISABLED
	_bar = MeshInstance3D.new()
	_bar.name = "Bar"
	_bar.material_override = _paint
	add_child(_bar)
	_bar_fill = MeshInstance3D.new()
	_bar_fill.name = "Held"
	_bar_fill.material_override = _fill_paint
	add_child(_bar_fill)
	for at in 4:
		var handle := Node3D.new()
		handle.name = "Corner%d" % at
		for leg in 2:
			var stroke := MeshInstance3D.new()
			stroke.mesh = QuadMesh.new()
			stroke.material_override = _handle_paint
			handle.add_child(stroke)
		add_child(handle)
		_handles.append(handle)
	_lay()
	_paint_now()


## The window now `given` big, its bar and corners standing round it.
func fit(given: Vector2, over := above) -> void:
	size = given
	above = over
	if is_inside_tree():
		_lay()


## Whether the window stands in the room rather than on the palette.
func shown() -> bool:
	if not is_inside_tree() or not get_parent().is_visible_in_tree():
		return false
	var at := get_parent()
	while at != null:
		if at.name == PALETTE:
			return false
		at = at.get_parent()
	return true


## Whether `pointer`'s ray is on the bar or a handle rather than the window's
## content, as `nearer` last found.
func takes(pointer: Node3D) -> bool:
	return _on.has(pointer)


## Whether `pointer` holds the bar or a corner.
func holds(pointer: Node3D) -> bool:
	return _held_by == pointer


## The nearer of the bar and handles and the panel's content met `own` metres
## along `pointer`'s ray; for the pointer holding the window, where it holds it.
func nearer(pointer: Node3D, own: float) -> float:
	if _held_by == pointer:
		_on[pointer] = true
		return _held_along(pointer, own)
	var mine := _hit(pointer)
	if mine < INF and mine <= own + LIFT:
		if not _on.has(pointer):
			_on[pointer] = true
			took_ray.emit(pointer)
		return mine
	_on.erase(pointer)
	return own


## How far along the holding `pointer`'s ray the bar or the corner it holds is.
func _held_along(pointer: Node3D, own: float) -> float:
	if _holding < 0:
		return _distance
	var meets = _meets(pointer, _start)
	if meets == null:
		return own
	return (_start * (meets as Vector3)).distance_to(pointer.ray()[0])


## How far along `pointer`'s ray it meets the bar or a handle; INF where it meets
## neither. Keeps which corner the ray is near.
func _hit(pointer: Node3D) -> float:
	_near.erase(pointer)
	if not shown():
		return INF
	var meets = _meets(pointer, global_transform)
	if meets == null:
		return INF
	var on: Vector2 = Vector2(meets.x, meets.y)
	var corner := _corner_near(on, REVEAL)
	if corner >= 0:
		_near[pointer] = corner
	if _on_bar(on) or _grabs_corner(on) >= 0:
		return (global_transform * (meets as Vector3)).distance_to(pointer.ray()[0])
	return INF


func _on_bar(on: Vector2) -> bool:
	var middle := bar_at(size)
	var half := bar_size(size) / 2.0 + Vector2.ONE * BAR_SLACK
	return absf(on.x - middle.x) <= half.x and absf(on.y - middle.y) <= half.y


func _corner_near(on: Vector2, within: float) -> int:
	for at in 4:
		if on.distance_to(corner_of(at, size, above)) <= within:
			return at
	return -1


## The corner whose band takes hold at `on`, or -1.
func _grabs_corner(on: Vector2) -> int:
	for at in 4:
		var corner := corner_of(at, size, above)
		var out := Vector2(signf(corner.x), signf(corner.y))
		var past := (on - corner) * out
		var outside := past.x >= 0.0 or past.y >= 0.0
		if outside and past.x > -INSIDE and past.y > -INSIDE and past.x < GRAB and past.y < GRAB:
			return at
	return -1


## Where `pointer`'s ray meets the plane of `seen`, in its own metres; null where
## it does not, ahead of the ray.
static func _meets(pointer: Node3D, seen: Transform3D) -> Variant:
	var ray: Array = pointer.ray()
	var inverse := seen.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	if absf(along.z) < 1e-6:
		return null
	var t := -from.z / along.z
	if t <= 0.0:
		return null
	return from + along * t


func point(pointer: Node3D) -> void:
	_lit[pointer] = true
	if pointer != _held_by:
		return
	var window := get_parent() as Node3D
	var ray: Array = pointer.ray()
	if _holding < 0:
		if not pinned:
			window.global_transform = follow(ray[0], ray[1], _distance, _grabbed_at, _eyes())
			return
		var head := _head()
		var bar: Vector3 = ray[0] + (ray[1] as Vector3).normalized() * _distance
		window.global_transform = held_pinned(bar, _grabbed_at, head, window.global_position)
		pinned_at = head_offset(head, window.global_position)
		return
	var meets = _meets(pointer, _start)
	if meets == null:
		return
	var grown := resized(_start_size, _start_corner, Vector2(meets.x, meets.y), least, most)
	if not grown.is_equal_approx(size):
		fit(grown)
		resize.call(grown, false)


func unpoint(pointer: Node3D) -> void:
	_lit.erase(pointer)


func press(pointer: Node3D) -> void:
	if _held_by != null:
		return
	var meets = _meets(pointer, global_transform)
	if meets == null:
		return
	var on := Vector2(meets.x, meets.y)
	var window := get_parent() as Node3D
	_start = Transform3D(window.global_basis.orthonormalized(), window.global_position)
	_holding = -1 if _on_bar(on) else _grabs_corner(on)
	if _holding < 0 and not _on_bar(on):
		return
	_held_by = pointer
	if _holding < 0:
		_grabbed_at = meets
		_distance = (_start * (meets as Vector3)).distance_to(pointer.ray()[0])
	else:
		_start_size = size
		_start_corner = corner_of(_holding, size, above)
	_paint_now()


func release(pointer: Node3D) -> void:
	if pointer != _held_by:
		return
	_held_by = null
	if _holding >= 0:
		resize.call(size, true)
	elif pinned:
		_settle()
		placed.emit(pinned_at)
	_holding = -1
	_paint_now()


## While the bar is held the stick pushes the window off and pulls it in.
func scroll(pointer: Node3D, amount: float) -> bool:
	if pointer != _held_by:
		return false
	if _holding < 0 and amount != 0.0:
		var ray: Array = pointer.ray()
		_distance = pushed(_distance, amount, reach(ray[0], ray[1], _eyes()))
		point(pointer)
	return true


## Pins the window to the head, or leaves it standing where it is; pinned
## `at_once`, it is there now rather than easing there.
func pin(on: bool, at_once := false) -> void:
	pinned = on
	_settle()
	_chasing = on
	if on and at_once:
		var head := _head()
		var window := get_parent() as Node3D
		var place := head_place(head, pinned_at)
		window.global_transform = Transform3D(facing(place, head.origin, _up), place)
		_chasing = false


## Carried by a hand, a pinned window stays where the hand leaves it, there
## in head space from then on.
func carry(on: bool) -> void:
	carried = on
	if on or not pinned:
		return
	pinned_at = head_offset(_head(), (get_parent() as Node3D).global_position)
	_settle()
	placed.emit(pinned_at)


## A pinned window `delta` seconds on toward where the head would have it.
func follow_head(delta: float) -> void:
	if not pinned or carried or _held_by != null or not is_inside_tree():
		return
	var head := _head()
	var window := get_parent() as Node3D
	var place := window.global_position
	var wanted := head_place(head, pinned_at)
	if not _chasing and left_behind(place, wanted, head.origin):
		_chasing = true
	if _chasing:
		var moved := spring(place, _velocity, wanted, delta)
		place = moved[0]
		_velocity = moved[1]
		var turned := spring(_up, _up_velocity, head.basis.y, delta)
		_up = (turned[0] as Vector3).normalized()
		_up_velocity = turned[1]
		if place.distance_to(wanted) < 0.002 and _velocity.length() < 0.01:
			place = wanted
			_settle()
	window.global_transform = Transform3D(facing(place, head.origin, _up), place)


func _settle() -> void:
	_chasing = false
	_velocity = Vector3.ZERO
	_up_velocity = Vector3.ZERO
	_up = _head().basis.y


func _process(delta: float) -> void:
	follow_head(delta)
	var now := shown()
	if now != _was_shown:
		_was_shown = now
		_left_palette_or_came_back(now)
	if _held_by != null and not is_instance_valid(_held_by):
		_held_by = null
		_holding = -1
	for kept in [_near, _on, _lit]:
		for pointer in kept.keys():
			if not is_instance_valid(pointer):
				kept.erase(pointer)
	_paint_now()


## Back on the palette, a window resized in the room is the size it opened at.
func _left_palette_or_came_back(floating: bool) -> void:
	if not floating and not size.is_equal_approx(opened):
		fit(opened)
		resize.call(opened, true)


func _paint_now() -> void:
	var standing := shown()
	visible = standing
	if not standing:
		return
	var pointed := not _lit.is_empty() or _held_by != null
	_paint.albedo_color = Room.ink() if pointed else Color(Room.ink(), 0.35)
	_fill_paint.albedo_color = Room.ink()
	_bar_fill.visible = _held_by != null and _holding < 0
	_handle_paint.albedo_color = Room.ink()
	var near := {}
	for pointer in _near:
		near[_near[pointer]] = true
	for at in 4:
		_handles[at].visible = near.has(at) or (_held_by != null and _holding == at)


func _eyes() -> Vector3:
	return _head().origin


func _head() -> Transform3D:
	var camera := get_viewport().get_camera_3d() if is_inside_tree() else null
	return camera.global_transform if camera != null else Transform3D(Basis(), Vector3(0.0, 1.6, 0.0))


func _lay() -> void:
	var middle := bar_at(size)
	var bar := bar_size(size)
	_bar.mesh = pill(bar, RING)
	_bar.position = Vector3(middle.x, middle.y, LIFT)
	_bar_fill.mesh = pill(bar, bar.y / 2.0)
	_bar_fill.position = _bar.position
	for at in 4:
		var corner := corner_of(at, size, above)
		var out := Vector2(signf(corner.x), signf(corner.y))
		var tip := corner + out * HANDLE_OUT
		var handle := _handles[at]
		handle.position = Vector3(tip.x, tip.y, LIFT)
		var across := handle.get_child(0) as MeshInstance3D
		(across.mesh as QuadMesh).size = Vector2(HANDLE, HANDLE_STROKE)
		across.position = Vector3(-out.x * (HANDLE / 2.0 - HANDLE_STROKE / 2.0), 0.0, 0.0)
		var down := handle.get_child(1) as MeshInstance3D
		(down.mesh as QuadMesh).size = Vector2(HANDLE_STROKE, HANDLE)
		down.position = Vector3(0.0, -out.y * (HANDLE / 2.0 - HANDLE_STROKE / 2.0), 0.0)


## A rounded bar `given` big, drawn as a ring `stroke` metres wide; one as wide
## as half its height is filled.
static func pill(given: Vector2, stroke: float) -> ArrayMesh:
	var radius := given.y / 2.0
	var straight := maxf(given.x / 2.0 - radius, 0.0)
	var inner := maxf(radius - stroke, 0.0)
	var outline := PackedVector2Array()
	var inline := PackedVector2Array()
	var steps := 12
	for side: float in [1.0, -1.0]:
		for i in steps + 1:
			var angle := -PI / 2.0 + PI * i / steps
			var bend := Vector2(cos(angle), sin(angle)) * side
			var middle := Vector2(straight * side, 0.0)
			outline.append(middle + bend * radius)
			inline.append(middle + bend * inner)
	var vertices := PackedVector3Array()
	var count := outline.size()
	for i in count:
		var j := (i + 1) % count
		var a := outline[i]
		var b := outline[j]
		var c := inline[j]
		var d := inline[i]
		vertices.append_array([Vector3(a.x, a.y, 0), Vector3(b.x, b.y, 0), Vector3(c.x, c.y, 0)])
		vertices.append_array([Vector3(a.x, a.y, 0), Vector3(c.x, c.y, 0), Vector3(d.x, d.y, 0)])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh
