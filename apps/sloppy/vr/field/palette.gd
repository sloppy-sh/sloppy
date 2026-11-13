## The colours a mark is drawn in, by the canvas's rules — DESIGN.md § "The
## graph's colour language": hue is the eight sets the field's notes carry most,
## lightness is depth, and both are measured against the paper they land on.
## The tokens are the Paper look's (`app.css`) unless a look is given; the room
## gives the one it is dressed in (`room/room.gd`, `look/look.gd`).
extends RefCounted

## `TAG_HUE_SLOTS` in `@sloppy/types`: the most sets in front of the reader.
const SLOTS := 8
## `MARK_FLOOR`: a fill carrying meaning alone owes this against the paper.
const MARK_FLOOR := 3.0
## `DEPTH_STEPS` and `DEPTH_SEPARATION` in `palette.ts`.
const DEPTH_STEPS := 6
const DEPTH_SEPARATION := 0.03
## What a receded mark or line keeps of itself: a note outside the lit set, a
## dense field's quiet hand link.
const DIM := 0.15

## OKLCH, `[l, c, h]`, h in degrees.
const INK := [0.26, 0.015, 70.0]
const PAPER := [0.972, 0.006, 85.0]
const FACETS := [
	[0.61, 0.13, 25.0], [0.61, 0.13, 70.0], [0.61, 0.13, 115.0], [0.61, 0.13, 160.0],
	[0.61, 0.13, 205.0], [0.61, 0.13, 250.0], [0.61, 0.13, 295.0], [0.61, 0.13, 340.0],
]

var ink: Color
var paper: Color
## How many generations the ramp keeps apart; a deeper note draws the last.
var generations: int

var _ramp: Array[Color] = []
var _slots: Array[Color] = []


## A look's ink, paper and eight facets in OKLCH, the facets in slot order.
func _init(ink_lch: Array = INK, paper_lch: Array = PAPER, facets: Array = FACETS) -> void:
	ink = to_color(ink_lch)
	paper = to_color(paper_lch)
	var faintest := raise_to_floor(paper_lch, paper_lch, ink_lch, MARK_FLOOR)
	var steps := clampi(int(floor(apart(ink_lch, faintest) / DEPTH_SEPARATION)), 1, DEPTH_STEPS)
	for step in steps + 1:
		_ramp.append(to_color(raise_to_floor(mix_oklab(ink_lch, faintest, float(step) / steps), paper_lch, ink_lch, MARK_FLOOR)))
	generations = steps + 1
	var away := 0.0 if ink_lch[0] < paper_lch[0] else 1.0
	for facet in facets.slice(0, SLOTS):
		_slots.append(to_color(shade_to_floor(into_gamut(facet), paper_lch, away, MARK_FLOOR)))


## The fill of a note `depth` deep that is in none of the drawn sets; a branch is 1.
func depth(at: int) -> Color:
	return _ramp[clampi(at - 1, 0, _ramp.size() - 1)]


## The colour slot `slot` (1 to 8) draws in.
func slot(at: int) -> Color:
	return _slots[clampi(at - 1, 0, SLOTS - 1)]


## `drawnSetsOf` with nothing selected: the tags `notes` carry, the most carried
## first and then by name, at most eight. A note repeating a tag counts once.
static func drawn_sets(notes: Array) -> Array[String]:
	var carried := {}
	for note in notes:
		var held := {}
		for tag in note.get("tags", []):
			if tag is String and not held.has(tag):
				held[tag] = true
				carried[tag] = carried.get(tag, 0) + 1
	var ranked: Array = carried.keys()
	ranked.sort_custom(func(a, b): return carried[a] > carried[b] or (carried[a] == carried[b] and a < b))
	var drawn: Array[String] = []
	for tag in ranked.slice(0, SLOTS):
		drawn.append(tag)
	return drawn


## The slots, 1 to 8, of the drawn sets `tags` carries, in the order the rail
## lists them — the band each wears, top to bottom.
static func bands(tags: Array, drawn: Array[String]) -> Array[int]:
	var worn: Array[int] = []
	for at in drawn.size():
		if tags.has(drawn[at]):
			worn.append(at + 1)
	return worn


static func to_color(lch: Array) -> Color:
	var rgb := _to_srgb8(lch)
	return Color8(rgb[0], rgb[1], rgb[2])


## A colour a display is handed, as OKLCH.
static func from_color(colour: Color) -> Array:
	var linear := []
	for v in [colour.r, colour.g, colour.b]:
		linear.append(v / 12.92 if v <= 0.04045 else pow((v + 0.055) / 1.055, 2.4))
	var l := pow(0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2], 1.0 / 3.0)
	var m := pow(0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2], 1.0 / 3.0)
	var s := pow(0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2], 1.0 / 3.0)
	return _from_oklab([
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	])


## How far apart two colours look, as a distance in OKLab.
static func apart(one: Array, two: Array) -> float:
	var p := _to_oklab(one)
	var q := _to_oklab(two)
	return Vector3(p[0] - q[0], p[1] - q[1], p[2] - q[2]).length()


## WCAG 2.2 contrast ratio, on the bytes a display is handed.
static func contrast(one: Array, two: Array) -> float:
	var a := _luminance(_to_srgb8(one))
	var b := _luminance(_to_srgb8(two))
	return (maxf(a, b) + 0.05) / (minf(a, b) + 0.05)


static func mix_oklab(from: Array, to: Array, t: float) -> Array:
	var a := _to_oklab(from)
	var b := _to_oklab(to)
	var k := clampf(t, 0.0, 1.0)
	return _from_oklab([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k])


## `color` pulled back toward `anchor` until it clears `floor` against `ground`.
static func raise_to_floor(color: Array, ground: Array, anchor: Array, floor_at: float) -> Array:
	if contrast(color, ground) >= floor_at:
		return color
	if contrast(anchor, ground) < floor_at:
		return anchor
	var lo := 0.0
	var hi := 1.0
	for _i in 12:
		var mid := (lo + hi) / 2.0
		if contrast(mix_oklab(anchor, color, mid), ground) >= floor_at:
			lo = mid
		else:
			hi = mid
	return mix_oklab(anchor, color, lo)


## `color` moved in lightness alone toward `l` until it clears `floor`: the hue
## is the meaning, so it is the one thing never moved.
static func shade_to_floor(color: Array, ground: Array, l: float, floor_at: float) -> Array:
	if contrast(color, ground) >= floor_at:
		return color
	var lo := 0.0
	var hi := 1.0
	for _i in 14:
		var mid := (lo + hi) / 2.0
		if contrast(into_gamut([color[0] + (l - color[0]) * mid, color[1], color[2]]), ground) >= floor_at:
			hi = mid
		else:
			lo = mid
	return into_gamut([color[0] + (l - color[0]) * hi, color[1], color[2]])


## The nearest showable colour on the same hue and lightness, giving up chroma.
static func into_gamut(color: Array) -> Array:
	if _in_gamut(color):
		return color
	var lo := 0.0
	var hi: float = color[1]
	for _i in 16:
		var mid := (lo + hi) / 2.0
		if _in_gamut([color[0], mid, color[2]]):
			lo = mid
		else:
			hi = mid
	return [color[0], lo, color[2]]


static func _in_gamut(color: Array) -> bool:
	for v in _to_linear_srgb(color):
		if v < -1e-4 or v > 1.0 + 1e-4:
			return false
	return true


static func _to_oklab(lch: Array) -> Array:
	var rad := deg_to_rad(lch[2])
	return [lch[0], lch[1] * cos(rad), lch[1] * sin(rad)]


static func _from_oklab(lab: Array) -> Array:
	var h := rad_to_deg(atan2(lab[2], lab[1]))
	return [lab[0], Vector2(lab[1], lab[2]).length(), h + 360.0 if h < 0.0 else h]


static func _to_linear_srgb(lch: Array) -> Array:
	var lab := _to_oklab(lch)
	var l3 := pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3)
	var m3 := pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3)
	var s3 := pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3)
	return [
		4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
		-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
		-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
	]


static func _to_srgb8(lch: Array) -> Array[int]:
	var bytes: Array[int] = []
	for v in _to_linear_srgb(lch):
		var g: float = 12.92 * v if v <= 0.0031308 else 1.055 * pow(v, 1.0 / 2.4) - 0.055
		bytes.append(int(round(clampf(g, 0.0, 1.0) * 255.0)))
	return bytes


static func _luminance(rgb: Array[int]) -> float:
	var linear := []
	for c in rgb:
		var v := c / 255.0
		linear.append(v / 12.92 if v <= 0.04045 else pow((v + 0.055) / 1.055, 2.4))
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
