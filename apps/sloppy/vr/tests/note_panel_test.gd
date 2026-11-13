## The pages at the hand wear the look: its faces, its ink and card, rules as
## heavy as its style draws them and sizes as its density leaves them, and a
## page dressed again after the look changes wears the new one. Exits 1 on a
## failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const Dressing := preload("res://ui/theme.gd")

var _failed := 0


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
	room.queue_free()
	if kept.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Room.KEPT))
	else:
		FileAccess.open(Room.KEPT, FileAccess.WRITE).store_buffer(kept)
	print("note_panel_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("note_panel_test: does not hold: %s" % what)
