## The marks' pictures: worn as a disc on the mark, its rim broken where the
## note is pulled. Exits 1 on a failure.
extends SceneTree

const Marks := preload("res://field/marks.gd")
const Room := preload("res://room/room.gd")

const OWNER := "did:syr:z6MkMarksTestOwner"
const PEER := "did:syr:z6MkMarksTestPeer"

var _failed := 0


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var own := OWNER + "/01JAAAAAAAAAAAAAAAAAAAAAAA"
	var theirs := PEER + "/01JBBBBBBBBBBBBBBBBBBBBBBB"
	var placed := {
		own: {"position": Vector3.ZERO, "parent": "", "depth": 1},
		theirs: {"position": Vector3(1, 0, 0), "parent": own, "depth": 2},
	}
	var notes := {own: {"note": own, "picture": true}, theirs: {"note": theirs, "picture": true}}
	var marks := Marks.new()
	root.add_child(marks)
	var drawn: Array[String] = []
	marks.build(placed, notes, Room.palette(), drawn, OWNER)
	var picture := Image.create(4, 4, false, Image.FORMAT_RGBA8)
	picture.fill(Color.WHITE)
	marks.wear(own, picture)
	marks.wear(theirs, picture.duplicate())
	_check(marks.pulled.has(theirs) and not marks.pulled.has(own), "a note in somebody else's graph is pulled")
	_check(_broken(marks, theirs), "a pulled mark's picture has its rim broken")
	_check(not _broken(marks, own), "an own mark's picture has its rim whole")
	_fades(marks, own, theirs)
	marks.free()
	print("marks_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


## A picture comes up and goes over a moment, never at once, and a mark that
## comes back into range mid-fade turns round from where it was.
func _fades(marks: Node3D, own: String, theirs: String) -> void:
	marks.set_process(false)
	var at: int = marks.refs.find(own)
	var shown: Array[int] = [at]
	_check(not marks.showing_picture(own) and _alpha(marks, own) == 0.0, "a picture is not up before it is asked for")
	marks.show_pictures(shown)
	_check(not marks.showing_picture(own), "nor the moment it is")
	marks.fade(Marks.FADING * 0.5)
	_check(marks.showing_picture(own) and _alpha(marks, own) > 0.0 and _alpha(marks, own) < 1.0, "it comes up: %.2f" % _alpha(marks, own))
	_check(not marks.showing_picture(theirs), "and only the one asked for")
	marks.fade(Marks.FADING * 0.5)
	_check(is_equal_approx(_alpha(marks, own), 1.0), "and is whole after %.1f s" % Marks.FADING)
	_check(marks.wearing(at) > 0.0 and marks.wearing(marks.refs.find(theirs)) == 0.0, "the mark wearing it says so, the other does not")
	marks.show_pictures([])
	marks.fade(Marks.FADING * 0.25)
	var going := _alpha(marks, own)
	_check(marks.showing_picture(own) and going < 1.0 and going > 0.0, "out of range it goes, not at once: %.2f" % going)
	marks.show_pictures(shown)
	marks.fade(Marks.FADING * 0.1)
	_check(_alpha(marks, own) > going, "back in range mid-fade, it turns round from where it was")
	marks.fade(Marks.FADING)
	_check(is_equal_approx(_alpha(marks, own), 1.0), "and stands whole")
	marks.show_pictures([])
	marks.fade(Marks.FADING)
	_check(not marks.showing_picture(own) and _alpha(marks, own) == 0.0 and marks.wearing(at) == 0.0, "gone after %.1f s, and drawn no more" % Marks.FADING)
	marks.show_pictures(shown)
	marks.fade(Marks.FADING * 2.0)
	var paint := marks._discs[own].material_override as ShaderMaterial
	_check(paint.render_priority > 0, "a picture is drawn after what it stands in front of")


func _alpha(marks: Node3D, ref: String) -> float:
	return (marks._discs[ref].material_override as ShaderMaterial).get_shader_parameter("alpha")


func _broken(marks: Node3D, ref: String) -> bool:
	return (marks._discs[ref].material_override as ShaderMaterial).get_shader_parameter("broken") == true


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("marks_test: does not hold: %s" % what)
