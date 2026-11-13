## The eight hue slots as colours: the look the room is dressed in, each slot
## held to its floor on the room's paper (`room/room.gd`, `field/palette.gd`).
extends RefCounted

const Room := preload("res://room/room.gd")

static var INK: Color:
	get:
		return Room.ink()


## Slot 1 to 8's colour; ink for no slot.
static func of(slot: int) -> Color:
	if slot < 1 or slot > 8:
		return INK
	return Room.palette().slot(slot)
