## The room's one browser: pages from the web as tabs on a panel standing ahead
## of the reader at reading distance, with the tabs, where the page is, its title,
## Back and Close over it and a keyboard below it whenever a field on the page has
## focus; taken hold of, the page and its keyboard go where the hand takes them.
## Opened from a note's link, each in a tab of its own, or from the palette's Here
## panel, onto a page of its own to search from. A tab pulled out is a panel of
## its own beside it, carried and closed on its own, with no tabs.
extends "res://ui/web_panel.gd"

const Keyboard := preload("res://ui/keyboard.gd")

const GROUP := "browser"
## The browser and every page pulled out of it.
const PAGES := "browser_pages"
## Told `browser_changed()` when the browser opens, closes, or goes from the
## reader or comes back to them.
const WATCHING := "browser_watching"
## In metres, from the eyes, and below them.
const READING := 0.75
const BELOW_EYES := 0.08
## In metres from where it would stand ahead of the reader, and in degrees from
## where they look: past either, it is away from them.
const AWAY_BEYOND := 1.5
const SEEN_WITHIN := 50.0
## In metres from the page's foot to the keyboard, clear of the window's bar,
## and in degrees how far the keyboard leans back toward the reader.
const KEYBOARD_BELOW := WindowFrame.FOOT + 0.008
const KEYBOARD_LEAN := 50.0
const START := "res://web/start.html"
## What a page made from html with no base reports itself to be.
const BLANK := "about:blank"
const SEARCH := "https://duckduckgo.com/?q=%s"
const SEARCH_THE_WEB := "Search the web"
const NEW_TAB := "New tab"
const PULL_OUT := "Pull out"
const MORE := "%d more"
## Each tab is a page held open, so a reader is asked to close one past these.
const MOST_TABS := 12
const FULL := "Twelve tabs are open. Close one to open another."
## In metres: how wide New tab and Pull out stand, how narrow a tab may be, and
## how far apart a page pulled out and the browser stand.
const NEW_TAB_WIDE := 0.1
const PULL_OUT_WIDE := 0.12
const TAB_LEAST := 0.1
const PULLED_APART := 0.1
## Reports to the panel whether a text field on the page has focus, through the
## plugin's `sloppyTyping`, which any page may speak to.
const WATCH_TYPING := "(() => { if (window.__sloppyTyping || !window.sloppyTyping) return; const typing = (at) => !!at && (at.isContentEditable || at.tagName === 'TEXTAREA' || (at.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(at.type))); const say = () => window.sloppyTyping.focus(typing(document.activeElement)); window.__sloppyTyping = say; document.addEventListener('focusin', say, true); document.addEventListener('focusout', () => setTimeout(say, 0), true); say(); })()"
## Where the headset keeps whether the browser is pinned and where pinned
## pages stand, in Room.KEPT.
const KEPT_UNDER := "browser"
## Asks a page watched as above to say again whether a field has focus.
const ASK_TYPING := "window.__sloppyTyping && window.__sloppyTyping()"

var keyboard: Node3D
## Where the page is; "" on the page searched from.
var address := ""
## Whether the browser stands far from the reader or out of their sight.
var away := false
## Whether the panel holds tabs: false on a page pulled out of the browser.
var tabbed := true

## `{page, title, address, frame}` each, `frame` the page's last `[width,
## height, bytes]` or empty.
var _tabs: Array[Dictionary] = []
var _showing := 0
## The first tab the strip shows.
var _strip_from := 0
var _address_row: Node3D
var _rows := {}


## The room's browser; null while there is none.
static func of(tree: SceneTree) -> Node3D:
	for panel in tree.get_nodes_in_group(GROUP):
		if panel.is_inside_tree() and not panel.is_queued_for_deletion():
			return panel
	return null


## Opens `url` in a tab of its own on the room's browser, making the browser
## ahead of the eyes `from` is seen by where there is none yet.
static func show_page(from: Node, url: String) -> Node3D:
	var panel := of(from.get_tree())
	if panel != null:
		panel.new_tab(url)
		return panel
	panel = _made(from)
	panel.open_url(url)
	return panel


## Opens the room's browser, or a tab on it, on its page to search from, with
## the keys up.
static func open_blank(from: Node) -> Node3D:
	var panel := of(from.get_tree())
	if panel != null:
		panel.new_tab()
		return panel
	panel = _made(from)
	panel.start()
	return panel


static func close_in(tree: SceneTree) -> void:
	var panel := of(tree)
	if panel != null:
		panel.close()


## Stands the browser ahead of the eyes `from` is seen by again.
static func bring_here(from: Node) -> void:
	var panel := of(from.get_tree())
	if panel != null:
		panel.pin(false)
		panel.global_transform = _ahead(from.get_viewport().get_camera_3d())
		panel._look_where_it_is()


static func _made(from: Node) -> Node3D:
	var tree := from.get_tree()
	var panel: Node3D = (load("res://ui/browser_panel.gd") as GDScript).new()
	_view(tree).add_child(panel)
	panel.global_transform = _ahead(from.get_viewport().get_camera_3d())
	if _kept("pinned", false) == true:
		panel.pin(true, true)
	panel._aimed_at()
	return panel


static func _kept(key: String, otherwise: Variant) -> Variant:
	var file := ConfigFile.new()
	return file.get_value(KEPT_UNDER, key, otherwise) if file.load(Room.KEPT) == OK else otherwise


static func _keep(key: String, value: Variant) -> void:
	var file := ConfigFile.new()
	file.load(Room.KEPT)
	file.set_value(KEPT_UNDER, key, value)
	file.save(Room.KEPT)


func _init() -> void:
	carries_itself = true
	windowed = true
	pinnable = true


## The browser's pin is kept for the next time it opens; a page pulled out of
## it is pinned for as long as it stands.
func pin(on: bool, at_once := false) -> void:
	super(on, at_once)
	if tabbed and _window != null:
		_keep("pinned", is_pinned())


func _ready() -> void:
	add_to_group(PAGES)
	if tabbed:
		add_to_group(GROUP)
	super()
	if tabbed:
		var place = _kept("pinned_at", WindowFrame.PINNED_AT)
		_window.pinned_at = place if place is Vector3 else WindowFrame.PINNED_AT
		_window.placed.connect(func(at: Vector3) -> void: _keep("pinned_at", at))
	_tabs = [{"page": id, "title": title, "address": address, "frame": []}]
	keyboard = Keyboard.new()
	keyboard.name = "Keyboard"
	_place_keyboard()
	keyboard.basis = Basis(Vector3.RIGHT, -deg_to_rad(KEYBOARD_LEAN))
	add_child(keyboard)
	keyboard.typed.connect(type_text)
	keyboard.pressed_key.connect(press_key)
	keyboard.taken.connect(take)
	keyboard.let_go_of.connect(let_go)
	closed.connect(keyboard.closed.emit)
	loaded.connect(_loaded)
	message.connect(_heard)
	if tabbed:
		tree_exiting.connect(_tell)
		_tell()
	_draw_bar()


func _place_keyboard() -> void:
	keyboard.position = Vector3(-Keyboard.wide * 0.5, -size.y * 0.5 - KEYBOARD_BELOW, 0.0)


func resize_to(given: Vector2, done := true) -> void:
	super(given, done)
	_place_keyboard()


## Every tab's page laid out again at the panel's size.
func _lay_pages_out() -> void:
	super()
	if _engine == null:
		return
	for tab in _tabs:
		if tab.page != 0 and tab.page != id:
			_engine.resize(tab.page, pixels.x, pixels.y)


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and _engine != null:
		for tab in _tabs:
			if tab.page != 0 and tab.page != id:
				_engine.destroy(tab.page)


## Opens `url`, or the page searched from where it is "", in a tab of its own
## and shows it; answers false, saying so, when MOST_TABS are open already.
func new_tab(url := "") -> bool:
	if _tabs.size() >= MOST_TABS:
		_saying(FULL)
		return false
	var page := _new_page() if _engine != null else 0
	_tabs.append({"page": page, "title": "", "address": "", "frame": []})
	show_tab(_tabs.size() - 1)
	if url == "":
		start()
	else:
		open_url(url)
	return true


func show_tab(index: int) -> void:
	if index < 0 or index >= _tabs.size():
		return
	_showing = index
	var tab := _tabs[index]
	id = tab.page
	address = tab.address
	title = tab.title
	_keep_in_strip()
	_show_frame(tab.frame)
	keyboard.hide_keys()
	evaluate(ASK_TYPING)
	_draw_bar()


## Closing the last tab closes the browser.
func close_tab(index: int) -> void:
	if index < 0 or index >= _tabs.size():
		return
	if _tabs.size() == 1:
		close()
		return
	var page: int = _tabs[index].page
	_tabs.remove_at(index)
	if _engine != null and page != 0:
		_engine.destroy(page)
	if index == _showing:
		show_tab(mini(index, _tabs.size() - 1))
		return
	if index < _showing:
		_showing -= 1
	_keep_in_strip()
	_draw_bar()


func tab_count() -> int:
	return _tabs.size()


func showing() -> int:
	return _showing


## The tab showing, made a panel of its own beside the browser, facing the
## reader; the browser shows the tab after it. Null with one tab, or on a page
## already pulled out.
func pull_out() -> Node3D:
	if not tabbed or _tabs.size() < 2:
		return null
	var tab := _tabs[_showing]
	var panel: Node3D = (get_script() as GDScript).new()
	panel.tabbed = false
	panel.page_given = tab.page
	panel.title = tab.title
	panel.address = tab.address
	var beside := _beside()
	_tabs.remove_at(_showing)
	show_tab(mini(_showing, _tabs.size() - 1))
	get_parent().add_child(panel)
	panel._window.pinned_at = _pinned_beside()
	panel.global_transform = beside
	panel._show_frame(tab.frame)
	panel.evaluate(ASK_TYPING)
	panel._aimed_at()
	return panel


## Where a page pulled out stands: PULLED_APART to the right of this one, as
## high, turned to face the reader.
func _beside() -> Transform3D:
	var at := global_transform * Vector3(size.x + PULLED_APART, 0.0, 0.0)
	var eyes := get_viewport().get_camera_3d()
	var toward := at - eyes.global_position if eyes != null else -global_basis.z
	toward.y = 0.0
	if toward.length() < 1e-3:
		return Transform3D(global_basis, at)
	return Transform3D(Basis.looking_at(toward.normalized(), Vector3.UP), at)


## Where a page pulled out is pinned until it is placed: turned right of where
## this one is pinned by as much as stands it PULLED_APART to the right of it.
func _pinned_beside() -> Vector3:
	var at: Vector3 = _window.pinned_at
	var turn := rad_to_deg(2.0 * atan((size.x + PULLED_APART) * 0.5 / at.z))
	return Vector3(at.x + turn, at.y, at.z)


## Lets the view in front point at the panel and its keys.
func _aimed_at() -> void:
	var view := get_parent()
	if view != null and view.has_method("aim_at"):
		view.aim_at(self)
		view.aim_at(keyboard)


## The page's last frame on the face, or paper until it draws one.
func _show_frame(frame: Array) -> void:
	if _engine == null:
		return
	if frame.is_empty():
		_image_texture = null
		_paint.albedo_texture = null
		_paint.albedo_color = Room.paper()
		return
	_pixels(id, frame[0], frame[1], frame[2])


func _tab_of(page: int) -> Dictionary:
	for tab in _tabs:
		if tab.page == page:
			return tab
	return {}


func _pixels(on: int, width: int, height: int, bytes: PackedByteArray) -> void:
	var tab := _tab_of(on)
	if tab.is_empty():
		return
	tab.frame = [width, height, bytes]
	if on == id:
		super(on, width, height, bytes)


func _page_loaded(on: int, url: String, page_title: String) -> void:
	if on == id:
		super(on, url, page_title)
		return
	var tab := _tab_of(on)
	if tab.is_empty():
		return
	tab.title = page_title if page_title.strip_edges() != "" else url
	tab.address = "" if url == BLANK else url
	_engine.evaluate(on, WATCH_TYPING)
	_draw_bar()


func _navigating(on: int, request: int, url: String) -> void:
	if on != id and not _tab_of(on).is_empty():
		_engine.allow(request, allows.call(url))
	else:
		super(on, request, url)


func _failed(on: int, url: String, said: String) -> void:
	if on == id:
		super(on, url, said)
		return
	var tab := _tab_of(on)
	if not tab.is_empty():
		tab.title = COULD_NOT
		_draw_bar()


func _saying(said: String) -> void:
	if said != FULL and _showing < _tabs.size():
		_tabs[_showing].title = said
	super(said)


## The keys up below this page, and put away below every other.
func _keys_up() -> void:
	for other in get_tree().get_nodes_in_group(PAGES):
		if other != self and other.keyboard != null:
			other.keyboard.hide_keys()
	keyboard.show_keys()


## The page searched from, holding where the browser was so it can be changed.
func start() -> void:
	var page := FileAccess.get_file_as_string(START)
	page = page.replace("/* look */", ":root { --ink: #%s; --paper: #%s; --card: #%s; --edge: #%s; }" % [
		Pieces.INK.to_html(false), Pieces.PAPER.to_html(false), Pieces.CARD.to_html(false), Pieces.EDGE.to_html(false)])
	page = page.replace("/* was */ \"\"", JSON.stringify(address).replace("</", "<\\/"))
	_at_address("")
	open_html(page)
	_keys_up()
	_draw_bar()


## What was typed on the page searched from: an address is gone to, anything
## else searched for.
func go(typed: String) -> void:
	var url := url_for(typed)
	if url == "":
		return
	keyboard.hide_keys()
	open_url(url)


static func url_for(typed: String) -> String:
	var said := typed.strip_edges()
	if said == "":
		return ""
	var scheme := said.get_slice(":", 0).to_lower()
	if said.contains("://") and (scheme == "http" or scheme == "https"):
		return said
	if not said.contains(" ") and _names_a_site(said.get_slice("/", 0)):
		return "https://" + said
	return SEARCH % said.uri_encode()


## Whether `host` reads as a site's name: a dotted name ending in letters, or
## this machine's, with a port or not.
static func _names_a_site(host: String) -> bool:
	var name := host.get_slice(":", 0).to_lower()
	if name == "localhost":
		return true
	var parts := name.split(".")
	if parts.size() < 2 or parts.has(""):
		return false
	var last := parts[parts.size() - 1]
	return last.length() >= 2 and RegEx.create_from_string("^[a-z]+$").search(last) != null


func type_text(typed: String) -> void:
	if _engine != null:
		_engine.text(id, typed)


## `name` is "Enter" or "Backspace".
func press_key(name: String) -> void:
	if _engine != null:
		_engine.key(id, name)


func _loaded(url: String, _title: String) -> void:
	_at_address("" if url == BLANK else url)
	evaluate(WATCH_TYPING)
	_draw_bar()


func _heard(said: Variant) -> void:
	if not said is Dictionary:
		return
	match said.get("kind"):
		"search":
			go(str(said.get("q", "")))
		"typing":
			if said.get("on") == true:
				_keys_up()


func _at_address(url: String) -> void:
	address = url
	if _showing < _tabs.size():
		_tabs[_showing].address = url


func _process(delta: float) -> void:
	super(delta)
	if tabbed:
		_look_where_it_is()


func _look_where_it_is() -> void:
	var eyes := get_viewport().get_camera_3d()
	if eyes == null or not is_inside_tree():
		return
	var now := global_position.distance_to(_ahead(eyes).origin) > AWAY_BEYOND or not _seen_by(eyes)
	if now != away:
		away = now
		_tell()


func _seen_by(eyes: Camera3D) -> bool:
	var toward := global_position - eyes.global_position
	return toward.length() < 1e-3 or (-eyes.global_basis.z).angle_to(toward) <= deg_to_rad(SEEN_WITHIN)


func _tell() -> void:
	if is_inside_tree():
		get_tree().call_group_flags(SceneTree.GROUP_CALL_DEFERRED, WATCHING, "browser_changed")


## Over the title, where the page is, which chosen opens the page searched from
## holding it, and Pull out beside it; over that, the tabs and New tab.
func _draw_bar() -> void:
	super()
	_address_row = null
	_rows = {}
	if _bar == null or _tabs.is_empty():
		return
	var pulling := tabbed and _tabs.size() > 1
	var across := size.x - (PULL_OUT_WIDE + Page.GAP if pulling else 0.0)
	var shown := address if address != "" else SEARCH_THE_WEB
	var row := _row(Page.choice(shown, "globe", start), across, Vector2.ZERO)
	var tall: float = row.get_meta("height")
	row.position.y = tall + Page.GAP
	_address_row = row
	if pulling:
		_rows.pull = _row(Page.choice(PULL_OUT, "square-arrow-out-up-right", pull_out), PULL_OUT_WIDE, Vector2(across + Page.GAP, tall + Page.GAP))
	if tabbed:
		_draw_strip(tall * 2.0 + Page.GAP)
	_fit_window()


## The tabs from `_strip_from` that fit, the showing one filled, each with its
## close; "n more" turning to the next ones where they do not all fit; New tab.
func _draw_strip(up: float) -> void:
	var fits := _strip_fits()
	var shown := _strip_shown()
	var wide := (size.x - NEW_TAB_WIDE - Page.GAP - (fits - 1) * Page.GAP) / fits
	var named := wide - Page.ROW - Page.GAP * 0.5
	var x := 0.0
	for at in range(_strip_from, mini(_strip_from + shown, _tabs.size())):
		var said: String = _tabs[at].title if _tabs[at].title != "" else OPENING
		_rows["tab%d" % at] = _row(Page.buttons([[said, show_tab.bind(at), at == _showing]]), named, Vector2(x, up))
		_rows["close%d" % at] = _row(Page.mark("x", close_tab.bind(at)), Page.ROW, Vector2(x + wide - Page.ROW, up))
		x += wide + Page.GAP
	if _tabs.size() > shown:
		_rows.more = _row(Page.buttons([[MORE % (_tabs.size() - shown), _turn_strip, false]]), wide, Vector2(x, up))
	_rows.new = _row(Page.choice(NEW_TAB, "plus", new_tab.bind("")), NEW_TAB_WIDE, Vector2(size.x - NEW_TAB_WIDE, up))


func _row(given: Dictionary, across: float, at: Vector2) -> Node3D:
	var row := Page.new("", [{"rows": [given]}], "", across)
	row.position = Vector3(at.x, at.y, 0.0)
	_bar.add_child(row)
	return row


## How many tabs' room the strip has beside New tab.
func _strip_fits() -> int:
	return maxi(1, floori((size.x - NEW_TAB_WIDE - Page.GAP + Page.GAP) / (TAB_LEAST + Page.GAP)))


## How many tabs the strip shows at once: one fewer than fit where "n more"
## takes the last place.
func _strip_shown() -> int:
	var fits := _strip_fits()
	return fits if _tabs.size() <= fits else maxi(1, fits - 1)


func _keep_in_strip() -> void:
	var shown := _strip_shown()
	_strip_from = clampi(_strip_from, 0, maxi(0, _tabs.size() - 1))
	if _showing < _strip_from:
		_strip_from = _showing
	elif _showing >= _strip_from + shown:
		_strip_from = _showing - shown + 1
	if _tabs.size() <= shown:
		_strip_from = 0


func _turn_strip() -> void:
	_strip_from += _strip_shown()
	if _strip_from >= _tabs.size():
		_strip_from = 0
	_draw_bar()


## The row saying where the page is; null with no bar.
func address_row() -> Node3D:
	return _address_row


## A row on the bar by "pull", "new", "more", "tab<n>" or "close<n>" for the
## tab at n; null where it is not standing.
func strip_row(key: String) -> Node3D:
	return _rows.get(key)


static func _view(tree: SceneTree) -> Node:
	var stage: Node = tree.root.get_node_or_null("Views")
	if stage != null:
		stage = stage.stage
		for i in range(stage.get_child_count() - 1, -1, -1):
			var child := stage.get_child(i)
			if child is Node3D and not child.is_queued_for_deletion():
				return child
	return tree.current_scene if tree.current_scene != null else tree.root


## Level ahead of `eyes`, turned to face them.
static func _ahead(eyes: Camera3D) -> Transform3D:
	if eyes == null:
		return Transform3D(Basis(), Vector3(0.0, 1.5, -READING))
	var forward := -eyes.global_basis.z
	forward.y = 0.0
	forward = forward.normalized() if forward.length() > 1e-3 else Vector3.FORWARD
	var at := eyes.global_position + forward * READING + Vector3.DOWN * BELOW_EYES
	return Transform3D(Basis.looking_at(forward, Vector3.UP), at)
