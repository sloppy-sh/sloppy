## What the panel tests hold every row to: its words on one line inside its
## card, four edges round it, and no two of its quads, or two rows' cards and
## edges, drawn at one depth over the same place. Each answers what does not
## hold, in words; empty where it all does.
extends RefCounted


static func words_fit(under: Node, what: String) -> Array[String]:
	var failed: Array[String] = []
	for found in under.find_children("*", "Label3D", true, false):
		var said := found as Label3D
		var row := said.get_parent()
		if said.is_queued_for_deletion() or not row.has_meta("height") or said.text == "":
			continue
		var card := Rect2()
		for piece in row.get_children():
			if piece.has_meta("card"):
				card = covers(piece)
		var drawn := said.get_aabb()
		var tall: float = row.get_meta("height")
		var line := said.font_size * said.pixel_size * 1.5
		var left := said.position.x + drawn.position.x
		var right := left + drawn.size.x
		var top := said.position.y + drawn.end.y
		var bottom := said.position.y + drawn.position.y
		if not (drawn.size.y <= minf(tall, line) and left >= card.position.x - 1e-4 and right <= card.end.x + 1e-4 and top <= 1e-4 and bottom >= -tall - 1e-4):
			failed.append("%s: \"%s\" stands on one line in its card (%.3f x %.3f m from %.3f, %.3f, in one ending at %.3f, %.3f tall)" % [what, said.text, drawn.size.x, drawn.size.y, left, top, card.end.x, tall])
	failed.append_array(nothing_coplanar(under, what))
	failed.append_array(glyphs_drawn(under, what))
	return failed


static func glyphs_drawn(under: Node, what: String) -> Array[String]:
	var failed: Array[String] = []
	for shown in under.find_children("*", "Sprite3D", true, false):
		if shown.has_meta("tint") and shown.texture == null and not shown.is_queued_for_deletion():
			var words: Array = shown.get_parent().find_children("*", "Label3D", false, false)
			failed.append("%s: the row \"%s\" has its glyph" % [what, words[0].text if not words.is_empty() else ""])
	return failed


static func nothing_coplanar(under: Node, what: String) -> Array[String]:
	var failed: Array[String] = []
	var drawn: Array[MeshInstance3D] = []
	for row in under.find_children("*", "Node3D", true, false):
		if not row.has_meta("height") or row.is_queued_for_deletion():
			continue
		var quads: Array[MeshInstance3D] = []
		var edged := 0
		for piece in row.get_children():
			if piece is MeshInstance3D and piece.mesh is QuadMesh:
				quads.append(piece)
				edged += int(piece.has_meta("edge"))
				if piece.has_meta("edge") or piece.has_meta("card"):
					drawn.append(piece)
		if quads.is_empty():
			continue
		if edged != 4:
			failed.append("%s: a row is edged on four sides, %d were" % [what, edged])
		for one in quads.size():
			for other in range(one + 1, quads.size()):
				var overlap := covers(quads[one]).intersection(covers(quads[other]))
				if is_equal_approx(quads[one].position.z, quads[other].position.z) and overlap.get_area() >= 1e-9:
					failed.append("%s: two quads of a row share %.6f m² at one depth" % [what, overlap.get_area()])
	for one in drawn.size():
		for other in range(one + 1, drawn.size()):
			if drawn[one].get_parent() != drawn[other].get_parent():
				var shared := shared_in_plane(drawn[one], drawn[other])
				if shared >= 1e-9:
					failed.append("%s: quads of two rows share %.6f m² at one depth" % [what, shared])
	return failed


## The area `a` and `b` cover together where they stand in one plane, facing one way.
static func shared_in_plane(a: MeshInstance3D, b: MeshInstance3D) -> float:
	var seen := a.global_transform.affine_inverse() * b.global_transform
	if not seen.basis.is_equal_approx(Basis.IDENTITY) or absf(seen.origin.z) > 1e-6:
		return 0.0
	var size_a := (a.mesh as QuadMesh).size
	var size_b := (b.mesh as QuadMesh).size
	var covered_a := Rect2(-size_a / 2.0, size_a)
	var covered_b := Rect2(Vector2(seen.origin.x, seen.origin.y) - size_b / 2.0, size_b)
	return covered_a.intersection(covered_b).get_area()


static func covers(quad: MeshInstance3D) -> Rect2:
	var size := (quad.mesh as QuadMesh).size
	return Rect2(Vector2(quad.position.x, quad.position.y) - size / 2.0, size)


## Whether the row `label` stands on is chosen: its card filled with ink.
static func chosen(label: Label3D, ink: Color) -> bool:
	if label == null:
		return false
	for piece in label.get_parent().get_children():
		if piece.has_meta("card"):
			return (piece.material_override as StandardMaterial3D).albedo_color.is_equal_approx(ink)
	return false
