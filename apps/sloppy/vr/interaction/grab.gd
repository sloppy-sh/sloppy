## Taking hold of the field: the right grip turns and moves it with the hand,
## the left grip spins it about its own middle, both grips scale it between
## them, the hands read steadied as much as the reader asks — DESIGN.md § "The
## field in a room". Without a headset, the right mouse button turns it and the
## wheel scales it.
extends Node

const Settings := preload("res://field/settings.gd")
const Steady := preload("res://interaction/steady.gd")
const Reach := preload("res://interaction/reach.gd")

## How far the grip must close to take hold, and how far it must open to let go.
const TAKE := 0.7
const LET_GO := 0.4
## The smallest and largest the field may be made.
const SMALLEST := 0.05
const LARGEST := 20.0
## Radians of turn per pixel the mouse is dragged.
const MOUSE_TURN := 0.006
const WHEEL_STEP := 1.1
## In metres and radians: how far the left hand moves, or twists, before the
## axis it spins the field about is chosen for the rest of the hold.
const SPIN_FROM := 0.01
const SPIN_TWIST := 0.1
## Radians the field spins for each metre the left hand travels: once round in half a metre.
const SPIN_RATE := TAU / 0.5

## What the left grip spins the field about: not yet chosen, the field's up,
## the level line across the reader's view, or the line from their eyes to the
## field's middle.
enum Spin { UNCHOSEN, YAW, PITCH, ROLL }

## A hand has hold of the field, or the mouse turned or scaled it, as it does so.
signal moved

var field: Node3D
## The reader's eyes; the viewport's camera where none is given.
var camera: Camera3D
var left: XRController3D
var right: XRController3D
## The mouse's pointer, whose panel takes the wheel before the field does.
var mouse: Node3D
## Each hand's pointer, by hand: a hand whose pointer takes the grip leaves the field be.
var pointers := {}
var settings = Settings.shared()

var _holding := {}
var _from_field := Transform3D()
var _from_hands := {}
## Each hand as it is read while holding, steadied.
var _hands := {}
var _spin: Spin = Spin.UNCHOSEN
var _spin_axis := Vector3.ZERO
var _spin_last := Transform3D()


func _process(delta: float) -> void:
	if field == null or left == null or right == null:
		return
	var changed := false
	for hand in [left, right]:
		var grip: float = hand.get_float("grip")
		var held: bool = grip > (LET_GO if _holding.has(hand) else TAKE)
		if not _holding.has(hand) and pointers.has(hand) and pointers[hand].takes_grip():
			held = false
		if held != _holding.has(hand):
			changed = true
			if held:
				_holding[hand] = true
			else:
				_holding.erase(hand)
	if changed:
		_from_field = field.global_transform
		_from_hands = {left: left.global_transform, right: right.global_transform}
		_hands = _from_hands.duplicate()
		_spin = Spin.UNCHOSEN
	if _holding.is_empty():
		return
	moved.emit()
	for hand in [left, right]:
		_hands[hand] = Steady.hold(_hands[hand], hand.global_transform, settings.steadying(), delta)
	if _holding.size() == 1 and _holding.has(left):
		_spin_by(_hands[left])
	elif _holding.size() == 1:
		field.global_transform = _hands[right] * _from_hands[right].affine_inverse() * _from_field
	else:
		field.global_transform = between(
			_from_field,
			_from_hands[left].origin, _from_hands[right].origin,
			_hands[left].origin, _hands[right].origin,
		)


## The left hand, read as `hand` now, spins the field: once it has moved or
## twisted far enough the axis is chosen, and from then on the field turns about
## it by what the hand did since the frame before.
func _spin_by(hand: Transform3D) -> void:
	var eyes := _eyes()
	var middle := field.global_position
	if _spin == Spin.UNCHOSEN:
		var view := middle - eyes.origin
		_spin = spin_chosen(eyes.basis, hand.origin - _from_hands[left].origin, twist(_from_hands[left].basis, hand.basis, view))
		if _spin == Spin.UNCHOSEN:
			return
		_spin_axis = spin_axis(_spin, eyes.basis, view)
		_spin_last = _from_hands[left]
	var angle := spin_angle(_spin, _spin_axis, eyes.basis, hand.origin - _spin_last.origin, twist(_spin_last.basis, hand.basis, _spin_axis))
	field.global_transform = spun(field.global_transform, _spin_axis, angle)
	_spin_last = hand


func _eyes() -> Transform3D:
	var eyes := camera if camera != null else get_viewport().get_camera_3d()
	return eyes.global_transform if eyes != null else Transform3D(Basis(), Vector3(0.0, 1.6, 0.0))


## Which way a hand that has `moved` and `twisted` (radians, about the line to
## the field's middle) since it took hold spins the field, seen by `eyes`: a
## twist, a move across their view or a move up or down, whichever has gone
## furthest past where it counts; UNCHOSEN while none has.
static func spin_chosen(eyes: Basis, moved: Vector3, twisted: float) -> Spin:
	var sideways := absf(moved.dot(Reach.across(eyes)))
	var upward := absf(moved.y)
	var travel := Vector2(sideways, upward).length() / SPIN_FROM
	var turned := absf(twisted) / SPIN_TWIST
	if travel < 1.0 and turned < 1.0:
		return Spin.UNCHOSEN
	if turned > travel:
		return Spin.ROLL
	return Spin.YAW if sideways >= upward else Spin.PITCH


## The line through the field's middle that `spin` turns it about, for `eyes`
## looking along `view` to that middle.
static func spin_axis(spin: Spin, eyes: Basis, view: Vector3) -> Vector3:
	match spin:
		Spin.YAW:
			return Vector3.UP
		Spin.PITCH:
			return Reach.across(eyes)
		Spin.ROLL:
			return view.normalized() if view.length() > 1e-4 else Reach.ahead(eyes)
	return Vector3.ZERO


## Radians the field spins about `axis` for a hand that has `moved` and
## `twisted` about it since the frame before: the side of the field nearer the
## eyes goes the way the hand went, and a twist turns it as much as the wrist did.
static func spin_angle(spin: Spin, axis: Vector3, eyes: Basis, moved: Vector3, twisted: float) -> float:
	match spin:
		Spin.YAW:
			return moved.dot(Reach.across(eyes)) * SPIN_RATE
		Spin.PITCH:
			return -moved.y * SPIN_RATE
		Spin.ROLL:
			return twisted
	return 0.0


## Radians `to` is turned from `from` about `axis`, the rest of the turn left out.
static func twist(from: Basis, to: Basis, axis: Vector3) -> float:
	if axis.length() < 1e-4:
		return 0.0
	var turn := Quaternion(to.orthonormalized() * from.orthonormalized().inverse())
	var along := axis.normalized()
	return wrapf(2.0 * atan2(Vector3(turn.x, turn.y, turn.z).dot(along), turn.w), -PI, PI)


## `field` turned by `angle` about `axis` through its own middle, keeping its size.
static func spun(field: Transform3D, axis: Vector3, angle: float) -> Transform3D:
	if angle == 0.0 or axis.length() < 1e-4:
		return field
	return Transform3D(Basis(axis.normalized(), angle) * field.basis, field.origin)


## `field` taken from where two hands were (`left`, `right`) to where they are
## now: turned as the line between them turned, scaled as it grew, and carried
## with the point between them.
static func between(field: Transform3D, left: Vector3, right: Vector3, left_now: Vector3, right_now: Vector3) -> Transform3D:
	var span := right - left
	var span_now := right_now - left_now
	if span.length() < 1e-3 or span_now.length() < 1e-3:
		return field
	var size := field.basis.get_scale().x
	var grown := clampf(span_now.length() / span.length(), SMALLEST / size, LARGEST / size)
	var turn := Basis(Quaternion(span.normalized(), span_now.normalized()))
	var middle := (left + right) * 0.5
	var middle_now := (left_now + right_now) * 0.5
	return Transform3D(turn * Basis.from_scale(Vector3.ONE * grown), middle_now) * Transform3D(Basis(), -middle) * field


func _unhandled_input(event: InputEvent) -> void:
	if field == null or left != null:
		return
	if event is InputEventMouseMotion and event.button_mask & MOUSE_BUTTON_MASK_RIGHT:
		moved.emit()
		var centre := field.global_position
		var turn := Basis(Vector3.UP, event.relative.x * MOUSE_TURN) * Basis(Vector3.RIGHT, event.relative.y * MOUSE_TURN)
		field.global_transform = Transform3D(turn, centre) * Transform3D(Basis(), -centre) * field.global_transform
	elif event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		if mouse != null and mouse.holding_stick:
			return
		moved.emit()
		var size := field.basis.get_scale().x
		var step := WHEEL_STEP if event.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / WHEEL_STEP
		step = clampf(size * step, SMALLEST, LARGEST) / size
		field.basis = field.basis.scaled(Vector3.ONE * step)
