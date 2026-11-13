## A web page on a panel in the room: where the plugin is absent the face shows
## what stands in for the page and a pointer works it as a mouse would; with the
## plugin (a fake here) the page is made at the panel's size, opened, drawn, told
## where the pointer presses and how the stick scrolls, asked about each place a
## link goes, heard when it speaks, and ended when the panel closes. Exits 1 on
## a failure.
extends SceneTree

const FakeWebView := preload("res://tests/fake_web_view.gd")

## Loaded once the autoloads it speaks to are there.
var WebPanel: GDScript
var _failed := 0
var _aim: GDScript


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	WebPanel = load("res://ui/web_panel.gd")
	_aim = GDScript.new()
	_aim.source_code = "extends Node3D\nvar hand: Node3D\nvar from := Vector3(0, 0, 1)\nvar toward := Vector3(0, 0, -1)\nfunc ray() -> Array:\n\treturn [from, toward]\n"
	_aim.reload()
	await _without_the_plugin()
	await _with_the_plugin()
	await _frames_as_buffers()
	WebPanel.engine_override = null
	WebPanel.frames = "pixels"
	print("web_panel_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _without_the_plugin() -> void:
	WebPanel.engine_override = null
	_check(WebPanel.engine() == null, "there is no plugin on this computer")
	var stand_in := Button.new()
	stand_in.text = "Plain words"
	var pressed := [0]
	stand_in.pressed.connect(func(): pressed[0] += 1)
	var panel := _panel()
	panel.fallback = stand_in
	root.add_child(panel)
	await process_frame
	_check(panel.id == 0, "no page is made")
	_check(panel.shown() is ViewportTexture, "the face shows what stands in for the page")
	_check(stand_in.is_inside_tree() and stand_in.get_viewport() != root, "drawn in the panel's own viewport")
	var aim := _pointer()
	_check(is_equal_approx(panel.hit(aim), 1.0), "a ray at the panel meets it where it stands")
	aim.from = Vector3(1.0, 0.0, 1.0)
	_check(panel.hit(aim) == INF, "a ray past its edge misses it")
	aim.from = Vector3(0.0, 0.0, 1.0)
	panel.point(aim)
	panel.press(aim)
	panel.release(aim)
	await process_frame
	_check(pressed[0] == 1, "the trigger presses what stands in, as a mouse would")
	_check(panel.scroll(aim, 0.1), "the stick scrolls it")
	panel.open_url("https://example.org/a")
	_check(panel.title == "https://example.org/a", "the bar names where a link goes, since nothing can open it here")
	panel.open_html("<p>words</p>")
	_check(panel.title == "https://example.org/a", "and never says it is opening what it cannot")
	var closed := [false]
	panel.closed.connect(func(): closed[0] = true)
	_pick(panel.bar_button("close"))
	await process_frame
	_check(closed[0] and not is_instance_valid(panel), "Close closes it")
	aim.queue_free()


func _with_the_plugin() -> void:
	var fake := FakeWebView.new()
	fake.says_on_load = ['{"kind":"ready"}']
	WebPanel.engine_override = fake
	var panel := _panel()
	root.add_child(panel)
	var other := _panel()
	root.add_child(other)
	await process_frame
	var made := fake.called("create")
	_check(made.size() == 2 and made[0] == ["create", panel.id, 64, 80, "pixels"], "a page is made at the panel's size, its frames as pixels")
	_check(panel.id != 0 and panel.id != other.id, "each panel has a page of its own")
	_check(panel.shown() == null, "the face is blank until the page draws")

	var heard: Array = []
	panel.message.connect(func(said): heard.append(said))
	var loaded: Array = []
	panel.loaded.connect(func(url, title): loaded.append([url, title]))
	panel.open_url("https://example.org/a")
	_check(fake.called("load_url").back() == ["load_url", panel.id, "https://example.org/a"], "opening a link loads it")
	_check(panel.title == WebPanel.OPENING, "the bar says it is opening")
	await process_frame
	await process_frame
	_check(panel.title == "A page" and loaded == [["https://example.org/a", "A page"]], "once loaded the bar names the page")
	var texture: Texture2D = panel.shown()
	_check(texture is ImageTexture and texture.get_size() == Vector2(64, 80), "the face wears the page's frame")
	_check(texture != null and _near(texture.get_image().get_pixel(10, 10), fake.colour), "as the page drew it")
	_check(heard.size() == 1 and heard[0] is Dictionary and heard[0].get("kind") == "ready", "what the page says is heard, read as JSON")
	fake.message.emit(other.id, '{"kind":"elsewhere"}')
	fake.message.emit(panel.id, "not json")
	_check(heard.size() == 1, "a word from another panel's page, or one that is not JSON, is not heard here")

	fake.says_on_evaluate = ['{"kind":"height","px":900}']
	panel.evaluate("sloppy.render({})")
	await process_frame
	_check(fake.called("evaluate").back() == ["evaluate", panel.id, "sloppy.render({})"], "script is run in the page")
	_check(heard.size() == 2 and heard[1].get("px") == 900, "and what it answers heard")

	_check(fake.follow(panel.id, "https://example.org/b"), "a link to the web goes")
	_check(not fake.follow(panel.id, "intent://scan#Intent;end"), "a link to anything else does not")
	_check(not fake.follow(panel.id, "file:///etc/hosts"), "nor one to a file")
	await process_frame
	await process_frame
	_check(loaded.back() == ["https://example.org/b", "A page"], "the page went where the link said")

	var back: Node3D = panel.bar_button("back")
	_check(back != null and panel.bar_button("close") != null, "the bar has Back and Close")
	_pick(back)
	await process_frame
	await process_frame
	_check(fake.called("go_back").size() == 1 and loaded.back()[0] == "https://example.org/a", "Back goes back a page")
	_check(not panel.go_back(), "and nowhere further back than the first")

	panel.allows = func(_url: String) -> bool: return false
	_check(not fake.follow(panel.id, "https://example.org/c"), "a panel can keep its page where it is")

	var aim := _pointer()
	panel.press(aim)
	_check(fake.called("touch").back() == ["touch", panel.id, 32.0, 40.0, "down"], "the trigger touches the page where the ray meets it")
	aim.from = Vector3(-0.12, 0.15, 1.0)
	panel.point(aim)
	_check(fake.called("touch").back() == ["touch", panel.id, 16.0, 20.0, "move"], "held, the touch follows the ray")
	panel.release(aim)
	_check(fake.called("touch").back() == ["touch", panel.id, 16.0, 20.0, "up"], "and lets go where it is")
	var touched := fake.called("touch").size()
	panel.point(aim)
	_check(fake.called("touch").size() == touched, "pointing without the trigger touches nothing")
	panel.press(aim)
	panel.unpoint(aim)
	_check(fake.called("touch").back()[4] == "up", "a press dragged off the page lets go of it")

	_check(panel.scroll(aim, 0.01), "the stick scrolls the page")
	_check(fake.called("scroll").back() == ["scroll", panel.id, 0.0, 14.0], "by its lean, in the page's pixels")
	var scrolled := fake.called("scroll").size()
	for i in 3:
		panel.scroll(aim, 0.0002)
	_check(fake.called("scroll").size() == scrolled + 1, "a slow lean adds up to whole pixels")

	var failed: Array = []
	panel.failed.connect(func(url): failed.append(url))
	fake.fails = true
	panel.open_url("https://nowhere.invalid/")
	await process_frame
	await process_frame
	_check(panel.title == WebPanel.COULD_NOT and failed == ["https://nowhere.invalid/"], "a page that cannot be opened says so")

	var hand := Node3D.new()
	root.add_child(hand)
	aim.hand = hand
	var held: Array = []
	panel.taken.connect(func(by): held.append(by))
	panel.let_go_of.connect(func(by): held.append(by))
	panel.carries_itself = true
	panel.take(aim)
	hand.position = Vector3(0.5, 0.2, -0.3)
	await process_frame
	_check(panel.global_position.is_equal_approx(Vector3(0.5, 0.2, -0.3)), "taken hold of, it goes where the hand goes")
	panel.let_go(aim)
	hand.position = Vector3(2.0, 0.0, 0.0)
	await process_frame
	_check(panel.global_position.is_equal_approx(Vector3(0.5, 0.2, -0.3)) and held == [aim, aim], "let go, it stays where it was left")

	var closed := [false]
	panel.closed.connect(func(): closed[0] = true)
	var page: int = panel.id
	_pick(panel.bar_button("close"))
	await process_frame
	_check(closed[0] and fake.called("destroy") == [["destroy", page]], "Close ends its page and no other")
	var elsewhere := Node3D.new()
	root.add_child(elsewhere)
	other.reparent(elsewhere)
	await process_frame
	_check(fake.called("destroy").size() == 1, "carried somewhere else, a panel keeps its page")
	var others: int = other.id
	elsewhere.queue_free()
	await process_frame
	_check(fake.called("destroy") == [["destroy", page], ["destroy", others]], "a panel freed ends its page too")
	hand.queue_free()
	aim.queue_free()


func _frames_as_buffers() -> void:
	var fake := FakeWebView.new()
	WebPanel.engine_override = fake
	WebPanel.frames = "buffer"
	var panel := _panel()
	root.add_child(panel)
	await process_frame
	_check(fake.called("create").back()[4] == "buffer", "a page can be asked for its frames as buffers")
	fake.pixels.emit(panel.id, 64, 80, PackedByteArray())
	_check(panel.shown() == null, "and then its pixels are not what the face wears")
	fake.frame.emit(panel.id, 0)
	_check(panel.shown() is ExternalTexture, "its buffers are")
	panel.queue_free()
	await process_frame


func _panel() -> Node3D:
	var panel: Node3D = WebPanel.new()
	panel.pixels = Vector2i(64, 80)
	return panel


func _pointer() -> Node3D:
	var aim := Node3D.new()
	aim.set_script(_aim)
	root.add_child(aim)
	return aim


func _pick(row: Node3D) -> void:
	if row == null:
		_check(false, "there is a button to pick")
		return
	for area in row.find_children("*", "Area3D", true, false):
		if area.has_meta("pick"):
			area.get_meta("pick").call()
			return
	_check(false, "the button can be picked")


func _near(one: Color, other: Color) -> bool:
	return absf(one.r - other.r) < 0.01 and absf(one.g - other.g) < 0.01 and absf(one.b - other.b) < 0.01


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("web_panel_test: does not hold: %s" % what)
