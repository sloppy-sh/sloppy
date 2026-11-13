## The browser opened from the palette's Here panel: ahead of the reader at
## reading distance on its page to search from, its keys below it, a key typing
## into the page, Enter searching or going to an address, a text field on any
## page bringing the keys up, the keys going with the page when it is carried,
## "Bring browser here" while it is away, the row closing it again, and no
## controller button bound for any of it; then its tabs: New tab, switching, a
## note's link in a tab of its own, a search staying in its tab, closing one and
## the last, at most MOST_TABS, and a tab pulled out into a panel of its own
## with its own keys. With the web view plugin faked.
## Exits 1 on a failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const FakeWebView := preload("res://tests/fake_web_view.gd")

var HandMenu: GDScript
var Browser: GDScript
var Keyboard: GDScript
var Pieces: GDScript
var _failed := 0


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	HandMenu = load("res://ui/hand_menu.gd")
	Browser = load("res://ui/browser_panel.gd")
	Keyboard = load("res://ui/keyboard.gd")
	Pieces = load("res://ui/pieces.gd")
	_reads_what_was_typed()
	_binds_no_button()

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
	var views := root.get_node("Views")
	views.stage = Node3D.new()
	scene.add_child(views.stage)
	views.show("projects")
	var fake := FakeWebView.new()
	load("res://ui/web_panel.gd").engine_override = fake
	HandMenu.ensure(self)
	await process_frame
	await process_frame
	var menu: Node3D = HandMenu.of(self)
	var here: Node3D = menu._faces[HandMenu.Pane.READING]
	_check(_label(here, HandMenu.WEB) != null and _label(here, HandMenu.BROWSER) != null, "the Here panel offers the browser under Web")
	_check(_label(here, HandMenu.BRING_BROWSER) == null, "and nothing to bring back while there is none")

	_pick(here, HandMenu.BROWSER)
	await _frames(3)
	var browser: Node3D = Browser.of(self)
	_check(browser != null, "the row opens the browser")
	if browser == null:
		_finish(kept)
		return
	_check(browser.global_position.is_equal_approx(Vector3(0.0, 1.6 - Browser.BELOW_EYES, -Browser.READING)), "ahead of the reader at reading distance: %s" % browser.global_position)
	_check(browser.global_basis.z.is_equal_approx(Vector3.BACK), "facing them")
	var started: Array = fake.called("load_html")
	_check(started.size() == 1 and started[0][2].contains("Search the web") and started[0][2].contains("--ink: #%s" % Room.ink().to_html(false)), "on its page to search from, in the look")
	_check(browser.title == fake.title and browser.address == "", "its bar names the page, and where it is says Search the web")
	_check(_words_on(browser.address_row()) == Browser.SEARCH_THE_WEB, "as the address row does")
	_check(fake.called("evaluate").any(func(call: Array): return call[2].contains("sloppyTyping")), "the page is asked to say when a field has focus")

	var keys: Node3D = browser.keyboard
	_check(keys.up and keys.visible, "the keys stand with it")
	var foot: float = browser.global_position.y - browser.size.y * 0.5
	_check(keys.global_position.y < foot and absf(keys.global_position.x - (browser.global_position.x - Keyboard.wide * 0.5)) < 1e-4, "below the page, under its middle")
	var facing: Vector3 = keys.global_basis.z
	_check(facing.y > 0.5 and facing.z > 0.3, "leaning back toward the reader, as a laptop's do: %s" % facing)
	_check(Keyboard.KEY >= 0.022 and Keyboard.GAP >= 0.004, "keys at least 22 mm, 4 mm apart")
	_check(keys.keys.has("q") and keys.keys.has("Enter") and keys.keys.has("Backspace") and keys.keys.has("shift") and keys.keys.has("space") and keys.keys.has("hide"), "letters, Enter, backspace, shift, space and a key to put them away")
	await _frames(2)
	_check(_label(here, HandMenu.CLOSE_BROWSER) != null and _label(here, HandMenu.BROWSER) == null, "the row reads Close browser while it is open")

	for typed in "otterz":
		_press(keys.keys[typed])
	_press(keys.keys.Backspace)
	_press(keys.keys.s)
	var said: Array = fake.called("text").map(func(call: Array): return call[2])
	_check("".join(said) == "otterzs" and fake.called("key").back()[2] == "Backspace", "a key types into the page, backspace takes one back: %s" % [said])
	_press(keys.keys.shift)
	_check(keys.shifted and _label(keys, "Q") != null, "shift shows capitals")
	_press(keys.keys.a)
	_check(fake.called("text").back()[2] == "A" and not keys.shifted, "and types one")
	_press(keys.keys.Backspace)
	_press(keys.keys.layer)
	_check(keys.symbols and keys.keys.has("1") and keys.keys.has("@"), "digits and symbols on a second layer")
	_press(keys.keys.layer)
	_press(keys.keys.Enter)
	await _frames(3)
	var gone: Array = fake.called("load_url")
	_check(not gone.is_empty() and gone.back()[2] == "https://duckduckgo.com/?q=otters", "Enter on the page to search from searches: %s" % [gone.back() if not gone.is_empty() else null])
	_check(not keys.up and keys.find_children("*", "Area3D", true, false).is_empty(), "and the keys go")
	_check(browser.address == "https://duckduckgo.com/?q=otters", "the bar says where the page is")
	_check(_words_on(browser.address_row()) == browser.address, "on its address row")

	fake.message.emit(browser.id, '{"kind":"typing","on":true}')
	await _frames(1)
	_check(keys.up, "a text field on any page brings the keys up")

	_pick_row(browser.address_row())
	await _frames(3)
	started = fake.called("load_html")
	_check(started.size() == 2 and started.back()[2].contains(JSON.stringify("https://duckduckgo.com/?q=otters")), "the address row opens the page to search from, holding where it was")
	for typed in "example.org/a":
		if not keys.keys.has(typed):
			_press(keys.keys.layer)
		_press(keys.keys[typed])
		if keys.symbols:
			_press(keys.keys.layer)
	_press(keys.keys.Enter)
	await _frames(3)
	_check(fake.called("load_url").back()[2] == "https://example.org/a", "an address typed is gone to: %s" % [fake.called("load_url").back()])

	keys.show_keys()
	_press(keys.keys.hide)
	await _frames(1)
	_check(not keys.up and not keys.visible and keys.find_children("*", "Area3D", true, false).is_empty(), "the key to put them away does")
	keys.show_keys()

	var hand := XRController3D.new()
	scene.add_child(hand)
	hand.global_position = Vector3(0.2, 1.2, -0.4)
	var pointer := _pointer(hand)
	var under: Transform3D = browser.global_transform.affine_inverse() * keys.global_transform
	keys.take(pointer)
	hand.global_transform = Transform3D(Basis(Vector3.UP, 0.8), Vector3(1.4, 1.5, -1.0))
	await _frames(2)
	keys.let_go(pointer)
	pointer.free()
	_check(browser.global_position.distance_to(Vector3(0.0, 1.52, -0.75)) > 0.5, "the grip on the keys carries the page")
	_check((browser.global_transform.affine_inverse() * keys.global_transform).is_equal_approx(under), "and the keys go with it, where they stood below it")

	browser.global_position = Vector3(0.0, 1.5, 3.0)
	await _frames(3)
	_check(browser.away and _label(here, HandMenu.BRING_BROWSER) != null, "behind the reader, it is away, and can be brought here")
	_pick(here, HandMenu.BRING_BROWSER)
	await _frames(3)
	_check(browser.global_position.is_equal_approx(Vector3(0.0, 1.6 - Browser.BELOW_EYES, -Browser.READING)) and not browser.away, "Bring browser here stands it ahead of the reader again")
	_check(_label(here, HandMenu.BRING_BROWSER) == null, "and the row goes")
	_check(fake.called("load_url").back()[2] == "https://example.org/a", "with the page it was on")

	browser.global_position = Vector3(0.0, 1.5, -2.6)
	await _frames(3)
	_check(browser.away, "far ahead is away too")
	browser.global_position = Vector3(0.0, 1.5, -1.2)
	await _frames(3)
	_check(not browser.away and _label(here, HandMenu.BRING_BROWSER) == null, "near, and in sight, it is not")

	_pick(here, HandMenu.CLOSE_BROWSER)
	await _frames(3)
	_check(not is_instance_valid(browser) and Browser.of(self) == null, "Close browser closes it, keys and all")
	_check(not fake.called("destroy").is_empty(), "and its page with it")
	_check(_label(here, HandMenu.BROWSER) != null and _label(here, HandMenu.CLOSE_BROWSER) == null, "and the row reads Browser again")

	_pick(here, HandMenu.BROWSER)
	await _frames(3)
	browser = Browser.of(self)
	_check(browser != null and browser.keyboard.up, "it opens again on its page to search from")
	if browser != null:
		await _tabs(fake, browser, scene, here)
	_finish(kept)


func _tabs(fake: RefCounted, browser: Node3D, scene: Node3D, here: Node3D) -> void:
	var first: int = browser.id
	_check(browser.tab_count() == 1 and browser.strip_row("tab0") != null and browser.strip_row("new") != null, "the browser opens with one tab, and New tab")
	_check(browser.strip_row("pull") == null, "with one tab there is nothing to pull out")
	_check(_words_on(browser.strip_row("new")) == Browser.NEW_TAB, "New tab says so")

	fake.follow(first, "https://example.org/first")
	await _frames(2)
	browser.keyboard.hide_keys()
	_pick_row(browser.strip_row("new"))
	await _frames(3)
	var second: int = browser.id
	_check(browser.tab_count() == 2 and browser.showing() == 1 and second != first, "New tab opens a second tab and shows it")
	_check(fake.called("create").back()[1] == second and fake.called("load_html").back()[1] == second, "on a page of its own, the page searched from")
	_check(browser.keyboard.up, "with the keys up")
	_check(_filled(browser.strip_row("tab1")) and not _filled(browser.strip_row("tab0")), "the tab showing is filled")
	_check(browser.strip_row("pull") != null and _words_on(browser.strip_row("pull")) == Browser.PULL_OUT, "and with two, Pull out stands beside where the page is")

	var keys: Node3D = browser.keyboard
	for typed in "voles":
		_press(keys.keys[typed])
	_press(keys.keys.Enter)
	await _frames(3)
	_check(fake.called("load_url").back()[1] == second and fake.called("load_url").back()[2] == "https://duckduckgo.com/?q=voles", "a search stays in its tab")
	_check(browser.tab_count() == 2 and browser.address == "https://duckduckgo.com/?q=voles", "and the tab says where it is")
	_check(fake.follow(second, "https://example.org/voles") and browser.tab_count() == 2 and browser.id == second, "so does a link followed in the page")
	await _frames(2)

	_frame(fake, first, Vector2i(16, 20), Color.RED)
	_frame(fake, second, Vector2i(24, 30), Color.BLUE)
	_check(_face(browser) == Vector2i(24, 30), "a tab hidden is not drawn")
	_pick_row(browser.strip_row("tab0"))
	await _frames(2)
	_check(browser.showing() == 0 and browser.id == first, "a tab chosen shows")
	_check(_face(browser) == Vector2i(16, 20) and _near(browser.shown().get_image().get_pixel(1, 1), Color.RED), "as it last drew")
	_check(browser.address == "https://example.org/first" and browser.title == fake.title, "with its own place and title")
	_check(not keys.up, "and the keys go until a field there has focus")
	_check(fake.called("evaluate").back()[1] == first and fake.called("evaluate").back()[2] == Browser.ASK_TYPING, "which the page is asked")
	_check(fake.follow(second, "https://example.org/hidden"), "a hidden tab still goes where it is sent")
	await _frames(2)
	_check(browser.id == first and _words_on(browser.strip_row("tab1")) == fake.title, "and its tab says what it is on")

	var from_note: Node3D = Browser.show_page(here, "https://example.org/note")
	await _frames(3)
	var third: int = browser.id
	_check(from_note == browser and browser.tab_count() == 3 and browser.showing() == 2 and third != first and third != second, "a note's link opens in a new tab and shows it")
	_check(fake.called("load_url").back()[1] == third and fake.called("load_url").back()[2] == "https://example.org/note", "on the page it names")
	_check(fake.called("destroy").filter(func(call: Array): return call[1] == first or call[1] == second).is_empty(), "keeping what the reader had open")

	_pick_row(browser.strip_row("close0"))
	await _frames(2)
	_check(browser.tab_count() == 2 and browser.id == third and _destroyed(fake, first) == 1, "a tab's close closes it and its page, the one showing staying")
	_check(_filled(browser.strip_row("tab1")), "still filled")

	var eyes := scene.get_viewport().get_camera_3d()
	var right := browser.global_transform * Vector3(browser.size.x + Browser.PULLED_APART, 0.0, 0.0)
	_pick_row(browser.strip_row("pull"))
	await _frames(3)
	var pulled: Node3D = null
	for page in get_nodes_in_group(Browser.PAGES):
		if page != browser:
			pulled = page
	_check(pulled != null, "Pull out makes a panel of its own")
	if pulled == null:
		return
	_check(pulled.id == third and _destroyed(fake, third) == 0, "holding the tab's page")
	_check(browser.tab_count() == 1 and browser.id == second, "the browser keeping its other tabs")
	_check(Browser.of(self) == browser and not pulled.is_in_group(Browser.GROUP), "and staying the room's browser")
	_check(pulled.global_position.is_equal_approx(right), "placed beside the browser, as high: %s" % pulled.global_position)
	var toward: Vector3 = eyes.global_position - pulled.global_position
	toward.y = 0.0
	_check(pulled.global_basis.z.dot(toward.normalized()) > 0.999, "facing the reader")
	_check(pulled.strip_row("new") == null and pulled.strip_row("tab0") == null and pulled.strip_row("pull") == null, "with no tabs")
	_check(pulled.bar_button("back") != null and pulled.address_row() != null and pulled.keyboard != null, "but its own Back, place and keys")
	_check(_words_on(pulled.address_row()) == "https://example.org/note", "saying where it is")
	_check(_face(pulled) == Vector2i(1152, 1440), "wearing the page as it last drew")

	fake.message.emit(pulled.id, '{"kind":"typing","on":true}')
	await _frames(1)
	_check(pulled.keyboard.up and not browser.keyboard.up, "a field on the pulled-out page brings its own keys up")
	_press(pulled.keyboard.keys.k)
	_check(fake.called("text").back()[1] == third and fake.called("text").back()[2] == "k", "which type into it")
	fake.message.emit(browser.id, '{"kind":"typing","on":true}')
	await _frames(1)
	_check(browser.keyboard.up and not pulled.keyboard.up, "and a field on the browser brings the browser's")
	_check(fake.follow(third, "https://example.org/pulled") and pulled.id == third, "the pulled-out page goes where it is sent")
	await _frames(2)
	_check(pulled.address == "https://example.org/pulled" and browser.address != pulled.address, "on its own")

	_pick(here, HandMenu.CLOSE_BROWSER)
	await _frames(3)
	_check(Browser.of(self) == null and is_instance_valid(pulled), "Close browser leaves a page pulled out")
	_check(_destroyed(fake, second) == 1 and _destroyed(fake, third) == 0, "closing the browser's pages and not that one")
	_pick_row(pulled.bar_button("close"))
	await _frames(2)
	_check(not is_instance_valid(pulled) and _destroyed(fake, third) == 1, "its own Close closes it and its page")

	browser = Browser.show_page(here, "https://example.org/1")
	await _frames(2)
	for at in range(2, Browser.MOST_TABS + 1):
		_check(browser.new_tab("https://example.org/%d" % at), "tab %d opens" % at)
	await _frames(2)
	_check(browser.tab_count() == Browser.MOST_TABS, "%d tabs open" % Browser.MOST_TABS)
	_check(browser.strip_row("more") != null and _words_on(browser.strip_row("more")).ends_with(" more"), "past what fits, the rest wait behind a row saying how many")
	_check(browser.strip_row("tab%d" % (Browser.MOST_TABS - 1)) != null, "the strip showing the tab showing")
	var made: int = fake.called("create").size()
	_check(not browser.new_tab("https://example.org/more"), "one more is not opened")
	Browser.show_page(here, "https://example.org/more")
	_check(browser.tab_count() == Browser.MOST_TABS and fake.called("create").size() == made, "from a note's link either")
	_check(browser.title == Browser.FULL, "the reader asked to close one")
	_pick_row(browser.strip_row("more"))
	_check(browser.strip_row("tab0") != null, "the row turns the strip on")
	var pages: Array = []
	for call in fake.called("create").slice(-Browser.MOST_TABS):
		pages.append(call[1])
	while browser.tab_count() > 1:
		browser.close_tab(0)
	await _frames(1)
	_check(is_instance_valid(browser) and browser.tab_count() == 1, "the browser stands while a tab is left")
	browser.close_tab(0)
	await _frames(2)
	_check(not is_instance_valid(browser) and Browser.of(self) == null, "closing the last tab closes the browser")
	_check(pages.all(func(page: int): return _destroyed(fake, page) == 1), "every page closed once")


func _frame(fake: RefCounted, page: int, size: Vector2i, colour: Color) -> void:
	var image := Image.create(size.x, size.y, false, Image.FORMAT_RGBA8)
	image.fill(colour)
	fake.pixels.emit(page, size.x, size.y, image.get_data())


## The size of what `panel`'s face wears; zero where it wears nothing.
func _face(panel: Node3D) -> Vector2i:
	var texture: Texture2D = panel.shown()
	return Vector2i(texture.get_size()) if texture != null else Vector2i.ZERO


func _destroyed(fake: RefCounted, page: int) -> int:
	return fake.called("destroy").filter(func(call: Array): return call[1] == page).size()


func _filled(row: Node3D) -> bool:
	if row == null:
		return false
	for card in row.find_children("*", "MeshInstance3D", true, false):
		if card.has_meta("card"):
			return (card.material_override as StandardMaterial3D).albedo_color.is_equal_approx(Pieces.get("INK"))
	return false


func _near(a: Color, b: Color) -> bool:
	return absf(a.r - b.r) < 0.02 and absf(a.g - b.g) < 0.02 and absf(a.b - b.b) < 0.02


func _finish(kept: PackedByteArray) -> void:
	load("res://ui/web_panel.gd").engine_override = null
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)
	print("browser_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _reads_what_was_typed() -> void:
	_check(Browser.url_for("otters and stoats") == "https://duckduckgo.com/?q=otters%20and%20stoats", "words are searched for")
	_check(Browser.url_for("  example.org ") == "https://example.org", "a site's name is gone to")
	_check(Browser.url_for("example.org/a?b=c") == "https://example.org/a?b=c", "with its path")
	_check(Browser.url_for("http://example.org/") == "http://example.org/", "an address with its scheme is gone to as it is")
	_check(Browser.url_for("localhost:5173") == "https://localhost:5173", "this machine too")
	_check(Browser.url_for("3.14").begins_with("https://duckduckgo.com/"), "a number is searched for")
	_check(Browser.url_for("file:///etc/hosts").begins_with("https://duckduckgo.com/"), "and anything not on the web")
	_check(Browser.url_for("   ") == "", "nothing typed goes nowhere")


func _binds_no_button() -> void:
	var said: Array = []
	for folder in ["res://ui", "res://interaction", "res://views", "res://room", "res://sets", "res://client", "res://field"]:
		for file in DirAccess.get_files_at(folder):
			if file.ends_with(".gd") and FileAccess.get_file_as_string(folder.path_join(file)).contains("by_button"):
				said.append(file)
	_check(said.is_empty(), "no controller button is bound for the browser: %s" % [said])


## The first words standing on `row`.
func _words_on(row: Node3D) -> String:
	if row == null:
		return ""
	var said: Array = row.find_children("*", "Label3D", true, false)
	return (said.front() as Label3D).text if not said.is_empty() else ""


func _frames(count: int) -> void:
	for _i in count:
		await process_frame


## A pointer on `hand`, as the grip would carry with it.
func _pointer(hand: XRController3D) -> Node3D:
	var source := GDScript.new()
	source.source_code = "extends Node3D\nvar hand: XRController3D\n"
	source.reload()
	var pointer := Node3D.new()
	pointer.set_script(source)
	pointer.hand = hand
	return pointer


func _press(key: Node3D) -> void:
	_pick_row(key)


func _pick_row(row: Node3D) -> void:
	if row == null:
		_check(false, "there is a row to choose")
		return
	for area in row.find_children("*", "Area3D", true, false):
		if area.has_meta("pick"):
			area.get_meta("pick").call()
			return
	_check(false, "the row can be chosen")


func _label(under: Node, text: String) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		if not found.is_queued_for_deletion() and (found as Label3D).text == text:
			return found
	return null


func _pick(under: Node, text: String) -> void:
	var said := _label(under, text)
	if said == null:
		_check(false, "there is a row %s to choose" % text)
		return
	_pick_row(said.get_parent())


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("browser_test: does not hold: %s" % what)
