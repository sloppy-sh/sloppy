## Taking hold of the field: the left grip spins it about its own middle — a
## move sideways about its up, up or down about the line across the reader's
## view, a twist about the line from their eyes to it — the right grip carries
## it, and both scale it as they did.
## Exits 1 on a failure.
extends SceneTree

const Grab := preload("res://interaction/grab.gd")
const Reach := preload("res://interaction/reach.gd")
const Settings := preload("res://field/settings.gd")

const EYES := Vector3(0.0, 1.6, 0.0)

var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	_the_axis_waits_for_a_centimetre_or_a_twist()
	_sideways_spins_about_the_fields_up()
	_up_or_down_spins_about_the_line_across_the_view()
	_a_twist_spins_about_the_line_to_the_field()
	_both_grips_scale_as_they_did()
	await _the_grips_in_the_room()
	print("grab_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _the_axis_waits_for_a_centimetre_or_a_twist() -> void:
	var eyes := Basis(Vector3.UP, 0.7)
	_check(Grab.spin_chosen(eyes, Vector3(0.004, 0.005, 0.0), 0.05) == Grab.Spin.UNCHOSEN, "a hand that has barely moved chooses nothing yet")
	_check(Grab.spin_chosen(eyes, Reach.ahead(eyes) * 0.03, 0.0) == Grab.Spin.UNCHOSEN, "nor one pushed straight ahead, along the view")
	var across := Reach.across(eyes)
	_check(Grab.spin_chosen(eyes, across * Grab.SPIN_FROM * 1.2, 0.0) == Grab.Spin.YAW, "a centimetre across the reader's view, however they are turned, is sideways")
	_check(Grab.spin_chosen(eyes, Vector3(0.0, -Grab.SPIN_FROM * 1.2, 0.0), 0.0) == Grab.Spin.PITCH, "a centimetre down is up and down")
	_check(Grab.spin_chosen(eyes, across * 0.006, Grab.SPIN_TWIST * 1.3) == Grab.Spin.ROLL, "a twist past its mark, the hand hardly moved, is a twist")
	_check(Grab.spin_chosen(eyes, across * 0.03, Grab.SPIN_TWIST * 1.1) == Grab.Spin.YAW, "a sweep that turns the wrist a little on the way is still a sweep")


## A field ahead of the eyes, and the point of it nearest them.
func _field() -> Transform3D:
	return Transform3D(Basis.from_scale(Vector3.ONE * 0.5), EYES + Vector3(0.0, 0.0, -2.0))


func _near_side(field: Transform3D) -> Vector3:
	return field * Vector3(0.0, 0.0, 1.0)


func _sideways_spins_about_the_fields_up() -> void:
	var field := _field()
	var eyes := Basis()
	var axis := Grab.spin_axis(Grab.Spin.YAW, eyes, field.origin - EYES)
	_check(axis.is_equal_approx(Vector3.UP), "sideways spins about the field's up")
	var angle := Grab.spin_angle(Grab.Spin.YAW, axis, eyes, Vector3(0.125, 0.02, 0.0), 0.0)
	_check(is_equal_approx(angle, TAU / 4.0), "an eighth of a metre turns it a quarter round: %.3f" % angle)
	var spun := Grab.spun(field, axis, angle)
	_check(spun.origin.is_equal_approx(field.origin), "about its own middle, which stays where it was")
	_check(is_equal_approx(spun.basis.get_scale().x, 0.5), "at the size it was")
	_check(_near_side(spun).x > field.origin.x + 0.1, "the side nearest the eyes goes right with the hand: %s" % _near_side(spun))
	_check(Grab.spin_angle(Grab.Spin.YAW, axis, eyes, Vector3(-0.1, 0.0, 0.0), 0.0) < 0.0, "and left with it")


func _up_or_down_spins_about_the_line_across_the_view() -> void:
	var eyes := Basis(Vector3.UP, PI / 2.0)
	var axis := Grab.spin_axis(Grab.Spin.PITCH, eyes, Vector3(-2.0, 0.0, 0.0))
	_check(axis.is_equal_approx(Reach.across(eyes)), "up and down spins about the level line across the reader's view")
	var facing := Transform3D(Basis.from_scale(Vector3.ONE * 0.5), EYES + Vector3(0.0, 0.0, -2.0))
	var ahead := Grab.spun(facing, Vector3.RIGHT, Grab.spin_angle(Grab.Spin.PITCH, Vector3.RIGHT, Basis(), Vector3(0.0, 0.05, 0.0), 0.0))
	_check(_near_side(ahead).y > EYES.y + 0.05, "a hand raised lifts the side nearest the eyes: %s" % _near_side(ahead))
	_check(ahead.origin.is_equal_approx(facing.origin), "about its own middle")


func _a_twist_spins_about_the_line_to_the_field() -> void:
	var field := Transform3D(Basis(), EYES + Vector3(1.0, -0.5, -2.0))
	var view := field.origin - EYES
	var axis := Grab.spin_axis(Grab.Spin.ROLL, Basis(), view)
	_check(axis.is_equal_approx(view.normalized()), "a twist spins about the line from the eyes to the field's middle")
	var hand := Basis(Vector3(0.1, 0.3, 1.0).normalized(), 0.4)
	var twisted := Basis(view.normalized(), 0.3) * hand
	var by := Grab.twist(hand, twisted, axis)
	_check(is_equal_approx(by, 0.3), "the wrist's turn about that line is read as it is: %.3f" % by)
	_check(is_equal_approx(Grab.twist(hand, Basis(Vector3.UP, 0.3) * hand, Vector3.RIGHT), 0.0), "and a turn about another line is no twist")
	var spun := Grab.spun(field, axis, Grab.spin_angle(Grab.Spin.ROLL, axis, Basis(), Vector3(0.2, 0.0, 0.0), by))
	var across_the_line := axis.cross(Vector3.UP).normalized()
	_check(is_equal_approx((spun.basis * across_the_line).angle_to(field.basis * across_the_line), 0.3) and spun.origin.is_equal_approx(field.origin), "and the field turns one for one with it, where it stands")


func _both_grips_scale_as_they_did() -> void:
	var field := Transform3D(Basis(), Vector3(0.0, 1.2, -1.0))
	var grown := Grab.between(field, Vector3(-0.2, 1.2, -0.5), Vector3(0.2, 1.2, -0.5), Vector3(-0.4, 1.2, -0.5), Vector3(0.4, 1.2, -0.5))
	_check(is_equal_approx(grown.basis.get_scale().x, 2.0), "two hands drawn apart to twice the span double it")
	var turned := Grab.between(field, Vector3(-0.2, 1.2, -0.5), Vector3(0.2, 1.2, -0.5), Vector3(0.0, 1.2, -0.7), Vector3(0.0, 1.2, -0.3))
	_check(is_equal_approx(turned.basis.get_scale().x, 1.0) and not turned.basis.is_equal_approx(field.basis), "and turned between them, it turns at its size")


## The grips read from the controllers as a headset reports them.
func _the_grips_in_the_room() -> void:
	var kept := FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	Settings.shared().set_steady("off")
	var camera := Camera3D.new()
	root.add_child(camera)
	camera.global_position = EYES
	var field := Node3D.new()
	root.add_child(field)
	field.global_position = EYES + Vector3(0.0, 0.0, -2.0)
	var left := _hand(&"left_hand", Vector3(-0.2, 1.2, -0.4))
	var right := _hand(&"right_hand", Vector3(0.2, 1.2, -0.4))
	var grab := Grab.new()
	grab.field = field
	grab.camera = camera
	grab.left = left
	grab.right = right
	root.add_child(grab)
	await process_frame

	_grip(left, 1.0)
	await process_frame
	left.global_position += Vector3(0.05, 0.0, 0.0)
	await process_frame
	await process_frame
	_check(field.global_position.is_equal_approx(EYES + Vector3(0.0, 0.0, -2.0)), "the left grip leaves the field's middle where it stands: %s" % field.global_position)
	_check(field.global_basis.z.x > 0.1 and is_equal_approx(field.global_basis.y.y, 1.0), "and spins it about its up as the hand goes sideways: %s" % field.global_basis.z)
	left.global_position += Vector3(0.0, 0.1, 0.0)
	await process_frame
	_check(is_equal_approx(field.global_basis.y.y, 1.0), "the axis chosen holds for the rest of the hold, the hand then raised")
	_grip(left, 0.0)
	await process_frame

	var stood := field.global_transform
	_grip(right, 1.0)
	await process_frame
	right.global_position += Vector3(0.1, 0.05, 0.0)
	await process_frame
	await process_frame
	_check(field.global_position.is_equal_approx(stood.origin + Vector3(0.1, 0.05, 0.0)) and field.global_basis.is_equal_approx(stood.basis), "the right grip carries the field with the hand")
	_grip(left, 1.0)
	await process_frame
	left.global_position += Vector3(-0.2, 0.0, 0.0)
	right.global_position += Vector3(0.2, 0.0, 0.0)
	await process_frame
	await process_frame
	_check(field.global_basis.get_scale().x > 1.5, "both grips scale it between them: %.2f" % field.global_basis.get_scale().x)
	_grip(left, 0.0)
	_grip(right, 0.0)
	await process_frame
	for made in [grab, left, right, field, camera]:
		made.queue_free()
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(kept)


func _hand(tracker: StringName, at: Vector3) -> XRController3D:
	var hand := XRController3D.new()
	hand.tracker = tracker
	root.add_child(hand)
	hand.global_position = at
	return hand


func _grip(hand: XRController3D, closed: float) -> void:
	var tracker := XRServer.get_tracker(hand.tracker)
	if tracker == null:
		tracker = XRControllerTracker.new()
		tracker.name = hand.tracker
		XRServer.add_tracker(tracker)
	tracker.set_input("grip", closed)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("grab_test: does not hold: %s" % what)
