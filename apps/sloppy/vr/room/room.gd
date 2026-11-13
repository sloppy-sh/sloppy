## The room the field stands in, and the look everything in it is drawn in —
## DESIGN.md § "The field in a room". The room is the look's own paper, dark
## with nothing drawn but the field, or the reader's own surroundings where the
## headset can show them. Which room, and what this headset chose over the
## desk's look, are kept on it; `look/look.gd` works out what that draws in.
extends WorldEnvironment

const Palette := preload("res://field/palette.gd")
const Look := preload("res://look/look.gd")
const Skies := preload("res://room/skies.gd")

enum Kind { DARK, SURROUNDINGS, LOOK, NIGHT }

signal changed(kind: Kind)
## What everything is drawn in has changed: the room, the desk's look, or what
## this headset chose over it. What stands already is to be drawn again.
signal dressed

const KEPT := "user://room.cfg"
## How each kind is kept.
const KINDS := ["dark", "surroundings", "look", "night"]
## The ground the two rooms that are not the look's own are read on, OKLCH.
const PAPER: Array = Look.OWN[Look.GROUND].paper
## How much of the surroundings is darkened behind the field, so it reads over
## a bright wall as it does over a dark one.
const SCRIM := 0.35
const NIGHT_SKY := preload("res://room/night.gdshader")
## Seconds the night sky takes to turn once about the upright.
const NIGHT_TURN := 3600.0
## Which sky the night is, and how much of a photographed one is taken off it, as kept.
const SKY_CHOSEN := {"sky": Skies.NIGHT, "dim": 40}
## Seconds a sky changing to another takes, half going and half coming.
const SKY_FADE := 0.4
## What the panels at the hand are dressed in where no theme pack is chosen.
const LOOK_PANELS := "look"

var kind := Kind.DARK
## The look the desk said it is wearing last; {} before it has, or where it shares none.
var served := {}
## What this headset chose over the desk's look, as `Look.NOTHING_CHOSEN` holds
## it, the sky, and which theme pack its panels are dressed in (`ui/theme.gd`'s `PACKS`).
var kept: Dictionary = Look.NOTHING_CHOSEN.merged(SKY_CHOSEN).merged({"panels": LOOK_PANELS})
## The library of skies the night is chosen from.
var skies := Skies.new()

var _night: Sky
var _drift: Tween
var _photo: Sky
var _photo_of := ""
var _fade: Tween

static var _worn := _dressing({}, Look.NOTHING_CHOSEN, Kind.DARK)
static var _faces := {}


## The field's colours in the room as it is dressed now.
static func palette() -> Palette:
	return _worn.palette


static func ink() -> Color:
	return Palette.to_color(_worn.colours.ink)


static func paper() -> Color:
	return Palette.to_color(_worn.colours.paper)


static func card() -> Color:
	return Palette.to_color(_worn.colours.card)


static func edge() -> Color:
	return Palette.to_color(_worn.colours.edge)


static func pointed() -> Color:
	return Palette.to_color(_worn.colours.pointed)


## What is drawn, as `Look.chosen` answers it.
static func look() -> Dictionary:
	return _worn.look


## The theme pack the panels are dressed in, `LOOK_PANELS` being the look's own.
static func panels() -> String:
	return _worn.panels


## The face `role` ("ui", "heading" or "mono") is set in now.
static func font(role: String) -> Font:
	var path := Look.face_file(role, str(_worn.look.fonts.get(role, "system")))
	if not _faces.has(path):
		_faces[path] = SystemFont.new() if path == "" else load(path)
	return _faces[path]


## How much of the room between things the density keeps.
static func closeness() -> float:
	return Look.CLOSENESS[_worn.look.density]


## How heavy a card's edge is drawn, as times a hairline.
static func edge_weight() -> float:
	return Look.EDGE_WEIGHTS.get(_worn.look.style, 1.0)


## The room `tree` stands in; null before the main scene is.
static func of(tree: SceneTree) -> Node:
	return tree.get_first_node_in_group("room")


static func _dressing(desk: Dictionary, chose: Dictionary, room: Kind) -> Dictionary:
	var look := Look.chosen(desk, chose)
	var colours := Look.colours(look)
	if room != Kind.LOOK:
		colours = Look.on_ground(colours)
	return {
		"look": look,
		"colours": colours,
		"palette": Palette.new(colours.ink, colours.paper, colours.facets),
		"panels": str(chose.get("panels", LOOK_PANELS)),
	}


func _ready() -> void:
	add_to_group("room")
	add_child(skies)
	var file := ConfigFile.new()
	if file.load(KEPT) == OK:
		kind = maxi(0, KINDS.find(file.get_value("room", "kind", KINDS[0]))) as Kind
		for axis in kept:
			kept[axis] = file.get_value("sky" if SKY_CHOSEN.has(axis) else "look", axis, kept[axis])
	_wear()
	var client := get_node_or_null("/root/Client")
	var views := get_node_or_null("/root/Views")
	if client != null and views != null:
		client.ready_to_ask.connect(_ask_desk)
		client.ready_to_ask.connect(_ask_looks)
		views.shown.connect(_shown)


## Whether this headset can show the reader's surroundings behind the field.
func can_show_surroundings() -> bool:
	var xr := XRServer.primary_interface
	return xr != null and xr.is_initialized() \
		and xr.get_supported_environment_blend_modes().has(XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND)


## Stand the field in `next`, and keep it for the next time.
func choose(next: Kind) -> void:
	kind = next
	_keep("room", "kind", KINDS[next])
	_wear()
	changed.emit(kind)


## Keep `value` as this headset's choice of `axis` ("follow", "look", "face",
## "density" or "panels"; "" for a look, a face or a density is none) and draw in it.
func keep(axis: String, value: Variant) -> void:
	kept[axis] = value
	_keep("look", axis, value)
	_wear()


## Hang the field in the night under `key` (`Skies.Choice.key`), and keep it.
## Changing from one sky to another fades the one out and the next in.
func choose_sky(key: String) -> void:
	kept.sky = key
	_keep("sky", "sky", key)
	if kind != Kind.NIGHT:
		choose(Kind.NIGHT)
		return
	if _fade != null:
		_fade.kill()
	if not is_inside_tree() or environment.background_mode != Environment.BG_SKY:
		_apply()
		changed.emit(kind)
		return
	_fade = create_tween()
	_fade.tween_property(environment, "background_energy_multiplier", 0.0, SKY_FADE / 2.0)
	_fade.tween_callback(_apply)
	_fade.tween_property(environment, "background_energy_multiplier", 1.0, SKY_FADE / 2.0)
	changed.emit(kind)


## Take `dim` (0 to 100) off a photographed sky, and keep it.
func dim_sky(dim: float) -> void:
	kept.dim = clampf(dim, 0.0, 100.0)
	_keep("sky", "dim", kept.dim)
	if _photo != null:
		(_photo.sky_material as PanoramaSkyMaterial).energy_multiplier = Skies.energy(kept.dim)


## The sky the night is drawn as now: the one kept, where it is on the
## headset, and the stars where it is not.
func sky_shown() -> Skies.Choice:
	var sky := Skies.find(str(kept.sky))
	return sky if Skies.on_headset(sky) else Skies.night()


## Draw in what the desk says it is wearing, `{}` being nothing.
func wear(look: Dictionary) -> void:
	if look == served:
		return
	served = look
	_wear()


## Whether the surroundings are what is behind the field now.
func showing_surroundings() -> bool:
	return kind == Kind.SURROUNDINGS and can_show_surroundings()


## The room fogged in its own colour: what stands nearer the eyes than `near`
## metres is clear, and nothing past `far` shows.
func veil(near: float, far: float) -> void:
	environment.fog_enabled = true
	environment.fog_mode = Environment.FOG_MODE_DEPTH
	environment.fog_density = 1.0
	environment.fog_depth_curve = 1.0
	environment.fog_depth_begin = near
	environment.fog_depth_end = maxf(far, near + 0.01)
	environment.fog_light_energy = 1.0
	# The night sky lies past every depth; this lets its stars come out as the veil falls back rather than all at once.
	environment.fog_sky_affect = clampf(near * 3.0 / environment.fog_depth_end, 0.0, 1.0)
	environment.fog_sun_scatter = 0.0
	var behind := environment.background_color
	environment.fog_light_color = Color(behind.r, behind.g, behind.b)


func unveil() -> void:
	environment.fog_enabled = false


func _keep(section: String, key: String, value: Variant) -> void:
	var file := ConfigFile.new()
	file.load(KEPT)
	file.set_value(section, key, value)
	file.save(KEPT)


func _wear() -> void:
	_worn = _dressing(served, kept, kind)
	_apply()
	dressed.emit()


## The desk is asked what it is wearing each time it is reached and each time
## a project's field is shown, so a change on the desk is worn by the next.
func _shown(view: String) -> void:
	if view == "graph" or view == "sets":
		_ask_desk()


func _ask_desk() -> void:
	var client := get_node("/root/Client")
	if client.state != client.State.OPEN:
		return
	var look: Dictionary = await client.look()
	if is_inside_tree() and client.state == client.State.OPEN:
		wear(look)


## The desk's collection is asked for each time a desk is reached, and kept;
## a look chosen from it is drawn again once it is there.
func _ask_looks() -> void:
	var client := get_node("/root/Client")
	var looks: Array = await client.looks()
	if looks.is_empty() or not is_inside_tree():
		return
	Look.keep_collection(looks)
	if not Look.OWN.has(str(kept.look)) and str(kept.look) != "":
		_wear()


func _apply() -> void:
	var through := showing_surroundings()
	var night := kind == Kind.NIGHT
	environment.background_mode = Environment.BG_SKY if night else Environment.BG_COLOR
	environment.background_color = Color(0.0, 0.0, 0.0, SCRIM) if through else paper()
	environment.sky = _sky_of(sky_shown()) if night else null
	_drifting(night)
	get_viewport().transparent_bg = through
	var xr := XRServer.primary_interface
	if xr != null and xr.is_initialized():
		xr.environment_blend_mode = XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND if through else XRInterface.XR_ENV_BLEND_MODE_OPAQUE


func _sky_of(chosen: Skies.Choice) -> Sky:
	if chosen.source == Skies.NIGHT:
		return _night_sky()
	if _photo_of != chosen.key or Skies.is_sharper(chosen) != _photo.get_meta("sharper", false):
		var panorama := Skies.load(chosen)
		if panorama == null:
			return _night_sky()
		var photographed := PanoramaSkyMaterial.new()
		photographed.panorama = panorama
		_photo = Sky.new()
		_photo.sky_material = photographed
		_photo.radiance_size = Sky.RADIANCE_SIZE_32
		_photo.set_meta("sharper", Skies.is_sharper(chosen))
		_photo_of = chosen.key
	(_photo.sky_material as PanoramaSkyMaterial).energy_multiplier = Skies.energy(kept.dim)
	return _photo


func _night_sky() -> Sky:
	if _night == null:
		var stars := ShaderMaterial.new()
		stars.shader = NIGHT_SKY
		_night = Sky.new()
		_night.sky_material = stars
		_night.radiance_size = Sky.RADIANCE_SIZE_32
	(_night.sky_material as ShaderMaterial).set_shader_parameter("paper", paper())
	return _night


func _drifting(on: bool) -> void:
	if on and _drift == null:
		_drift = create_tween().set_loops()
		_drift.tween_property(environment, "sky_rotation:y", TAU, NIGHT_TURN).from(0.0)
	elif not on and _drift != null:
		_drift.kill()
		_drift = null
		environment.sky_rotation = Vector3.ZERO
