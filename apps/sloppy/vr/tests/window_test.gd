## A panel left in the room is a window: its bar taken by the trigger carries it
## on the ray at the distance it was taken at, upright and facing the eyes, the
## stick pushing it off and pulling it in within bounds, and letting go leaving
## it there; a corner drawn resizes it from its middle, its aspect kept and
## within bounds, the page told its new size once let go and the browser's keys
## keeping their place under it; the note and the chat panel the same, and no
## frame while a panel is held on the palette. The browser pinned to the view
## stands where the eyes look and follows the head past a small turn, its bar
## placing it anew, unpinned it stays, and the pin is kept for the next time.
## With the web view plugin faked.
## Exits 1 on a failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const FakeWebView := preload("res://tests/fake_web_view.gd")
const WindowFrame := preload("res://ui/window_frame.gd")
const Pointer := preload("res://interaction/pointer.gd")

var Browser: GDScript
var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	Browser = load("res://ui/browser_panel.gd")
	_follows()
	_pushes()
	_resizes()
	_head_space()

	var kept := FileAccess.get_file_as_bytes(Room.KEPT) if FileAccess.file_exists(Room.KEPT) else PackedByteArray()
	var scene := Node3D.new()
	root.add_child(scene)
	current_scene = scene
	var room := WorldEnvironment.new()
	room.environment = Environment.new()
	room.set_script(Room)
	scene.add_child(room)
	for axis in Room.Look.NOTHING_CHOSEN:
		room.keep(axis, Room.Look.NOTHING_CHOSEN[axis])
	var camera := Camera3D.new()
	scene.add_child(camera)
	camera.global_position = Vector3(0.0, 1.6, 0.0)
	camera.current = true
	var fake := FakeWebView.new()
	load("res://ui/web_panel.gd").engine_override = fake

	var browser: Node3D = Browser.new()
	scene.add_child(browser)
	browser.global_transform = Transform3D(Basis(), Vector3(0.0, 1.5, -0.8))
	await _frames(2)
	await _moves(browser)
	await _beams(browser)
	await _sizes(browser, fake)
	browser.close()
	await _frames(1)
	await _pins(scene, camera)
	load("res://ui/web_panel.gd").engine_override = null

	var note: Node3D = load("res://ui/note_panel.tscn").instantiate()
	scene.add_child(note)
	note.global_transform = Transform3D(Basis(), Vector3(0.0, 1.5, -0.8))
	await _frames(2)
	await _moves(note)
	var sheet: SubViewport = note.get_node("Page")
	var before := sheet.size
	await _draw_corner(note, 1.25)
	var grown: Vector2 = _window(note).size / _window(note).opened
	_check(grown.x > 1.2 and sheet.size == Vector2i((Vector2(before) * grown).round()), "a note is laid out again at its new size: %s from %s" % [sheet.size, before])

	var palette := Node3D.new()
	palette.name = WindowFrame.PALETTE
	scene.add_child(palette)
	note.reparent(palette)
	await _frames(2)
	var pointer := _pointer()
	_aim(pointer, _world(note, WindowFrame.bar_at(_window(note).size)))
	note.hit(pointer)
	_check(not _window(note).visible and not _window(note).takes(pointer), "held on the palette, a panel shows no frame")
	_check(sheet.size == before, "and is the size it opened at")
	pointer.free()
	note.close()

	var chat: Node3D = load("res://ui/chat_panel.tscn").instantiate()
	scene.add_child(chat)
	chat.global_transform = Transform3D(Basis(), Vector3(0.3, 1.4, -0.9))
	await _frames(2)
	await _moves(chat)
	chat.close()

	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)
	print("window_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _follows() -> void:
	var eyes := Vector3(0.0, 1.6, 0.0)
	var placed := WindowFrame.follow(Vector3(0.1, 1.2, -0.2), Vector3(0.3, 0.1, -1.0), 1.2, Vector3(0.05, -0.33, 0.0), eyes)
	var bar := placed * Vector3(0.05, -0.33, 0.0)
	var on_ray := Vector3(0.1, 1.2, -0.2) + Vector3(0.3, 0.1, -1.0).normalized() * 1.2
	_check(bar.is_equal_approx(on_ray), "the point taken stands on the ray at the distance taken: %s, %s" % [bar, on_ray])
	_check(placed.basis.y.is_equal_approx(Vector3.UP), "upright")
	var toward := eyes - bar
	toward.y = 0.0
	_check(placed.basis.z.is_equal_approx(toward.normalized()), "and turned to face the eyes")


func _pushes() -> void:
	var eyes := Vector3(0.0, 1.6, 0.0)
	var origin := Vector3(0.1, 1.45, -0.15)
	var along := Vector3(0.0, 0.1, -1.0).normalized()
	var bounds := WindowFrame.reach(origin, along, eyes)
	_check(is_equal_approx((origin + along * bounds.y).distance_to(eyes), WindowFrame.FARTHEST), "the farthest stands FARTHEST from the eyes")
	_check(is_equal_approx((origin + along * bounds.x).distance_to(eyes), WindowFrame.NEAREST), "the nearest NEAREST")
	var distance := 1.0
	distance = WindowFrame.pushed(distance, -0.1, bounds)
	_check(is_equal_approx(distance, 1.0 + 0.1 * WindowFrame.PUSH), "leaning ahead pushes it off at PUSH a second")
	for _i in 100:
		distance = WindowFrame.pushed(distance, -0.1, bounds)
	_check(is_equal_approx(distance, bounds.y), "no farther than FARTHEST")
	for _i in 100:
		distance = WindowFrame.pushed(distance, 0.1, bounds)
	_check(is_equal_approx(distance, bounds.x), "and no nearer than NEAREST")
	_check(is_equal_approx(WindowFrame.pushed(4.0, 0.0, bounds), 4.0), "a window already past a bound stays where it is")


func _resizes() -> void:
	var size := Vector2(0.48, 0.6)
	var corner := Vector2(0.24, -0.3)
	var least := size * WindowFrame.SMALLEST
	var most := size * WindowFrame.LARGEST
	_check(WindowFrame.resized(size, corner, corner * 1.5, least, most).is_equal_approx(size * 1.5), "a corner drawn out half again grows it half again")
	var aslant := WindowFrame.resized(size, corner, Vector2(0.4, -0.31), least, most)
	_check(is_equal_approx(aslant.x / aslant.y, size.x / size.y), "its aspect kept: %s" % aslant)
	_check(WindowFrame.resized(size, corner, corner * 5.0, least, most).is_equal_approx(most), "no larger than LARGEST")
	_check(WindowFrame.resized(size, corner, Vector2.ZERO, least, most).is_equal_approx(least), "no smaller than SMALLEST")


func _head_space() -> void:
	var head := Transform3D(Basis(Vector3.UP, deg_to_rad(40.0)) * Basis(Vector3.RIGHT, deg_to_rad(-10.0)), Vector3(0.3, 1.6, -0.2))
	var at := WindowFrame.head_place(head, WindowFrame.PINNED_AT)
	_check(is_equal_approx(at.distance_to(head.origin), WindowFrame.PINNED_AT.z), "pinned, a window stands its distance from the eyes")
	var seen := head.affine_inverse() * at
	_check(seen.x > 0.0 and seen.y < 0.0 and seen.z < 0.0, "to the right of where they look, and below: %s" % seen)
	_check(WindowFrame.head_offset(head, at).is_equal_approx(WindowFrame.PINNED_AT), "and reads back as where it was pinned")
	var turned := WindowFrame.facing(at, head.origin, head.basis.y)
	_check(turned.z.is_equal_approx((head.origin - at).normalized()), "facing the eyes squarely")
	var eyes := Vector3(0.0, 1.6, 0.0)
	var ahead := eyes + Vector3.FORWARD
	_check(not WindowFrame.left_behind(eyes + Basis(Vector3.UP, deg_to_rad(5.0)) * Vector3.FORWARD, ahead, eyes), "a head turned 5 degrees leaves it")
	_check(WindowFrame.left_behind(eyes + Basis(Vector3.UP, deg_to_rad(7.0)) * Vector3.FORWARD, ahead, eyes), "turned 7 it does not")
	var moving := [Vector3.ZERO, Vector3.ZERO]
	var steps := 0
	while (moving[0] as Vector3).distance_to(Vector3.RIGHT) > 0.05:
		moving = WindowFrame.spring(moving[0], moving[1], Vector3.RIGHT, 0.01)
		steps += 1
	_check(absf(steps * 0.01 - WindowFrame.SETTLE) <= 0.011, "it comes within 5 %% in about SETTLE: %.2f s" % (steps * 0.01))
	for _i in 200:
		moving = WindowFrame.spring(moving[0], moving[1], Vector3.RIGHT, 0.01)
	_check((moving[0] as Vector3).is_equal_approx(Vector3.RIGHT), "and does not pass it: %s" % moving[0])


## The browser pinned to the view, as the reader would use it.
func _pins(scene: Node3D, camera: Camera3D) -> void:
	var cleared := ConfigFile.new()
	cleared.load(Room.KEPT)
	if cleared.has_section(Browser.KEPT_UNDER):
		cleared.erase_section(Browser.KEPT_UNDER)
	cleared.save(Room.KEPT)
	var browser: Node3D = Browser.show_page(scene, "https://example.org/")
	await _frames(1)
	var frame := _window(browser)
	_check(browser.bar_button("pin") != null and not browser.is_pinned(), "the browser's bar offers its pin, unpinned at first")
	_pick_row(browser.bar_button("pin"))
	_check(browser.is_pinned(), "the pin pins it")
	_follow(frame, 1.0)
	var head := camera.global_transform
	_check(browser.global_position.is_equal_approx(WindowFrame.head_place(head, WindowFrame.PINNED_AT)), "pinned, it stands where the head has it: %s" % browser.global_position)
	_check(browser.global_basis.z.is_equal_approx((head.origin - browser.global_position).normalized()), "facing the eyes")
	var keys: Node3D = browser.keyboard
	var under := browser.to_local(keys.global_position)
	_check(keys.get_parent() == browser and under.y < -browser.size.y / 2.0, "its keys under it")

	var still := browser.global_transform
	camera.global_transform = Transform3D(Basis(Vector3.UP, deg_to_rad(-4.0)), head.origin)
	_follow(frame, 1.0)
	_check(browser.global_position.is_equal_approx(still.origin), "a small turn of the head leaves it")

	camera.global_transform = Transform3D(Basis(Vector3.UP, deg_to_rad(-30.0)), head.origin)
	var wanted := WindowFrame.head_place(camera.global_transform, WindowFrame.PINNED_AT)
	var was := browser.global_position.distance_to(wanted)
	_follow(frame, 0.05)
	var early := browser.global_position.distance_to(wanted)
	_check(early < was and early > was * 0.3, "a large one brings it along, behind the head: %.3f of %.3f" % [early, was])
	_follow(frame, WindowFrame.SETTLE - 0.05)
	_check(browser.global_position.distance_to(wanted) <= was * 0.06, "within about SETTLE: %.3f of %.3f" % [browser.global_position.distance_to(wanted), was])
	_follow(frame, 1.0)
	_check(browser.global_position.is_equal_approx(wanted), "until it stands there")
	_check(browser.to_local(keys.global_position).is_equal_approx(under), "its keys with it")

	var pointer := _pointer()
	pointer.from = camera.global_position + Vector3(0.1, -0.3, 0.0)
	_aim(pointer, _world(browser, WindowFrame.bar_at(frame.size)))
	browser.hit(pointer)
	browser.point(pointer)
	browser.press(pointer)
	_check(frame.holds(pointer), "pinned, the trigger takes hold of its bar")
	pointer.toward = (pointer.toward + camera.global_basis.x * 0.4).normalized()
	browser.hit(pointer)
	browser.point(pointer)
	var squarely := (camera.global_position - browser.global_position).normalized()
	_check(browser.global_basis.z.is_equal_approx(squarely), "held by its bar, it faces the eyes from its centre: %s, %s" % [browser.global_basis.z, squarely])
	var ray: Array = pointer.ray()
	var taken: Vector3 = browser.global_transform * (frame._grabbed_at as Vector3)
	_check(taken.distance_to(ray[0] + (ray[1] as Vector3).normalized() * frame._distance) < 1e-4, "its bar on the ray")
	var held := browser.global_transform
	browser.release(pointer)
	_follow(frame, 0.02)
	_check(browser.global_transform.is_equal_approx(held), "and let go, it does not turn")
	var placed: Vector3 = frame.pinned_at
	_check(placed.x > WindowFrame.PINNED_AT.x + 5.0 and browser.is_pinned(), "the bar draws it elsewhere, and it stays pinned: %s" % placed)
	_check(placed.is_equal_approx(WindowFrame.head_offset(camera.global_transform, browser.global_position)), "pinned where it was let go")
	var kept := ConfigFile.new()
	kept.load(Room.KEPT)
	_check((kept.get_value(Browser.KEPT_UNDER, "pinned_at", Vector3.ZERO) as Vector3).is_equal_approx(placed), "kept for the next time")
	var left := browser.global_position
	_follow(frame, 1.0)
	_check(browser.global_position.is_equal_approx(left), "and the head leaves it there")
	camera.global_transform = Transform3D(Basis(), head.origin)
	_follow(frame, 1.0)
	_check(browser.global_position.is_equal_approx(WindowFrame.head_place(camera.global_transform, placed)), "following the head from there")
	pointer.free()

	var gripping := _pointer()
	gripping.hand = XRController3D.new()
	scene.add_child(gripping.hand)
	gripping.hand.global_position = browser.global_position + Vector3(0.0, -0.2, 0.1)
	browser.take(gripping)
	gripping.hand.global_position += Vector3(-0.3, 0.1, 0.0)
	browser._process(0.01)
	_follow(frame, 0.2)
	var carried_to := browser.global_position
	browser.let_go(gripping)
	_follow(frame, 1.0)
	_check(browser.is_pinned() and browser.global_position.is_equal_approx(carried_to), "carried by the grip, it stays pinned where the hand left it")
	_check(frame.pinned_at.is_equal_approx(WindowFrame.head_offset(camera.global_transform, carried_to)), "which it follows the head from")
	placed = frame.pinned_at
	gripping.hand.free()
	gripping.free()

	var size: Vector2 = browser.size
	await _draw_corner(browser, 1.25)
	_check(browser.size.x > size.x * 1.15 and browser.is_pinned(), "pinned, its corners still resize it: %s" % browser.size)

	browser.close()
	await _frames(1)
	browser = Browser.show_page(scene, "https://example.org/")
	await _frames(1)
	frame = _window(browser)
	_check(browser.is_pinned() and frame.pinned_at.is_equal_approx(placed), "opened again, it is pinned where it was")
	_check(browser.global_position.is_equal_approx(WindowFrame.head_place(camera.global_transform, placed)), "and stands there at once")

	_pick_row(browser.bar_button("pin"))
	_check(not browser.is_pinned(), "the pin chosen again unpins it")
	left = browser.global_position
	camera.global_transform = Transform3D(Basis(Vector3.UP, deg_to_rad(40.0)), head.origin)
	_follow(frame, 1.0)
	_check(browser.global_position.is_equal_approx(left), "unpinned, it stands in the room where it was")
	kept.load(Room.KEPT)
	_check(kept.get_value(Browser.KEPT_UNDER, "pinned", true) == false, "and is kept unpinned")

	browser.pin(true, true)
	Browser.bring_here(scene)
	_check(not browser.is_pinned(), "Bring browser here unpins it")
	camera.global_transform = Transform3D(Basis(), head.origin)

	browser.pin(true, true)
	browser.new_tab("https://example.com/")
	var pulled: Node3D = browser.pull_out()
	await _frames(1)
	var pulled_frame := _window(pulled)
	_pick_row(pulled.bar_button("pin"))
	_check(pulled.is_pinned() and browser.is_pinned(), "a page pulled out pins beside the pinned browser")
	_follow(pulled_frame, 1.0)
	_follow(frame, 1.0)
	var apart := browser.global_position.distance_to(pulled.global_position)
	_check(apart >= (browser.size.x + pulled.size.x) * 0.5, "and the two stand apart, not one over the other: %.3f" % apart)
	_check(browser.global_position.is_equal_approx(WindowFrame.head_place(camera.global_transform, placed)), "the browser where it was pinned")
	pointer = _pointer()
	pointer.from = camera.global_position + Vector3(0.1, -0.3, 0.0)
	_aim(pointer, _world(pulled, WindowFrame.bar_at(pulled_frame.size)))
	pulled.hit(pointer)
	pulled.point(pointer)
	pulled.press(pointer)
	pointer.toward = (pointer.toward + camera.global_basis.y * 0.3).normalized()
	pulled.hit(pointer)
	pulled.point(pointer)
	pulled.release(pointer)
	pointer.free()
	_check(not pulled_frame.pinned_at.is_equal_approx(frame.pinned_at), "placing the page pins it anew: %s" % pulled_frame.pinned_at)
	kept.load(Room.KEPT)
	_check(frame.pinned_at.is_equal_approx(placed) and (kept.get_value(Browser.KEPT_UNDER, "pinned_at", Vector3.ZERO) as Vector3).is_equal_approx(placed), "and leaves where the browser is pinned as it was")
	pulled.close()
	browser.close()
	await _frames(1)


## `seconds` of a pinned window following the head, a frame at a time.
func _follow(frame: Node3D, seconds: float) -> void:
	for _i in roundi(seconds / 0.01):
		frame.follow_head(0.01)


## The bar taken carries `panel` on the ray, upright and facing the eyes; the
## stick pushes it off; let go, it stays.
func _moves(panel: Node3D) -> void:
	var what := str(panel.name)
	var frame := _window(panel)
	var pointer := _pointer()
	var bar := _world(panel, WindowFrame.bar_at(frame.size))
	_aim(pointer, bar)
	_check(panel.hit(pointer) < INF and frame.takes(pointer), "%s: the ray on its bar is the bar's" % what)
	panel.point(pointer)
	await _frames(1)
	_check(frame.visible and (frame.get_node("Bar").material_override as StandardMaterial3D).albedo_color.a == 1.0, "%s: the bar lights in ink when pointed at" % what)
	var taken := bar.distance_to(pointer.from)
	panel.press(pointer)
	_check(frame.holds(pointer), "%s: the trigger takes hold of it" % what)
	pointer.toward = Vector3(0.6, 0.1, -1.0).normalized()
	_check(is_equal_approx(panel.hit(pointer), taken), "%s: held, the ray meets it where it was taken" % what)
	panel.point(pointer)
	var now := _world(panel, WindowFrame.bar_at(frame.size))
	_check(now.is_equal_approx(pointer.from + pointer.toward * taken), "%s: the bar follows the ray at the distance it was taken at" % what)
	_check(panel.global_basis.y.is_equal_approx(Vector3.UP), "%s: upright" % what)
	var toward := Vector3(0.0, 1.6, 0.0) - panel.global_position
	toward.y = 0.0
	_check(panel.global_basis.z.is_equal_approx(toward.normalized()), "%s: facing the eyes" % what)
	_check(panel.scroll(pointer, -0.2), "%s: held, the stick is the bar's" % what)
	_check(is_equal_approx(_world(panel, WindowFrame.bar_at(frame.size)).distance_to(pointer.from), taken + 0.2 * WindowFrame.PUSH), "%s: leaned ahead it goes off" % what)
	for _i in 60:
		panel.scroll(pointer, -0.2)
	_check(_world(panel, WindowFrame.bar_at(frame.size)).distance_to(Vector3(0.0, 1.6, 0.0)) <= WindowFrame.FARTHEST + 1e-4, "%s: no farther than FARTHEST from the eyes" % what)
	for _i in 60:
		panel.scroll(pointer, 0.2)
	_check(_world(panel, WindowFrame.bar_at(frame.size)).distance_to(Vector3(0.0, 1.6, 0.0)) >= WindowFrame.NEAREST - 1e-4, "%s: no nearer than NEAREST" % what)
	panel.scroll(pointer, -0.3)
	panel.release(pointer)
	_check(not frame.holds(pointer), "%s: let go" % what)
	var left := panel.global_transform
	pointer.toward = Vector3(-0.5, 0.0, -1.0).normalized()
	panel.hit(pointer)
	panel.point(pointer)
	_check(panel.global_transform.is_equal_approx(left), "%s: it stays where it was let go" % what)
	panel.global_transform = Transform3D(Basis(), Vector3(0.0, 1.5, -0.8))
	pointer.free()


## A hand holding `panel`'s bar sees its beam end at the bar, and keeps the
## window though something nearer comes onto the ray, until it lets go.
func _beams(panel: Node3D) -> void:
	var frame := _window(panel)
	var hand := XRController3D.new()
	panel.get_parent().add_child(hand)
	var from := Vector3(0.15, 1.3, -0.25)
	var bar := _world(panel, WindowFrame.bar_at(frame.size))
	hand.global_transform = Transform3D(Basis.looking_at(bar - from, Vector3.UP), from)
	var nearer := _blocker()
	var held: Node3D = Pointer.new(hand, panel.get_viewport().get_camera_3d(), [panel, nearer], Color.BLACK)
	hand.add_child(held)
	held._process(0.016)
	held._pressed("trigger_click")
	_check(frame.holds(held), "a hand's trigger on the bar takes hold of it")
	var taken := bar.distance_to(from)
	hand.global_transform = Transform3D(Basis.looking_at(Vector3(0.5, 0.0, -1.0), Vector3.UP), from)
	nearer.on = true
	held._process(0.016)
	var length: float = held._beam.transform.basis.get_scale().y
	var now := _world(panel, WindowFrame.bar_at(frame.size))
	_check(is_equal_approx(length, taken) and is_equal_approx(now.distance_to(from), length), "held, the beam ends at the bar: %s, %s" % [length, taken])
	_check(held._on == panel, "and something nearer on the ray does not take it")
	held._released("trigger_click")
	_check(not frame.holds(held), "the trigger let go lets the window go")
	held._process(0.016)
	_check(held._on == nearer, "after which the nearer has the ray")
	hand.free()
	panel.global_transform = Transform3D(Basis(), Vector3(0.0, 1.5, -0.8))


## A target that meets every ray 5 cm out once it is `on`.
func _blocker() -> Object:
	var source := GDScript.new()
	source.source_code = "extends RefCounted\nvar on := false\nfunc hit(_p) -> float:\n\treturn 0.05 if on else INF\nfunc point(_p) -> void:\n\tpass\nfunc unpoint(_p) -> void:\n\tpass\nfunc press(_p) -> void:\n\tpass\nfunc release(_p) -> void:\n\tpass\nfunc scroll(_p, _a) -> bool:\n\treturn false\n"
	source.reload()
	var made := RefCounted.new()
	made.set_script(source)
	return made


## The browser drawn larger by its corner, from its middle, its page told once.
func _sizes(browser: Node3D, fake: RefCounted) -> void:
	var frame := _window(browser)
	var middle := browser.global_position
	var size: Vector2 = browser.size
	var pixels: Vector2i = browser.pixels
	var pointer := _pointer()
	var corner := Vector2(size.x / 2.0, -size.y / 2.0)
	_aim(pointer, _world(browser, corner + Vector2(0.03, -0.03)))
	browser.hit(pointer)
	await _frames(1)
	_check(frame.get_node("Corner2").visible and not frame.get_node("Corner0").visible, "the handle shows on the corner the ray is near, only")
	_aim(pointer, _world(browser, corner + Vector2(-0.005, 0.005)))
	_check(browser.hit(pointer) < INF and not frame.takes(pointer), "just inside the corner the ray is the page's")
	_aim(pointer, _world(browser, corner + Vector2(0.005, -0.005)))
	_check(browser.hit(pointer) < INF and frame.takes(pointer), "the ray on a corner is its handle's")
	browser.point(pointer)
	var asked: int = fake.called("resize").size()
	browser.press(pointer)
	_check(frame.holds(pointer), "the trigger takes hold of the corner")
	_aim(pointer, _world(browser, Vector2.ZERO).lerp(_world(browser, corner + Vector2(0.005, -0.005)), 1.4))
	browser.hit(pointer)
	browser.point(pointer)
	var grown: Vector2 = browser.size
	_check(grown.x > size.x * 1.3 and is_equal_approx(grown.x / grown.y, size.x / size.y), "drawn out, it grows, its aspect kept: %s" % grown)
	_check(browser.global_position.is_equal_approx(middle), "from its middle")
	_check(fake.called("resize").size() == asked, "its page is not laid out again while the corner is held")
	_check(browser.keyboard.position.is_equal_approx(Vector3(-load("res://ui/keyboard.gd").wide * 0.5, -grown.y * 0.5 - Browser.KEYBOARD_BELOW, 0.0)), "its keys keep their place under it")
	browser.release(pointer)
	var told: Array = fake.called("resize")
	_check(told.size() == asked + 1 and told.back()[1] == browser.id and Vector2i(told.back()[2], told.back()[3]) == browser.pixels, "let go, its page is told its new size: %s" % [told.back() if not told.is_empty() else null])
	_check(browser.pixels.x > pixels.x, "in more of its pixels")
	pointer.free()


func _draw_corner(panel: Node3D, by: float) -> void:
	var frame := _window(panel)
	var size: Vector2 = frame.size
	var pointer := _pointer()
	var corner := Vector2(size.x / 2.0, -size.y / 2.0) + Vector2(0.005, -0.005)
	_aim(pointer, _world(panel, corner))
	panel.hit(pointer)
	panel.point(pointer)
	panel.press(pointer)
	_aim(pointer, _world(panel, corner * by))
	panel.hit(pointer)
	panel.point(pointer)
	panel.release(pointer)
	await _frames(2)
	pointer.free()


func _window(panel: Node3D) -> Node3D:
	return panel.get_node("Window")


func _world(panel: Node3D, at: Vector2) -> Vector3:
	return panel.global_transform * Vector3(at.x, at.y, 0.0)


func _aim(pointer: Node3D, at: Vector3) -> void:
	pointer.toward = (at - pointer.from).normalized()


## A pointer from below the eyes whose ray is set by the test.
func _pointer() -> Node3D:
	var source := GDScript.new()
	source.source_code = "extends Node3D\nvar hand: XRController3D\nvar from := Vector3(0.15, 1.3, -0.25)\nvar toward := Vector3.FORWARD\nfunc ray() -> Array:\n\treturn [from, toward]\n"
	source.reload()
	var pointer := Node3D.new()
	pointer.set_script(source)
	return pointer


func _pick_row(row: Node3D) -> void:
	if row == null:
		_check(false, "there is a row to choose")
		return
	for area in row.find_children("*", "Area3D", true, false):
		if area.has_meta("pick"):
			area.get_meta("pick").call()
			return
	_check(false, "the row can be chosen")


func _frames(count: int) -> void:
	for _i in count:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("window_test: does not hold: %s" % what)
