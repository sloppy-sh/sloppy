## Reaching a desk: the desks on this network and the ones paired before, a
## keypad for the code a new one shows, and a way in by what a desk somewhere
## else shows. A desk lost while reading comes back here, saying so.
extends Node3D

const Pieces := preload("res://ui/pieces.gd")
const Pointing := preload("res://ui/pointing.gd")
const HandMenu := preload("res://ui/hand_menu.gd")

const WIDTH := 0.7
const CODE_LENGTH := 6
## The desks paired before that the list shows, the last reached first.
const REMEMBERED_SHOWN := 4
## In seconds: how long the list waits for a desk on this network before saying
## what else to try.
const QUIET_FOR := 8.0

enum Step { LIST, ASK, CODE, ELSEWHERE, REACHING, LOST }

var _step := Step.LIST
## A desk on this network is heard once a session, so what was heard outlives
## the view.
static var _found: Dictionary = {}
static var _waited_long := false
var _chosen := {}
var _digits := ""
var _pasted := ""
var _said := ""

@onready var _panel: Node3D = $Panel


func enter(args: Dictionary) -> void:
	Pointing.ensure(get_tree())
	HandMenu.ensure(get_tree())
	Client.desk_found.connect(_desk_found)
	Client.state_changed.connect(_state_changed)
	Client.discover()
	get_tree().create_timer(QUIET_FOR).timeout.connect(_quiet_passed)
	if args.get("lost", false):
		_chosen = {"desk": Client.desk, "name": _name_of(Client.desk)}
		_go(Step.LOST)
	else:
		_go(Step.LIST)


func _quiet_passed() -> void:
	_waited_long = true
	if _step == Step.LIST and _found.is_empty():
		_draw()


func _desk_found(name: String, id: String) -> void:
	var known: bool = _found.get(id, "") == name
	_found[id] = name
	if _step == Step.LIST and not known:
		_draw()


func _state_changed(state: int) -> void:
	match state:
		Client.State.OPEN:
			Views.show("projects")
		Client.State.UNPAIRED:
			_said = Client.said
			_digits = ""
			_go(Step.CODE if Client.pairing else Step.ASK)
		Client.State.RETRYING:
			if _step == Step.REACHING:
				_go(Step.LOST)


func _go(step: Step) -> void:
	_step = step
	_draw()


func _draw() -> void:
	for piece in _panel.get_children():
		piece.queue_free()
	var pieces: Array = []
	match _step:
		Step.LIST:
			pieces = _list()
		Step.ASK:
			pieces = _ask_for_a_code()
		Step.CODE:
			pieces = _keypad()
		Step.ELSEWHERE:
			pieces = _elsewhere()
		Step.REACHING:
			pieces = _reaching()
		Step.LOST:
			pieces = _lost()
	Pieces.stack(_panel, pieces)


func _list() -> Array:
	var pieces: Array = [Pieces.words("Choose a desk", WIDTH, Pieces.SIZE + 8)]
	if _said != "":
		pieces.append(Pieces.words(_said, WIDTH, Pieces.SMALL))
	var listed := {}
	for held in Client.remembered().slice(0, REMEMBERED_SHOWN):
		var desk: String = held.desk
		listed[desk] = true
		var name: String = _found.get(desk, held.name)
		var when := Time.get_date_string_from_unix_time(int(held.at))
		var quiet := "Paired, here now" if _found.has(desk) else "Paired, last reached %s" % when
		pieces.append(Pieces.row(name if name != "" else "A desk somewhere else", WIDTH,
			_reach.bind({"desk": desk, "name": name}), quiet))
	var ids: Array = _found.keys()
	ids.sort_custom(func(a, b): return _found[a] < _found[b] if _found[a] != _found[b] else a < b)
	for id in ids:
		if not listed.has(id):
			pieces.append(Pieces.row(_found[id], WIDTH, _reach.bind({"desk": id, "name": _found[id]}),
				"On this network"))
	if _found.is_empty():
		pieces.append(Pieces.words(
			"Looking for desks on this network…" if not _waited_long else
			"No desk on this network has answered. Check Sloppy is serving on it and that both are on the same network, or reach it as a desk somewhere else.",
			WIDTH, Pieces.SMALL, Pieces.QUIET))
	pieces.append(Pieces.row("Somewhere else", WIDTH, _go.bind(Step.ELSEWHERE),
		"A desk on another network"))
	return pieces


## Every desk is dialled first with no code: one that has not paired this
## headset says so, and the keypad comes up with its words.
func _reach(desk: Dictionary) -> void:
	_chosen = desk
	_said = ""
	_digits = ""
	_dial("")


func _dial(code: String) -> void:
	_go(Step.REACHING)
	if not Client.connect_to(_chosen.desk, code):
		_said = Client.said
		_go(Step.ELSEWHERE if _pasted != "" else Step.LIST)


## A desk showing no code: nothing typed here could pair, so the keypad waits
## until the person has one.
func _ask_for_a_code() -> Array:
	var name: String = _chosen.get("name", "")
	return [
		Pieces.words("Pair with %s" % name if name != "" else "Pair with this desk", WIDTH, Pieces.SIZE + 8),
		Pieces.words(_said if _said != "" else
			"Ask the desk for a code: on it, choose Pair a headset.", WIDTH, Pieces.SMALL),
		Pieces.row("I have a code", WIDTH, _enter_a_code),
		Pieces.row("Back", WIDTH, _back_to_list),
	]


func _enter_a_code() -> void:
	_said = ""
	_digits = ""
	_go(Step.CODE)


func _keypad() -> Array:
	var name: String = _chosen.get("name", "")
	var pieces: Array = [
		Pieces.words("Pair with %s" % name if name != "" else "Pair with this desk", WIDTH, Pieces.SIZE + 8),
		Pieces.words(_said if _said != "" else "Enter the six digits the desk is showing.", WIDTH, Pieces.SMALL),
		Pieces.words(_shown_digits(), WIDTH, Pieces.SIZE + 24),
	]
	var keys := Node3D.new()
	var key := (WIDTH - 0.03) / 3.0
	var rows := [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["Clear", "0", "Pair"]]
	for line in rows.size():
		for at in 3:
			var label: String = rows[line][at]
			var pressed := _press.bind(label)
			var made := Pieces.row(label, key, pressed, "", 0.075)
			made.position = Vector3(at * (key + 0.015), -line * 0.09, 0.0)
			keys.add_child(made)
	keys.set_meta("height", rows.size() * 0.09)
	pieces.append(keys)
	pieces.append(Pieces.row("Back", WIDTH, _back_to_list))
	return pieces


func _shown_digits() -> String:
	var shown := ""
	for at in CODE_LENGTH:
		shown += (_digits[at] if at < _digits.length() else "_") + " "
	return shown.strip_edges()


func _press(key: String) -> void:
	if key == "Clear":
		_digits = _digits.substr(0, maxi(0, _digits.length() - 1))
	elif key == "Pair":
		if _digits.length() == CODE_LENGTH:
			_said = ""
			_dial(_digits)
			return
	elif _digits.length() < CODE_LENGTH:
		_digits += key
	_draw()


func _elsewhere() -> Array:
	var pieces: Array = [
		Pieces.words("A desk somewhere else", WIDTH, Pieces.SIZE + 8),
		Pieces.words(_said if _said != "" else
			"On the desk, choose Anywhere under Serve to a headset and copy what it shows. Then paste it here.",
			WIDTH, Pieces.SMALL),
		Pieces.row("Paste", WIDTH, _paste,
			_shortened(_pasted) if _pasted != "" else "Nothing pasted yet"),
	]
	if _pasted != "":
		pieces.append(Pieces.row("Connect", WIDTH, _reach_pasted))
	pieces.append(Pieces.row("Back", WIDTH, _back_to_list))
	return pieces


func _paste() -> void:
	_pasted = DisplayServer.clipboard_get().strip_edges()
	_said = "" if _pasted != "" else "Nothing has been copied on this headset yet."
	_draw()


func _shortened(text: String) -> String:
	return text if text.length() <= 32 else "%s…%s" % [text.substr(0, 16), text.substr(text.length() - 12)]


func _reach_pasted() -> void:
	_reach({"desk": _pasted, "name": ""})


func _reaching() -> Array:
	var name: String = _chosen.get("name", "")
	return [
		Pieces.words("Reaching %s…" % name if name != "" else "Reaching the desk…", WIDTH, Pieces.SIZE + 8),
		Pieces.row("Stop", WIDTH, _stop),
	]


func _lost() -> Array:
	var name: String = _chosen.get("name", "")
	return [
		Pieces.words("%s is not answering" % name if name != "" else "The desk is not answering", WIDTH, Pieces.SIZE + 8),
		Pieces.words(Client.said if Client.said != "" else Client.LOST, WIDTH, Pieces.SMALL),
		Pieces.words("Trying again on its own.", WIDTH, Pieces.SMALL, Pieces.QUIET),
		Pieces.row("Connect again", WIDTH, _again),
		Pieces.row("Choose another desk", WIDTH, _stop),
	]


## The client's own retry is let go first, so it cannot dial over this one.
func _again() -> void:
	Client.close()
	_dial("")


func _stop() -> void:
	Client.close()
	_said = ""
	_go(Step.LIST)


func _back_to_list() -> void:
	_said = ""
	_digits = ""
	_go(Step.LIST)


func _name_of(desk: String) -> String:
	if _found.has(desk):
		return _found[desk]
	for held in Client.remembered():
		if held.desk == desk:
			return held.name
	return ""
