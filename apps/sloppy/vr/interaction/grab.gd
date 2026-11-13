## Taking hold of the field: one grip turns and moves it with the hand, both
## grips scale it between them, the hands read steadied as much as the reader
## asks. Without a headset, the right mouse button turns it and the wheel scales it.
extends Node

const Settings := preload("res://field/settings.gd")
const Steady := preload("res://interaction/steady.gd")

## How far the grip must close to take hold, and how far it must open to let go.
const TAKE := 0.7
const LET_GO := 0.4
## The smallest and largest the field may be made.
const SMALLEST := 0.05
const LARGEST := 20.0
## Radians of turn per pixel the mouse is dragged.
const MOUSE_TURN := 0.006
const WHEEL_STEP := 1.1

## A hand has hold of the field, or the mouse turned or scaled it, as it does so.
signal moved

var field: Node3D
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
	if _holding.is_empty():
		return
	moved.emit()
	for hand in [left, right]:
		_hands[hand] = Steady.hold(_hands[hand], hand.global_transform, settings.steadying(), delta)
	if _holding.size() == 1:
		var hand: XRController3D = _holding.keys()[0]
		field.global_transform = _hands[hand] * _from_hands[hand].affine_inverse() * _from_field
	else:
		field.global_transform = between(
			_from_field,
			_from_hands[left].origin, _from_hands[right].origin,
			_hands[left].origin, _hands[right].origin,
		)


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
