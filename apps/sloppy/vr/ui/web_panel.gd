## A live web page on a panel in the room, with a bar over it saying what it
## shows and Back and Close; where the web view plugin is absent (a Mac, the
## tests) the face shows `fallback` instead. android/plugins/sloppy_webview/
## README.md is the plugin's contract. A target for `interaction/pointer.gd`,
## carried as the note panel is.
extends Node3D

const Page := preload("res://ui/page.gd")
const Pieces := preload("res://ui/pieces.gd")
const Room := preload("res://room/room.gd")
const WindowFrame := preload("res://ui/window_frame.gd")

## The page finished loading `url`.
signal loaded(url: String, title: String)
## What the page said through `window.sloppy.send`, as JSON reads it.
signal message(said: Variant)
signal failed(url: String)
signal closed
## A hand's grip took hold of the panel, and let it go.
signal taken(pointer: Node3D)
signal let_go_of(pointer: Node3D)

const SINGLETON := "SloppyWebView"
const OPENING := "Opening…"
const COULD_NOT := "This page could not be opened."
const BACK := "Back"
const CLOSE := "Close"
## Pixels the page moves for a second of the stick leaned all the way.
const SCROLL := 1400.0
## In metres: how wide Back and Close stand together, and from the bar to the page.
const BUTTONS_WIDE := 0.2
const BAR_GAP := 0.008
const WEB_SCHEMES := ["http", "https", "about"]

## Stands in for the plugin where set; tests set it.
static var engine_override: Object = null
## How a page's frames reach its panel: "pixels", or "buffer" once it has been
## seen to draw on the headset.
static var frames := "pixels"
static var _next_id := 1

## In metres.
var size := Vector2(0.48, 0.6)
## The page's own size, in its pixels.
var pixels := Vector2i(1152, 1440)
## Whether the bar stands over the page.
var titled := true
## Shown on the face where the plugin is absent.
var fallback: Control
## Whether the page may go to a url, by itself or from a link in it.
var allows: Callable = web_allows
## Whether a grip carries the panel itself rather than whoever holds it.
var carries_itself := false
## Whether the panel is a window, moved by its bar and resized by its corners;
## set before it enters the tree.
var windowed := false
## Whether the bar offers to pin the window to the reader's view.
var pinnable := false
## What the bar says: the page's title, or how opening it went.
var title := ""
## The page's id with the plugin; 0 where there is none.
var id := 0
## A page the plugin already holds, shown instead of making one; set before
## the panel enters the tree.
var page_given := 0

var _engine: Object
var _face: MeshInstance3D
var _paint: StandardMaterial3D
var _viewport: SubViewport
var _image_texture: ImageTexture
var _external: Texture2D
var _bar: Node3D
var _buttons: Page
var _pressed := false
var _at := Vector2.ZERO
var _scroll_left := 0.0
var _carried_by: Node3D
var _carry := Transform3D()
var _window: Node3D
## The page's pixels to a metre of the panel.
var _density := 1.0


## Whether a page left to itself may go to `url`: the web, and nothing else.
static func web_allows(url: String) -> bool:
	return WEB_SCHEMES.has(url.get_slice(":", 0).to_lower()) and url.contains(":")


## The plugin, or what stands in for it; null where there is neither.
static func engine() -> Object:
	if engine_override != null:
		return engine_override
	return Engine.get_singleton(SINGLETON) if Engine.has_singleton(SINGLETON) else null


func _ready() -> void:
	_face = MeshInstance3D.new()
	_face.name = "Face"
	var quad := QuadMesh.new()
	quad.size = size
	_face.mesh = quad
	_paint = StandardMaterial3D.new()
	_paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_paint.cull_mode = BaseMaterial3D.CULL_DISABLED
	_paint.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	_paint.albedo_color = Room.paper()
	_face.material_override = _paint
	add_child(_face)
	_density = pixels.x / size.x
	if windowed:
		_window = WindowFrame.new(size, resize_to)
		_window.took_ray.connect(_unpoint_face)
		add_child(_window)
	_engine = engine()
	if _engine != null:
		_open_with_plugin()
	else:
		_open_fallback()
	_draw_bar()
	var room := Room.of(get_tree())
	if room != null:
		room.dressed.connect(_draw_bar)


## Carried from the palette to the room the panel leaves the tree and comes
## back, so its page ends only with the panel.
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and _engine != null and id != 0:
		_engine.destroy(id)
		id = 0


## Where the plugin is absent, the bar names where the page is instead.
func open_url(url: String) -> void:
	if _engine == null:
		_saying(url)
		return
	_saying(OPENING)
	_engine.load_url(id, url)


## `html` shown as though it stood at `base`, which its relative links read from.
func open_html(html: String, base := "") -> void:
	if _engine == null:
		return
	_saying(OPENING)
	_engine.load_html(id, html, base)


func evaluate(js: String) -> void:
	if _engine != null:
		_engine.evaluate(id, js)


## Whether there was a page before this one to go back to.
func go_back() -> bool:
	return _engine != null and _engine.go_back(id)


func close() -> void:
	closed.emit()
	queue_free()


## The panel `given` metres across and tall about its middle, live while it is
## drawn there and its page laid out again at that size once `done`.
func resize_to(given: Vector2, done := true) -> void:
	size = given
	(_face.mesh as QuadMesh).size = given
	if _window != null:
		_window.fit(given)
	if not done:
		_place_bar()
		return
	pixels = Vector2i((given * _density).round())
	_lay_pages_out()
	_draw_bar()


## Pins the window to the reader's view, or leaves it standing in the room
## where it is now; pinned `at_once`, it is there now rather than easing there.
func pin(on: bool, at_once := false) -> void:
	if _window == null or on == is_pinned():
		return
	_window.pin(on, at_once)
	_draw_bar()


func is_pinned() -> bool:
	return _window != null and _window.pinned


func _toggle_pin() -> void:
	pin(not is_pinned())


## Each page the panel shows laid out again at `pixels`.
func _lay_pages_out() -> void:
	if _external is ExternalTexture:
		(_external as ExternalTexture).size = Vector2(pixels)
	if _viewport != null:
		_viewport.size = pixels
	if _engine != null and id != 0:
		_engine.resize(id, pixels.x, pixels.y)


## The texture the face shows now; null before the page's first frame.
func shown() -> Texture2D:
	return _paint.albedo_texture


func _open_with_plugin() -> void:
	_engine.connect("page_loaded", _page_loaded)
	_engine.connect("navigating", _navigating)
	_engine.connect("message", _message)
	_engine.connect("failed", _failed)
	if frames == "buffer":
		var external := ExternalTexture.new()
		external.size = Vector2(pixels)
		_external = external
		_engine.connect("frame", _frame)
	else:
		_engine.connect("pixels", _pixels)
	id = page_given if page_given != 0 else _new_page()


## A page made with the plugin at the panel's size; answers its id.
func _new_page() -> int:
	var page := _next_id
	_next_id += 1
	_engine.create(page, pixels.x, pixels.y, frames)
	return page


func _open_fallback() -> void:
	_viewport = SubViewport.new()
	_viewport.name = "Fallback"
	_viewport.disable_3d = true
	_viewport.size = pixels
	_viewport.gui_embed_subwindows = true
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_viewport)
	if fallback != null:
		fallback.set_anchors_preset(Control.PRESET_FULL_RECT)
		_viewport.add_child(fallback)
	_paint.albedo_color = Color.WHITE
	_paint.albedo_texture = _viewport.get_texture()


func _page_loaded(on: int, url: String, page_title: String) -> void:
	if on != id:
		return
	_saying(page_title if page_title.strip_edges() != "" else url)
	loaded.emit(url, title)


func _navigating(on: int, request: int, url: String) -> void:
	if on == id:
		_engine.allow(request, allows.call(url))


func _message(on: int, json: String) -> void:
	if on != id:
		return
	var reading := JSON.new()
	if reading.parse(json) == OK:
		message.emit(reading.data)


func _failed(on: int, url: String, _said: String) -> void:
	if on != id:
		return
	_saying(COULD_NOT)
	failed.emit(url)


func _pixels(on: int, width: int, height: int, bytes: PackedByteArray) -> void:
	if on != id or bytes.size() != width * height * 4:
		return
	var image := Image.create_from_data(width, height, false, Image.FORMAT_RGBA8, bytes)
	if _image_texture == null or _image_texture.get_size() != Vector2(width, height):
		_image_texture = ImageTexture.create_from_image(image)
		_wear(_image_texture)
	else:
		_image_texture.update(image)


func _frame(on: int, buffer: int) -> void:
	if on != id:
		return
	(_external as ExternalTexture).set_external_buffer_id(buffer)
	if _paint.albedo_texture != _external:
		_wear(_external)


func _wear(texture: Texture2D) -> void:
	_paint.albedo_color = Color.WHITE
	_paint.albedo_texture = texture


func _saying(said: String) -> void:
	title = said
	_draw_bar()


## The bar: what the page is, at the left, and Back and Close at the right,
## standing just over the page.
func _draw_bar() -> void:
	if _bar != null:
		_bar.queue_free()
		_bar = null
	if not titled or not is_inside_tree():
		return
	_bar = Node3D.new()
	_bar.name = "Bar"
	_buttons = Page.new("", [{"rows": [Page.buttons([[BACK, go_back, false, "back"], [CLOSE, close, false, "close"]])]}], "", BUTTONS_WIDE)
	var tall: float = _buttons.get_meta("height")
	_buttons.position = Vector3(size.x - BUTTONS_WIDE, 0.0, 0.0)
	_bar.add_child(_buttons)
	var room := size.x - BUTTONS_WIDE - Page.GAP
	if pinnable and _window != null:
		var pinning := Page.new("", [{"rows": [Page.mark("pin-off" if is_pinned() else "pin", _toggle_pin)]}], "", Page.ROW)
		room -= Page.ROW + Page.GAP
		pinning.position = Vector3(room + Page.GAP, 0.0, 0.0)
		pinning.name = "Pin"
		_bar.add_child(pinning)
	var named := Pieces.words(Pieces.cut(title, room, Page.TITLE, Page.LETTER), room, Page.TITLE, Pieces.INK, Page.LETTER)
	named.autowrap_mode = TextServer.AUTOWRAP_OFF
	named.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	named.position = Vector3(0.0, -(tall + Page.GAP) * 0.5, 0.002)
	_bar.add_child(named)
	_bar.set_meta("tall", tall)
	_place_bar()
	add_child(_bar)
	_fit_window()


func _place_bar() -> void:
	if _bar != null:
		_bar.position = Vector3(-size.x / 2.0, size.y / 2.0 + BAR_GAP + float(_bar.get_meta("tall")), 0.0)


## The window's corners at the page's and over the bar's top.
func _fit_window() -> void:
	if _window == null:
		return
	var over := 0.0
	if _bar != null:
		var top := 0.0
		for row in _bar.get_children():
			top = maxf(top, row.position.y)
		over = _bar.position.y + top - size.y / 2.0
	_window.fit(size, over)


## The Back or Close button on the bar, by "back" or "close", or the pin by
## "pin"; null with no bar.
func bar_button(key: String) -> Node3D:
	if _bar == null or not is_instance_valid(_buttons):
		return null
	return _bar.get_node_or_null("Pin") if key == "pin" else _buttons.keyed.get(key)


## Where `pointer`'s ray meets the face, in the page's pixels; null where it misses.
func _pixel(pointer: Node3D) -> Variant:
	var ray: Array = pointer.ray()
	var inverse := _face.global_transform.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	if absf(along.z) < 1e-6:
		return null
	var t := -from.z / along.z
	if t <= 0.0:
		return null
	var meets := from + along * t
	if absf(meets.x) > size.x / 2.0 or absf(meets.y) > size.y / 2.0:
		return null
	return Vector2((meets.x / size.x + 0.5) * pixels.x, (0.5 - meets.y / size.y) * pixels.y)


func hit(pointer: Node3D) -> float:
	var own := _face_hit(pointer)
	return own if _window == null else _window.nearer(pointer, own)


func _face_hit(pointer: Node3D) -> float:
	if _pixel(pointer) == null:
		return INF
	var ray: Array = pointer.ray()
	var inverse := _face.global_transform.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	return (_face.global_transform * (from + along * (-from.z / along.z))).distance_to(ray[0])


func point(pointer: Node3D) -> void:
	if _window != null:
		if _window.takes(pointer):
			_window.point(pointer)
			return
		_window.unpoint(pointer)
	var at = _pixel(pointer)
	if at == null:
		return
	_at = at
	if _engine != null:
		if _pressed:
			_engine.touch(id, at.x, at.y, "move")
		return
	var moved := InputEventMouseMotion.new()
	moved.position = at
	moved.global_position = at
	moved.button_mask = MOUSE_BUTTON_MASK_LEFT if _pressed else 0
	_viewport.push_input(moved)


func unpoint(pointer: Node3D) -> void:
	if _window != null:
		_window.unpoint(pointer)
	_unpoint_face(pointer)


func _unpoint_face(_pointer: Node3D) -> void:
	if _engine != null:
		if _pressed:
			_engine.touch(id, _at.x, _at.y, "up")
			_pressed = false
		return
	var away := InputEventMouseMotion.new()
	away.position = Vector2(-10, -10)
	away.global_position = away.position
	_viewport.push_input(away)


func press(pointer: Node3D) -> void:
	if _window != null and _window.takes(pointer):
		_window.press(pointer)
		return
	_touch(pointer, true)


func holds(pointer: Node3D) -> bool:
	return _window != null and _window.holds(pointer)


func release(pointer: Node3D) -> void:
	if holds(pointer):
		_window.release(pointer)
		return
	_touch(pointer, false)


func scroll(pointer: Node3D, amount: float) -> bool:
	if _window != null and _window.takes(pointer):
		return _window.scroll(pointer, amount)
	if amount == 0.0:
		return true
	if _engine != null:
		_scroll_left += amount * SCROLL
		var whole := roundf(_scroll_left)
		if whole != 0.0:
			_scroll_left -= whole
			_engine.scroll(id, 0.0, whole)
		return true
	var wheel := InputEventMouseButton.new()
	wheel.button_index = MOUSE_BUTTON_WHEEL_DOWN if amount > 0.0 else MOUSE_BUTTON_WHEEL_UP
	wheel.factor = absf(amount) * SCROLL / 100.0
	wheel.position = _at
	wheel.global_position = _at
	wheel.pressed = true
	_viewport.push_input(wheel)
	return true


func take(pointer: Node3D) -> void:
	taken.emit(pointer)
	if carries_itself and pointer.hand != null:
		_carried_by = pointer
		_carry = pointer.hand.global_transform.affine_inverse() * global_transform
		if _window != null:
			_window.carry(true)


func let_go(pointer: Node3D) -> void:
	if pointer == _carried_by:
		_carried_by = null
		if _window != null:
			_window.carry(false)
	let_go_of.emit(pointer)


func _process(_delta: float) -> void:
	if _carried_by != null and is_instance_valid(_carried_by) and is_instance_valid(_carried_by.hand):
		global_transform = _carried_by.hand.global_transform * _carry


func _touch(pointer: Node3D, down: bool) -> void:
	var at = _pixel(pointer)
	if at == null:
		if not down and _pressed and _engine != null:
			_engine.touch(id, _at.x, _at.y, "up")
		_pressed = false
		return
	_at = at
	_pressed = down
	if _engine != null:
		_engine.touch(id, at.x, at.y, "down" if down else "up")
		return
	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.pressed = down
	click.position = at
	click.global_position = at
	_viewport.push_input(click)
