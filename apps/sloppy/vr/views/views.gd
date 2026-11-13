## One view in front of the reader at a time, and the way back through the ones
## before it. A view is `res://views/<name>.tscn` whose root script has
## `func enter(args: Dictionary)`.
extends Node

signal shown(view: String)

## Where a view is put; `main.tscn` names it, and until then it is this node.
var stage: Node = self

var _stack: Array[Dictionary] = []
var _current: Node = null


## Put the view `view` in front, remembering the one it replaces.
func show(view: String, args: Dictionary = {}) -> void:
	_stack.push_back({"name": view, "args": args})
	_put(view, args)


## The view before this one, as it was entered. Nothing where there is none.
func back() -> void:
	if _stack.size() < 2:
		return
	_stack.pop_back()
	var before: Dictionary = _stack.back()
	_put(before.name, before.args)


## The view in front, or "" before the first.
func current() -> String:
	return _stack.back().name if not _stack.is_empty() else ""


func _put(view: String, args: Dictionary) -> void:
	var scene := load("res://views/%s.tscn" % view) as PackedScene
	if scene == null:
		push_error("There is no view called %s." % view)
		return
	if _current != null:
		_current.queue_free()
	_current = scene.instantiate()
	stage.add_child(_current)
	if _current.has_method("enter"):
		_current.enter(args)
	shown.emit(view)
