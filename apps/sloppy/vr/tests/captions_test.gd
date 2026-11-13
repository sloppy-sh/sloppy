## Where a title stands about its mark, clear of the titles already written. Run
## from apps/sloppy/vr with `Godot --headless --script res://tests/captions_test.gd`.
extends SceneTree

const Captions := preload("res://field/captions.gd")
const Labels := preload("res://field/labels.gd")
const Lod := preload("res://field/lod.gd")


class Cluster extends Node3D:
	var at := PackedVector3Array()

	func local_at(index: int) -> Vector3:
		return at[index]

	func radius() -> float:
		return Lod.MARK_RADIUS

	func wearing(_index: int) -> float:
		return 0.0


var _failed := 0


func _initialize() -> void:
	_right_then_left_then_above_then_below()
	_none_where_every_place_is_taken()
	_a_cluster_reads_without_one_title_over_another.call_deferred()


func _check(holds: bool, said: String) -> void:
	if not holds:
		_failed += 1
		printerr("  FAIL: ", said)


func _right_then_left_then_above_then_below() -> void:
	var placed: Array[Rect2] = []
	var tried := [Rect2(0.1, -0.05, 1.0, 0.1), Rect2(-1.1, -0.05, 1.0, 0.1), Rect2(-0.5, 0.1, 1.0, 0.1), Rect2(-0.5, -0.2, 1.0, 0.1)]
	for box in tried:
		var got: Variant = Captions.place(Vector2.ZERO, 0.1, 1.0, 0.1, placed)
		_check(got is Rect2 and (got as Rect2).is_equal_approx(box), "took %s, wanted %s" % [got, box])
		placed.append(box)


func _none_where_every_place_is_taken() -> void:
	var placed: Array[Rect2] = [Rect2(-5.0, -5.0, 10.0, 10.0)]
	_check(Captions.place(Vector2.ZERO, 0.1, 1.0, 0.1, placed) == null, "no place under a wall of words")
	var narrow: Array[Rect2] = [Rect2(-2.0, -0.06, 4.0, 0.12)]
	_check(Captions.place(Vector2.ZERO, 0.1, 1.0, 0.1, narrow) is Rect2, "above or below a line that fills the sides")


func _a_cluster_reads_without_one_title_over_another() -> void:
	var cluster := Cluster.new()
	var said: Array[String] = []
	var cited: Array[String] = []
	for index in 12:
		cluster.at.append(Vector3(0.004 * index, 0.003 * (index % 3), -0.4 - 0.002 * index))
		said.append("1a%d  Note number %d about something" % [index, index])
		cited.append("1a%d" % index)
	root.add_child(cluster)
	var labels := Labels.new()
	root.add_child(labels)
	labels.build(cluster, said, cited, Color.BLACK, Color.WHITE)
	var distances := PackedFloat32Array()
	var facing := PackedFloat32Array()
	for index in 12:
		distances.append(cluster.at[index].length())
		facing.append(cluster.at[index].normalized().dot(Vector3.FORWARD))
	labels.choose(distances, facing)
	labels.follow(Vector3.ZERO, Basis.IDENTITY)
	_check(labels._placed.size() > 1, "more than one of a close cluster is titled, %d were" % labels._placed.size())
	for one in labels._placed.size():
		for other in range(one + 1, labels._placed.size()):
			_check(not labels._placed[one].intersects(labels._placed[other]), "titles %d and %d overlap" % [one, other])
	var standing := 0
	for label in labels.get_children():
		standing += int(label.visible)
	_check(standing == labels._placed.size(), "only the placed titles stand")
	print("captions_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)
