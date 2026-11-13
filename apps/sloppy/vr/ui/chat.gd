## The desk's chat, for the palette's chat panel: the threads of the project
## being read, the one open at the hand, and A on the pointing hand held to
## speak into it — DESIGN.md § "Speaking to the desk". Nothing of it is kept here.
extends Node

const Pieces := preload("res://ui/pieces.gd")
const Room := preload("res://room/room.gd")
const PANEL := preload("res://ui/chat_panel.tscn")
const ChatPanel := preload("res://ui/chat_panel.gd")

## Threads, the open one's answering, or what is said changed: draw it again.
signal changed
## `panel` was made for a thread, to be held at the hand before it is filled.
signal opened(panel: Node3D)
## The reader began to speak, and wants to see the chat.
signal wants_seen
## A stop asked of the desk was answered.
signal _stopped

const TALK := "ax_button"
const LISTENING := "Listening…"
const STOPPED_LISTENING := "Stopped. Listening…"
const HEARD := "Heard: %s"
const ANSWERING := " · answering"
const CUT := "…"
## `NO_SPEECH` in `@sloppy/types`' `serve.ts`.
const NO_SPEECH := -32010

## What each desk said when it had no speech set up, by desk, for this session.
static var unset := {}

## The project being read; "" is the desk's first.
var project := ""
## The desk's threads of `project`, newest first, as `chat/threads` lists them.
var threads: Array = []
## Where in `threads` the panel's listing starts.
var listed_from := 0
## What the reader is told about speaking; "" while nothing is to say.
var said := ""
## The thread open at the hand; null while none is.
var panel: Node3D = null
## What each note in the field is called, by ref, for the open thread's acts.
var named := func() -> Dictionary: return {}

var _reading := false
var _talking := false
var _press := 0
## Stops asked of the desk and not yet answered.
var _stopping := 0


func _ready() -> void:
	Client.heard.connect(_heard)
	Client.state_changed.connect(_link_changed)
	for found in get_tree().root.find_children("*", "XRController3D", true, false):
		var hand := found as XRController3D
		if hand.tracker == &"right_hand":
			hand.button_pressed.connect(_pressed)
			hand.button_released.connect(_released)
	var room := Room.of(get_tree())
	if room != null:
		room.dressed.connect(_redress)


func _redress() -> void:
	if is_instance_valid(panel):
		panel.dress(Room.ink(), Room.paper())


## A project is read (`reading`) or not; another project's thread is let go.
func read(at: String, reading: bool) -> void:
	if at != project:
		close_thread()
		threads = []
		listed_from = 0
		said = ""
		project = at
	_reading = reading
	if reading:
		refresh()
	changed.emit()


## Whether the open thread's assistant is answering now.
func answering() -> bool:
	return is_instance_valid(panel) and panel.answering


## The threads listed again.
func refresh() -> void:
	if not _reading:
		return
	var asked_of := project
	var listed: Dictionary = await Client.chat_threads(project)
	if asked_of != project:
		return
	if listed.has("error"):
		said = str(listed.error)
	else:
		threads = listed.get("threads", [])
		listed_from = mini(listed_from, maxi(threads.size() - 1, 0))
	changed.emit()


## The listing moved `by` threads, older for more, kept within `threads`.
func page(by: int) -> void:
	listed_from = clampi(listed_from + by, 0, maxi(threads.size() - 1, 0))
	changed.emit()


## Open the thread `id`, "" a new one, at the hand in place of the one open.
## One the desk will not open leaves the one open as it was, saying why.
func open(id: String) -> Dictionary:
	var asked_of := project
	var answer: Dictionary = await Client.chat_open(project, id)
	if asked_of != project:
		return answer
	if answer.has("error"):
		said = str(answer.error)
		changed.emit()
		return answer
	var held: Dictionary = answer.get("thread", {})
	var was := panel
	var made: Node3D = PANEL.instantiate()
	made.named = named.call()
	panel = made
	made.closed.connect(_closed.bind(made))
	opened.emit(made)
	made.dress(Room.ink(), Room.paper())
	made.fill(held)
	if is_instance_valid(was):
		if was.thread != made.thread:
			Client.chat_close(project, was.thread)
		was.close()
	changed.emit()
	return answer


## Let the open thread go, back to the list.
func close_thread() -> void:
	if not is_instance_valid(panel):
		return
	if panel.thread != "":
		Client.chat_close(project, panel.thread)
	panel.close()
	refresh()


## Stop the open thread's answer: the desk's answer, `{}` or `{error, code}`.
func stop() -> Dictionary:
	if not answering():
		return {}
	_stopping += 1
	var answer: Dictionary = await Client.chat_stop(project, panel.thread)
	_stopping -= 1
	_stopped.emit()
	if answer.has("error"):
		said = str(answer.error)
		changed.emit()
	return answer


## Say `words` into the open thread, opening a new one where none is.
func say(words: String) -> void:
	said = HEARD % words
	if not is_instance_valid(panel) or panel.thread == "":
		var made: Dictionary = await open("")
		if made.has("error"):
			return
	var into := panel
	into.add_said(words)
	changed.emit()
	var answer: Dictionary = await Client.chat_say(project, into.thread, words)
	if answer.has("error") and is_instance_valid(into):
		into.take_back_said()
		said = str(answer.error)
		changed.emit()


## A pressed: listen, while a project is read and nothing else is listening,
## and once it is held long enough to be speech, turn the chat to the reader
## and stop the answer under way, so what is said next is said over it.
func listen() -> void:
	if not _reading or Voice.is_listening():
		return
	_talking = true
	_press += 1
	var this_press := _press
	Voice.start()
	await get_tree().create_timer(Voice.SHORTEST).timeout
	if not _talking or this_press != _press:
		return
	var stopping := answering()
	said = STOPPED_LISTENING if stopping else LISTENING
	wants_seen.emit()
	changed.emit()
	if stopping:
		stop()


## A let go: what was said goes to the chat. A bump does nothing.
func ask() -> void:
	if not _talking:
		return
	_talking = false
	var recording: PackedByteArray = Voice.stop()
	if recording.is_empty():
		if said == LISTENING or said == STOPPED_LISTENING:
			said = ""
			changed.emit()
		return
	var heard: Dictionary = await Client.hear(project, recording)
	if heard.has("error"):
		if int(heard.get("code", 0)) == NO_SPEECH:
			unset[Client.desk] = str(heard.error)
		said = str(heard.error)
		changed.emit()
		return
	unset.erase(Client.desk)
	while _stopping > 0:
		await _stopped
	await say(str(heard.get("said", "")))


## A thread's row: its name on one line in `room` metres at `size` (`letter`
## metres a pixel), and whether it is answering.
static func row_words(thread: Dictionary, room: float, size: int, letter := Pieces.LETTER) -> String:
	var name := str(thread.get("name", "")).strip_edges()
	if name == "":
		name = ChatPanel.NEW
	var after := ANSWERING if thread.get("answering", false) else ""
	return one_line(name, after, room, size, letter)


## `text` then `after`, `text` cut short where the two would not stand on one line.
static func one_line(text: String, after: String, room: float, size: int, letter := Pieces.LETTER) -> String:
	var font: Font = Room.font("ui")
	var wide := func(said: String) -> float:
		return font.get_string_size(said, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x * letter
	if wide.call(text + after) <= room:
		return text + after
	var kept := text
	while kept.length() > 1 and wide.call(kept.strip_edges() + CUT + after) > room:
		kept = kept.left(-1)
	return kept.strip_edges() + CUT + after


func _pressed(button: String) -> void:
	if button == TALK:
		listen()


func _released(button: String) -> void:
	if button == TALK:
		ask()


func _heard(method: String, params: Dictionary) -> void:
	if method != "chat/event" or not is_instance_valid(panel) or str(params.get("thread", "")) != panel.thread:
		return
	var was: bool = panel.answering
	var event = params.get("event")
	if not event is Dictionary:
		return
	panel.apply(event)
	if event.get("event") in ["ended", "over"]:
		refresh()
	if was != panel.answering:
		changed.emit()


## A desk lost hears this headset no more, so what was open and held is let go.
func _link_changed(state: int) -> void:
	if state == Client.State.OPEN:
		return
	if _talking:
		_talking = false
		Voice.cancel()
	if is_instance_valid(panel):
		panel.close()
	threads = []
	listed_from = 0
	said = ""
	changed.emit()


func _closed(made: Node3D) -> void:
	if made == panel:
		panel = null
		changed.emit()
