## What a mark shows at the distance it is read from: far away the field reads
## as a shape, near as notes — DESIGN.md § "The field in a room".
extends RefCounted

## In metres, at the field's own scale: a mark not folded, as the canvas draws a leaf.
const MARK_RADIUS := 0.012
## In radians: the narrowest a band is worn at before the mark falls back to the
## first of its hues — `BAND_MIN_WIDTH`'s three pixels, as a headset draws them.
const BAND_MIN_ANGLE := 0.0021
## How far past that the bands hang on, so stepping back and forth does not strobe them.
const BAND_HYSTERESIS := 0.75
## The most titles standing at once unless the reader asks for more or fewer,
## the nearest first: a field of words is a wall.
const TITLES_MOST := 8
## What the farthest of them keeps of its ink; the nearest is whole.
const TITLE_FAINTEST := 0.35
## The cosine of the widest a mark may stand off where the eyes look and still be
## titled, 40°: well inside a headset's view, so no title is spent where it is not seen.
const TITLE_CONE := 0.766
## A mark titled a moment ago keeps its title out to 46°…
const TITLE_CONE_HELD := 0.695
## …and is ranked as though this much nearer, so two marks at nearly one distance
## do not trade a title back and forth.
const TITLE_HELD := 0.9


## Whether a mark `radius` across at `distance`, carrying `count` bands, wears
## them all. `banding` is whether it wore them a moment ago.
static func bands_shown(radius: float, distance: float, count: int, banding: bool) -> bool:
	if count < 2:
		return true
	var band := 2.0 * radius / count / maxf(distance, 1e-6)
	return band >= BAND_MIN_ANGLE * (BAND_HYSTERESIS if banding else 1.0)


## How much of its title a mark at `distance` shows, when the titled marks run
## from `nearest` to `farthest`: 1 at the nearest, `TITLE_FAINTEST` at the farthest.
static func title_alpha(distance: float, nearest: float, farthest: float) -> float:
	if farthest - nearest < 1e-6:
		return 1.0
	return lerpf(1.0, TITLE_FAINTEST, clampf((distance - nearest) / (farthest - nearest), 0.0, 1.0))


## The marks whose titles stand, `most` at most and nearest first, as indices
## into `distances`; `facing` is each mark's cosine off the eyes' forward axis,
## and `held` the marks titled a moment ago.
static func titled(distances: PackedFloat32Array, facing: PackedFloat32Array, held: Array[int] = [], most := TITLES_MOST) -> Array[int]:
	var ranked := {}
	for at in distances.size():
		var was := held.has(at)
		if facing[at] >= (TITLE_CONE_HELD if was else TITLE_CONE):
			ranked[at] = distances[at] * (TITLE_HELD if was else 1.0)
	var ahead: Array[int] = []
	ahead.assign(ranked.keys())
	ahead.sort_custom(func(a, b): return ranked[a] < ranked[b] or (ranked[a] == ranked[b] and a < b))
	return ahead.slice(0, most)


## How much further than it is taken up at a picture worn is kept, so stepping
## back and forth at the edge does not take it off and put it on.
const PICTURES_HELD := 1.25


## The marks that wear their pictures, nearest first, as indices into `distances`
## (INF where a mark has none to wear): every one from `beyond` to `within`
## metres, wherever the eyes face, and one in `held` out to `PICTURES_HELD` times that.
static func worn(distances: PackedFloat32Array, held: Array[int], within: float, beyond: float) -> Array[int]:
	var was := {}
	for at in held:
		was[at] = true
	var kept: Array[int] = []
	for at in distances.size():
		var reach := within * (PICTURES_HELD if was.has(at) else 1.0)
		if distances[at] >= beyond and distances[at] <= reach:
			kept.append(at)
	kept.sort_custom(func(a, b): return distances[a] < distances[b] or (distances[a] == distances[b] and a < b))
	return kept


## Which of `worn` (nearest first) to ask the pictures of now: those not in
## `asked`, nearest first, while fewer than `most` are being asked; `asking` are.
static func to_ask(worn: Array[int], asked: Dictionary, asking: int, most: int) -> Array[int]:
	var next: Array[int] = []
	for at in worn:
		if asking + next.size() >= most:
			break
		if not asked.has(at):
			next.append(at)
	return next
