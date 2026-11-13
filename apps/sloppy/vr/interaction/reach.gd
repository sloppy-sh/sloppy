## The field brought to the reader wherever they sit or stand: the pointing
## hand's stick turns it about them as it leans across and tilts it about them,
## over the top and under without a stop, as it leans ahead or back; and
## `stand_before` puts it in front of their eyes at the height they are at now.
## Without a headset, the arrow keys turn and tilt.
extends Node

const Settings := preload("res://field/settings.gd")
const Steady := preload("res://interaction/steady.gd")

## Radians a second the field turns about the reader with the stick leaned all
## the way, and how far the stick must lean before it turns at all.
const TURN_RATE := PI / 2.0
const TURN_FROM := 0.15
## In metres: how large the field stands across when it is brought before the
## reader, and how far its near side is from their eyes, within reach.
const ACROSS := 1.4
const NEAR := 0.45
## In the field's own units: a field of one or two notes is drawn as if it reached this far.
const SMALLEST_RADIUS := 0.3
## In metres, for a field the reader arrives inside: how far ahead its middle
## stands, and the least room left between their eyes and any mark.
const ARRIVAL_AHEAD := 1.0
const ARRIVAL_CLEAR := 0.4
## In metres: how much further than within reach the near side of a field stood
## ahead at its own size is.
const AT_SIZE_FURTHER := 0.5
## The eye height in metres the views are laid out for (`main.tscn`'s camera).
const LAID_OUT_FOR := 1.6

## The stick is turning or tilting the field, as it does so.
signal moved

var field: Node3D
var camera: Camera3D
## The pointing hand; null without a headset.
var hand: XRController3D
## That hand's pointer: while it is on something that scrolls, its stick scrolls.
var pointer: Node3D
var settings = Settings.shared()

## The stick's lean as it is read, steadied.
var _lean := Vector2.ZERO


## The way ahead of `eyes` across the floor, even when they look straight up or
## down: then the top of the head is what points ahead, or behind.
static func ahead(eyes: Basis) -> Vector3:
	var forward := Vector3(-eyes.z.x, 0.0, -eyes.z.z)
	if forward.length() > 0.2:
		return forward.normalized()
	var up := Vector3(eyes.y.x, 0.0, eyes.y.z) * (1.0 if eyes.z.y > 0.0 else -1.0)
	return up.normalized() if up.length() > 1e-4 else Vector3.FORWARD


## Upright, facing the way ahead of `eyes`: what is in front of the field is
## what is in front of the reader.
static func facing(eyes: Basis) -> Basis:
	return Basis.looking_at(ahead(eyes), Vector3.UP)


## Where a field whose farthest mark is `radius` from its middle, in its own
## units, stands when it is put before `eyes`: ACROSS wide, its middle at their
## height, its near side NEAR in front of them.
static func stand_before(eyes: Transform3D, radius: float) -> Transform3D:
	var size := ACROSS / (2.0 * maxf(radius, SMALLEST_RADIUS))
	var middle := eyes.origin + ahead(eyes.basis) * (ACROSS / 2.0 + NEAR)
	return Transform3D(facing(eyes.basis).scaled(Vector3.ONE * size), middle)


## Where a field laid out as `placed` (`Field.derive`'s answer) stands for a
## reader arriving inside it: at its own size, upright, its middle ARRIVAL_AHEAD
## ahead of `eyes` at their height, and turned about its upright so no mark is
## nearer their eyes than ARRIVAL_CLEAR — or, where no turn leaves that much
## room, the turn that leaves the most.
static func arrival(eyes: Transform3D, placed: Dictionary) -> Transform3D:
	var inner := INF
	for ref in placed:
		var out: float = placed[ref].position.length()
		if out > 1e-3:
			inner = minf(inner, out)
	var away := minf(ARRIVAL_AHEAD, inner * 0.9)
	var ahead_of := ahead(eyes.basis)
	var best := Transform3D()
	var most := -1.0
	for nearer in [1.0, 0.8, 0.6]:
		for turn in 16:
			var basis := facing(eyes.basis) * Basis(Vector3.UP, turn * TAU / 16.0)
			var stood := Transform3D(basis, eyes.origin + ahead_of * away * nearer)
			var clear := _clearance(stood.affine_inverse() * eyes.origin, placed)
			if clear >= ARRIVAL_CLEAR:
				return stood
			if clear > most:
				most = clear
				best = stood
	return best


## In the field's own units: how far the mark of `placed` nearest `at` is from it.
static func _clearance(at: Vector3, placed: Dictionary) -> float:
	var nearest := INF
	for ref in placed:
		nearest = minf(nearest, at.distance_to(placed[ref].position))
	return nearest


## Where a field laid out as `placed` stands ahead of `eyes` at its own size:
## upright, its middle at their height, its near side AT_SIZE_FURTHER beyond reach.
static func before_at_size(eyes: Transform3D, placed: Dictionary) -> Transform3D:
	var nearest := 0.0
	for ref in placed:
		nearest = maxf(nearest, placed[ref].position.z)
	return Transform3D(facing(eyes.basis), eyes.origin + ahead(eyes.basis) * (nearest + NEAR + AT_SIZE_FURTHER))


## Where a field stands to put its mark at `mark_local`, in its own units, NEAR
## ahead of `eyes` at their height: upright, at the size and turned the way
## across the floor of `field_was`, the basis it stood in before.
static func before_mark(eyes: Transform3D, mark_local: Vector3, field_was: Basis) -> Transform3D:
	var size := field_was.get_scale().x
	var upright := Basis(Vector3.UP, heading(field_was)).scaled(Vector3.ONE * size)
	var at := eyes.origin + ahead(eyes.basis) * NEAR
	return Transform3D(upright, at - upright * mark_local)


## Radians `field` is turned about the upright, read from its back, or from its
## side where it is tilted to lie flat.
static func heading(field: Basis) -> float:
	var turned := field.orthonormalized()
	var back := Vector3(turned.z.x, 0.0, turned.z.z)
	if back.length() > 1e-3:
		return atan2(back.x, back.z)
	return atan2(-turned.x.z, turned.x.x)


## Where the stage a view is laid out on stands for `eyes`: turned to face the
## way they face and raised or lowered to their height, so what is laid out at
## LAID_OUT_FOR is at their eyes.
static func stage_before(eyes: Transform3D) -> Transform3D:
	var under := Vector3(eyes.origin.x, eyes.origin.y - LAID_OUT_FOR, eyes.origin.z)
	return Transform3D(facing(eyes.basis), under)


## `field` turned by `angle` about the upright line through `eye`.
static func turned(field: Transform3D, eye: Vector3, angle: float) -> Transform3D:
	var about := Vector3(eye.x, 0.0, eye.z)
	return Transform3D(Basis(Vector3.UP, angle), about) * Transform3D(Basis(), -about) * field


## `field` tilted by `angle` about the level line through `eye` running
## `across` the reader's view: with a negative angle what was overhead comes
## forward, as it does when they look up.
static func tilted(field: Transform3D, eye: Vector3, across: Vector3, angle: float) -> Transform3D:
	return Transform3D(Basis(across.normalized(), angle), eye) * Transform3D(Basis(), -eye) * field


## The level line across `eyes`' view, to their right.
static func across(eyes: Basis) -> Vector3:
	var right := Vector3(eyes.x.x, 0.0, eyes.x.z)
	return right.normalized() if right.length() > 1e-4 else Vector3.RIGHT


## Radians the field turns in `delta` seconds with the stick leaned `lean`:
## none within TURN_FROM, TURN_RATE's worth leaned all the way, and finer than
## the lean between, so a small lean turns slowly. The same for a tilt.
static func turn_by(lean: float, delta: float) -> float:
	if absf(lean) <= TURN_FROM:
		return 0.0
	var past := (absf(lean) - TURN_FROM) / (1.0 - TURN_FROM)
	return -signf(lean) * past * past * TURN_RATE * delta


## Radians the field turns about the upright through the reader in `delta`
## seconds with the stick leaned `lean` across: leaned right it turns left
## about them, bringing what is on their right round to the front.
static func across_turn(lean: float, delta: float) -> float:
	return -turn_by(lean, delta)


func _process(delta: float) -> void:
	if field == null or camera == null:
		return
	var lean := Vector2.ZERO
	if hand != null:
		if pointer == null or not pointer.holding_stick:
			lean = hand.get_vector2("primary")
	else:
		lean = Vector2(
			float(Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_LEFT)),
			float(Input.is_physical_key_pressed(KEY_UP)) - float(Input.is_physical_key_pressed(KEY_DOWN)),
		)
	_lean = Steady.lean(_lean, lean, settings.steadying(), delta)
	var eye := camera.global_position
	if absf(_lean.x) >= absf(_lean.y):
		var by := across_turn(_lean.x, delta)
		if by != 0.0:
			moved.emit()
			field.global_transform = turned(field.global_transform, eye, by)
	else:
		var by := turn_by(_lean.y, delta)
		if by != 0.0:
			moved.emit()
			field.global_transform = tilted(field.global_transform, eye, across(camera.global_basis), by)
