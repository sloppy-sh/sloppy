## What the headset draws in: the look the desk is wearing (`look/read`), or
## what this headset chose over it, as colours, faces and spacing — and those
## colours worked out again for a room that is not the look's own paper.
## DESIGN.md § "The field in a room"; `room/room.gd` wears what this answers.
extends RefCounted

const Palette := preload("res://field/palette.gd")

## Sloppy's own five looks as `packages/ts/ui/src/lib/app.css` paints them, in
## OKLCH: `paper` is `--background`, `ink` `--foreground`, `edge` `--border`,
## `pointed` `--secondary`, and `facet` the lightness of its eight hue slots.
const OWN := {
	"paper": {"name": "Paper", "paper": [0.972, 0.006, 85.0], "ink": [0.26, 0.015, 70.0], "card": [0.987, 0.005, 85.0], "edge": [0.895, 0.008, 85.0], "pointed": [0.937, 0.01, 82.0], "facet": 0.61},
	"graphite": {"name": "Graphite", "paper": [0.215, 0.008, 260.0], "ink": [0.905, 0.006, 250.0], "card": [0.23, 0.008, 260.0], "edge": [0.31, 0.009, 260.0], "pointed": [0.275, 0.008, 260.0], "facet": 0.54},
	"light": {"name": "Light", "paper": [1.0, 0.0, 0.0], "ink": [0.145, 0.0, 0.0], "card": [1.0, 0.0, 0.0], "edge": [0.918, 0.0, 0.0], "pointed": [0.965, 0.0, 0.0], "facet": 0.61},
	"dark": {"name": "Dark", "paper": [0.145, 0.0, 0.0], "ink": [0.985, 0.0, 0.0], "card": [0.16, 0.0, 0.0], "edge": [0.3, 0.0, 0.0], "pointed": [0.26, 0.0, 0.0], "facet": 0.54},
	"contrast": {"name": "High contrast", "paper": [0.99, 0.0, 0.0], "ink": [0.13, 0.0, 0.0], "card": [1.0, 0.0, 0.0], "edge": [0.72, 0.0, 0.0], "pointed": [0.94, 0.0, 0.0], "facet": 0.61},
}
## In the order Settings offers them.
const OWN_LOOKS := ["paper", "graphite", "light", "dark", "contrast"]
## What a headset draws in with nothing from a desk and nothing chosen here.
const FIRST_LOOK := "paper"
## The ground of a room that is not the look's own paper.
const GROUND := "dark"
## The hue slots' chroma, slot 1's hue, and the turn to each next, in degrees.
const FACET_CHROMA := 0.13
const FIRST_HUE := 25.0
const HUE_TURN := 45.0
## Ink on a ground that is not its own look's paper owes this against it.
const INK_FLOOR := 7.0

## Which drawn colour each of a palette's tokens paints; the graph's own two
## ends are read after the page's, so they win where a look names both.
const TOKENS := [
	["--background", "paper"], ["--foreground", "ink"], ["--card", "card"],
	["--border", "edge"], ["--secondary", "pointed"],
	["--graph-paper", "paper"], ["--graph-ink", "ink"],
]

## The faces the headset carries, by the name a desk gives them, under `res://fonts/`.
const FACE_FILES := {
	"inter": "inter", "atkinson": "atkinson-hyperlegible", "opendyslexic": "opendyslexic",
	"firacode": "fira-code", "cascadiacode": "cascadia-code", "victormono": "victor-mono",
	"iosevka": "iosevka",
}
## What a role reads in where it names no face the headset carries.
const ROLE_FILES := {"ui": "inter", "heading": "inter", "mono": "jetbrains-mono"}
## The device's own face, which the headset asks the system for.
const DEVICE_FACE := "apple"
## The faces Settings offers to read in, and what each is called.
const READING_FACES := ["inter", "atkinson", "opendyslexic"]
const FACE_NAMES := {"inter": "Inter", "atkinson": "Atkinson Hyperlegible", "opendyslexic": "OpenDyslexic"}

const DENSITIES := ["comfortable", "compact"]
const DENSITY_NAMES := {"comfortable": "Comfortable", "compact": "Compact"}
## How much of the room between things a density keeps.
const CLOSENESS := {"comfortable": 1.0, "compact": 0.6}
## How heavy a style draws the edge of a card, as times a hairline.
const EDGE_WEIGHTS := {"hardline": 2.0, "bevel": 2.0, "pixel": 2.0}

## What this headset keeps having chosen nothing: follow the desk, override nothing.
const NOTHING_CHOSEN := {"follow": true, "look": "", "face": "", "density": ""}
## Where the desk's collection of looks (`look/list`) is kept once a desk has said it.
const COLLECTION := "user://looks.json"

## The kept collection by id, read from COLLECTION the first time it is asked for.
static var _listed = null


## Every look a desk said it could wear, as `look/list` answers it, in its
## order; empty before one has.
static func collection() -> Array:
	return _by_id().values()


## The look `id` of the kept collection; {} where it holds none.
static func listed(id: String) -> Dictionary:
	return _by_id().get(id, {})


## Keep `looks` (as `look/list` answers them) as the collection.
static func keep_collection(looks: Array) -> void:
	var file := FileAccess.open(COLLECTION, FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify({"looks": looks}))
	_listed = _indexed(looks)


static func _by_id() -> Dictionary:
	if _listed == null:
		var read = JSON.parse_string(FileAccess.get_file_as_string(COLLECTION)) if FileAccess.file_exists(COLLECTION) else null
		_listed = _indexed(read.get("looks", []) if read is Dictionary and read.get("looks") is Array else [])
	return _listed


static func _indexed(looks: Array) -> Dictionary:
	var held := {}
	for look in looks:
		if look is Dictionary and look.get("id") is String and look.get("name") is String and look.get("palette") is Dictionary:
			held[look.id] = look
	return held


## What is drawn, from what the desk serves (`{}` where it serves none) and
## what this headset `kept`. Each of the look, the face and the density is the
## headset's where it chose one — one of Sloppy's own, or one of the kept
## collection, painted with its palette over the own look its ground runs
## like; otherwise the desk's while following it, and Sloppy's own first
## choice where not.
static func chosen(served: Dictionary, kept: Dictionary) -> Dictionary:
	var desk: Dictionary = served if kept.get("follow", true) else {}
	var own := str(kept.get("look", ""))
	var look := {}
	var scheme := listed(own) if own != "" else {}
	if OWN.has(own):
		look = {"name": OWN[own].name, "based_on": own}
	elif not scheme.is_empty():
		look = {"name": scheme.name, "based_on": "dark" if scheme.get("variant") == "dark" else "light", "palette": scheme.palette}
	elif desk.get("name") is String:
		look = {"name": desk.name}
		if desk.get("based_on") is String:
			look["based_on"] = desk.based_on
		if desk.get("palette") is Dictionary:
			look["palette"] = desk.palette
	else:
		look = {"name": OWN[FIRST_LOOK].name, "based_on": FIRST_LOOK}
	var fonts: Dictionary = desk.get("fonts") if desk.get("fonts") is Dictionary else {}
	var ui := str(fonts.get("ui", "system"))
	var heading := str(fonts.get("heading", "system"))
	var face := str(kept.get("face", ""))
	if face != "":
		ui = face
		heading = face
	elif heading == "system":
		heading = ui
	look["fonts"] = {"ui": ui, "heading": heading, "mono": str(fonts.get("mono", "system"))}
	var density := str(kept.get("density", ""))
	if not CLOSENESS.has(density):
		density = str(desk.get("density", ""))
	look["density"] = density if CLOSENESS.has(density) else DENSITIES[0]
	look["style"] = str(desk.get("style", "default"))
	return look


## The colours `look` (as `chosen` answers it) paints, in OKLCH: `paper`,
## `ink`, `card`, `edge`, `pointed`, and `facets`, the eight slots in order. A
## token this cannot read leaves the colour under it.
static func colours(look: Dictionary) -> Dictionary:
	var under: Dictionary = OWN.get(str(look.get("based_on", "")), OWN[FIRST_LOOK])
	var drawn := {
		"paper": under.paper, "ink": under.ink, "card": under.card,
		"edge": under.edge, "pointed": under.pointed, "facets": facets_at(under.facet),
	}
	var paint = look.get("palette")
	if not paint is Dictionary:
		return drawn
	for token in TOKENS:
		var read := parse(paint.get(token[0], ""))
		if not read.is_empty():
			drawn[token[1]] = read
	for slot in Palette.SLOTS:
		var read := parse(paint.get("--facet-%d" % (slot + 1), ""))
		if not read.is_empty():
			drawn.facets[slot] = read
	return drawn


## Sloppy's own eight slots at `lightness`, in order.
static func facets_at(lightness: float) -> Array:
	var held := []
	for slot in Palette.SLOTS:
		held.append([lightness, FACET_CHROMA, FIRST_HUE + HUE_TURN * slot])
	return held


## `drawn` (as `colours` answers it) for a room that is not its own paper: the
## Dark look's ground and cards, the look's ink or its paper, whichever stands
## further from that ground, lightened until it clears INK_FLOOR on it, and the
## look's own hues, which `Palette` holds to its mark floor there.
static func on_ground(drawn: Dictionary) -> Dictionary:
	var ground: Dictionary = OWN[GROUND]
	var ink: Array = drawn.ink
	if Palette.contrast(drawn.paper, ground.paper) > Palette.contrast(ink, ground.paper):
		ink = drawn.paper
	return {
		"paper": ground.paper,
		"ink": Palette.shade_to_floor(ink, ground.paper, 1.0, INK_FLOOR),
		"card": ground.card, "edge": ground.edge, "pointed": ground.pointed,
		"facets": drawn.facets,
	}


## A colour as CSS writes it, in OKLCH; [] where it is not `#rgb`, `#rrggbb`
## (an alpha after either ignored) or `oklch(l c h)`.
static func parse(text: Variant) -> Array:
	if not text is String:
		return []
	var said := (text as String).strip_edges().to_lower()
	var hex := RegEx.create_from_string("^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$").search(said)
	if hex != null:
		var digits := hex.get_string(1)
		if digits.length() == 4 or digits.length() == 8:
			digits = digits.left(digits.length() * 3 / 4)
		return Palette.from_color(Color.html(digits))
	var lch := RegEx.create_from_string("^oklch\\(\\s*([0-9.]+)(%?)\\s+([0-9.]+)\\s+([0-9.]+)(?:deg)?\\s*(?:/[^)]*)?\\)$").search(said)
	if lch == null:
		return []
	var lightness := lch.get_string(1).to_float() / (100.0 if lch.get_string(2) == "%" else 1.0)
	return [clampf(lightness, 0.0, 1.0), lch.get_string(3).to_float(), fmod(lch.get_string(4).to_float(), 360.0)]


## The file a role reads `face` from; "" for the device's own.
static func face_file(role: String, face: String) -> String:
	if face == DEVICE_FACE:
		return ""
	return "res://fonts/%s.woff2" % FACE_FILES.get(face, ROLE_FILES.get(role, ROLE_FILES.ui))
