## The field brought to the reader, seated or standing: where it stands before
## their eyes, how the stick turns it about them and tilts it, steadied or not,
## and where a view's stage stands.
## Exits 1 on a failure.
extends SceneTree

const Reach := preload("res://interaction/reach.gd")
const Walk := preload("res://interaction/walk.gd")
const Steady := preload("res://interaction/steady.gd")
const Settings := preload("res://field/settings.gd")

const SEATED := 1.15
const STANDING := 1.7

var _failed := 0


func _initialize() -> void:
	_stands_before_the_eyes_at_their_height()
	_stands_ahead_wherever_the_reader_has_turned()
	_stands_ahead_when_looking_straight_down_or_up()
	_turns_about_the_reader()
	_tilts_about_the_reader()
	_the_stage_comes_to_the_eyes()
	_walking_shares_the_stick_with_a_facing_palette()
	_turns_finer_near_the_middle_of_the_stick()
	_steadying_pulls_a_reading_toward_the_last()
	_arrives_inside_clear_of_every_mark()
	_stands_ahead_at_its_own_size()
	await _the_stick_turns_as_it_leans_and_tilts_over_the_top()
	await _a_lean_more_ahead_than_across_tilts_rather_than_turns()
	print("reach_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _eyes(height: float, yaw: float, pitch := 0.0, at := Vector3.ZERO) -> Transform3D:
	var turned := Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, pitch)
	return Transform3D(turned, Vector3(at.x, height, at.z))


func _stands_before_the_eyes_at_their_height() -> void:
	for height in [SEATED, STANDING]:
		var eyes := _eyes(height, 0.0)
		var stood := Reach.stand_before(eyes, 2.0)
		_check(is_equal_approx(stood.origin.y, height), "its middle is at the eyes, %.2f" % height)
		var across := stood.basis.get_scale().x * 2.0 * 2.0
		_check(is_equal_approx(across, Reach.ACROSS), "it stands %.2f across, %.2f" % [Reach.ACROSS, across])
		var away := eyes.origin.distance_to(stood.origin)
		_check(is_equal_approx(away, Reach.ACROSS / 2.0 + Reach.NEAR), "its near side is within reach, %.2f" % away)
		_check(stood.origin.z < 0.0 and is_zero_approx(stood.origin.x), "it is ahead of the eyes: %s" % stood.origin)
		_check(stood.basis.orthonormalized().y.is_equal_approx(Vector3.UP), "it stands upright")
	var small := Reach.stand_before(_eyes(STANDING, 0.0), 0.01)
	_check(is_equal_approx(small.basis.get_scale().x, Reach.ACROSS / (2.0 * Reach.SMALLEST_RADIUS)), "a field of one note is not blown up")


func _stands_ahead_wherever_the_reader_has_turned() -> void:
	for yaw in [PI / 2.0, PI, -2.3]:
		var eyes := _eyes(SEATED, yaw, 0.0, Vector3(1.5, 0.0, -0.4))
		var stood := Reach.stand_before(eyes, 1.0)
		var ahead := -eyes.basis.z
		var toward := (stood.origin - eyes.origin).normalized()
		_check(toward.dot(ahead) > 0.999, "it follows the eyes turned %.2f, not the room's forward" % yaw)
		_check(stood.basis.orthonormalized().z.dot(-toward) > 0.999, "it faces the reader turned %.2f" % yaw)


func _stands_ahead_when_looking_straight_down_or_up() -> void:
	for pitch in [-PI / 2.0, -1.4, PI / 2.0, 1.45]:
		var eyes := _eyes(SEATED, 0.6, pitch)
		var stood := Reach.stand_before(eyes, 1.0)
		var flat := Vector3(stood.origin.x - eyes.origin.x, 0.0, stood.origin.z - eyes.origin.z).normalized()
		var facing := Vector3(-sin(0.6), 0.0, -cos(0.6))
		_check(flat.dot(facing) > 0.99, "looking %.2f off level, it stands where the reader is turned" % pitch)
		_check(is_equal_approx(stood.origin.y, SEATED), "and at their eyes, never below them")


func _turns_about_the_reader() -> void:
	var eye := Vector3(0.3, SEATED, 0.2)
	var field := Transform3D(Basis.from_scale(Vector3.ONE * 0.4), Vector3(0.3, 1.0, -1.0))
	var turned := Reach.turned(field, eye, PI / 2.0)
	var before := Vector2(field.origin.x - eye.x, field.origin.z - eye.z)
	var after := Vector2(turned.origin.x - eye.x, turned.origin.z - eye.z)
	_check(is_equal_approx(before.length(), after.length()), "it keeps its distance from the reader")
	_check(is_equal_approx(turned.origin.y, field.origin.y), "and its height")
	_check(is_equal_approx(absf(before.angle_to(after)), PI / 2.0), "and goes round them by the turn")
	_check(is_equal_approx(turned.basis.get_scale().x, 0.4), "and its size")
	var back := Reach.turned(turned, eye, -PI / 2.0)
	_check(back.is_equal_approx(field), "turning back undoes it")


func _tilts_about_the_reader() -> void:
	var eye := Vector3(0.3, SEATED, 0.2)
	var overhead := Transform3D(Basis.from_scale(Vector3.ONE * 0.4), eye + Vector3(0.0, 1.0, 0.0))
	var looked_up := Reach.tilted(overhead, eye, Vector3.RIGHT, -PI / 2.0)
	_check(looked_up.origin.is_equal_approx(eye + Vector3(0.0, 0.0, -1.0)), "looking up brings what was overhead in front: %s" % looked_up.origin)
	_check(is_equal_approx(looked_up.basis.get_scale().x, 0.4), "and keeps its size")
	var ahead := Transform3D(Basis(), eye + Vector3(0.0, 0.0, -2.0))
	var looked_down := Reach.tilted(ahead, eye, Vector3.RIGHT, PI / 4.0)
	_check(looked_down.origin.y > eye.y and is_equal_approx(looked_down.origin.distance_to(eye), 2.0), "looking down lifts what was ahead, as far from the eyes as it was")
	_check(Reach.tilted(looked_up, eye, Vector3.RIGHT, PI / 2.0).is_equal_approx(overhead), "tilting back undoes it")
	var turned := Basis(Vector3.UP, 1.0)
	_check(Reach.across(turned).is_equal_approx(turned.x) and is_zero_approx(Reach.across(turned).y), "the line it tilts about runs across the reader's view, level")
	_check(Reach.across(Basis(Vector3.RIGHT, -PI / 2.0)).is_equal_approx(Vector3.RIGHT), "even with the eyes straight down")


func _the_stage_comes_to_the_eyes() -> void:
	var laid := Vector3(-0.35, Reach.LAID_OUT_FOR + 0.15, -1.1)
	for height in [SEATED, STANDING]:
		var eyes := _eyes(height, 2.0, -0.3, Vector3(0.8, 0.0, 0.4))
		var stage := Reach.stage_before(eyes)
		var panel := stage * laid
		_check(is_equal_approx(panel.y - height, 0.15), "a panel laid out at the eyes is at the eyes, %.2f" % height)
		var toward := Vector3(panel.x - eyes.origin.x, 0.0, panel.z - eyes.origin.z)
		_check(toward.normalized().dot(Vector3(-sin(2.0), 0.0, -cos(2.0))) > 0.9, "and ahead of where they look")
	_check(Reach.stage_before(_eyes(Reach.LAID_OUT_FOR, 0.0)).is_equal_approx(Transform3D()), "eyes where the views were laid out leave the stage alone")


func _walking_shares_the_stick_with_a_facing_palette() -> void:
	var ahead := Vector2(0.15, 0.9)
	_check(Walk.walked(ahead, false, false) == ahead, "with the palette turned away the whole stick walks")
	_check(Walk.walked(ahead, false, true) == Vector2(0.0, 0.9), "with it facing, a lean ahead still walks ahead")
	_check(Walk.walked(Vector2(0.0, -0.8), false, true) == Vector2(0.0, -0.8), "and a lean back walks back")
	_check(Walk.walked(Vector2(0.9, 0.2), false, true) == Vector2.ZERO, "a lean sideways is the palette's turn, not a step")
	_check(Walk.walked(ahead, true, false) == Vector2.ZERO, "and nothing walks while the pointer scrolls")


func _turns_finer_near_the_middle_of_the_stick() -> void:
	_check(Reach.turn_by(0.1, 0.5) == 0.0 and Reach.turn_by(-Reach.TURN_FROM, 0.5) == 0.0, "a lean within the middle turns nothing")
	_check(is_equal_approx(Reach.turn_by(1.0, 0.5), -Reach.TURN_RATE * 0.5), "leaned all the way it turns at TURN_RATE")
	_check(is_equal_approx(Reach.turn_by(-1.0, 0.25), Reach.TURN_RATE * 0.25), "the other way for the other side")
	var half := absf(Reach.turn_by((1.0 + Reach.TURN_FROM) * 0.5, 1.0))
	_check(half > 0.0 and half < Reach.TURN_RATE * 0.5, "half a lean turns at less than half the rate: %.3f" % half)
	_check(absf(Reach.turn_by(0.9, 1.0)) > absf(Reach.turn_by(0.6, 1.0)), "and further leaned turns faster")


func _a_lean_more_ahead_than_across_tilts_rather_than_turns() -> void:
	var camera := Camera3D.new()
	root.add_child(camera)
	camera.global_position = Vector3(0.0, SEATED, 0.0)
	var field := Node3D.new()
	root.add_child(field)
	field.global_position = Vector3(0.0, SEATED, -2.0)
	var hand := XRController3D.new()
	root.add_child(hand)
	var reach := Reach.new()
	reach.field = field
	reach.camera = camera
	reach.hand = hand
	root.add_child(reach)
	await process_frame
	_lean_the_stick(hand, Vector2(0.4, 0.9))
	for _i in 5:
		await process_frame
	_check(is_zero_approx(field.global_position.x), "leaned mostly ahead, the field is not turned: %.4f" % field.global_position.x)
	_check(field.global_position.y < SEATED, "but tilted: %.3f" % field.global_position.y)
	_lean_the_stick(hand, Vector2.ZERO)
	await process_frame
	reach.queue_free()
	hand.queue_free()
	field.queue_free()
	camera.queue_free()


## The stick of `hand` leaned to `at`, as the headset would report it.
static func _lean_the_stick(hand: XRController3D, at: Vector2) -> void:
	var tracker := XRServer.get_tracker(hand.tracker)
	if tracker == null:
		tracker = XRControllerTracker.new()
		tracker.name = hand.tracker
		XRServer.add_tracker(tracker)
	tracker.set_input("primary", at)


func _steadying_pulls_a_reading_toward_the_last() -> void:
	var leaned := Vector2(1.0, 0.0)
	_check(Steady.lean(Vector2.ZERO, leaned, 0.0, 0.016) == leaned, "with no steadying a reading passes untouched")
	var some := Steady.lean(Vector2.ZERO, leaned, Settings.STEADY.some, 0.016)
	_check(some.x > 0.0 and some.x < 1.0, "steadied, it is pulled part of the way: %.3f" % some.x)
	var more := Steady.lean(Vector2.ZERO, leaned, Settings.STEADY.most, 0.016)
	_check(more.x < some.x, "more steadying pulls it less far")
	var later := Steady.lean(Vector2.ZERO, leaned, Settings.STEADY.most, 0.5)
	_check(later.x > 0.9, "and a lean held longer than the steadying comes through: %.3f" % later.x)
	var was := Transform3D()
	var now := Transform3D(Basis(Vector3.UP, 1.0), Vector3(1.0, 0.0, 0.0))
	_check(Steady.hold(was, now, 0.0, 0.016) == now, "a hold with no steadying is the hand as it is")
	var held := Steady.hold(was, now, Settings.STEADY.most, 0.016)
	var turned := held.basis.get_euler().y
	_check(held.origin.x > 0.0 and held.origin.x < 1.0 and turned > 0.0 and turned < 1.0, "steadied, it is part of the way there in place and in turn")


## A field of a root and a shell of marks around it, with one mark standing
## just behind where the reader would first be put.
func _a_field_inside() -> Dictionary:
	var placed := {"root": {"position": Vector3.ZERO}}
	for at in 12:
		var bearing := at * TAU / 12.0
		placed["ring%d" % at] = {"position": Vector3(sin(bearing), 0.2 * (at % 3 - 1), cos(bearing)) * 1.1}
	placed["behind"] = {"position": Vector3(0.0, 0.0, 1.05)}
	return placed


func _arrives_inside_clear_of_every_mark() -> void:
	var placed := _a_field_inside()
	for height in [SEATED, STANDING]:
		for yaw in [0.0, 1.3, -2.6]:
			var eyes := _eyes(height, yaw, -0.2, Vector3(0.4, 0.0, -0.3))
			var stood := Reach.arrival(eyes, placed)
			var middle := stood * Vector3.ZERO
			var toward := middle - eyes.origin
			var what := "height %.2f, turned %.1f" % [height, yaw]
			_check(is_equal_approx(middle.y, height), "the root is at the eyes' height: %s" % what)
			_check(toward.normalized().dot(Reach.ahead(eyes.basis)) > 0.999, "and ahead of them: %s" % what)
			_check(toward.length() > 0.5 and toward.length() <= Reach.ARRIVAL_AHEAD + 1e-4, "about a metre off: %.2f, %s" % [toward.length(), what])
			_check(is_equal_approx(stood.basis.get_scale().x, 1.0) and stood.basis.y.is_equal_approx(Vector3.UP), "at its own size, upright: %s" % what)
			var eye_in := stood.affine_inverse() * eyes.origin
			_check(eye_in.length() < 1.1, "the reader stands inside the first shell: %s" % what)
			for ref in placed:
				_check(eye_in.distance_to(placed[ref].position) >= Reach.ARRIVAL_CLEAR, "no mark is nearer than %.1f m: %s, %s" % [Reach.ARRIVAL_CLEAR, ref, what])
	var crowded := {"root": {"position": Vector3.ZERO}}
	for at in 400:
		crowded["m%d" % at] = {"position": Vector3(sin(at * 2.4), cos(at * 1.7) * 0.9, cos(at * 2.4)) * (0.6 + 0.001 * at)}
	var eyes := _eyes(SEATED, 0.4)
	var plain := Transform3D(Reach.facing(eyes.basis), eyes.origin + Reach.ahead(eyes.basis) * 0.54)
	var room := Reach._clearance(Reach.arrival(eyes, crowded).affine_inverse() * eyes.origin, crowded)
	_check(room >= Reach._clearance(plain.affine_inverse() * eyes.origin, crowded), "where no stand clears every mark, the one leaving the most room is taken: %.3f" % room)


func _stands_ahead_at_its_own_size() -> void:
	var placed := {"a": {"position": Vector3(0.0, 0.0, 0.0)}, "b": {"position": Vector3(0.3, 0.5, 1.6)}, "c": {"position": Vector3(-0.2, -1.0, -2.0)}}
	for yaw in [0.0, 2.1]:
		var eyes := _eyes(STANDING, yaw)
		var stood := Reach.before_at_size(eyes, placed)
		_check(is_equal_approx(stood.basis.get_scale().x, 1.0) and stood.basis.y.is_equal_approx(Vector3.UP), "a tree stands at its own size, upright")
		_check(is_equal_approx(stood.origin.y, STANDING), "its middle at the eyes")
		var nearest := INF
		for ref in placed:
			nearest = minf(nearest, (stood * placed[ref].position - eyes.origin).dot(Reach.ahead(eyes.basis)))
		_check(is_equal_approx(nearest, Reach.NEAR + Reach.AT_SIZE_FURTHER), "its nearest mark a step beyond reach ahead: %.3f" % nearest)


func _the_stick_turns_as_it_leans_and_tilts_over_the_top() -> void:
	await process_frame
	var kept := FileAccess.get_file_as_bytes(Settings.KEPT) if FileAccess.file_exists(Settings.KEPT) else PackedByteArray()
	var settings = Settings.shared()
	settings.set_steady("off")
	var camera := Camera3D.new()
	root.add_child(camera)
	camera.global_position = Vector3(0.0, SEATED, 0.0)
	var field := Node3D.new()
	root.add_child(field)
	field.global_position = Vector3(0.0, SEATED, -2.0)
	var reach := Reach.new()
	reach.field = field
	reach.camera = camera
	root.add_child(reach)
	await process_frame
	_hold(KEY_RIGHT, true)
	for _i in 5:
		await process_frame
	var after_five := _turned_by(field)
	for _i in 5:
		await process_frame
	var after_ten := _turned_by(field)
	_hold(KEY_RIGHT, false)
	_check(after_five > 0.0 and after_five < Reach.TURN_RATE * 0.5, "a lean held turns the field a little at a time: %.3f" % after_five)
	_check(after_ten > after_five, "and goes on turning while it is held: %.3f" % after_ten)
	for _i in 2:
		await process_frame
	var resting := _turned_by(field)
	await process_frame
	_check(is_equal_approx(_turned_by(field), resting), "and stops when it is let go")

	field.global_position = Vector3(0.0, SEATED, -2.0)
	_hold(KEY_UP, true)
	for _i in 10:
		await process_frame
	_check(field.global_position.y < SEATED and -field.global_position.z < 2.0, "leaning ahead looks up: what is ahead goes down and under: %s" % field.global_position)
	var by := Time.get_ticks_msec() + 4000
	while field.global_position.z <= 0.05 and Time.get_ticks_msec() < by:
		await process_frame
	_check(field.global_position.z > 0.05 and field.global_position.y < SEATED, "and a lean held on carries it past underfoot to behind, with no stop: %s" % field.global_position)
	_check(is_equal_approx(field.global_position.distance_to(Vector3(0.0, SEATED, 0.0)), 2.0), "as far from the eyes as it was")
	_hold(KEY_UP, false)
	reach.queue_free()
	field.queue_free()
	camera.queue_free()
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Settings.KEPT))
	else:
		FileAccess.open(Settings.KEPT, FileAccess.WRITE).store_buffer(kept)


## Radians the field at `field` has gone round the reader from straight ahead.
static func _turned_by(field: Node3D) -> float:
	return absf(Vector2(field.global_position.x, field.global_position.z).angle_to(Vector2(0.0, -2.0)))


func _hold(key: Key, down: bool) -> void:
	var event := InputEventKey.new()
	event.physical_keycode = key
	event.pressed = down
	Input.parse_input_event(event)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("reach_test: does not hold: %s" % what)
