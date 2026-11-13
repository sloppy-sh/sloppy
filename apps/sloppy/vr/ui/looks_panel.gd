## The look panel's Looks page: the desk's look, Sloppy's own five, and the
## desk's whole collection, light or dark, narrowed by the letters their names
## begin with until a few are left to choose from — DESIGN.md § "The field in a
## room". Laid on a `Page` from its own top-left corner downward, `width` across.
extends Node3D

const Page := preload("res://ui/page.gd")
const Room := preload("res://room/room.gd")
const Look := preload("res://look/look.gd")
const Palette := preload("res://field/palette.gd")

const TITLE := "Looks"
const NOW := "Now: %s"
const THE_DESKS := "The desk's"
const OWN := "Sloppy's"
const SCHEMES := "Schemes"
const LIGHT := "Light"
const DARK := "Dark"
const WITH_A_DESK := "The rest come with a desk."
## The most schemes listed at once, and the most runs of letters offered: two
## narrowings reach any of RUNS × RUNS × AT_ONCE schemes of one variant.
const AT_ONCE := 8
const RUNS := 9

var width := 0.18
## Chosen to turn the look panel back to its rows.
var back := Callable()

## "light" or "dark" once one is chosen.
var _variant := ""
## The runs of the variant's schemes narrowed into, outermost first, each `[from, to)`.
var _within: Array = []
var _page: Node3D


## `names`, in order, cut into at most RUNS runs of about one size, each
## `{from, to, label}`, labelled by as few of the letters its first and last
## names begin with as tell it from the runs beside it.
static func runs_of(names: Array) -> Array:
	var count := names.size()
	var parts := mini(RUNS, ceili(count / float(AT_ONCE)))
	var runs: Array = []
	for at in parts:
		runs.append({"from": floori(at * count / float(parts)), "to": floori((at + 1) * count / float(parts))})
	for run in runs:
		var start := _letters(str(names[run.from]), str(names[run.from - 1]) if run.from > 0 else "")
		var end := _letters(str(names[run.to - 1]), str(names[run.to]) if run.to < count else "")
		run.label = start if start == end else "%s–%s" % [start, end]
	return runs


## The fewest of the letters `name` begins with, up to three, that `beside` does not begin with too.
static func _letters(name: String, beside: String) -> String:
	for length in range(1, 4):
		if name.left(length).to_lower() != beside.left(length).to_lower():
			return _capital(name.left(length))
	return _capital(name.left(3))


static func _capital(letters: String) -> String:
	return letters.left(1).to_upper() + letters.substr(1).to_lower()


func _ready() -> void:
	set_meta("height", 0.0)
	var room := Room.of(get_tree())
	if room != null:
		room.dressed.connect(redraw)
	redraw()


## Drawn again as what this headset chose stands now.
func redraw() -> void:
	if not is_inside_tree():
		return
	if _page != null:
		_page.queue_free()
	var room := Room.of(get_tree())
	var chosen := str(room.kept.look) if room != null else ""
	var groups: Array = []
	if room == null or room.kept.follow:
		groups.append({"rows": [Page.choice(THE_DESKS, "monitor", _wear.bind(""), chosen == "")]})
	if _variant == "":
		var own: Array = []
		for id in Look.OWN_LOOKS:
			own.append(Page.choice(Look.OWN[id].name, _swatch({"based_on": id}), _wear.bind(id), chosen == id))
		groups.append({"heading": OWN, "rows": own})
	var schemes: Array = Look.collection().filter(func(look): return not Look.OWN.has(look.id))
	if schemes.is_empty():
		groups.append({"rows": [Page.words(WITH_A_DESK)]})
	else:
		groups.append({"heading": SCHEMES, "rows": _scheme_rows(schemes, chosen)})
	groups.append({"rows": [Page.back(func(): if back.is_valid(): back.call())]})
	_page = Page.new(TITLE, groups, NOW % Room.look().name, width)
	add_child(_page)
	set_meta("height", _page.get_meta("height"))


func _scheme_rows(schemes: Array, chosen: String) -> Array:
	var rows: Array = [Page.buttons([
		[LIGHT, _choose_variant.bind("light"), _variant == "light", "light"],
		[DARK, _choose_variant.bind("dark"), _variant == "dark", "dark"],
	])]
	if _variant == "":
		return rows
	var these: Array = schemes.filter(func(look): return look.get("variant") == _variant)
	var names: Array = these.map(func(look): return str(look.name))
	var whole := [0, these.size()]
	var within: Array = _within.back() if not _within.is_empty() else whole
	if within[1] - within[0] > AT_ONCE:
		rows.append(_letter_row(names, within, _within.size(), []))
		return rows
	if not _within.is_empty():
		rows.append(_letter_row(names, _within[-2] if _within.size() > 1 else whole, _within.size() - 1, within))
	for look in these.slice(within[0], within[1]):
		var base := "dark" if _variant == "dark" else "light"
		var row := Page.choice(str(look.name), _swatch({"palette": look.palette, "based_on": base}), _wear.bind(str(look.id)), chosen == look.id)
		row["key"] = str(look.id)
		rows.append(row)
	return rows


## The runs `among` of `names` is cut into, as buttons; choosing one narrows to
## it at `depth`, and `chosen` is the run narrowed to already.
func _letter_row(names: Array, among: Array, depth: int, chosen: Array) -> Dictionary:
	var buttons: Array = []
	for run in runs_of(names.slice(among[0], among[1])):
		var span := [among[0] + run.from, among[0] + run.to]
		buttons.append([run.label, _narrow.bind(span, depth), span == chosen, span])
	return Page.buttons(buttons)


## The paper and ink `look` (as `Look.chosen` answers one) is painted with.
static func _swatch(look: Dictionary) -> Array:
	var drawn := Look.colours(look)
	return [Palette.to_color(drawn.paper), Palette.to_color(drawn.ink)]


func _choose_variant(variant: String) -> void:
	_variant = "" if _variant == variant else variant
	_within = []
	redraw()


func _narrow(span: Array, depth: int) -> void:
	_within = _within.slice(0, depth) + [span]
	redraw()


func _wear(id: String) -> void:
	var room := Room.of(get_tree())
	if room != null:
		room.keep("look", id)
