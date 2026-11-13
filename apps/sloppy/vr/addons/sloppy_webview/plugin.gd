@tool
extends EditorPlugin

const Export := preload("res://addons/sloppy_webview/export.gd")

var _export: EditorExportPlugin


func _enter_tree() -> void:
	_export = Export.new()
	add_export_plugin(_export)


func _exit_tree() -> void:
	remove_export_plugin(_export)
	_export = null
