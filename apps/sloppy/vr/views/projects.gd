## The projects the desk is serving, to point at; choosing one shows its graph.
extends Node3D

const Pieces := preload("res://ui/pieces.gd")
const Pointing := preload("res://ui/pointing.gd")
const HandMenu := preload("res://ui/hand_menu.gd")
const Room := preload("res://room/room.gd")

const WIDTH := 0.7
const ASKING := "Asking the desk…"

@onready var _panel: Node3D = $Panel

## What the desk answered; null while it is being asked.
var _served: Variant = null


func enter(_args: Dictionary) -> void:
	Pointing.ensure(get_tree())
	HandMenu.ensure(get_tree())
	var room := Room.of(get_tree())
	if room != null and not room.dressed.is_connected(_redress):
		room.dressed.connect(_redress)
	_served = null
	_redress()
	_served = await Client.projects()
	if not is_inside_tree():
		return
	_list(_served)


func _redress() -> void:
	if _served is Array:
		_list(_served)
	else:
		_show([Pieces.words(ASKING, WIDTH, Pieces.SMALL, Pieces.QUIET)])


func _list(served: Array) -> void:
	var pieces: Array = [Pieces.words("Projects", WIDTH, Pieces.SIZE + 8)]
	if served.is_empty():
		pieces.append(Pieces.words(
			"This desk is not serving a project. Open a folder in Sloppy on the desk and look again.",
			WIDTH, Pieces.SMALL))
		pieces.append(Pieces.row("Look again", WIDTH, enter.bind({})))
	for project in served:
		if project is Dictionary:
			pieces.append(Pieces.row(str(project.get("name", "")), WIDTH, _choose.bind(str(project.get("id", "")), str(project.get("name", "")))))
	_show(pieces)


func _choose(project: String, named: String) -> void:
	HandMenu.project = project
	HandMenu.project_name = named
	Views.show("graph", {"project": project})


func _show(pieces: Array) -> void:
	for piece in _panel.get_children():
		piece.queue_free()
	Pieces.stack(_panel, pieces)
