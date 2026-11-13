## The pages at the hand wear the look: its faces, its ink and card, rules as
## heavy as its style draws them and sizes as its density leaves them, and a
## page dressed again after the look changes wears the new one. A note read
## from the desk `tests/run.sh` starts is drawn by the page where the web view
## plugin is present (a fake here), its pictures handed to it, and its links
## open notes in the panel and the web in the room; with no plugin it reads as
## text. Exits 1 on a failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const Dressing := preload("res://ui/theme.gd")
const FakeWebView := preload("res://tests/fake_web_view.gd")
const WAIT := 10.0
const TABLE := "| Kind | Count |\n| --- | --- |\n| seed | 3 |"

var _failed := 0
var WebPanel: GDScript
var Browser: GDScript


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	var kept := FileAccess.get_file_as_bytes(Room.KEPT) if FileAccess.file_exists(Room.KEPT) else PackedByteArray()
	var room := WorldEnvironment.new()
	room.environment = Environment.new()
	room.set_script(Room)
	root.add_child(room)
	for axis in Room.Look.NOTHING_CHOSEN:
		room.keep(axis, Room.Look.NOTHING_CHOSEN[axis])

	var plain := Dressing.of(Room.look())
	_check(plain.default_font == load("res://fonts/inter.woff2"), "a page reads in the ui face")
	_check(plain.get_font("mono_font", "RichTextLabel") == load("res://fonts/jetbrains-mono.woff2"), "code in the mono face")
	_check(plain.get_color("font_color", "Label") == Room.ink() and plain.get_color("default_color", "RichTextLabel") == Room.ink(), "in the room's ink")
	var sheet := plain.get_stylebox("panel", "PanelContainer") as StyleBoxFlat
	_check(sheet != null and sheet.bg_color == Room.card() and sheet.border_color == Room.edge(), "on its card, edged as the room edges one")
	_check(sheet != null and sheet.border_width_top == Dressing.HAIRLINE, "by a hairline")
	_check((plain.get_stylebox("separator", "HSeparator") as StyleBoxLine).thickness == Dressing.HAIRLINE, "and a rule is one too")

	var served := {"name": "Graphite", "based_on": "graphite", "density": "compact", "style": "hardline", "fonts": {"ui": "atkinson", "heading": "system", "mono": "firacode"}}
	var other := Dressing.of(Room.Look.chosen(served, Room.Look.NOTHING_CHOSEN))
	_check(other.default_font == load("res://fonts/atkinson-hyperlegible.woff2"), "a look's own face is read in")
	_check(other.get_font("font", Dressing.HEADING) == load("res://fonts/atkinson-hyperlegible.woff2"), "titles too, where it names no other")
	_check(other.get_font("mono_font", "RichTextLabel") == load("res://fonts/fira-code.woff2"), "and its code face")
	_check(other.get_font_size("normal_font_size", "RichTextLabel") < plain.get_font_size("normal_font_size", "RichTextLabel"), "a compact look reads a little smaller")
	_check(other.get_constant("margin_left", "MarginContainer") < plain.get_constant("margin_left", "MarginContainer"), "and keeps less room round a page")
	_check((other.get_stylebox("panel", "PanelContainer") as StyleBoxFlat).border_width_top == Dressing.HAIRLINE * 2, "a heavy style edges a page heavier")

	var NotePanel: PackedScene = load("res://ui/note_panel.tscn")
	var page: Node3D = NotePanel.instantiate()
	root.add_child(page)
	page.dress(Room.ink(), Room.paper())
	var title: Label = page.get_node("Page/Sheet/Margin/Column/Head/Title")
	var body: RichTextLabel = page.get_node("Page/Sheet/Margin/Column/Body")
	_check(title.get_theme_font("font") == load("res://fonts/inter.woff2"), "the note's title stands in the heading face")
	_check(title.get_theme_font_size("font_size") > body.get_theme_font_size("normal_font_size"), "larger than what it says")
	_check(body.get_theme_color("default_color") == Room.ink(), "the note reads in the room's ink")
	room.keep("face", "opendyslexic")
	page.dress(Room.ink(), Room.paper())
	_check(title.get_theme_font("font") == load("res://fonts/opendyslexic.woff2") and body.get_theme_font("normal_font") == load("res://fonts/opendyslexic.woff2"), "dressed again, it wears the face chosen since")

	var sheet_of: PanelContainer = page.get_node("Page/Sheet")
	for pack in Dressing.PACKS:
		room.keep("panels", pack)
		page.dress(Room.ink(), Room.paper())
		var worn: Theme = load(Dressing.PACKS[pack].file)
		var writes_in: Color = worn.get_color("font_color", "Label") if worn.has_color("font_color", "Label") else body.get_theme_color("default_color")
		_check(sheet_of.theme.default_font == worn.default_font and body.get_theme_font("normal_font") == worn.get_font("font", "Label"), "%s dresses the note in its own face" % pack)
		_check(sheet_of.get_theme_stylebox("panel") == worn.get_stylebox("panel", Dressing.PACKS[pack].sheet), "on its own sheet")
		_check(body.get_theme_color("default_color") == writes_in and title.get_theme_color("font_color") != Room.ink(), "in its own colours, not the room's ink")
		_check(title.get_theme_font_size("font_size") > body.get_theme_font_size("normal_font_size") and body.get_theme_font_size("normal_font_size") == Dressing.BODY, "at the sizes a page reads at")
	room.keep("panels", Room.LOOK_PANELS)
	page.dress(Room.ink(), Room.paper())
	_check(sheet_of.get_theme_stylebox("panel") is StyleBoxFlat and body.get_theme_color("default_color") == Room.ink() and title.get_theme_font("font") == load("res://fonts/opendyslexic.woff2"), "and back in the look's own, as it was")
	page.queue_free()

	var ChatPanel: PackedScene = load("res://ui/chat_panel.tscn")
	var thread: Node3D = ChatPanel.instantiate()
	root.add_child(thread)
	thread.dress(Room.ink(), Room.paper())
	var said: RichTextLabel = thread.get_node("Page/Sheet/Margin/Column/Body")
	_check(said.get_theme_font("normal_font") == load("res://fonts/opendyslexic.woff2") and said.get_theme_color("default_color") == Room.ink(), "a thread wears the look as a note does")
	thread.queue_free()

	room.keep("face", "")
	await _reads_pages()
	room.queue_free()
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)
	print("note_panel_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _reads_pages() -> void:
	var client := root.get_node("Client")
	var ticket := OS.get_environment("SLOPPY_DESK")
	client.connect_to(ticket)
	await _until(func(): return client.state in [client.State.OPEN, client.State.UNPAIRED])
	if client.state == client.State.UNPAIRED:
		client.connect_to(ticket, OS.get_environment("SLOPPY_DESK_CODE"))
		await _until(func(): return client.state == client.State.OPEN)
	_check(client.state == client.State.OPEN, "reaches the desk")
	var listed: Array = (await client.call_act("", "list_notes", {})).get("notes", [])
	var notes := {}
	var named := {}
	for note in listed:
		notes[note.note] = note
		named[note.note] = note.get("title", "")
	var first: Dictionary = listed[0] if listed.size() > 0 else {}
	var leaf: Dictionary = listed.filter(func(one): return one.has("parent")).front() if listed.size() > 1 else {}
	_check(not first.is_empty() and not leaf.is_empty(), "the desk has a note and one under it")
	if first.is_empty() or leaf.is_empty():
		return
	WebPanel = load("res://ui/web_panel.gd")
	Browser = load("res://ui/browser_panel.gd")
	var NotePanel: PackedScene = load("res://ui/note_panel.tscn")

	var plain: Node3D = NotePanel.instantiate()
	root.add_child(plain)
	plain.open("", leaf.note, leaf, false, named)
	var body: RichTextLabel = plain.get_node("Page/Sheet/Margin/Column/Body")
	await _until(func(): return body.text.contains("The file"))
	_check(body.text.contains("[b]The file[/b]") or body.text.contains("The file"), "with no plugin a note reads as text, as it did: %s" % body.text)
	_check(plain.get_node_or_null("Reading") == null, "and no page is made")
	plain.queue_free()

	_check(FileAccess.file_exists("res://web/dist/index.html"), "the page is built (tools/build-web.sh)")
	var fake := FakeWebView.new()
	fake.says_on_load = ['{"kind":"ready"}']
	fake.says_on_evaluate = ['{"kind":"height","px":2000}']
	WebPanel.engine_override = fake
	var eyes := Camera3D.new()
	root.add_child(eyes)
	eyes.position = Vector3(0.0, 1.6, 0.0)
	eyes.make_current()

	var panel: Node3D = NotePanel.instantiate()
	root.add_child(panel)
	panel.notes = notes
	var followed: Array = []
	panel.followed.connect(func(ref): followed.append(ref))
	panel.dress(Room.ink(), Room.paper())
	panel.open("", leaf.note, leaf, false, named)
	await _until(func(): return not fake.called("evaluate").is_empty())
	body = panel.get_node("Page/Sheet/Margin/Column/Body")
	var page: Node3D = panel.get_node_or_null("Reading")
	_check(page != null and page.visible, "the note is drawn by a page over the body")
	if page == null:
		return
	var made: Array = fake.called("create").back()
	var rect := body.get_global_rect()
	_check(made[2] == int(round(rect.size.x)) and made[3] == int(round(rect.size.y)), "at the body's size: %s" % [made])
	var loaded: Array = fake.called("load_html").back()
	_check(loaded[2].contains("sloppy") and loaded[3].begins_with("file:///android_asset/"), "the page we ship, standing in the app's own files")
	var asked := _asked(fake)
	_check(str(asked.get("markdown", "")).contains("## The file"), "it is asked to draw the note's section: %s" % [asked])
	var look: Dictionary = asked.get("look", {})
	_check(look.get("ink") == "#" + Room.ink().to_html(false) and look.get("faces", {}).has("mono"), "in the look's ink and faces: %s" % [look])
	_check(asked.get("named", {}).get(first.note) == first.get("title", ""), "knowing what each cited note is called")
	_check(body.text == "", "the words underneath stand aside")
	await _until(func(): return _asked(fake).get("pictures", {}).size() == 1)
	var pictures: Dictionary = _asked(fake).get("pictures", {})
	var shown: String = pictures.values()[0] if pictures.size() == 1 else ""
	_check(shown.begins_with("data:image/png;base64,iVBOR"), "and drawn again with the pictures it shows: %s" % [pictures.keys()])
	_check(not fake.called("evaluate").back()[2].begins_with("window.scrollTo"), "without losing the reader's place")

	panel._draw_page(TABLE)
	_check(str(_asked(fake).get("markdown")) == TABLE and fake.called("evaluate").back()[2].begins_with("window.scrollTo(0, 0)"), "a section with a table is the page's to draw, from its top")

	await process_frame
	var aim := _pointer(page.global_position + Vector3(0, 0, 0.5))
	_check(panel.scroll(aim, 0.1), "a page taller than the panel takes the stick")
	fake.message.emit(page.id, '{"kind":"height","px":10}')
	_check(not panel.scroll(aim, 0.1), "a page that fits leaves it be")
	panel.press(aim)
	_check(not fake.called("touch").is_empty() and fake.called("touch").back()[4] == "down", "the trigger on the page touches it")
	panel.release(aim)
	_check(fake.called("touch").back()[4] == "up", "and lets go of it")
	aim.queue_free()

	fake.message.emit(page.id, JSON.stringify({"kind": "link", "href": "sloppy:" + first.note, "note": first.note}))
	await _until(func(): return panel._ref == first.note and panel.get_node("Page/Sheet/Margin/Column/Head/Title").text.contains(str(first.get("title", ""))))
	_check(followed == [first.note] and panel._ref == first.note, "a link to a note opens it here")
	fake.message.emit(page.id, JSON.stringify({"kind": "link", "href": str(leaf.address), "address": str(leaf.address)}))
	await _until(func(): return panel._ref == leaf.note)
	_check(followed == [first.note, leaf.note], "and one by its address too")
	fake.message.emit(page.id, JSON.stringify({"kind": "link", "href": "9z", "address": "9z"}))
	await process_frame
	_check(followed.size() == 2 and get_first_node_in_group(Browser.GROUP) == null, "a note that is not here opens nothing")

	fake.message.emit(page.id, JSON.stringify({"kind": "link", "href": "https://example.org/a"}))
	var browser: Node3D = get_first_node_in_group(Browser.GROUP)
	_check(browser != null and fake.called("load_url").back()[2] == "https://example.org/a", "a link to the web opens a page in the room")
	if browser == null:
		return
	_check(browser.global_position.is_equal_approx(Vector3(0.0, 1.6 - Browser.BELOW_EYES, -Browser.READING)), "ahead of the reader at reading distance: %s" % browser.global_position)
	_check(browser.global_basis.z.is_equal_approx(Vector3.BACK), "facing them")
	_check(browser.carries_itself, "for them to take anywhere")
	_check(browser.allows.call("https://example.org/b") and not browser.allows.call("intent://x") and not browser.allows.call("file:///etc/hosts"), "where it may go: the web and nowhere else")
	await process_frame
	await process_frame
	_check(browser.title == fake.title, "the bar names the page")
	browser.global_position = Vector3(1.0, 1.0, -1.0)
	fake.message.emit(page.id, JSON.stringify({"kind": "link", "href": "http://example.org/b"}))
	_check(get_nodes_in_group(Browser.GROUP).size() == 1 and fake.called("load_url").back()[2] == "http://example.org/b", "a second link opens in the same page")
	_check(browser.global_position.is_equal_approx(Vector3(1.0, 1.0, -1.0)), "where the reader left it")
	fake.message.emit(page.id, JSON.stringify({"kind": "link", "href": "mailto:someone@example.org"}))
	_check(fake.called("load_url").size() == 2, "a link that is not to the web goes nowhere")
	await process_frame
	await process_frame
	_pick(browser.bar_button("back"))
	_check(fake.called("go_back").size() == 1, "Back goes back")
	_pick(browser.bar_button("close"))
	await process_frame
	_check(not is_instance_valid(browser) and get_first_node_in_group(Browser.GROUP) == null, "Close puts it away")

	panel.queue_free()
	eyes.queue_free()
	await process_frame
	WebPanel.engine_override = null
	client.close()


## What the page was last asked to draw.
func _asked(fake: RefCounted) -> Dictionary:
	var evaluated: Array = fake.called("evaluate")
	if evaluated.is_empty():
		return {}
	var js: String = evaluated.back()[2]
	var json := js.substr(js.find("sloppy.render(") + "sloppy.render(".length())
	var reading := JSON.new()
	return reading.data if reading.parse(json.left(-1)) == OK and reading.data is Dictionary else {}


## A pointer whose ray runs from `from` straight ahead into -z.
func _pointer(from: Vector3) -> Node3D:
	var aim := GDScript.new()
	aim.source_code = "extends Node3D\nvar hand: Node3D\nvar from := Vector3.ZERO\nfunc ray() -> Array:\n\treturn [from, Vector3(0, 0, -1)]\n"
	aim.reload()
	var pointer := Node3D.new()
	pointer.set_script(aim)
	pointer.from = from
	root.add_child(pointer)
	return pointer


func _pick(row: Node3D) -> void:
	if row == null:
		_check(false, "there is a button to pick")
		return
	for area in row.find_children("*", "Area3D", true, false):
		if area.has_meta("pick"):
			area.get_meta("pick").call()
			return
	_check(false, "the button can be picked")


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("note_panel_test: does not hold: %s" % what)
