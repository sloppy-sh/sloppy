## The client over IrohLink against a desk `tests/run.sh` starts from the desk app's code,
## named by SLOPPY_DESK (its ticket) and SLOPPY_DESK_CODE, one showing no code,
## SLOPPY_RESTING_DESK, and one with no speech set up, SLOPPY_MUTE_DESK and
## SLOPPY_MUTE_DESK_CODE. Exits 1 on a failure.
extends SceneTree

const WAIT := 10.0
const VoiceScript := preload("res://interaction/voice.gd")

var _client: Node
var _failed := 0
var _heard: Array = []


func _initialize() -> void:
	_run()


func _run() -> void:
	var ticket := OS.get_environment("SLOPPY_DESK")
	var code := OS.get_environment("SLOPPY_DESK_CODE")
	var resting := OS.get_environment("SLOPPY_RESTING_DESK")
	if ticket == "" or code == "" or resting == "":
		print("link_test: FAILED, no desk was named")
		quit(1)
		return
	await process_frame
	_client = root.get_node("Client")

	_check(not _client.connect_to("not a desk", code), "refuses what names no desk")

	_client.connect_to(resting)
	await _until(func(): return _client.state == _client.State.UNPAIRED)
	_check(_client.state == _client.State.UNPAIRED and not _client.pairing,
		"hears that a desk showing no code is not pairing: %s" % _client.said)
	_client.connect_to(resting, code)
	await _until(func(): return _client.state == _client.State.CONNECTING or _client.state == _client.State.PAIRING)
	await _until(func(): return _client.state == _client.State.UNPAIRED)
	_check(_client.said.begins_with("That is not a code"), "is refused a pair there as a wrong code is: %s" % _client.said)
	_client.close()

	_client.connect_to(ticket, "000000")
	await _until(func(): return _client.state == _client.State.UNPAIRED)
	_check(_client.state == _client.State.UNPAIRED, "is turned away on the wrong code")
	_check(_client.said.begins_with("That is not a code"), "says why: %s" % _client.said)
	_check(_client.pairing, "hears that the desk is showing a code")

	_client.connect_to(ticket, code)
	await _until(func(): return _client.state == _client.State.OPEN)
	_check(_client.state == _client.State.OPEN, "pairs on the right code")
	var listed: Array = await _client.projects()
	_check(listed.size() == 1 and listed[0].get("name", "") == "garden", "lists what is served: %s" % [listed])
	var notes: Dictionary = await _client.call_act("", "list_notes", {})
	_check(notes.get("notes", []) is Array and not notes.get("notes", []).is_empty(), "reads the notes")
	var field: Dictionary = await _client.field("")
	var refs: Array = notes.get("notes", []).map(func(one): return one.get("note"))
	var drawn: Array = field.get("notes", []).map(func(one): return one.get("note"))
	refs.sort()
	drawn.sort()
	_check(not drawn.is_empty() and drawn == refs and not field.has("next"), "reads the whole field: %s" % [field])
	_check((await _client.field("garden")).get("notes", []).size() == drawn.size(), "reads the field of the project named")
	_check((await _client.field("nowhere")).has("error"), "says a project it does not serve is not there")
	_check((await _client.look()).get("based_on") == "graphite", "reads the look the desk is wearing")
	var worn: Array = field.get("notes", []).filter(func(one): return one.get("picture") == true)
	_check(worn.size() == 1, "says which mark wears a picture: %s" % [worn])
	if worn.size() == 1:
		var picture: Image = await _client.picture("", worn[0].note)
		_check(picture != null and picture.get_size() == Vector2i(4, 2), "reads the picture a mark wears")
	var bare: Array = field.get("notes", []).filter(func(one): return one.get("picture") != true)
	_check(not bare.is_empty() and await _client.picture("", bare[0].note) == null, "and none for a mark that wears none")
	await _shows_pictures(field)
	await _names_authors(field)
	var written: Dictionary = await _client.call_act("", "write_note", {"about": "a.ts", "sections": ["It."]})
	_check(written.has("error"), "writes nothing")
	var second: Array = field.get("notes", []).filter(func(one): return one.has("parent"))
	await _speaks(second[0].note if second.size() == 1 else "")

	_client.close()
	_client.connect_to(ticket)
	await _until(func(): return _client.state == _client.State.OPEN)
	_check(_client.state == _client.State.OPEN, "is let in by its key after, with no code")
	_check(_client.remembered().any(func(one): return one.desk == ticket), "remembers the desk")

	_client.close()
	_client.connect_to(OS.get_environment("SLOPPY_MUTE_DESK"), OS.get_environment("SLOPPY_MUTE_DESK_CODE"))
	await _until(func(): return _client.state == _client.State.OPEN)
	var unheard: Dictionary = await _client.hear("", _recording(1.0))
	_check(unheard.get("code") == -32010 and str(unheard.get("error", "")).contains("Settings"),
		"hears a desk with no speech say where to set it up: %s" % [unheard])

	_client.close()
	print("link_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


## The pictures a note's writing shows, as its markdown names them.
func _shows_pictures(field: Dictionary) -> void:
	var leaf: Array = field.get("notes", []).filter(func(one): return one.has("parent"))
	var note: String = leaf[0].note if leaf.size() == 1 else ""
	var read: Dictionary = await _client.call_act("", "read_note", {"note": note})
	var named := RegEx.create_from_string("!\\[[^\\]]*\\]\\(([^)\\s]+)\\)").search(
		str(read.get("sections", [{}])[0].get("markdown", "")))
	var path := named.get_string(1) if named != null else ""
	var shown: Dictionary = await _client.asset("", note, path)
	var image := Image.new()
	var drawn: bool = shown.get("mime") == "image/png" \
		and image.load_png_from_buffer(Marshalls.base64_to_raw(str(shown.get("bytes", "")))) == OK
	_check(drawn and image.get_size() == Vector2i(4, 2), "reads a picture a note's writing shows: %s" % [shown])
	var other: Dictionary = await _client.asset("", note, "media/elsewhere")
	_check(other.get("code") == -32040 and other.has("error"), "and is refused one it does not: %s" % [other])


## Who wrote a note, as the field lists them and the desk names them.
func _names_authors(field: Dictionary) -> void:
	var leaf: Array = field.get("notes", []).filter(func(one): return one.has("parent"))
	var authors: Array = leaf[0].get("authors", []) if leaf.size() == 1 else []
	_check(authors.size() == 1, "the field says who wrote a note another wrote: %s" % [leaf])
	var root: Array = field.get("notes", []).filter(func(one): return not one.has("parent"))
	_check(root.size() == 1 and not root[0].has("authors"), "and says nothing of one its owner wrote alone")
	if authors.is_empty():
		return
	var who: Dictionary = await _client.author("", authors[0])
	var face := Image.new()
	var drawn: bool = face.load_png_from_buffer(Marshalls.base64_to_raw(str(who.get("picture", "")))) == OK
	_check(who.get("name") == "Ada" and drawn and face.get_width() <= 128, "names an author, with a face: %s" % [who.keys()])
	var hidden: Dictionary = await _client.author("", "w3id:@00000000-0000-5000-8000-000000000002")
	_check(hidden.get("name") == "Unresolvable eName" and not hidden.has("picture"), "names one whose profile cannot be read as an unresolvable eName: %s" % [hidden])


## What a headset asks of a desk beyond its notes: hearing, the chat,
## and the lines the desk sends unasked.
func _speaks(second: String) -> void:
	_client.heard.connect(func(method: String, params: Dictionary): _heard.append([method, params]))
	var heard: Dictionary = await _client.hear("", _recording(1.0))
	_check(heard.get("said") == "take me to the second note", "hears what was said: %s" % [heard])
	var long: Dictionary = await _client.hear("", _recording(61.0))
	_check(long.get("code") == -32011 and long.has("error"), "is told a recording is too long: %s" % [long])
	var threads: Dictionary = await _client.chat_threads("")
	_check(threads.get("threads", []).size() == 1, "lists the desk's threads: %s" % [threads])
	var opened: Dictionary = await _client.chat_open("")
	var thread: Dictionary = opened.get("thread", {})
	_check(thread.get("turns", []).size() == 2, "opens a thread with what was said in it: %s" % [opened])
	var said: Dictionary = await _client.chat_say("", str(thread.get("id", "")), "take me to the second note")
	_check(said.is_empty(), "says something into it: %s" % [said])
	await _until(func(): return _heard.size() >= 5)
	var events: Array = _heard.filter(func(one): return one[0] == "chat/event").map(func(one): return one[1].event.event)
	_check(events == ["started", "block", "block", "over"], "hears the answer as it is written: %s" % [events])
	var shown: Array = _heard.filter(func(one): return one[0] == "view/show")
	_check(shown.size() == 1 and shown[0][1].get("note") == second, "is taken to the note asked for: %s" % [shown])
	_check((await _client.chat_stop("", str(thread.get("id", "")))).is_empty(), "stops the turn")
	_check((await _client.chat_close("", str(thread.get("id", "")))).is_empty(), "stops hearing the thread")


## `seconds` of silence as a WAV file the way a headset sends one, uncut.
func _recording(seconds: float) -> PackedByteArray:
	var pcm := PackedByteArray()
	pcm.resize(int(seconds * VoiceScript.RATE) * 2)
	return VoiceScript.wav_of(pcm)


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("link_test: does not hold: %s" % what)
