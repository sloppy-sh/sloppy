## The room panel's Skies page: the skies the night can be, each with its small
## picture, the saved ones first and the person's own under their headings, the
## published ones a page at a time, how dim a photographed one is drawn,
## saving it, and fetching it sharper — DESIGN.md § "The field in a room". Laid on
## a `Page` from its own top-left corner downward, `width` across.
extends Node3D

const Page := preload("res://ui/page.gd")
const Room := preload("res://room/room.gd")
const Skies := preload("res://room/skies.gd")

const TITLE := "Skies"
const NOW := "Now: %s"
const FINDING := "Finding skies…"
const NEED_THE_NETWORK := "The rest need the network."
const SAVED := "Saved"
const PUBLISHED := "Published"
const YOUR_SKIES := "Your skies"
const NONE_OF_YOUR_OWN := "Connect this headset to a computer and put a panorama in %s, and it is listed here."
const MORE := "More skies"
const PREVIOUS := "Previous skies"
const WHERE := "%d–%d of %d"
const SAVE := "Save"
const UNSAVE := "Unsave"
const DIM := "Dim"
const SHARPER := "Sharper"
const FETCHING := "%s  %d%%"

## The published skies one page carries.
const AT_ONCE := 4

var width := 0.18
## Chosen to turn the room panel back to its rows.
var back := Callable()

var _skies: Array = []
var _asking := false
var _from := 0
var _failed := ""
var _page: Node3D
## Each sky's row and the sky, by its key.
var _rows := {}


func _ready() -> void:
	set_meta("height", 0.0)
	var room := _room()
	if room != null:
		room.skies.progressed.connect(_progressed)
		room.changed.connect(func(_kind): _redraw())
	_redraw()
	_ask()


## Whether the slider has this hand's stick now, so the palette does not turn.
func holds_stick() -> bool:
	return _page != null and _page.holds_stick()


## The catalogue asked for again, as it is each time the page is turned to.
func refresh() -> void:
	_ask()


func _ask() -> void:
	var room := _room()
	if _asking or room == null:
		return
	_asking = true
	_skies = await room.skies.catalogue(room.saved)
	_asking = false
	if is_inside_tree():
		_redraw()


func _room() -> Node:
	return Room.of(get_tree()) if is_inside_tree() else null


func _redraw() -> void:
	if holds_stick() or not is_inside_tree():
		return
	if _page != null:
		_page.queue_free()
	_rows.clear()
	var room := _room()
	var shown: Skies.Choice = room.sky_shown() if room != null else Skies.night()
	var saved: Array = _skies.filter(func(sky): return sky.source == Skies.PUBLISHED and room != null and room.is_saved(sky.key))
	var published: Array = _skies.filter(func(sky): return sky.source == Skies.PUBLISHED and not saved.has(sky))
	var own: Array = _skies.filter(func(sky): return sky.source == Skies.OWN)
	var last := maxi(0, published.size() - 1)
	_from = clampi(_from, 0, last - last % AT_ONCE)
	var groups: Array = []
	if not saved.is_empty():
		groups.append({"heading": SAVED, "rows": saved.map(func(sky): return _sky_row(sky, shown))})
	var first: Array = [_sky_row(Skies.night(), shown, "sparkles")]
	if _from > 0:
		first.append(Page.choice(PREVIOUS, "chevron-up", _page_by.bind(-AT_ONCE)))
	for sky in published.slice(_from, _from + AT_ONCE):
		first.append(_sky_row(sky, shown))
	if _from + AT_ONCE < published.size():
		first.append(Page.choice(MORE, "chevron-down", _page_by.bind(AT_ONCE)))
	if published.size() > AT_ONCE:
		first.append(Page.words(WHERE % [_from + 1, mini(_from + AT_ONCE, published.size()), published.size()]))
	for said in [FINDING if _skies.is_empty() else "", NEED_THE_NETWORK if room != null and room.skies.offline else "", _failed]:
		if said != "":
			first.append(Page.words(said))
	var yours: Array = []
	for sky in own:
		yours.append(_sky_row(sky, shown, "image"))
	if own.is_empty():
		yours.append(Page.words(NONE_OF_YOUR_OWN % Skies.own_dir_said()))
	var drawn: Array = []
	if shown.source != Skies.NIGHT and room != null:
		drawn.append(Page.slider(DIM, "sun-dim", float(room.kept.dim), Vector2(0.0, 100.0), func(dim): return "%d%%" % roundi(dim), _dim))
	if shown.source == Skies.PUBLISHED and room != null:
		var keeping: bool = room.is_saved(shown.key)
		drawn.append(Page.choice(UNSAVE if keeping else SAVE, "bookmark-minus" if keeping else "bookmark", _save.bind(shown, not keeping)))
		if not Skies.is_sharper(shown):
			drawn.append(Page.choice(SHARPER, "zoom-in", _sharper.bind(shown)))
		drawn.append(Page.words(Skies.CREDIT % ", ".join(shown.authors)))
	drawn.append(Page.back(func(): if back.is_valid(): back.call()))
	groups.append_array([{"heading": PUBLISHED, "rows": first}, {"heading": YOUR_SKIES, "rows": yours}, {"rows": drawn}])
	_page = Page.new(TITLE, groups, NOW % shown.name, width)
	for key in _page.keyed:
		_rows[key][0] = _page.keyed[key]
	add_child(_page)
	set_meta("height", _page.get_meta("height"))


## A sky's row: its small picture where it has one, and its name, chosen while
## it is the sky drawn.
func _sky_row(sky: Skies.Choice, shown: Skies.Choice, glyph: Variant = "") -> Dictionary:
	if sky.thumbnail_url != "":
		glyph = _thumbnail.bind(sky)
	var fraction = _room().skies.fetching.get(sky.key) if _room() != null else null
	var named := sky.name if fraction == null else FETCHING % [sky.name, roundi(fraction * 100.0)]
	var row := Page.choice(named, glyph, _choose.bind(sky), sky.key == shown.key)
	row["key"] = sky.key
	_rows[sky.key] = [null, sky]
	return row


func _thumbnail(sky: Skies.Choice) -> Texture2D:
	var room := _room()
	return await room.skies.thumbnail(sky) if room != null else null


func _dim(dim: float) -> void:
	var room := _room()
	if room != null:
		room.dim_sky(dim)


func _choose(sky: Skies.Choice) -> void:
	var room := _room()
	if room == null:
		return
	_failed = ""
	if not Skies.on_headset(sky):
		_failed = await room.skies.fetch(sky)
	if _failed == "" and is_inside_tree():
		room.choose_sky(sky.key)
	_redraw()


func _sharper(sky: Skies.Choice) -> void:
	var room := _room()
	if room == null:
		return
	_failed = await room.skies.sharper(sky)
	if _failed == "" and is_inside_tree() and room.kept.sky == sky.key:
		room.choose_sky(sky.key)
	_redraw()


func _page_by(skies: int) -> void:
	_from = maxi(0, _from + skies)
	_redraw()


func _save(sky: Skies.Choice, on: bool) -> void:
	var room := _room()
	if room != null:
		room.save_sky(sky, on)
	_redraw()


func _progressed(key: String, _fraction: float) -> void:
	if _rows.has(key) and not holds_stick():
		var held: Array = _rows[key]
		if is_instance_valid(held[0]):
			var fraction: float = _room().skies.fetching.get(key, 1.0)
			Page.say(held[0], FETCHING % [held[1].name, roundi(fraction * 100.0)])
