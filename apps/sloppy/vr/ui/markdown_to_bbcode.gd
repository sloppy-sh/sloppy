## A section of a note, as `read_note` gives its markdown, in the BBCode a
## RichTextLabel draws: headings, paragraphs, lists, quotes, code as code, and a
## picture or a drawing as the words its author gave it, and a citation as the
## cited note's address and title where the reader has them. Nothing the
## markdown holds is taken for a tag of its own.
extends RefCounted

const HEADING_SIZES := [40, 34, 30, 27, 26, 26]
const PICTURE := "A picture"
const DRAWING := "A drawing"
const PICTURE_NAMED := "Picture: %s"
const DRAWING_NAMED := "Drawing: %s"
const CITED := "a note"

## Characters no note holds, standing in for pieces already converted.
const HELD_OPEN := ""
const HELD_CLOSE := ""
const LINK_OPEN := ""
const LINK_CLOSE := ""

static var _fence := RegEx.create_from_string("^\\s*(`{3,}|~{3,})")
static var _heading := RegEx.create_from_string("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
static var _bare_heading := RegEx.create_from_string("^#{1,6}\\s*$")
static var _rule := RegEx.create_from_string("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
static var _item := RegEx.create_from_string("^(\\s*)([-*+]|\\d+[.)])\\s+(\\[[ xX]\\]\\s+)?(.*)$")
static var _quote := RegEx.create_from_string("^\\s*>\\s?(.*)$")
static var _table := RegEx.create_from_string("^\\s*\\|.*\\|\\s*$")
static var _delimiter := RegEx.create_from_string("^\\s*\\|?\\s*:?-+:?\\s*(\\|\\s*:?-+:?\\s*)*\\|?\\s*$")
static var _comment := RegEx.create_from_string("<!--[\\s\\S]*?-->")
static var _code_span := RegEx.create_from_string("(`+)([\\s\\S]*?[^`])\\1(?!`)")
static var _escaped := RegEx.create_from_string("\\\\([!-/:-@\\[-`{-~])")
static var _picture := RegEx.create_from_string("!\\[([^\\]]*)\\]\\(([^)]*)\\)")
static var _cited := RegEx.create_from_string("\\[\\[([^\\]]*)\\]\\]")
static var _cited_unnamed := RegEx.create_from_string("\\[\\]\\(sloppy:([^)]*)\\)")
static var _link := RegEx.create_from_string("\\[([^\\]]*)\\]\\(([^)]*)\\)")
static var _strong := RegEx.create_from_string("(\\*\\*|__)(?=\\S)([\\s\\S]+?)(?<=\\S)\\1")
static var _struck := RegEx.create_from_string("~~(?=\\S)([\\s\\S]+?)(?<=\\S)~~")
static var _em_star := RegEx.create_from_string("\\*(?=\\S)([^*]+?)(?<=\\S)\\*")
static var _em_line := RegEx.create_from_string("(?<![A-Za-z0-9_])_(?=\\S)([^_]+?)(?<=\\S)_(?![A-Za-z0-9_])")
static var _held := RegEx.create_from_string(HELD_OPEN + "(\\d+)" + HELD_CLOSE)
## What each note a citation may name is called, by ref, for the conversion under way.
static var _naming := {}


## `named` is what each note is called where the reader has it, by ref; a
## citation of any other says only that it is a note.
static func to_bbcode(markdown: String, named: Dictionary = {}) -> String:
	_naming = named
	var lines := _comment.sub(markdown.replace("\r\n", "\n"), "", true).split("\n")
	var blocks: Array[String] = []
	var paragraph: Array[String] = []
	var at := 0
	while at < lines.size():
		var line: String = lines[at]
		var fence := _fence.search(line)
		if fence != null:
			_close(paragraph, blocks)
			var bar := fence.get_string(1)
			var code: Array[String] = []
			at += 1
			while at < lines.size() and not lines[at].strip_edges().begins_with(bar):
				code.append(lines[at])
				at += 1
			blocks.append(_code("\n".join(code)))
			at += 1
			continue
		if line.strip_edges() == "$$":
			_close(paragraph, blocks)
			var tex: Array[String] = []
			at += 1
			while at < lines.size() and lines[at].strip_edges() != "$$":
				tex.append(lines[at])
				at += 1
			blocks.append(_code("\n".join(tex)))
			at += 1
			continue
		if line.strip_edges() == "":
			_close(paragraph, blocks)
		elif _heading.search(line) != null or _bare_heading.search(line) != null:
			_close(paragraph, blocks)
			blocks.append(_heading_of(line))
		elif _rule.search(line) != null:
			_close(paragraph, blocks)
			blocks.append("[center]·   ·   ·[/center]")
		elif _table.search(line) != null:
			_close(paragraph, blocks)
			var rows: Array[String] = []
			while at < lines.size():
				if _table.search(lines[at]) != null:
					rows.append(lines[at].strip_edges())
					at += 1
					continue
				var next := at
				while next < lines.size() and lines[next].strip_edges() == "":
					next += 1
				if next == at or next >= lines.size() or _table.search(lines[next]) == null:
					break
				at = next
			blocks.append(_table_of(rows))
			continue
		elif _quote.search(line) != null:
			_close(paragraph, blocks)
			var quoted: Array[String] = []
			while at < lines.size() and _quote.search(lines[at]) != null:
				quoted.append(_quote.search(lines[at]).get_string(1))
				at += 1
			blocks.append("[indent][i]" + to_bbcode("\n".join(quoted), _naming) + "[/i][/indent]")
			continue
		elif _item.search(line) != null:
			_close(paragraph, blocks)
			var items: Array[Dictionary] = []
			while at < lines.size() and lines[at].strip_edges() != "":
				var item := _item.search(lines[at])
				if item != null:
					items.append(_item_of(item))
				else:
					items[-1].words += " " + inline(lines[at].strip_edges())
				at += 1
			var written: Array[String] = []
			for each in items:
				written.append("[indent]".repeat(each.depth) + each.marker + " " + each.words + "[/indent]".repeat(each.depth))
			blocks.append("\n".join(written))
			continue
		else:
			paragraph.append(line)
		at += 1
	_close(paragraph, blocks)
	return "\n\n".join(blocks)


## A markdown table's rows as a BBCode table, its first row bold; the row of
## dashes under the head is dropped. Rows that are not a table stay as written.
static func _table_of(rows: Array[String]) -> String:
	var cells: Array = []
	var widest := 0
	for row in rows:
		var trimmed := row.strip_edges().trim_prefix("|").trim_suffix("|")
		var parts := trimmed.split("|")
		if _delimiter.search(row) != null:
			continue
		cells.append(parts)
		widest = maxi(widest, parts.size())
	if cells.size() < 2 or widest < 2:
		return _code("\n".join(rows))
	var out := "[table=%d]" % widest
	for at in cells.size():
		var parts: PackedStringArray = cells[at]
		for column in widest:
			var said := inline(parts[column].strip_edges()) if column < parts.size() else ""
			out += "[cell padding=6,2,6,2]" + ("[b]%s[/b]" % said if at == 0 else said) + "[/cell]"
	return out + "[/table]"


## One line of markdown's inline marks as BBCode.
static func inline(text: String) -> String:
	var held: Array[String] = []
	var out := text
	out = _hold_all(out, _code_span, held, func(found: RegExMatch): return "[code]" + escape(found.get_string(2).strip_edges()) + "[/code]")
	out = _hold_all(out, _escaped, held, func(found: RegExMatch): return escape(found.get_string(1)))
	out = _hold_all(out, _picture, held, func(found: RegExMatch): return "[i]" + _picture_name(found) + "[/i]")
	out = _hold_all(out, _cited, held, _citation)
	out = _hold_all(out, _cited_unnamed, held, _citation)
	out = _link.sub(out, LINK_OPEN + "$1" + LINK_CLOSE, true)
	out = escape(out)
	out = _strong.sub(out, "[b]$2[/b]", true)
	out = _struck.sub(out, "[s]$1[/s]", true)
	out = _em_star.sub(out, "[i]$1[/i]", true)
	out = _em_line.sub(out, "[i]$1[/i]", true)
	out = out.replace(LINK_OPEN, "[u]").replace(LINK_CLOSE, "[/u]")
	# A piece held inside another (an escape in a picture's name) comes back on the next pass.
	for _pass in 3:
		for each in _held.search_all(out):
			var at := int(each.get_string(1))
			out = out.replace(each.get_string(), held[at] if at < held.size() else "")
	return out


## `text` with every bracket written as the BBCode for itself.
static func escape(text: String) -> String:
	var out := ""
	for character in text:
		if character == "[":
			out += "[lb]"
		elif character == "]":
			out += "[rb]"
		else:
			out += character
	return out


static func _hold_all(text: String, pattern: RegEx, held: Array[String], made: Callable) -> String:
	var out := ""
	var from := 0
	for found in pattern.search_all(text):
		out += text.substr(from, found.get_start() - from)
		out += HELD_OPEN + str(held.size()) + HELD_CLOSE
		held.append(made.call(found))
		from = found.get_end()
	return out + text.substr(from)


static func _citation(found: RegExMatch) -> String:
	var named := str(_naming.get(found.get_string(1).strip_edges(), ""))
	return "[u]" + (escape(named) if named != "" else CITED) + "[/u]"


static func _picture_name(found: RegExMatch) -> String:
	var named := found.get_string(1).strip_edges()
	var drawing := found.get_string(2).contains("/ink/")
	if named == "":
		return DRAWING if drawing else PICTURE
	return (DRAWING_NAMED if drawing else PICTURE_NAMED) % escape(named)


static func _close(paragraph: Array[String], blocks: Array[String]) -> void:
	if paragraph.is_empty():
		return
	var joined := ""
	for at in paragraph.size():
		var line := paragraph[at]
		var broken := line.ends_with("\\") or line.ends_with("  ")
		joined += inline(line.strip_edges().trim_suffix("\\"))
		if at < paragraph.size() - 1:
			joined += "\n" if broken else " "
	blocks.append(joined)
	paragraph.clear()


static func _code(source: String) -> String:
	return "[code]" + escape(source) + "[/code]"


static func _heading_of(line: String) -> String:
	var found := _heading.search(line)
	var level := found.get_string(1).length() if found != null else line.strip_edges().length()
	var words := inline(found.get_string(2)) if found != null else ""
	return "[font_size=%d][b]%s[/b][/font_size]" % [HEADING_SIZES[level - 1], words]


## `{depth, marker, words}`, depth from 1.
static func _item_of(found: RegExMatch) -> Dictionary:
	var marker := found.get_string(2)
	var task := found.get_string(3).strip_edges()
	if task != "":
		marker = "[lb]x[rb]" if task.to_lower() == "[x]" else "[lb]  [rb]"
	elif marker in ["-", "*", "+"]:
		marker = "•"
	return {
		"depth": found.get_string(1).replace("\t", "  ").length() / 2 + 1,
		"marker": marker,
		"words": inline(found.get_string(4)),
	}
