## How this reader has the field drawn, kept on the headset and sent nowhere —
## DESIGN.md § "The field in a room". One for the session, shared by the field
## panel that changes it and the graph view that draws by it.
extends RefCounted

const Field := preload("res://field/field.gd")

## `what` changed: "room", "size", "titles", "pictures", "arrangement",
## "steady" or "lines".
signal changed(what: String)
## The graph in front said which lines it has to draw.
signal offered

const KEPT := "user://field.cfg"
const INSIDE := Field.INSIDE
const TREE := Field.TREE
## The least and most of each slider.
const ROOM := Vector2(1.0, 2.5)
const SIZE := Vector2(0.5, 3.0)
const TITLES := Vector2i(0, 24)
## How much of a hand's shaking is taken out of the stick's lean and the grip's
## hold, and in seconds how long a reading takes to settle at each.
const STEADY := {"off": 0.0, "some": 0.07, "most": 0.18}
## The kinds of line the field draws, and the key a relation's row is kept by.
const SPRANG := "genealogy"
const BY_HAND := "link"
const RELATION := "label:"

var room := 1.0
var size := 1.0
var titles := 8
var pictures := true
var arrangement := INSIDE
var steady := "off"
## The rows of the lines panel for the graph in front, as
## `[{key, count, label?}]`: the kinds first, then each relation a hand link
## names, most carried first; a relation row carries `label`, "" for none.
var lines: Array = []
## Whether the graph in front's hand links are dense (`field/lines.gd`).
var dense := false

## The graph in front, as its lines are kept against.
var _graph := ""
var _off := {}
var _file := ConfigFile.new()

static var _shared


static func shared():
	if _shared == null:
		_shared = load("res://field/settings.gd").new()
		_shared._read()
	return _shared


func set_room(value: float) -> void:
	_keep_value("room", clampf(value, ROOM.x, ROOM.y))


func set_size(value: float) -> void:
	_keep_value("size", clampf(value, SIZE.x, SIZE.y))


func set_titles(value: int) -> void:
	_keep_value("titles", clampi(value, TITLES.x, TITLES.y))


func set_pictures(value: bool) -> void:
	_keep_value("pictures", value)


func set_arrangement(value: String) -> void:
	if value == INSIDE or value == TREE:
		_keep_value("arrangement", value)


func set_steady(value: String) -> void:
	if STEADY.has(value):
		_keep_value("steady", value)


## In seconds: how long a reading of the hand takes to settle.
func steadying() -> float:
	return STEADY[steady]


## The graph in front, `graph` naming it among every graph this headset reads,
## drawing `rows` (as `lines` holds them), its hand links `crowded` or not.
func offer(graph: String, rows: Array, crowded := false) -> void:
	_graph = graph
	lines = rows
	dense = crowded
	_off = _file.get_value(_section(graph), "off", {})
	offered.emit()


## Whether the row kept by `key` draws.
func is_on(key: String) -> bool:
	return not _off.has(key)


func turn(key: String, on: bool) -> void:
	if is_on(key) == on:
		return
	if on:
		_off.erase(key)
	else:
		_off[key] = true
	if _graph != "":
		_file.set_value(_section(_graph), "off", _off)
		_file.save(KEPT)
	changed.emit("lines")


## The key the row of relation `label` is kept by.
static func relation(label: String) -> String:
	return RELATION + label


func _keep_value(what: String, value: Variant) -> void:
	if get(what) == value:
		return
	set(what, value)
	_file.set_value("field", what, value)
	_file.save(KEPT)
	changed.emit(what)


func _read() -> void:
	if _file.load(KEPT) != OK:
		return
	for what in ["room", "size", "titles", "pictures", "arrangement", "steady"]:
		var held: Variant = _file.get_value("field", what, get(what))
		if typeof(held) == typeof(get(what)):
			set(what, held)
	room = clampf(room, ROOM.x, ROOM.y)
	size = clampf(size, SIZE.x, SIZE.y)
	titles = clampi(titles, TITLES.x, TITLES.y)
	if arrangement != INSIDE and arrangement != TREE:
		arrangement = INSIDE
	if not STEADY.has(steady):
		steady = "off"


static func _section(graph: String) -> String:
	return "lines " + graph.sha256_text().substr(0, 16)
