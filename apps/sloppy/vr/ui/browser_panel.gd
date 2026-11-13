## A page from the web opened from a note, standing in the room ahead of the
## reader at reading distance, with Back and Close; taken hold of, it goes
## where the hand takes it. One at a time: a second link opens in it.
extends "res://ui/web_panel.gd"

const GROUP := "browser"
## In metres, from the eyes, and below them.
const READING := 0.75
const BELOW_EYES := 0.08


## Opens `url` on the room's one browser panel, making it ahead of the eyes
## `from` is seen by where there is none yet.
static func show_page(from: Node, url: String) -> Node3D:
	var tree := from.get_tree()
	var panel: Node3D = tree.get_first_node_in_group(GROUP)
	if panel == null or panel.is_queued_for_deletion():
		panel = (load("res://ui/browser_panel.gd") as GDScript).new()
		var view := _view(tree)
		view.add_child(panel)
		panel.global_transform = _ahead(from.get_viewport().get_camera_3d())
		if view.has_method("aim_at"):
			view.aim_at(panel)
	panel.open_url(url)
	return panel


func _init() -> void:
	carries_itself = true
	add_to_group(GROUP)


static func _view(tree: SceneTree) -> Node:
	var stage: Node = tree.root.get_node_or_null("Views")
	if stage != null:
		stage = stage.stage
		for i in range(stage.get_child_count() - 1, -1, -1):
			var child := stage.get_child(i)
			if child is Node3D and not child.is_queued_for_deletion():
				return child
	return tree.current_scene if tree.current_scene != null else tree.root


## Level ahead of `eyes`, turned to face them.
static func _ahead(eyes: Camera3D) -> Transform3D:
	if eyes == null:
		return Transform3D(Basis(), Vector3(0.0, 1.5, -READING))
	var forward := -eyes.global_basis.z
	forward.y = 0.0
	forward = forward.normalized() if forward.length() > 1e-3 else Vector3.FORWARD
	var at := eyes.global_position + forward * READING + Vector3.DOWN * BELOW_EYES
	return Transform3D(Basis.looking_at(forward, Vector3.UP), at)
