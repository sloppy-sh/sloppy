## The room: the reader's head and hands, and the stage the views stand on,
## put before the reader's eyes each time a view is shown.
extends Node3D

const Reach := preload("res://interaction/reach.gd")
## Seconds from starting, or from a recentre, in which the stage follows the
## eyes, while the headset is still finding where they are.
const SETTLING := 1.5

var _settling := SETTLING


func _ready() -> void:
	var openxr := XRServer.find_interface("OpenXR")
	if openxr != null and openxr.is_initialized():
		# The headset paces the frames, not the monitor.
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		get_viewport().use_xr = true
		openxr.pose_recentered.connect(_recentered)
	Views.stage = $Stage
	Views.shown.connect(_stand_stage)
	Views.show("connect")


func _process(delta: float) -> void:
	if _settling > 0.0:
		_settling -= delta
		_stand_stage("")


## A view stands where the reader is looking now, at the height of their eyes.
func _stand_stage(_view: String) -> void:
	$Stage.global_transform = Reach.stage_before($XROrigin3D/XRCamera3D.global_transform)


## The headset's own recentre (holding its system button) puts the reader back
## where they are looking, keeping the floor and the tilt; the view follows.
func _recentered() -> void:
	XRServer.center_on_hmd(XRServer.RESET_BUT_KEEP_TILT, true)
	_settling = SETTLING
