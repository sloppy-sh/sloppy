## The palette's field panel: room between marks, mark size, pictures, how many
## titles stand, which lines are drawn (its Lines page), and the arrangement —
## DESIGN.md § "The field in a room". Laid on a `Page` from its own top-left
## corner downward, `width` across.
extends Node3D

const Page := preload("res://ui/page.gd")
const Settings := preload("res://field/settings.gd")

enum Shown { FIELD, LINES }

const TITLE := "Field"
const NOW_INSIDE := "Now: standing inside it."
const NOW_TREE := "Now: a tree before you."
const NOW_SETS := "Now: its tags as places."
const MARKS := "Marks"
const ROOM := "Spacing"
const SIZE := "Mark size"
const PICTURES := "Pictures"
const TITLES := "Titles"
const HOW_MANY := "How many"
const LINES := "Lines"
const DRAWN := "Drawn"
const ARRANGEMENT := "Arrangement"
const INSIDE := "Inside"
const TREE := "Tree"
const SETS := "Sets"
const MORE := "More"
const SPRANG := "Sprang from"
const BY_HAND := "Drawn by hand"
const RELATIONS := "Relations"
const NO_LABEL := "No label"
const SHOWN := "%d lines"
const HIDDEN := "%d lines, hidden"
const KINDS_SHOWN := "%d of %d"
const NO_LINES := "This field has no lines."
const DENSE := "So many hand links that they stand out only round the note you read and the one you point at."
const POINT_TO_SLIDE := "Point at a slider and lean this stick to change it."

## The relation rows one page of the lines carries.
const RELATIONS_AT_ONCE := 6
## The panels a view tells when it stands out at its vantage or comes back in.
const GROUP := "field_panel"

var width := 0.18
## Chosen to stand the Sets reading, and the graph again from it.
var to_sets := Callable()
var to_graph := Callable()
## Whether the view in front is Sets.
var in_sets := false

var settings = Settings.shared()
var _shown := Shown.FIELD
var _relations_from := 0
var _page: Node3D


func _ready() -> void:
	set_meta("height", 0.0)
	add_to_group(GROUP)
	settings.offered.connect(_redraw)
	settings.changed.connect(_changed)
	_redraw()


## Whether a slider has this hand's stick now, so the palette does not turn.
func holds_stick() -> bool:
	return _page != null and _page.holds_stick()


func vantage_changed() -> void:
	_changed("")


func _changed(_what: String) -> void:
	if not holds_stick():
		_redraw()


func _redraw() -> void:
	if _page != null:
		_page.queue_free()
	_page = _field_page() if _shown == Shown.FIELD else _lines_page()
	add_child(_page)
	set_meta("height", _page.get_meta("height"))


func _field_page() -> Node3D:
	var now := NOW_SETS if in_sets else (NOW_TREE if settings.arrangement == Settings.TREE else NOW_INSIDE)
	var kinds: Array = settings.lines.filter(func(row): return not row.has("label"))
	var on := kinds.filter(func(row): return settings.is_on(row.key)).size()
	var groups: Array = [
		{"heading": MARKS, "rows": [
			Page.slider(ROOM, "unfold-horizontal", settings.room, Settings.ROOM, _times, settings.set_room),
			Page.slider(SIZE, "circle", settings.size, Settings.SIZE, _times, settings.set_size),
			Page.choice(PICTURES, "image", func(): settings.set_pictures(not settings.pictures), settings.pictures),
		]},
		{"heading": TITLES, "rows": [
			Page.slider(HOW_MANY, "heading", float(settings.titles), Vector2(Settings.TITLES), _count, func(value): settings.set_titles(roundi(value))),
		]},
		{"heading": LINES, "rows": [
			Page.onward(DRAWN, KINDS_SHOWN % [on, kinds.size()] if not kinds.is_empty() else "", "spline", _to.bind(Shown.LINES)),
		]},
		{"heading": ARRANGEMENT, "rows": [
			Page.buttons([
				[INSIDE, _arrange.bind(Settings.INSIDE), not in_sets and settings.arrangement == Settings.INSIDE],
				[TREE, _arrange.bind(Settings.TREE), not in_sets and settings.arrangement == Settings.TREE],
				[SETS, _to_sets, in_sets],
			]),
		]},
	]
	if get_viewport() == null or get_viewport().use_xr:
		groups.append({"rows": [Page.words(POINT_TO_SLIDE)]})
	return Page.new(TITLE, groups, now, width)


func _lines_page() -> Node3D:
	var kinds: Array = []
	for row in settings.lines:
		if not row.has("label"):
			kinds.append(_switch(row, SPRANG if row.key == Settings.SPRANG else BY_HAND, "git-branch" if row.key == Settings.SPRANG else "pen-line"))
	var relations: Array = settings.lines.filter(func(row): return row.has("label"))
	if _relations_from >= relations.size():
		_relations_from = 0
	var named: Array = []
	for row in relations.slice(_relations_from, _relations_from + RELATIONS_AT_ONCE):
		named.append(_switch(row, row.label if row.label != "" else NO_LABEL, "link"))
	if relations.size() > RELATIONS_AT_ONCE:
		named.append(Page.choice(MORE, "chevron-down", _more_relations.bind(relations.size())))
	var state := NO_LINES if settings.lines.is_empty() else (DENSE if settings.dense else "")
	var groups: Array = [{"rows": kinds}]
	if not named.is_empty():
		groups.append({"heading": RELATIONS, "rows": named})
	groups.append({"rows": [Page.back(_to.bind(Shown.FIELD))]})
	return Page.new(LINES, groups, state, width)


## A kind of line or a relation, chosen while it is drawn, saying how many lines carry it.
func _switch(row: Dictionary, named: String, glyph: String) -> Dictionary:
	var on: bool = settings.is_on(row.key)
	return Page.setting(named, (SHOWN if on else HIDDEN) % row.count, glyph, func(): settings.turn(row.key, not on), on)


static func _times(value: float) -> String:
	return "%.1f×" % value


static func _count(value: float) -> String:
	return "%d" % roundi(value)


func _more_relations(count: int) -> void:
	_relations_from = (_relations_from + RELATIONS_AT_ONCE) % count
	_redraw()


func _to(shown: Shown) -> void:
	_shown = shown
	_relations_from = 0
	_redraw()


func _arrange(arrangement: String) -> void:
	settings.set_arrangement(arrangement)
	if in_sets and to_graph.is_valid():
		to_graph.call()


func _to_sets() -> void:
	if to_sets.is_valid():
		to_sets.call()
