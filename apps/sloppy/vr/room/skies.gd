## The skies the night room can hang the field in — DESIGN.md § "The field in a
## room": the stars drawn here, Poly Haven's published panoramas fetched once
## when chosen, and the panoramas a person puts in the skies folder they reach
## by connecting the headset to a computer.
## Everything else about a sky is kept under `dir`; nothing but the request for a
## chosen sky leaves the headset.
extends Node

## One sky: `key` is how the room keeps it ("night", "polyhaven:<id>", "own:<file>").
## Godot names its own sky `Sky`, so one offered here is a `Choice`.
class Choice:
	extends RefCounted
	var key := ""
	var id := ""
	var name := ""
	var authors: PackedStringArray = []
	var thumbnail_url := ""
	var source := ""

	func _init(from: String, named: String, at := "") -> void:
		source = from
		id = at
		name = named
		key = from if at == "" else "%s:%s" % [from, at]

	func to_kept() -> Dictionary:
		return {"id": id, "name": name, "authors": Array(authors), "thumbnail_url": thumbnail_url}

	static func published(held: Dictionary) -> Choice:
		var sky := Choice.new(PUBLISHED, str(held.get("name", held.get("id", ""))), str(held.get("id", "")))
		var authors = held.get("authors", [])
		sky.authors = PackedStringArray(authors.keys() if authors is Dictionary else authors)
		sky.thumbnail_url = str(held.get("thumbnail_url", ""))
		return sky


signal progressed(key: String, fraction: float)
signal fetched(key: String, failed: String)

const NIGHT := "night"
const PUBLISHED := "polyhaven"
const OWN := "own"
const CATALOGUE_URL := "https://api.polyhaven.com/assets?t=hdris"
const FILES_URL := "https://api.polyhaven.com/files/%s"
const ASKED_AS := ["User-Agent: Sloppy headset (sloppy.sh)"]
## Seconds a catalogue fetched is read again before it is asked for anew.
const CATALOGUE_KEPT_FOR := 86400.0
const OWN_KINDS := ["exr", "png", "jpg", "jpeg", "webp"]
const OPEN_SKY := ["night", "skies"]
const EXR_MAGIC := [0x76, 0x2f, 0x31, 0x01]
const FAILED := "The sky could not be fetched. Check the network and try again."
const STARS := "Stars"
## In pixels: the most a small picture is held at, which is all a row's few centimetres show.
const THUMBNAIL := 96
const CREDIT := "%s · Poly Haven · CC0"

## Where everything about a sky is kept on the headset.
static var dir := "user://skies"
## Where the person's own panoramas are read from; "" is the folder they can
## reach over USB on Android, and `dir`'s own one elsewhere.
static var own_at := ""

## `func(url: String, progressed: Callable) -> PackedByteArray`, empty where it
## failed; the network unless a test says otherwise.
var fetcher: Callable = _over_network
## Whether the last catalogue asked for could not reach the publisher.
var offline := false
## The fraction fetched of each sky being fetched now, by key.
var fetching := {}

var _thumbnails := {}


static func catalogue_path() -> String:
	return dir.path_join("catalogue.json")


static func kept_path() -> String:
	return dir.path_join("kept.json")


static func own_dir() -> String:
	if own_at != "":
		return own_at
	var reachable := _reachable_dir()
	return reachable.path_join("skies") if reachable != "" else dir.path_join("own")


## `own_dir()` as a person finds it: from the headset's storage when it is
## connected to a computer, or the whole path where it is not on a headset.
static func own_dir_said() -> String:
	var at := ProjectSettings.globalize_path(own_dir())
	var storage := _storage_root()
	return at.trim_prefix(storage).trim_prefix("/") if storage != "" and at.begins_with(storage) else at


## The app's external files folder, which the headset shows over USB and
## reading asks no permission for; "" off Android.
static func _reachable_dir() -> String:
	if not Engine.has_singleton("AndroidRuntime"):
		return ""
	var context = Engine.get_singleton("AndroidRuntime").getApplicationContext()
	var at = context.getExternalFilesDir("") if context != null else null
	if at == null:
		return ""
	var path := str(at.getCanonicalPath())
	DirAccess.make_dir_recursive_absolute(path.path_join("skies"))
	return path


static func _storage_root() -> String:
	if not Engine.has_singleton("AndroidRuntime"):
		return ""
	var environment = JavaClassWrapper.wrap("android.os.Environment")
	var root = environment.getExternalStorageDirectory() if environment != null else null
	return str(root.getCanonicalPath()) if root != null else ""


static func picture_path(sky: Choice, sharper := false) -> String:
	return dir.path_join("%s%s.exr" % [sky.id, "-2k" if sharper else ""])


static func thumbnail_path(sky: Choice) -> String:
	return dir.path_join("thumbnails").path_join(sky.id)


## The procedural night, the sky that needs nothing.
static func night() -> Choice:
	return Choice.new(NIGHT, STARS)


## How bright a photographed sky is drawn, `dim` 0 to 100 taken off it.
static func energy(dim: float) -> float:
	return 1.0 - clampf(dim, 0.0, 100.0) / 100.0


## The published open and night skies in Poly Haven's `assets` answer: night
## first, then the rest, each most fetched first.
static func parse(assets: Dictionary) -> Array[Choice]:
	var held: Array[Dictionary] = []
	for id in assets:
		var asset = assets[id]
		if not asset is Dictionary:
			continue
		var categories: Array = asset.get("categories", []) if asset.get("categories") is Array else []
		var attributes: Dictionary = asset.get("attributes") if asset.get("attributes") is Dictionary else {}
		if not OPEN_SKY.any(func(one): return categories.has(one)) or categories.has("indoor"):
			continue
		if attributes.get("sky_view", "open") != "open" or attributes.get("environment", "outdoor") == "indoor":
			continue
		held.append({
			"id": str(id), "name": str(asset.get("name", id)), "authors": asset.get("authors", {}),
			"thumbnail_url": str(asset.get("thumbnail_url", "")), "night": categories.has("night"),
			"fetched": int(asset.get("download_count", 0)),
		})
	held.sort_custom(func(a, b):
		if a.night != b.night:
			return a.night
		if a.fetched != b.fetched:
			return a.fetched > b.fetched
		return a.id < b.id)
	var skies: Array[Choice] = []
	for one in held:
		skies.append(Choice.published(one))
	return skies


## The address of a published sky's panorama in Poly Haven's `files` answer: 1k,
## or 2k where `sharper`; "" where it has none.
static func file_url(files: Dictionary, sharper := false) -> String:
	var at: Variant = files.get("hdri", {}).get("2k" if sharper else "1k", {}).get("exr", {}).get("url", "")
	return at if at is String else ""


## The panoramas put in `own_dir()`, by file name.
static func own() -> Array[Choice]:
	var skies: Array[Choice] = []
	var names: Array = Array(DirAccess.get_files_at(own_dir())) if DirAccess.dir_exists_absolute(own_dir()) else []
	names.sort()
	for file in names:
		if OWN_KINDS.has(str(file).get_extension().to_lower()):
			skies.append(Choice.new(OWN, str(file).get_basename(), file))
	return skies


## The published skies fetched to this headset before.
static func kept() -> Array[Choice]:
	var skies: Array[Choice] = []
	var held = _read_json(kept_path())
	if held is Dictionary:
		for id in held:
			var sky := Choice.published(held[id])
			if FileAccess.file_exists(picture_path(sky)):
				skies.append(sky)
	return skies


## The sky kept as `key`; the night where none here answers to it.
static func find(key: String) -> Choice:
	var source := key.get_slice(":", 0)
	var id := key.substr(source.length() + 1)
	if source == OWN and FileAccess.file_exists(own_dir().path_join(id)):
		return Choice.new(OWN, id.get_basename(), id)
	if source == PUBLISHED:
		var held = _read_json(kept_path())
		if held is Dictionary and held.has(id):
			return Choice.published(held[id])
	return night()


## Whether `sky` can be drawn from what is on the headset now.
static func on_headset(sky: Choice) -> bool:
	match sky.source:
		NIGHT:
			return true
		OWN:
			return FileAccess.file_exists(own_dir().path_join(sky.id))
	return FileAccess.file_exists(picture_path(sky))


static func is_sharper(sky: Choice) -> bool:
	return sky.source == PUBLISHED and FileAccess.file_exists(picture_path(sky, true))


## `sky`'s panorama as the room draws it; null for the night, or where it is not
## on the headset or will not read.
static func load(sky: Choice) -> Texture2D:
	var path := ""
	match sky.source:
		OWN:
			path = own_dir().path_join(sky.id)
		PUBLISHED:
			path = picture_path(sky, is_sharper(sky))
	if path == "" or not FileAccess.file_exists(path):
		return null
	var image := picture(FileAccess.get_file_as_bytes(path), path.get_extension())
	return ImageTexture.create_from_image(image) if image != null else null


## An image read from `bytes`, its kind told by `named` where given and by its
## first bytes otherwise; null where it reads as none.
static func picture(bytes: PackedByteArray, named := "") -> Image:
	var kind := named.to_lower()
	if kind == "":
		if Array(bytes.slice(0, 4)) == EXR_MAGIC:
			kind = "exr"
		elif bytes.slice(0, 4) == PackedByteArray([0x89, 0x50, 0x4e, 0x47]):
			kind = "png"
		elif bytes.slice(0, 2) == PackedByteArray([0xff, 0xd8]):
			kind = "jpg"
		elif bytes.slice(8, 12).get_string_from_ascii() == "WEBP":
			kind = "webp"
	var image := Image.new()
	var read := ERR_FILE_UNRECOGNIZED
	match kind:
		"exr":
			read = image.load_exr_from_buffer(bytes)
		"png":
			read = image.load_png_from_buffer(bytes)
		"jpg", "jpeg":
			read = image.load_jpg_from_buffer(bytes)
		"webp":
			read = image.load_webp_from_buffer(bytes)
	return image if read == OK and not image.is_empty() else null


## Every sky offered: the night first, the published ones, then the person's
## own. A catalogue fetched within the day is read again rather than asked
## for; where the publisher cannot be reached, the published skies already on
## the headset are all of them and `offline` says so.
func catalogue() -> Array[Choice]:
	var skies: Array[Choice] = [night()]
	var published := await _published()
	skies.append_array(published)
	skies.append_array(own())
	return skies


## Fetch `sky`'s panorama to the headset once, 2k where `sharper`; "" when it is
## there, or the sentence to say where it is not.
func fetch(sky: Choice, sharper := false) -> String:
	if sky.source != PUBLISHED or FileAccess.file_exists(picture_path(sky, sharper)):
		return ""
	if fetching.has(sky.key):
		var said: Array = await fetched
		while said[0] != sky.key:
			said = await fetched
		return said[1]
	fetching[sky.key] = 0.0
	progressed.emit(sky.key, 0.0)
	var failed := await _fetch_picture(sky, sharper)
	fetching.erase(sky.key)
	if failed == "":
		_keep_meta(sky)
	fetched.emit(sky.key, failed)
	return failed


func sharper(sky: Choice) -> String:
	return await fetch(sky, true)


## `sky`'s small picture, fetched once and kept; null for a sky with none.
func thumbnail(sky: Choice) -> Texture2D:
	if sky.thumbnail_url == "":
		return null
	if _thumbnails.has(sky.key):
		return _thumbnails[sky.key]
	var path := thumbnail_path(sky)
	var bytes := FileAccess.get_file_as_bytes(path) if FileAccess.file_exists(path) else PackedByteArray()
	if bytes.is_empty():
		bytes = await fetcher.call(sky.thumbnail_url, func(_fraction): pass)
		if not bytes.is_empty():
			_write(path, bytes)
	var image := picture(bytes)
	if image == null:
		return null
	var longest := maxi(image.get_width(), image.get_height())
	if longest > THUMBNAIL:
		image.resize(maxi(1, image.get_width() * THUMBNAIL / longest), maxi(1, image.get_height() * THUMBNAIL / longest), Image.INTERPOLATE_LANCZOS)
	image.generate_mipmaps()
	var texture := ImageTexture.create_from_image(image)
	_thumbnails[sky.key] = texture
	return texture


func _published() -> Array[Choice]:
	var cached = _read_json(catalogue_path())
	var fresh: bool = cached is Dictionary and Time.get_unix_time_from_system() - float(cached.get("at", 0.0)) < CATALOGUE_KEPT_FOR
	if fresh and cached.get("skies") is Array:
		offline = false
		return _from_cache(cached.skies)
	var answer = _json((await fetcher.call(CATALOGUE_URL, func(_fraction): pass)).get_string_from_utf8())
	if not answer is Dictionary:
		offline = true
		return kept()
	offline = false
	var skies := parse(answer)
	_write(catalogue_path(), JSON.stringify({"at": Time.get_unix_time_from_system(), "skies": skies.map(func(sky): return sky.to_kept())}).to_utf8_buffer())
	return skies


static func _from_cache(held: Array) -> Array[Choice]:
	var skies: Array[Choice] = []
	for one in held:
		if one is Dictionary:
			skies.append(Choice.published(one))
	return skies


func _fetch_picture(sky: Choice, sharper: bool) -> String:
	var files = _json((await fetcher.call(FILES_URL % sky.id, func(_fraction): pass)).get_string_from_utf8())
	var url := file_url(files, sharper) if files is Dictionary else ""
	if url == "":
		return FAILED
	var bytes: PackedByteArray = await fetcher.call(url, func(fraction: float):
		fetching[sky.key] = fraction
		progressed.emit(sky.key, fraction))
	if Array(bytes.slice(0, 4)) != EXR_MAGIC:
		return FAILED
	_write(picture_path(sky, sharper), bytes)
	return ""


func _keep_meta(sky: Choice) -> void:
	var held = _read_json(kept_path())
	if not held is Dictionary:
		held = {}
	held[sky.id] = sky.to_kept()
	_write(kept_path(), JSON.stringify(held).to_utf8_buffer())


static func _read_json(path: String) -> Variant:
	return _json(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null


## What `text` holds as JSON; null where it holds none.
static func _json(text: String) -> Variant:
	var reading := JSON.new()
	return reading.data if reading.parse(text) == OK else null


static func _write(path: String, bytes: PackedByteArray) -> void:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file != null:
		file.store_buffer(bytes)


func _over_network(url: String, progress: Callable) -> PackedByteArray:
	var asking := HTTPRequest.new()
	asking.use_threads = true
	asking.timeout = 120.0
	add_child(asking)
	var answer := [false, PackedByteArray()]
	asking.request_completed.connect(func(result: int, code: int, _headers, body: PackedByteArray):
		answer[1] = body if result == HTTPRequest.RESULT_SUCCESS and code == 200 else PackedByteArray()
		answer[0] = true)
	if asking.request(url, ASKED_AS) != OK:
		asking.queue_free()
		return PackedByteArray()
	while not answer[0]:
		if asking.get_body_size() > 0:
			progress.call(float(asking.get_downloaded_bytes()) / asking.get_body_size())
		await get_tree().process_frame
	asking.queue_free()
	return answer[1]
