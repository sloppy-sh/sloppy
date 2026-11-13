## Hands the web view plugin's library to an Android export where the preset
## turns it on; tools/build-webview.sh makes the library.
@tool
extends EditorExportPlugin

const ENABLED := "sloppy_webview/enabled"
const LIBRARY := "sloppy_webview/bin/sloppy_webview-%s.aar"


func _get_name() -> String:
	return "SloppyWebView"


func _supports_platform(platform: EditorExportPlatform) -> bool:
	return platform is EditorExportPlatformAndroid


func _get_export_options(platform: EditorExportPlatform) -> Array[Dictionary]:
	if not platform is EditorExportPlatformAndroid:
		return []
	return [{"option": {"name": ENABLED, "type": TYPE_BOOL}, "default_value": false}]


func _get_export_option_warning(platform: EditorExportPlatform, option: String) -> String:
	if option != ENABLED or not get_option(ENABLED):
		return ""
	for debug in [true, false]:
		if not FileAccess.file_exists("res://addons/" + _library(debug)):
			return "Run tools/build-webview.sh to build the web view plugin."
	return ""


## Relative to res://addons/, as Godot reads it.
func _get_android_libraries(platform: EditorExportPlatform, debug: bool) -> PackedStringArray:
	if not _enabled(platform):
		return PackedStringArray()
	return PackedStringArray([_library(debug)])


func _enabled(platform: EditorExportPlatform) -> bool:
	return platform is EditorExportPlatformAndroid and get_option(ENABLED)


static func _library(debug: bool) -> String:
	return LIBRARY % ("debug" if debug else "release")
