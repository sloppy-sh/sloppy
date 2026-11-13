## The library of skies: which published skies are offered and in what order,
## the night first and the person's own after, the catalogue kept for a day,
## what is fetched for a sky and where it is kept, the panorama read back, and
## how dim it is drawn. Nothing here reaches the network. Exits 1 on a failure.
extends SceneTree

const Skies := preload("res://room/skies.gd")

const FILES := {"hdri": {
	"1k": {"exr": {"url": "https://files.example/1k/quiet_meadow_night_1k.exr"}, "hdr": {"url": "https://files.example/1k/quiet_meadow_night_1k.hdr"}},
	"2k": {"exr": {"url": "https://files.example/2k/quiet_meadow_night_2k.exr"}},
}}

var _failed := 0
var _asked: Array[String] = []
var _answers := {}


func _initialize() -> void:
	_run()


func _run() -> void:
	await process_frame
	Skies.dir = "user://skies-test"
	_clear(Skies.dir)
	var assets: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/skies/hdris.json"))

	var parsed := Skies.parse(assets)
	_check(parsed.map(func(sky): return sky.id) == ["quiet_meadow_night", "harbour_night", "high_noon_hills", "pure_cloud"],
		"open and night skies are offered, night first, each most fetched first: %s" % [parsed.map(func(sky): return sky.id)])
	var harbour: Skies.Choice = parsed[1]
	_check(harbour.name == "Harbour Night" and harbour.source == Skies.PUBLISHED and harbour.key == "polyhaven:harbour_night", "each is named, published, and kept by its id")
	_check(Array(harbour.authors) == ["B. Rowe", "C. Lake"], "with who made it")
	_check(harbour.thumbnail_url == "https://cdn.example/thumbs/harbour_night.png", "and its small picture")

	_check(Skies.file_url(FILES) == "https://files.example/1k/quiet_meadow_night_1k.exr", "a sky is fetched as its 1k panorama")
	_check(Skies.file_url(FILES, true) == "https://files.example/2k/quiet_meadow_night_2k.exr", "and as its 2k one, sharper")
	_check(Skies.file_url({}) == "", "and as nothing where it has none")

	_check(is_equal_approx(Skies.energy(0.0), 1.0) and is_equal_approx(Skies.energy(40.0), 0.6) and is_equal_approx(Skies.energy(100.0), 0.0), "dim is taken off a photographed sky's brightness")
	_check(is_equal_approx(Skies.energy(150.0), 0.0) and is_equal_approx(Skies.energy(-5.0), 1.0), "and held to 0 to 100")

	_check(Skies.own_dir() == "user://skies-test/own", "off a headset the person's own skies sit beside the rest: %s" % Skies.own_dir())
	_check(Skies.own_dir_said() == ProjectSettings.globalize_path(Skies.own_dir()), "and are named by their whole path")
	Skies.own_at = "user://skies-test/elsewhere"
	_check(Skies.own_dir() == "user://skies-test/elsewhere", "a folder set for them is where they are read from")
	Skies.own_at = ""

	var aurora := Image.create(8, 4, false, Image.FORMAT_RGB8)
	aurora.fill(Color(0.1, 0.4, 0.3))
	DirAccess.make_dir_recursive_absolute(Skies.own_dir())
	aurora.save_png(Skies.own_dir().path_join("Aurora Over Ice.png"))
	FileAccess.open(Skies.own_dir().path_join("notes.txt"), FileAccess.WRITE).store_string("not a sky")

	var skies := Skies.new()
	root.add_child(skies)
	skies.fetcher = _fake
	_answers[Skies.CATALOGUE_URL] = JSON.stringify(assets).to_utf8_buffer()
	var offered: Array = await skies.catalogue()
	_check(offered.size() == 6, "the night, four published skies and one of the person's own: %d" % offered.size())
	_check(offered[0].source == Skies.NIGHT and offered[0].key == Skies.NIGHT and offered[0].name == Skies.STARS, "the stars come first")
	_check(offered[1].id == "quiet_meadow_night", "then the published ones")
	var own: Skies.Choice = offered[5]
	_check(own.source == Skies.OWN and own.name == "Aurora Over Ice" and own.key == "own:Aurora Over Ice.png", "the person's own is named by its file")
	_check(_asked == [Skies.CATALOGUE_URL] and not skies.offline, "the catalogue is asked for once")
	_check(FileAccess.file_exists(Skies.catalogue_path()), "and kept on the headset")

	_asked.clear()
	offered = await skies.catalogue()
	_check(_asked.is_empty() and offered.size() == 6, "within the day it is read from the headset, not asked for")
	var cached: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(Skies.catalogue_path()))
	cached.at = Time.get_unix_time_from_system() - 2.0 * Skies.CATALOGUE_KEPT_FOR
	FileAccess.open(Skies.catalogue_path(), FileAccess.WRITE).store_string(JSON.stringify(cached))
	_answers.erase(Skies.CATALOGUE_URL)
	offered = await skies.catalogue()
	_check(_asked == [Skies.CATALOGUE_URL], "a day old, it is asked for again")
	_check(skies.offline and offered.size() == 2 and offered[0].source == Skies.NIGHT and offered[1].source == Skies.OWN, "and with the publisher out of reach, what is on the headset is the list")

	var meadow: Skies.Choice = parsed[0]
	var panorama := Image.create(16, 8, false, Image.FORMAT_RGBF)
	panorama.fill(Color(0.02, 0.03, 0.08))
	_answers[Skies.FILES_URL % meadow.id] = JSON.stringify(FILES).to_utf8_buffer()
	_answers[FILES.hdri["1k"].exr.url] = panorama.save_exr_to_buffer()
	_answers[FILES.hdri["2k"].exr.url] = panorama.save_exr_to_buffer()
	var heard: Array = []
	skies.progressed.connect(func(key, fraction): heard.append([key, fraction]))
	_check(not Skies.on_headset(meadow) and Skies.load(meadow) == null, "a published sky not fetched is not on the headset")
	_asked.clear()
	var said: String = await skies.fetch(meadow)
	_check(said == "", "it is fetched: %s" % said)
	_check(_asked == [Skies.FILES_URL % meadow.id, FILES.hdri["1k"].exr.url], "by asking what files it has, then for its 1k panorama: %s" % [_asked])
	_check(heard.size() >= 2 and heard[0] == [meadow.key, 0.0] and is_equal_approx(heard[-1][1], 1.0), "saying how far it has come: %s" % [heard])
	_check(FileAccess.file_exists(Skies.dir.path_join("quiet_meadow_night.exr")), "kept on the headset by its id")
	_check(Skies.on_headset(meadow) and not Skies.is_sharper(meadow), "and is on it now")
	var drawn := Skies.load(meadow)
	_check(drawn != null and drawn.get_width() == 16 and drawn.get_height() == 8, "its panorama reads back")
	_check(Skies.find(meadow.key).name == "Quiet Meadow Night" and Array(Skies.find(meadow.key).authors) == ["A. Walker"], "and is known by its key, made by whom")
	_asked.clear()
	_check(await skies.fetch(meadow) == "" and _asked.is_empty(), "a sky on the headset is not fetched again")
	_check(await skies.sharper(meadow) == "" and _asked == [Skies.FILES_URL % meadow.id, FILES.hdri["2k"].exr.url], "sharper fetches its 2k panorama")
	_check(Skies.is_sharper(meadow) and FileAccess.file_exists(Skies.dir.path_join("quiet_meadow_night-2k.exr")), "and keeps it beside the first")

	offered = await skies.catalogue()
	_check(offered.size() == 3 and offered[1].key == meadow.key, "offline, a sky fetched before is still offered")

	var cloud: Skies.Choice = parsed[3]
	said = await skies.fetch(cloud)
	_check(said == Skies.FAILED and not Skies.on_headset(cloud), "a sky that cannot be fetched says so, and nothing is kept")
	_answers[Skies.FILES_URL % cloud.id] = JSON.stringify({"hdri": {"1k": {"exr": {"url": "https://files.example/1k/pure_cloud_1k.exr"}}}}).to_utf8_buffer()
	_answers["https://files.example/1k/pure_cloud_1k.exr"] = "<html>not a panorama</html>".to_utf8_buffer()
	_check(await skies.fetch(cloud) == Skies.FAILED and not Skies.on_headset(cloud), "nor is what is not a panorama")

	var read := Skies.load(own)
	_check(read != null and read.get_width() == 8 and read.get_height() == 4, "the person's own panorama reads")
	_check(Skies.find(own.key).source == Skies.OWN and Skies.find("own:gone.png").source == Skies.NIGHT, "and a sky no longer here is the night")

	var picture := Image.create(4, 4, false, Image.FORMAT_RGB8)
	picture.fill(Color(0.5, 0.5, 0.9))
	_answers[harbour.thumbnail_url] = picture.save_webp_to_buffer()
	_asked.clear()
	var small: Texture2D = await skies.thumbnail(harbour)
	_check(small != null and small.get_width() == 4 and FileAccess.file_exists(Skies.thumbnail_path(harbour)), "a small picture is fetched and kept")
	_check(await skies.thumbnail(harbour) == small and _asked.size() == 1, "and fetched once")
	_check(await skies.thumbnail(own) == null, "the person's own skies have none")

	skies.queue_free()
	_clear(Skies.dir)
	print("skies_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _fake(url: String, progress: Callable) -> PackedByteArray:
	_asked.append(url)
	await process_frame
	var answer: PackedByteArray = _answers.get(url, PackedByteArray())
	if not answer.is_empty():
		progress.call(0.5)
		progress.call(1.0)
	return answer


func _clear(path: String) -> void:
	if not DirAccess.dir_exists_absolute(path):
		return
	for dir in DirAccess.get_directories_at(path):
		_clear(path.path_join(dir))
	for file in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(file))
	DirAccess.remove_absolute(path)


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("skies_test: does not hold: %s" % what)
