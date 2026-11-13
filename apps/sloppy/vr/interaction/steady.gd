## A hand's shaking taken out of what it drives — DESIGN.md § "The field in a
## room". A reading is pulled toward the newest by the share of `steadying`
## seconds that have passed, so a tremor averages away while a movement held
## longer than that comes through whole.
extends RefCounted


## How much of the way from the last reading to the newest is taken in `delta` seconds.
static func share(steadying: float, delta: float) -> float:
	return 1.0 if steadying <= 0.0 else 1.0 - exp(-delta / steadying)


static func lean(was: Vector2, now: Vector2, steadying: float, delta: float) -> Vector2:
	return now if steadying <= 0.0 else was.lerp(now, share(steadying, delta))


static func hold(was: Transform3D, now: Transform3D, steadying: float, delta: float) -> Transform3D:
	return now if steadying <= 0.0 else was.interpolate_with(now, share(steadying, delta))
