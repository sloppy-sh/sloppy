## A note's sections as the panel draws them. Run from apps/sloppy/vr with
## `Godot --headless --script res://tests/markdown_test.gd`.
extends SceneTree

const Markdown := preload("res://ui/markdown_to_bbcode.gd")

var _failed := 0
var _asked := 0
var _answered := 0
var _label := RichTextLabel.new()


func _initialize() -> void:
	_label.bbcode_enabled = true
	root.add_child(_label)

	_reads("# Why\nIt is so.", "Why\n\nIt is so.")
	_says("## Why it is", "[font_size=34][b]Why it is[/b][/font_size]")
	_reads("one\ntwo", "one two")
	_reads("one\\\ntwo", "one\ntwo")
	_says("a **strong** and *soft* and _soft_ and ~~gone~~", "a [b]strong[/b] and [i]soft[/i] and [i]soft[/i] and [s]gone[/s]")
	_reads("snake_case_name stays", "snake_case_name stays")
	_reads("2 * 3 * 4", "2 * 3 * 4")
	_says("call `f[0]` now", "call [code]f[lb]0[rb][/code] now")
	_reads("call `f[0]` now", "call f[0] now")
	_reads("- one\n- two\n  - under", "\t• one\n\t• two\n\t\t• under")
	_says("- one\n  - under", "[indent]• one[/indent]\n[indent][indent]• under[/indent][/indent]")
	_reads("1. first\n2. second", "\t1. first\n\t2. second")
	_reads("- [ ] to do\n- [x] done", "\t[  ] to do\n\t[x] done")
	_reads("- one\n  carried on", "\t• one carried on")
	_says("```ts\nconst a = [1];\n**not bold**\n```", "[code]const a = [lb]1[rb];\n**not bold**[/code]")
	_reads("````\n```\ninner\n```\n````", "```\ninner\n```")
	_reads("![the garden at dusk](media/01J8ZQ7X9KACDEFGHJKMNPQRST.png)", Markdown.PICTURE_NAMED % "the garden at dusk")
	_reads("![a \\[rough\\] sketch](.sloppy/ink/01J8ZQ7X9KACDEFGHJKMNPQRST-0.svg)", Markdown.DRAWING_NAMED % "a [rough] sketch")
	_reads("![](media/01J8ZQ7X9KACDEFGHJKMNPQRST.png)", Markdown.PICTURE)
	_reads("![](.sloppy/ink/01J8ZQ7X9KACDEFGHJKMNPQRST-0.svg)", Markdown.DRAWING)
	_reads("see [the plan](sloppy:did:syr:z6MkA/01J8ZQ7X9KACDEFGHJKMNPQRST) first", "see the plan first")
	_reads("idea: [[did:syr:z6MkA/01J8ZQ7X9KACDEFGHJKMNPQRST]]", "idea: " + Markdown.CITED)
	var cited := {"did:syr:z6MkA/01J8ZQ7X9KACDEFGHJKMNPQRST": "1a  The [first] plan"}
	_says("idea: [[did:syr:z6MkA/01J8ZQ7X9KACDEFGHJKMNPQRST]]", "idea: [u]1a  The [lb]first[rb] plan[/u]", cited)
	_says("idea: [[did:syr:z6MkA/01J8ZQ7X9KACDEFGHJKMNPQRST]]", "idea: [u]a note[/u]", {})
	_says("see [](sloppy:did:syr:z6MkA/01J8ZQ7X9KACDEFGHJKMNPQRST)", "see [u]1a  The [lb]first[rb] plan[/u]", cited)
	_says("see [](sloppy:did:syr:z6MkB/01J8ZQ7X9KACDEFGHJKMNPQRST)", "see [u]a note[/u]", cited)
	_says("> quoting [[did:syr:z6MkA/01J8ZQ7X9KACDEFGHJKMNPQRST]]", "[indent][i]quoting [u]1a  The [lb]first[rb] plan[/u][/i][/indent]", cited)
	_reads("[b]not a tag[/b] and [url=x]y[/url]", "[b]not a tag[/b] and [url=x]y[/url]")
	_reads("\\# not a heading \\: and \\[x\\]", "# not a heading : and [x]")
	_reads("before\n\n<!-- -->\n\nafter <!-- sloppy:inline {\"a\":1} -->", "before\n\nafter")
	_reads("> quoted\n> still", "\tquoted still")
	_reads("| a | b |\n| - | - |", "| a | b |\n| - | - |")
	_reads("$$\nx^2\n$$", "x^2")
	_reads("---", "·   ·   ·")
	_reads("**unclosed", "**unclosed")

	_failed += _asked - _answered
	print("markdown_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _says(markdown: String, bbcode: String, named: Dictionary = {}) -> void:
	_asked += 1
	var said := Markdown.to_bbcode(markdown, named)
	if said != bbcode:
		_failed += 1
		printerr("  FAIL: %s\n    gave     %s\n    expected %s" % [markdown.c_escape(), said.c_escape(), bbcode.c_escape()])
	_answered += 1


## What a reader sees: the converted section drawn, as plain text.
func _reads(markdown: String, plain: String) -> void:
	_asked += 1
	_label.text = Markdown.to_bbcode(markdown)
	var seen := _label.get_parsed_text()
	if seen != plain:
		_failed += 1
		printerr("  FAIL: %s\n    reads    %s\n    expected %s" % [markdown.c_escape(), seen.c_escape(), plain.c_escape()])
	_answered += 1
