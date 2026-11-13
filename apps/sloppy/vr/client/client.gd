## The desk this headset reads from: one `IrohLink` speaking Sloppy's acts as
## MCP messages, a line each — docs/ARCHITECTURE.md § "A headset beside the desk".
extends Node

## Where the link stands, as `state` holds it.
enum State { IDLE, CONNECTING, PAIRING, OPEN, UNPAIRED, RETRYING }

signal state_changed(state: State)
## The desk said what it is; calls may be made.
signal ready_to_ask
## A message came back for `id`: the whole JSON-RPC answer.
signal answered(id: int, answer: Dictionary)
## A desk on this network said it is there.
signal desk_found(name: String, id: String)
## The desk sent a line that answers nothing asked: `chat/event`, `view/show`.
signal heard(method: String, params: Dictionary)

## `UNPAIRED` in `@sloppy/local`'s `serving.ts`: the desk wants the code.
const UNPAIRED := -32001
const REMEMBERED := "user://desks.cfg"
const PROTOCOL := "2025-06-18"
const FIRST_WAIT := 1.0
const LONGEST_WAIT := 30.0
## How long hearing a recording may take before it is given up.
const SLOW_ASK := 30.0
## How long one of a note's pictures may take before it is given up.
const PICTURE_WAIT := 30.0
## How long naming one of a note's authors may take before it is given up.
const AUTHOR_WAIT := 30.0

const LOST := "The desk stopped answering. Check Sloppy is still serving, and try again."
const NOT_A_DESK := "That is not a desk this headset can reach. Check what you entered."
const TOO_SLOW := "The desk took too long to answer. Try again."

var state: State = State.IDLE
## The id or ticket of the desk reached last.
var desk := ""
## Words for the person about the last thing that went wrong; "" while nothing has.
var said := ""
## Whether the desk that turned this headset away last is showing a code.
var pairing := true

var _link: Node
var _names: Dictionary = {}
var _code := ""
var _next_id := 1
var _waiting: Dictionary = {}
var _wait := FIRST_WAIT
var _retry_at := -1.0
var _meant_to_close := false


func _ready() -> void:
	_link = ClassDB.instantiate("IrohLink")
	if _link == null:
		push_error("IrohLink is not built: run rust/build.sh.")
		return
	add_child(_link)
	_link.desk_found.connect(_found)
	_link.opened.connect(_opened)
	_link.line.connect(_heard)
	_link.closed.connect(_closed)


func _found(name: String, id: String) -> void:
	_names[id] = name
	desk_found.emit(name, id)


## Listen for desks on this network; each is said as `desk_found`.
func discover() -> void:
	if _link != null:
		_link.discover()


## The desks this headset has paired, as `[{desk, name}]`, the last reached first.
func remembered() -> Array:
	var file := ConfigFile.new()
	if file.load(REMEMBERED) != OK:
		return []
	var held: Array = []
	for section in file.get_sections():
		held.append({
			"desk": file.get_value(section, "desk", ""),
			"name": file.get_value(section, "name", ""),
			"at": file.get_value(section, "at", 0),
		})
	held.sort_custom(func(a, b): return a.at > b.at)
	return held


## Reach the desk an id or a ticket names. `code` is the six digits it shows,
## for a desk this headset has not paired; "" for one it has. False where
## `id_or_ticket` names no desk.
func connect_to(id_or_ticket: String, code := "") -> bool:
	if _link == null:
		return false
	_meant_to_close = true
	_settle_waiting()
	if not _link.connect_to(id_or_ticket):
		said = NOT_A_DESK
		_become(State.IDLE)
		return false
	desk = id_or_ticket.strip_edges()
	_code = code
	_meant_to_close = false
	_wait = FIRST_WAIT
	said = ""
	_become(State.CONNECTING)
	return true


## Let the desk go, and stop reaching for it.
func close() -> void:
	_meant_to_close = true
	_retry_at = -1.0
	if _link != null:
		_link.close()
	_settle_waiting()
	_become(State.IDLE)


## The projects the desk serves, as `[{id, name}]`; empty where it could not say.
func projects() -> Array:
	var answer := await _ask("projects/list", {})
	var listed = answer.get("result", {}).get("projects", [])
	return listed if listed is Array else []


## The look the desk is wearing, as `look/read` answers it; {} where it shares
## none or could not say.
func look() -> Dictionary:
	var answer := await _ask("look/read", {})
	var result = answer.get("result")
	return result if result is Dictionary else {}


## Every look the desk could wear, as `look/list` answers it; empty where it
## could not say.
func looks() -> Array:
	var answer := await _ask("look/list", {})
	var result = answer.get("result")
	var listed = result.get("looks") if result is Dictionary else null
	return listed if listed is Array else []


## One page of every note in `project`'s graph ("" is the desk's first), as
## `{notes, next?}` — `next` is the `after` to ask again with — or `{error}` in words.
func field(project: String, after := "") -> Dictionary:
	var params := {}
	if project != "":
		params["project"] = project
	if after != "":
		params["after"] = after
	var answer := await _ask("field/list", params)
	if answer.has("error"):
		return {"error": str(answer.error.get("message", LOST))}
	var result = answer.get("result", {})
	if not result is Dictionary or not result.get("notes") is Array:
		return {"error": LOST}
	return result


## The picture `note`'s mark wears in `project` ("" is the desk's first), no
## larger than the desk sends one; null where it wears none or the desk could not say.
func picture(project: String, note: String) -> Image:
	var answer := await _ask("picture/read", {"note": note}, project)
	var result = answer.get("result")
	var held = result.get("picture") if result is Dictionary else null
	if not held is String:
		return null
	var image := Image.new()
	if image.load_png_from_buffer(Marshalls.base64_to_raw(held)) != OK:
		return null
	return image


## A picture `note`'s writing shows at `path`, as its markdown names it:
## `{bytes, mime}` with `bytes` base64, or `{error, code}` with the desk's words.
func asset(project: String, note: String, path: String) -> Dictionary:
	return _result(await _ask("asset/read", {"note": note, "path": path}, project, PICTURE_WAIT))


## Who `principal`, one of a note's authors, is: `{name?, handle?, picture?}`
## with `picture` base64 PNG, or `{error, code}` with the desk's words.
func author(project: String, principal: String) -> Dictionary:
	return _result(await _ask("author/read", {"principal": principal}, project, AUTHOR_WAIT))


## One of Sloppy's acts asked of `project` ("" is the desk's first): the JSON
## the act answered with, or `{error}` in words for the person.
func call_act(project: String, act: String, args: Dictionary = {}) -> Dictionary:
	var answer := await _ask("tools/call", {"name": act, "arguments": args}, project)
	if answer.has("error"):
		return {"error": str(answer.error.get("message", LOST))}
	var result: Dictionary = answer.get("result", {})
	var content: Array = result.get("content", [])
	var text: String = content[0].get("text", "") if not content.is_empty() else ""
	if result.get("isError", false):
		return {"error": text}
	var parsed = JSON.parse_string(text)
	return parsed if parsed is Dictionary else {"said": text}


## What `wav` says, heard by the desk: `{said}`, or `{error, code}` with the
## desk's words. `wav` is 16 kHz mono 16-bit, as `Voice.stop()` makes it.
func hear(project: String, wav: PackedByteArray, language := "") -> Dictionary:
	var params := {"audio": Marshalls.raw_to_base64(wav)}
	if language != "":
		params["language"] = language
	return _result(await _ask("speech/hear", params, project, SLOW_ASK))


## The desk's chat threads about `project`: `{threads: [{id, name, updated_at,
## archived, answering}]}`, or `{error, code}`.
func chat_threads(project: String) -> Dictionary:
	return _result(await _ask("chat/threads", {}, project))


## Opens a thread, "" a new one, and hears its `chat/event`s from now on:
## `{thread: {id, name, turns}}`, or `{error, code}`.
func chat_open(project: String, thread := "") -> Dictionary:
	var params := {}
	if thread != "":
		params["thread"] = thread
	return _result(await _ask("chat/open", params, project))


## Says `said` into `thread`; the answer arrives as `chat/event`s. `{}`, or
## `{error, code}`.
func chat_say(project: String, thread: String, said: String) -> Dictionary:
	return _result(await _ask("chat/say", {"thread": thread, "said": said}, project))


## Stops the turn underway in `thread`. `{}`, or `{error, code}`.
func chat_stop(project: String, thread: String) -> Dictionary:
	return _result(await _ask("chat/stop", {"thread": thread}, project))


## Stops hearing `thread`. `{}`, or `{error, code}`.
func chat_close(project: String, thread: String) -> Dictionary:
	return _result(await _ask("chat/close", {"thread": thread}, project))


func _result(answer: Dictionary) -> Dictionary:
	if answer.has("error"):
		var error = answer.error
		if not error is Dictionary:
			return {"error": LOST, "code": 0}
		return {"error": str(error.get("message", LOST)), "code": int(error.get("code", 0))}
	var result = answer.get("result")
	return result if result is Dictionary else {"error": LOST, "code": 0}


## `within` is how many seconds the answer may take before it is given up as
## `TOO_SLOW`; 0 waits as long as the link stands.
func _ask(method: String, params: Dictionary, project := "", within := 0.0) -> Dictionary:
	var asking_now := state == State.OPEN or method == "initialize" or method == "pair"
	if not asking_now or _link == null:
		return {"error": {"message": LOST}}
	var id := _next_id
	_next_id += 1
	var message := {"jsonrpc": "2.0", "id": id, "method": method, "params": params}
	if project != "":
		message["project"] = project
	_waiting[id] = true
	_link.send(JSON.stringify(message))
	if within > 0.0:
		get_tree().create_timer(within).timeout.connect(_give_up.bind(id))
	while true:
		var came: Array = await answered
		if came[0] == id:
			return came[1]
	return {}


func _give_up(id: int) -> void:
	if _waiting.erase(id):
		answered.emit(id, {"error": {"message": TOO_SLOW}})


func _opened() -> void:
	if _code != "":
		_become(State.PAIRING)
		var paired := await _ask("pair", {"code": _code, "name": OS.get_model_name()})
		if not paired.has("result"):
			_refused(paired)
			return
		_code = ""
	var hello := await _ask("initialize", {
		"protocolVersion": PROTOCOL,
		"capabilities": {},
		"clientInfo": {"name": "sloppy-vr", "version": "0.0.1"},
	})
	if not hello.has("result"):
		_refused(hello)
		return
	_remember()
	_wait = FIRST_WAIT
	_become(State.OPEN)
	ready_to_ask.emit()


## A desk that wants the code, or turned the one given down, is not reached
## again until somebody enters it.
func _refused(answer: Dictionary) -> void:
	var error: Dictionary = answer.get("error", {})
	said = str(error.get("message", LOST))
	if int(error.get("code", 0)) == UNPAIRED:
		var data = error.get("data")
		pairing = not (data is Dictionary and data.get("pairing", true) == false)
		_meant_to_close = true
		_link.close()
		_settle_waiting()
		_become(State.UNPAIRED)


func _remember() -> void:
	var file := ConfigFile.new()
	file.load(REMEMBERED)
	var section := desk.sha256_text().substr(0, 16)
	file.set_value(section, "desk", desk)
	if _names.has(desk):
		file.set_value(section, "name", _names[desk])
	file.set_value(section, "at", Time.get_unix_time_from_system())
	file.save(REMEMBERED)


func _process(_delta: float) -> void:
	if _retry_at >= 0.0 and Time.get_ticks_msec() / 1000.0 >= _retry_at:
		_retry_at = -1.0
		var again := desk
		connect_to(again, _code)


func _heard(line: String) -> void:
	var message = JSON.parse_string(line)
	if message is Dictionary and not message.has("id") and message.get("method") is String:
		var params = message.get("params", {})
		heard.emit(message.method, params if params is Dictionary else {})
		return
	if not message is Dictionary or not message.has("id") or message.id == null:
		if message is Dictionary and message.has("error"):
			said = str(message.error.get("message", LOST))
		return
	var id := int(message.id)
	if _waiting.erase(id):
		answered.emit(id, message)


func _closed(reason: String) -> void:
	_settle_waiting()
	if _meant_to_close or state == State.UNPAIRED:
		return
	said = reason
	_become(State.RETRYING)
	_retry_at = Time.get_ticks_msec() / 1000.0 + _wait
	_wait = minf(_wait * 2.0, LONGEST_WAIT)


## Every call still waiting is answered with the link gone.
func _settle_waiting() -> void:
	for id in _waiting.keys():
		_waiting.erase(id)
		answered.emit(id, {"error": {"message": LOST}})


func _become(next: State) -> void:
	if state == next:
		return
	state = next
	state_changed.emit(next)
