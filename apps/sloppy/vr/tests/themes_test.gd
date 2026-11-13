## Every theme pack a panel may wear is on this headset, opens as a Theme with
## a face of its own, and names the types a page takes from it. Exits 1 on a
## failure.
extends SceneTree

const Room := preload("res://room/room.gd")
const Dressing := preload("res://ui/theme.gd")

var _failed := 0


func _initialize() -> void:
	for pack in Dressing.PACKS:
		var found: Dictionary = Dressing.PACKS[pack]
		var worn = load(found.file) if ResourceLoader.exists(found.file) else null
		_check(worn is Theme, "%s opens as a theme" % pack)
		if not worn is Theme:
			continue
		_check(worn.default_font != null, "%s has a face of its own" % pack)
		_check(worn.has_stylebox("panel", found.sheet), "%s has a sheet for a page" % pack)
		_check(worn.has_font_size("font_size", found.heading) or worn.has_font("font", found.heading), "%s has a title" % pack)
		var made := Dressing.pack(pack, Room.look())
		_check(made.default_font == worn.default_font and made.get_stylebox("panel", "PanelContainer") == worn.get_stylebox("panel", found.sheet), "%s is what a page is dressed in" % pack)
	_check(Dressing.pack(Room.LOOK_PANELS, Room.look()).get_stylebox("panel", "PanelContainer") is StyleBoxFlat, "the look's own is a page's sheet of ours")
	_check(Dressing.pack("not a pack", Room.look()).get_stylebox("panel", "PanelContainer") is StyleBoxFlat, "and a pack this headset does not hold is the look's own")
	print("themes_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("themes_test: does not hold: %s" % what)
