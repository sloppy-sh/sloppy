## Arriving in Sets: the places come up one after another, in the order they are
## ranked, while the veil over the room recedes — DESIGN.md § "The field in a room".
extends RefCounted

## In seconds: how long one step takes to come up, and how long after the step
## before it each one starts.
const FADING := 0.4
const BETWEEN := 0.15
## In metres: how near the veil begins, and how far it reaches as it falls.
const VEIL_NEAR := 0.5
const VEIL_FAR := 1.5


## Seconds the whole arrival takes over `steps` steps.
static func span(steps: int) -> float:
	return BETWEEN * maxf(steps - 1, 0) + FADING


## How much of step `step` has come up `elapsed` seconds in, 0 to 1.
static func shown(elapsed: float, step: int) -> float:
	return clampf((elapsed - BETWEEN * step) / FADING, 0.0, 1.0)


## How far the veil reaches `elapsed` seconds into an arrival of `steps` steps,
## eased out from VEIL_FAR to `farthest` metres.
static func veil_far(elapsed: float, steps: int, farthest: float) -> float:
	return lerpf(VEIL_FAR, maxf(farthest, VEIL_FAR), smoothstep(0.0, 1.0, elapsed / span(steps)))


## The step a note comes up at: that of the first place in `order` it carries,
## or one past the last place where it carries none.
static func step_of(tags: Array, order: Array) -> int:
	for at in order.size():
		if tags.has(order[at]):
			return at
	return order.size()
