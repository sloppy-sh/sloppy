## The palette's chat against the desk `tests/run.sh` starts, named by
## SLOPPY_DESK and SLOPPY_DESK_CODE: the desk's threads listed, one opened with
## what was said in it, words said into it answered as they are written, the
## answer stopped, the thread pulled off into the room and put back, threads
## past the first few paged to and opened, a bump of A leaving the palette as
## it stood, A and B each inert while the other is held, A held heard into a thread, and a new thread opened for words said with none open;
## then, mid-answer: the answer heard on with the palette turned and put away,
## Stop leaving the answer so far, A held stopping it and saying into the same
## thread, and another thread the desk will not open leaving this one as it was.
## Exits 1 on a failure.
extends SceneTree

const WAIT := 10.0
## Loaded once the autoloads they speak to are there.
var HandMenu: GDScript
var ChatPanel: GDScript
var _failed := 0
var _events: Array = []


func _initialize() -> void:
	_run()


func _run() -> void:
	var ticket := OS.get_environment("SLOPPY_DESK")
	var code := OS.get_environment("SLOPPY_DESK_CODE")
	if ticket == "" or code == "":
		print("chat_panel_test: FAILED, no desk was named")
		quit(1)
		return
	await process_frame
	ChatPanel = load("res://ui/chat_panel.gd")
	HandMenu = load("res://ui/hand_menu.gd")
	_transcribes()
	var client := root.get_node("Client")
	var views := root.get_node("Views")
	var room: Node3D = load("res://main.tscn").instantiate()
	root.add_child(room)
	current_scene = room
	client.connect_to(ticket)
	await _until(func(): return client.state in [client.State.OPEN, client.State.UNPAIRED])
	if client.state == client.State.UNPAIRED:
		client.connect_to(ticket, code)
		await _until(func(): return client.state == client.State.OPEN)
	_check(client.state == client.State.OPEN, "reaches the desk")
	client.heard.connect(func(method: String, params: Dictionary):
		if method == "chat/event":
			_events.append(params.event))

	HandMenu.ensure(self)
	await process_frame
	views.show("graph", {"project": ""})
	var view: Node3D = room.get_node("Stage").get_child(-1)
	await _until(func(): return view._marks != null)
	var menu: Node3D = HandMenu.of(self)
	var chat: Node = menu.chat()
	await _until(func(): return chat.threads.size() == 1)
	_check(chat.threads.size() == 1, "the desk's threads are listed")
	var name: String = chat.threads[0].name
	var Page: GDScript = HandMenu.Page
	var room_for_words: float = HandMenu.WIDTH - Page.INSET * 2.0 - Page.GLYPH - Page.AFTER_GLYPH
	var row: String = chat.row_words(chat.threads[0], room_for_words, Page.LETTERS, Page.LETTER)
	_check(row.ends_with("…") and name.begins_with(row.trim_suffix("…").strip_edges()), "a long name is cut to stand on its row: %s" % row)
	menu.turn_to(HandMenu.Pane.CHAT)
	await _settle()
	var face: Node3D = menu._faces[HandMenu.Pane.CHAT]
	_check(_choosable(face, row) and _choosable(face, HandMenu.NEW_THREAD), "the threads and a new one are chosen from once the chat faces the reader")
	_check(_label(face, HandMenu.TALK) != null, "and it says how to speak to it")
	_check_words_fit(face, "the threads")

	_pick(face, row)
	await _until(func(): return is_instance_valid(chat.panel) and chat.panel.turns.size() == 2)
	var panel: Node3D = chat.panel
	_check(is_instance_valid(panel) and panel.turns.size() == 2, "a thread opens with what was said in it")
	if not is_instance_valid(panel):
		_end()
		return
	_check(panel.get_parent() == face and menu.showing == HandMenu.Pane.CHAT, "held on the chat's panel, turned to the reader")
	_check(panel._title.text == name, "named as the desk names it")
	var read: String = panel._body.get_parsed_text()
	_check(read.contains("Why does the parser read whole files?") and read.contains("halfway through a word"), "reading both turns: %s" % read)
	_check(view._targets[0] == panel, "pointed at before the field behind it")
	_check(_label(face, HandMenu.ALL_THREADS) != null and _label(face, HandMenu.STOP) == null, "with the way back to the threads, and nothing to stop")
	var Dressing: GDScript = load("res://ui/theme.gd")
	var dressing: Node = Dressing.Room.of(self)
	var wore: String = Dressing.Room.panels()
	var pack: String = Dressing.PACKS.keys()[0]
	dressing.keep("panels", pack)
	_check(panel.get_node("Page/Sheet").theme.default_font == load(Dressing.PACKS[pack].file).default_font, "the room dressed in %s dresses the open thread in it too" % pack)
	dressing.keep("panels", wore)

	_events.clear()
	chat.say("take me to the second note")
	await _until(func(): return panel.answering)
	_check(panel.turns.size() == 3 and panel.turns[2].from == "person", "what was said stands in the thread at once")
	await process_frame
	_check(_choosable(face, HandMenu.STOP), "an answer under way can be stopped")
	_check_words_fit(face, "the open thread's rows")
	var stopped: Dictionary = await chat.stop()
	_check(stopped.is_empty(), "stopping is asked of the desk: %s" % [stopped])
	await _until(func(): return _events.size() >= 2 and _events[1].event == "block")
	_check(panel.turns.size() == 4 and panel._body.get_parsed_text().contains("The second note"), "the answer appears as it is written")
	await _until(func(): return _events.size() >= 4)
	var kinds: Array = _events.map(func(event): return event.event)
	_check(kinds == ["started", "block", "block", "over"], "the desk's events are heard in order: %s" % [kinds])
	_check(panel.turns.size() == 4 and panel.turns[3].blocks.size() == 1, "a grown block replaces the one before it: %s" % [panel.turns.back()])
	_check(panel.turns[3].blocks[0].said == "The second note is a.ts.", "and is the whole of it")
	_check(not panel.answering and _label(face, HandMenu.STOP) == null, "an answer finished has nothing to stop")
	_check(panel._body.scroll_following, "the page follows the answer while the reader has not scrolled up")

	var hand := XRController3D.new()
	room.add_child(hand)
	hand.global_position = panel.global_position + Vector3(0.0, 0.0, 0.3)
	var pointer := _pointer(hand)
	panel.take(pointer)
	_check(panel.get_parent() == room and menu._floating.get(HandMenu.Pane.CHAT, false), "the grip pulls the thread off into the room")
	_check(_label(face, HandMenu.ALL_THREADS) != null, "leaving its rows on the palette")
	hand.global_position += Vector3(0.5, 0.1, -0.3)
	await process_frame
	panel.let_go(pointer)
	_check(panel.get_parent() == room, "let go away from the palette, it stays in the room")
	panel.take(pointer)
	hand.global_position += menu.rest_on(HandMenu.Pane.CHAT).origin - panel.global_position
	await process_frame
	panel.let_go(pointer)
	_check(panel.get_parent() == face and panel.transform.is_equal_approx(menu._note_on_face()), "let go by the palette, it goes back on it")
	pointer.free()

	_pick(face, HandMenu.ALL_THREADS)
	await process_frame
	_check(not is_instance_valid(panel) and chat.panel == null, "all threads lets the thread go")
	await _until(func(): return _label(face, row) != null)
	_check(_choosable(face, HandMenu.NEW_THREAD), "and lists them again")

	await chat.refresh()
	var desks: Dictionary = chat.threads[0]
	var many: Array = []
	for at in 6:
		many.append(desks if at == 4 else {"id": "elsewhere-%d" % at, "name": "Thread %d" % at})
	chat.threads = many
	chat.changed.emit()
	await process_frame
	_check(_choosable(face, HandMenu.OLDER_THREADS) and _label(face, HandMenu.NEWER_THREADS) == null and _label(face, row) == null, "past four threads, the older ones are a row away")
	_check_words_fit(face, "the first threads")
	_pick(face, HandMenu.OLDER_THREADS)
	await process_frame
	_check(_choosable(face, row) and _choosable(face, HandMenu.NEWER_THREADS) and _label(face, HandMenu.OLDER_THREADS) == null and _label(face, "Thread 3") == null, "older threads are listed, with the way back to the newer")
	_check_words_fit(face, "the older threads")
	_pick(face, row)
	await _until(func(): return is_instance_valid(chat.panel) and chat.panel.turns.size() == 2)
	_check(is_instance_valid(chat.panel) and chat.panel.thread == str(desks.id), "the fifth thread opens")
	_pick(face, HandMenu.ALL_THREADS)
	await _until(func(): return chat.threads.size() == 1 and _label(face, row) != null)
	_check(_label(face, HandMenu.NEWER_THREADS) == null and _choosable(face, row), "the desk's threads listed again from the newest there is")

	var shortest: float = root.get_node("Voice").SHORTEST
	menu.toggle()
	var stood: Array = [menu.visible, menu.showing, chat.said]
	chat.listen()
	await create_timer(shortest / 3.0).timeout
	await chat.ask()
	await create_timer(shortest).timeout
	_check([menu.visible, menu.showing, chat.said] == stood and chat.panel == null, "a bump of A leaves the palette where it stood and opens nothing")
	chat.listen()
	await create_timer(shortest + 0.1).timeout
	_check(menu.visible and menu.showing == HandMenu.Pane.CHAT and chat.said == chat.LISTENING, "A held turns the chat to the reader, listening")
	_check(_label(face, chat.LISTENING) != null, "and says so")
	await chat.ask()
	_check(is_instance_valid(chat.panel) and chat.said.begins_with(chat.HEARD % ""), "and what was said is heard into a thread")
	chat.close_thread()

	chat.say("what is in the second note")
	await _until(func(): return is_instance_valid(chat.panel) and chat.panel.turns.size() == 3)
	_check(is_instance_valid(chat.panel) and chat.panel.turns.back().from == "person", "words said with no thread open open one for them")
	_check(chat.said == chat.HEARD % "what is in the second note", "and what was heard is said")
	await _interrupts(menu, chat, face, client)
	_end()


func _interrupts(menu: Node3D, chat: Node, face: Node3D, client: Node) -> void:
	var panel: Node3D = chat.panel
	await _until(func(): return panel.answering)
	menu.turn_to(HandMenu.Pane.READING)
	menu.toggle()
	_check(not menu.visible, "the palette is put away mid-answer")
	await _until(func(): return not panel.answering)
	_check(panel._body.get_parsed_text().contains("The second note is a.ts."), "and the answer is heard to its end all the same")
	menu.toggle()
	menu.turn_to(HandMenu.Pane.CHAT)

	var sent := _spy(client)
	chat.say("what is in the first note")
	await _until(func(): return panel.turns.back().from == "agent" and panel._body.get_parsed_text().contains("The second note"))
	await process_frame
	_pick(face, HandMenu.STOP)
	await _until(func(): return _asked(sent).has("chat/stop"))
	_check(_asked(sent).has("chat/stop"), "Stop asks the desk to stop")
	_check(chat.panel == panel and panel._body.get_parsed_text().contains("The second note"), "and leaves the thread open at the answer so far")

	sent.clear()
	var shortest: float = root.get_node("Voice").SHORTEST
	await _until(func(): return panel.answering)
	chat.listen()
	await create_timer(shortest + 0.1).timeout
	_check(chat.said == chat.STOPPED_LISTENING, "A held mid-answer says it stopped and is listening")
	await chat.ask()
	var asked := _asked(sent)
	_check(asked.find("chat/stop") >= 0 and asked.find("chat/stop") < asked.find("speech/hear") and asked.find("speech/hear") < asked.find("chat/say"), "the answer is stopped before what was said is heard: %s" % [asked])
	var said_into = sent.filter(func(line): return line.method == "chat/say")
	_check(not said_into.is_empty() and said_into[0].params.thread == panel.thread and chat.panel == panel, "and it is said into the same thread")
	_check(panel.turns.filter(func(turn): return turn.from == "person").back().blocks[0].said == "take me to the second note", "standing in it as said")

	sent.clear()
	var refused: Dictionary = await chat.open("")
	_check(int(refused.get("code", 0)) == -32020 and chat.said == str(refused.get("error", "")), "another thread mid-answer is the desk's to refuse, in its words: %s" % [refused])
	await process_frame
	_check(_label(face, chat.said) != null, "said on the chat's panel")
	_check(chat.panel == panel and is_instance_valid(panel) and not _asked(sent).has("chat/close"), "and the thread open stays open, heard as before")


## Every line `client` sends from now on, parsed, in the order it is sent.
func _spy(client: Node) -> Array:
	var source := GDScript.new()
	source.source_code = """extends Node
var real: Object
var sent: Array = []
func send(line: String) -> void:
	sent.append(JSON.parse_string(line))
	real.send(line)
func close() -> void:
	real.close()
func connect_to(to: String) -> bool:
	return real.connect_to(to)
func discover() -> void:
	real.discover()
"""
	source.reload()
	var spy := Node.new()
	spy.set_script(source)
	spy.real = client._link
	client.add_child(spy)
	client._link = spy
	return spy.sent


func _asked(sent: Array) -> Array:
	return sent.map(func(line): return line.method)


func _transcribes() -> void:
	var named := {"did:x/1": "1a  a.ts"}
	_check(ChatPanel.act_line({"kind": "tool_call", "call": "c", "tool": "mcp__sloppy__read_note", "act": "read_note", "arguments": {"note": "did:x/1"}}, named) == "Reading a note: 1a  a.ts", "an act on a note names the note")
	_check(ChatPanel.act_line({"kind": "tool_call", "call": "c", "tool": "mcp__sloppy__search_notes", "act": "search_notes", "arguments": {"words": "parser"}}, named) == "Looking through the notes: parser", "a search names what it looks for")
	_check(ChatPanel.act_line({"kind": "tool_call", "call": "c", "tool": "Bash"}, named) == "Bash", "a tool of the assistant's own is named as it is")
	var said: String = ChatPanel.transcript([
		{"from": "person", "blocks": [{"kind": "said", "said": "Why [this]?"}]},
		{"from": "agent", "blocks": [
			{"kind": "thinking", "said": "hm"},
			{"kind": "thinking", "said": "hm hm"},
			{"kind": "tool_call", "call": "c", "tool": "t", "act": "list_notes"},
			{"kind": "tool_result", "call": "c", "said": "{\"notes\": []}"},
			{"kind": "said", "said": "**Because.**"},
		]},
	], named)
	_check(said == "[b]Why [lb]this[rb]?[/b]\n\n[i]…[/i]\n\n[i]Reading the notes[/i]\n\n[b]Because.[/b]", "a thread reads as the desk's, one quiet line an act: %s" % said)


func _check_words_fit(under: Node, what: String) -> void:
	for failure in load("res://tests/fit.gd").words_fit(under, what):
		_check(false, failure)


func _end() -> void:
	root.get_node("Client").close()
	print("chat_panel_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _settle() -> void:
	var by: float = Time.get_ticks_msec() + (HandMenu.TURNING + 0.3) * 1000.0
	while Time.get_ticks_msec() < by:
		await process_frame


## A pointer on `hand`, as the grip would carry with it.
func _pointer(hand: XRController3D) -> Node3D:
	var source := GDScript.new()
	source.source_code = "extends Node3D\nvar hand: XRController3D\n"
	source.reload()
	var pointer := Node3D.new()
	pointer.set_script(source)
	pointer.hand = hand
	return pointer


func _label(under: Node, text: String) -> Label3D:
	for found in under.find_children("*", "Label3D", true, false):
		if not found.is_queued_for_deletion() and (found as Label3D).text == text:
			return found
	return null


func _choosable(under: Node, text: String) -> bool:
	var label := _label(under, text)
	if label == null:
		return false
	for area in label.get_parent().find_children("*", "Area3D", false, false):
		return (area as Area3D).collision_layer != 0
	return false


func _pick(under: Node, text: String) -> void:
	var label := _label(under, text)
	if label == null:
		_check(false, "there is a row %s" % text)
		return
	for area in label.get_parent().find_children("*", "Area3D", false, false):
		area.get_meta("pick").call()
		return
	_check(false, "%s can be chosen" % text)


func _until(done: Callable) -> void:
	var by := Time.get_ticks_msec() + WAIT * 1000.0
	while not done.call() and Time.get_ticks_msec() < by:
		await process_frame


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("chat_panel_test: does not hold: %s" % what)
