## A note opened beside the hand, read a section at a time. A target for
## `interaction/pointer.gd`: the pointer works its buttons as a mouse would.
## Where the web view plugin is present a section is drawn by the page in web/
## (its README is the contract), and its links open notes here and the web in
## the room; elsewhere it reads as text.
extends Node3D

const Markdown := preload("res://ui/markdown_to_bbcode.gd")
const Room := preload("res://room/room.gd")
const Dressing := preload("res://ui/theme.gd")
const WebPanel := preload("res://ui/web_panel.gd")
const Browser := preload("res://ui/browser_panel.gd")

signal closed
## A hand's grip took hold of the page, and let it go.
signal taken(pointer: Node3D)
signal let_go_of(pointer: Node3D)
## A link in the note read before took the panel to the note `ref`.
signal followed(ref: String)

const READING := "Reading…"
const NOTHING := "Nothing is written in this note yet."
const PULLED := "Pulled from another graph"
const MORE := "%d more sections are not shown here."
const OF := "%d of %d"
const AND_MORE := "%s and %d more"
## What a surface calls somebody nobody here can put a name to, as the desk does.
const SOMEBODY := "Somebody"
## Pixels the body moves for a second of the stick leaned all the way.
const SCROLL := 900.0
## The page a section is drawn by, built by tools/build-web.sh.
const PAGE := "res://web/dist/index.html"
## Where the page says it stands: in the app's own files, so it is heard.
const PAGE_BASE := "file:///android_asset/web/dist/index.html"
## A view's pixels to one of the page's, as the plugin draws a page.
const PAGE_DENSITY := 1.5
## In metres, in front of the sheet.
const PAGE_LIFT := 0.002
const ON_THE_WEB := ["http", "https"]

static var _pictured := RegEx.create_from_string("!\\[[^\\]]*\\]\\(\\s*<?([^)\\s>]+)")

## The notes of the view in front, by ref, as listed: what a link by address
## or by ref opens.
var notes: Dictionary = {}
## Whether the note `ref` was pulled from another graph.
var pulled_of: Callable = func(_ref: String) -> bool: return false

var _project := ""
var _ref := ""
## Each page: `{markdown}` carried, or `{heading}` still to be read by it.
var _pages: Array[Dictionary] = []
var _at := 0
var _more := 0
## What each note a citation may name is called, by ref.
var _named := {}
var _pressed := false
var _ink := Color.BLACK
var _paper := Color.WHITE
## The page, where the plugin is present; null before the body has a size.
var _web: Node3D
var _paged := false
var _page_ready := false
## What the page was last asked to draw; {} while the body says something else.
var _asked := {}
## How tall the drawn section is, in the page's own pixels.
var _tall := 0.0
## A data URI for each picture this note's writing shows, by its path.
var _pictures := {}
var _on_page := false
var _pressing_page := false
## Whose writing the note carries, as last asked of the desk.
var _writers: Array = []

@onready var _page: SubViewport = $Page
@onready var _face: MeshInstance3D = $Face
@onready var _title: Label = $Page/Sheet/Margin/Column/Head/Title
@onready var _about: Label = $Page/Sheet/Margin/Column/About
@onready var _disc: PanelContainer = $Page/Sheet/Margin/Column/Authors/Disc
@onready var _letter: Label = $Page/Sheet/Margin/Column/Authors/Disc/Letter
@onready var _portrait: TextureRect = $Page/Sheet/Margin/Column/Authors/Face
@onready var _author: Label = $Page/Sheet/Margin/Column/Authors/Name
@onready var _body: RichTextLabel = $Page/Sheet/Margin/Column/Body
@onready var _where: Label = $Page/Sheet/Margin/Column/Foot/Where
@onready var _before: Button = $Page/Sheet/Margin/Column/Foot/Before
@onready var _next: Button = $Page/Sheet/Margin/Column/Foot/Next


func _ready() -> void:
	var face := StandardMaterial3D.new()
	face.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	face.albedo_texture = _page.get_texture()
	face.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	face.cull_mode = BaseMaterial3D.CULL_DISABLED
	_face.material_override = face
	$Page/Sheet/Margin/Column/Head/Close.pressed.connect(close)
	_before.pressed.connect(func(): _turn(-1))
	_next.pressed.connect(func(): _turn(1))
	_dress_disc()
	_paged = WebPanel.engine() != null and FileAccess.file_exists(PAGE)
	if _paged:
		_body.resized.connect(_fit_page)
		_fit_page.call_deferred()


## Dress the page in the theme pack this headset chose, or else in the field's
## ink and paper and the faces the room reads in.
func dress(ink: Color, paper: Color) -> void:
	_ink = ink
	_paper = paper
	$Page/Sheet.theme = Dressing.pack(Room.panels(), Room.look(), ink, paper)
	_dress_disc()
	if not _asked.is_empty():
		_asked.look = _look()
		_render()


## Read the note `ref` of `project`, `listed` being what the listing said of it
## and `named` what each note in the field is called, by ref.
func open(project: String, ref: String, listed: Dictionary, pulled: bool, named: Dictionary = {}) -> void:
	_project = project
	_ref = ref
	_named = named
	_pictures = {}
	_title.text = named(listed)
	_about.text = _carried(listed.get("tags", []), pulled)
	_name_authors(_authors_of(ref, listed))
	_saying(READING)
	_where.text = ""
	_before.disabled = true
	_next.disabled = true
	var read := await Client.call_act(project, "read_note", {"note": ref})
	if not is_inside_tree() or ref != _ref:
		return
	if read.has("error") or read.has("said"):
		_saying(str(read.get("error", read.get("said", ""))))
		return
	_title.text = named(read)
	if read.has("authors") and _authors_of(ref, read) != _writers:
		_name_authors(_authors_of(ref, read))
	_pages.clear()
	for section in read.get("sections", []):
		_pages.append({"markdown": str(section.get("markdown", ""))})
	for outlined in read.get("outline", []):
		_pages.append({"heading": str(outlined.get("heading", ""))})
	_more = int(read.get("more", 0))
	_at = 0
	_show()


func close() -> void:
	closed.emit()
	queue_free()


## What a note is called where it is shown: its address, then its title.
static func named(note: Dictionary) -> String:
	var title := str(note.get("title", "")).strip_edges()
	var address := str(note.get("address", ""))
	if address != "" and title != "":
		return "%s  %s" % [address, title]
	return title if title != "" else address


## Whose writing `note` carries: its `authors`, or where it names none, whoever
## the ref says wrote it.
static func _authors_of(ref: String, note: Dictionary) -> Array:
	var authors = note.get("authors")
	if authors is Array and not authors.is_empty():
		return authors.map(func(one): return str(one))
	return [ref.substr(0, ref.rfind("/"))]


## Asks the desk who wrote the note, one author at a time until one is named,
## and draws the first named with how many others wrote beside them.
func _name_authors(authors: Array) -> void:
	_writers = authors
	_draw_author("", null)
	var ref := _ref
	var first_said := ""
	for principal in authors:
		var who: Dictionary = await Client.author(_project, principal)
		if not is_inside_tree() or ref != _ref or _writers != authors:
			return
		var called := str(who.get("name", who.get("handle", ""))).strip_edges()
		if who.has("error") or called == "":
			if first_said == "":
				first_said = str(who.get("error", SOMEBODY))
			continue
		var more := authors.size() - 1
		_draw_author(AND_MORE % [called, more] if more > 0 else called, _face_of(who.get("picture")), called)
		return
	var others := authors.size() - 1
	_draw_author(AND_MORE % [first_said, others] if first_said == SOMEBODY and others > 0 else first_said, null)


## The author line: `said` beside `face`, or beside the plain disc carrying the
## first letter of `called`.
func _draw_author(said: String, face: Texture2D, called := "") -> void:
	_author.text = said
	_portrait.texture = face
	_portrait.visible = face != null
	_disc.visible = face == null
	_letter.text = called.left(1).to_upper()


static func _face_of(picture: Variant) -> Texture2D:
	if not picture is String:
		return null
	var image := Image.new()
	if image.load_png_from_buffer(Marshalls.base64_to_raw(picture)) != OK:
		return null
	return ImageTexture.create_from_image(rounded(image))


## `image` cut to the circle inside its middle square, its edge softened by a pixel.
static func rounded(image: Image) -> Image:
	var side := mini(image.get_width(), image.get_height())
	var square := image.get_region(Rect2i((image.get_width() - side) >> 1, (image.get_height() - side) >> 1, side, side))
	square.convert(Image.FORMAT_RGBA8)
	var middle := side / 2.0
	for y in side:
		for x in side:
			var outside := Vector2(x + 0.5, y + 0.5).distance_to(Vector2(middle, middle)) - middle
			if outside > -1.0:
				var pixel := square.get_pixel(x, y)
				pixel.a *= clampf(-outside, 0.0, 1.0)
				square.set_pixel(x, y, pixel)
	return square


## The plain disc is the sheet's own words, faintly.
func _dress_disc() -> void:
	var disc := StyleBoxFlat.new()
	disc.bg_color = _author.get_theme_color("font_color")
	disc.bg_color.a = 0.16
	disc.set_corner_radius_all(int(_disc.custom_minimum_size.x / 2.0))
	disc.anti_aliasing = true
	_disc.add_theme_stylebox_override("panel", disc)


static func _carried(tags: Array, pulled: bool) -> String:
	var said: Array[String] = []
	if pulled:
		said.append(PULLED)
	if not tags.is_empty():
		said.append(" · ".join(PackedStringArray(tags)))
	return "\n".join(said)


func _turn(by: int) -> void:
	_at = clampi(_at + by, 0, maxi(_pages.size() - 1, 0))
	_show()


func _show() -> void:
	_before.disabled = _at == 0
	_next.disabled = _at >= _pages.size() - 1
	_where.text = OF % [_at + 1, _pages.size()] if _pages.size() > 1 else ""
	if _pages.is_empty():
		_saying(NOTHING)
		return
	var page := _pages[_at]
	if page.has("heading"):
		_saying(READING)
		var at := _at
		var ref := _ref
		var read := await Client.call_act(_project, "read_note", {"note": _ref, "sections": [page.heading]})
		if not is_inside_tree() or ref != _ref:
			return
		var sections: Array = read.get("sections", [])
		if sections.is_empty():
			_saying(str(read.get("error", NOTHING)))
			return
		_pages[at] = {"markdown": str(sections[0].get("markdown", ""))}
		if at != _at:
			return
		page = _pages[at]
	if _paged:
		var markdown: String = page.markdown
		if _at == _pages.size() - 1 and _more > 0:
			markdown += "\n\n*" + MORE % _more + "*"
		_draw_page(markdown)
		return
	var text: String = Markdown.to_bbcode(page.markdown, _named)
	if _at == _pages.size() - 1 and _more > 0:
		text += "\n\n[i]" + MORE % _more + "[/i]"
	_body.text = text
	_body.scroll_to_line(0)


## The body says `said` in words, and the page stands aside.
func _saying(said: String) -> void:
	_body.text = Markdown.escape(said)
	_asked = {}
	if _web != null:
		_web.visible = false


func _draw_page(markdown: String) -> void:
	_body.text = ""
	_tall = 0.0
	_asked = {"markdown": markdown, "look": _look(), "named": _named, "pictures": _pictures}
	if _web != null:
		_web.visible = true
	_render(true)
	_fetch_pictures(markdown)


## `from_the_top` for a section newly shown, rather than the same one again.
func _render(from_the_top := false) -> void:
	if _web != null and _page_ready and not _asked.is_empty():
		var js := "sloppy.render(%s)" % JSON.stringify(_asked)
		_web.evaluate("window.scrollTo(0, 0); " + js if from_the_top else js)


func _look() -> Dictionary:
	var look := Room.look()
	return {
		"ink": "#" + _ink.to_html(false),
		"paper": "#" + _paper.to_html(false),
		"card": "#" + Room.card().to_html(false),
		"edge": "#" + Room.edge().to_html(false),
		"faces": look.get("fonts", {}),
		"density": look.get("density", ""),
	}


## Asks the desk for each picture `markdown` shows that is not held yet, and
## draws the section again with them once they are all in.
func _fetch_pictures(markdown: String) -> void:
	var ref := _ref
	var fetched := false
	for found in _pictured.search_all(markdown):
		var path := found.get_string(1)
		if _pictures.has(path) or path.contains("://") or path.begins_with("data:"):
			continue
		var shown: Dictionary = await Client.asset(_project, ref, path)
		if not is_inside_tree() or ref != _ref:
			return
		if shown.has("bytes") and shown.has("mime"):
			_pictures[path] = "data:%s;base64,%s" % [shown.mime, shown.bytes]
			fetched = true
	if fetched and _asked.get("markdown") == markdown:
		_asked.pictures = _pictures
		_render()


## The page stands over the body at the body's size, made again only when that
## size changes.
func _fit_page() -> void:
	var rect := _body.get_global_rect()
	var pixels := Vector2i(rect.size.round())
	if pixels.x <= 0 or pixels.y <= 0:
		return
	var face: Vector2 = (_face.mesh as QuadMesh).size
	var page := Vector2(_page.size)
	var middle := rect.get_center()
	var at := Vector3((middle.x / page.x - 0.5) * face.x, (0.5 - middle.y / page.y) * face.y, PAGE_LIFT)
	if _web != null and _web.pixels == pixels:
		_web.position = at
		return
	if _web != null:
		remove_child(_web)
		_web.queue_free()
	_page_ready = false
	_web = WebPanel.new()
	_web.name = "Reading"
	_web.titled = false
	_web.pixels = pixels
	_web.size = rect.size / page * face
	_web.allows = func(_url: String) -> bool: return false
	_web.position = at
	_web.visible = not _asked.is_empty()
	add_child(_web)
	_web.message.connect(_heard)
	_web.open_html(FileAccess.get_file_as_string(PAGE), PAGE_BASE)


func _heard(said: Variant) -> void:
	if not said is Dictionary:
		return
	match str(said.get("kind", "")):
		"ready":
			_page_ready = true
			_render()
		"height":
			_tall = float(said.get("px", 0.0))
		"link":
			_follow(said)


## A link the reader chose on the page: a note opens here, a page on the web
## opens in the room, and anything else stays where it is.
func _follow(link: Dictionary) -> void:
	var ref := str(link.get("note", ""))
	var address := str(link.get("address", ""))
	if ref == "" and address != "":
		ref = _at_address(address)
	if ref != "":
		open(_project, ref, notes.get(ref, {}), pulled_of.call(ref), _named)
		followed.emit(ref)
		return
	var href := str(link.get("href", "")).strip_edges()
	if address == "" and href.contains("://") and ON_THE_WEB.has(href.get_slice(":", 0).to_lower()):
		Browser.show_page(self, href)


func _at_address(address: String) -> String:
	for ref in notes:
		if str(notes[ref].get("address", "")) == address:
			return ref
	return ""


## Whether `pointer` is on the drawn page rather than the sheet round it.
func _over_page(pointer: Node3D) -> bool:
	return _web != null and _web.visible and _web.hit(pointer) < INF


## Where `pointer`'s ray meets the page, in its pixels; null where it misses.
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
	var size: Vector2 = (_face.mesh as QuadMesh).size
	if absf(meets.x) > size.x / 2.0 or absf(meets.y) > size.y / 2.0:
		return null
	return Vector2((meets.x / size.x + 0.5) * _page.size.x, (0.5 - meets.y / size.y) * _page.size.y)


func hit(pointer: Node3D) -> float:
	var at = _pixel(pointer)
	if at == null:
		return INF
	var ray: Array = pointer.ray()
	var inverse := _face.global_transform.affine_inverse()
	var from: Vector3 = inverse * ray[0]
	var along: Vector3 = inverse.basis * ray[1]
	return (_face.global_transform * (from + along * (-from.z / along.z))).distance_to(ray[0])


func point(pointer: Node3D) -> void:
	var on_page := _over_page(pointer)
	if on_page != _on_page:
		if _on_page:
			_web.unpoint(pointer)
		else:
			_unpoint_sheet()
		_on_page = on_page
	if on_page:
		_web.point(pointer)
		return
	var at = _pixel(pointer)
	if at == null:
		return
	var moved := InputEventMouseMotion.new()
	moved.position = at
	moved.global_position = at
	moved.button_mask = MOUSE_BUTTON_MASK_LEFT if _pressed else 0
	_page.push_input(moved)


func unpoint(pointer: Node3D) -> void:
	if _web != null:
		_web.unpoint(pointer)
	_on_page = false
	_pressing_page = false
	_unpoint_sheet()


func _unpoint_sheet() -> void:
	var away := InputEventMouseMotion.new()
	away.position = Vector2(-10, -10)
	away.global_position = away.position
	_page.push_input(away)


func press(pointer: Node3D) -> void:
	if _over_page(pointer):
		_pressing_page = true
		_web.press(pointer)
		return
	_click(pointer, true)


func release(pointer: Node3D) -> void:
	if _pressing_page:
		_pressing_page = false
		if _web != null:
			_web.release(pointer)
		return
	_click(pointer, false)


func take(pointer: Node3D) -> void:
	taken.emit(pointer)


func let_go(pointer: Node3D) -> void:
	let_go_of.emit(pointer)


## On the drawn page the stick is the page's only while more of it is below
## than the panel shows.
func scroll(pointer: Node3D, amount: float) -> bool:
	if not _asked.is_empty() and _web != null:
		if _tall * PAGE_DENSITY <= float(_web.pixels.y):
			return false
		return _web.scroll(pointer, amount)
	_body.get_v_scroll_bar().value += amount * SCROLL
	return true


func _click(pointer: Node3D, down: bool) -> void:
	var at = _pixel(pointer)
	if at == null:
		return
	_pressed = down
	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.pressed = down
	click.position = at
	click.global_position = at
	_page.push_input(click)
