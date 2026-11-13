## Stands in for the web view plugin in the tests: answers as the plugin does,
## a frame later, with a flat page, and keeps every call made of it. A page given
## as html answers Enter as the browser's page to search from does.
extends RefCounted

signal page_loaded(id: int, url: String, title: String)
signal navigating(id: int, request: int, url: String)
signal message(id: int, json: String)
signal failed(id: int, url: String, said: String)
signal pixels(id: int, width: int, height: int, bytes: PackedByteArray)
signal frame(id: int, buffer: int)

## Every call, as `[name, args…]`.
var calls: Array = []
var title := "A page"
var colour := Color(0.9, 0.85, 0.7)
## What the page says once it has loaded, and after each `evaluate`, as JSON.
var says_on_load: Array[String] = []
var says_on_evaluate: Array[String] = []
## Whether the next load fails.
var fails := false
var answers := {}
var _sizes := {}
var _visited := {}
var _typed := {}
var _html := {}
var _request := 0


func create(id: int, width: int, height: int, path: String) -> void:
	calls.append(["create", id, width, height, path])
	_sizes[id] = Vector2i(width, height)
	_visited[id] = []


func destroy(id: int) -> void:
	calls.append(["destroy", id])
	_sizes.erase(id)


func resize(id: int, width: int, height: int) -> void:
	calls.append(["resize", id, width, height])
	_sizes[id] = Vector2i(width, height)


func load_url(id: int, url: String) -> void:
	calls.append(["load_url", id, url])
	_html[id] = false
	_load(id, url)


func load_html(id: int, html: String, base_url: String) -> void:
	calls.append(["load_html", id, html, base_url])
	_html[id] = true
	_typed[id] = ""
	_load(id, base_url if base_url != "" else "about:blank")


func evaluate(id: int, js: String) -> void:
	calls.append(["evaluate", id, js])
	for said in says_on_evaluate:
		message.emit.call_deferred(id, said)


func go_back(id: int) -> bool:
	calls.append(["go_back", id])
	var visited: Array = _visited.get(id, [])
	if visited.size() < 2:
		return false
	visited.pop_back()
	_arrive.call_deferred(id, visited.back())
	return true


func touch(id: int, x: float, y: float, phase: String) -> void:
	calls.append(["touch", id, x, y, phase])


func scroll(id: int, dx: float, dy: float) -> void:
	calls.append(["scroll", id, dx, dy])


func text(id: int, typed: String) -> void:
	calls.append(["text", id, typed])
	_typed[id] = _typed.get(id, "") + typed


func key(id: int, name: String) -> void:
	calls.append(["key", id, name])
	var held: String = _typed.get(id, "")
	if name == "Backspace":
		_typed[id] = held.left(-1)
	elif name == "Enter" and _html.get(id, false):
		message.emit.call_deferred(id, JSON.stringify({"kind": "search", "q": held}))


func allow(request: int, yes: bool) -> void:
	answers[request] = yes


## A link on page `id` followed to `url`: asked as the plugin asks, and gone to
## where the answer allows; answers whether it was.
func follow(id: int, url: String) -> bool:
	_request += 1
	navigating.emit(id, _request, url)
	var yes: bool = answers.get(_request, false)
	if yes:
		_load(id, url)
	return yes


## The calls named `name`.
func called(name: String) -> Array:
	return calls.filter(func(call: Array): return call[0] == name)


func _load(id: int, url: String) -> void:
	if fails:
		fails = false
		failed.emit.call_deferred(id, url, "the site could not be reached")
		return
	_visited[id].append(url)
	_arrive.call_deferred(id, url)


func _arrive(id: int, url: String) -> void:
	if not _sizes.has(id):
		return
	page_loaded.emit(id, url, title)
	var size: Vector2i = _sizes[id]
	var page := Image.create(size.x, size.y, false, Image.FORMAT_RGBA8)
	page.fill(colour)
	pixels.emit(id, size.x, size.y, page.get_data())
	for said in says_on_load:
		message.emit(id, said)
