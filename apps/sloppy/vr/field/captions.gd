## Where a title stands about its mark, held clear of the titles already written:
## the canvas's rule (DESIGN.md § "The canvas"), read in the reader's view.
## Positions and sizes are in the plane one metre in front of the eyes, x to the
## reader's right and y up, so a box `w` metres wide at depth `d` is `w / d` across.
extends RefCounted


## The box a `width` x `high` caption takes about a mark at `at`, `rim` from its
## centre to where words may start: right of it, left of it, centred above, centred
## below — the first clear of every box in `placed` — or null where none is.
static func place(at: Vector2, rim: float, width: float, high: float, placed: Array[Rect2]) -> Variant:
	for corner in [
		Vector2(at.x + rim, at.y - high / 2.0),
		Vector2(at.x - rim - width, at.y - high / 2.0),
		Vector2(at.x - width / 2.0, at.y + rim),
		Vector2(at.x - width / 2.0, at.y - rim - high),
	]:
		var box := Rect2(corner, Vector2(width, high))
		if not placed.any(func(one: Rect2) -> bool: return one.intersects(box)):
			return box
	return null
