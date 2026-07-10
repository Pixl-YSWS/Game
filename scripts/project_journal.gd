extends Control

signal closed

const COLOR_ACCENT := Color(1, 0.819608, 0.4)

@onready var _title: Label = %Title
@onready var _entries: VBoxContainer = %Entries
@onready var _toolbar: HBoxContainer = %Toolbar
@onready var _editor: TextEdit = %Editor
@onready var _hours: SpinBox = %Hours
@onready var _error: Label = %ErrorLabel
@onready var _back_button: Button = %BackButton
@onready var _add_button: Button = %AddButton

var _project_id := 0
var _submitting := false

func _ready() -> void:
	visible = false
	_back_button.pressed.connect(func(): closed.emit())
	_add_button.pressed.connect(_submit)
	_build_toolbar()

func open(project: Dictionary) -> void:
	_project_id = int(project.get("id", 0))
	var pname := String(project.get("name", "")).strip_edges()
	if pname.length() > 24:
		pname = pname.substr(0, 24) + "…"
	_title.text = "JOURNAL — %s" % pname.to_upper()
	_editor.text = ""
	_hours.value = 0
	_error.visible = false
	_set_submitting(false)
	visible = true
	_clear_entries()
	_entries.add_child(_muted("Loading…"))
	_refresh()
	_editor.grab_focus()

func _build_toolbar() -> void:
	var actions := [
		["B", "**", "**", false],
		["I", "*", "*", false],
		["H", "# ", "", true],
		["Code", "`", "`", false],
		["List", "- ", "", true],
		["Link", "[", "](https://)", false],
	]
	for a in actions:
		var b := Button.new()
		b.theme_type_variation = &"StepButton"
		b.text = a[0]
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(_apply_markdown.bind(a[1], a[2], a[3]))
		_toolbar.add_child(b)

func _apply_markdown(prefix: String, suffix: String, line_prefix: bool) -> void:
	if line_prefix:
		var line := _editor.get_caret_line()
		_editor.set_line(line, prefix + _editor.get_line(line))
		_editor.set_caret_column(_editor.get_line(line).length())
	else:
		var sel := _editor.get_selected_text()
		if sel != "":
			_editor.insert_text_at_caret(prefix + sel + suffix)
		else:
			_editor.insert_text_at_caret(prefix + suffix)
			_editor.set_caret_column(maxi(_editor.get_caret_column() - suffix.length(), 0))
	_editor.grab_focus()

func _submit() -> void:
	if _submitting:
		return
	var content := _editor.text.strip_edges()
	if content == "":
		_show_error("Write something first.")
		_editor.grab_focus()
		return
	_set_submitting(true)
	_api(HTTPClient.METHOD_POST, "/api/projects/%d/journal" % _project_id, {"content": content, "hours": _hours.value}, func(code, _json):
		_set_submitting(false)
		if code >= 200 and code < 300:
			_editor.text = ""
			_hours.value = 0
			_error.visible = false
			_refresh()
		else:
			_show_error("Couldn't save the entry — try again.")
	)

func _refresh() -> void:
	_api(HTTPClient.METHOD_GET, "/api/projects/%d/journal" % _project_id, null, _on_entries)

func _on_entries(code: int, json: Variant) -> void:
	_clear_entries()
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_entries.add_child(_muted("Couldn't load journal entries."))
		return
	var entries: Array = json.get("entries", [])
	if entries.is_empty():
		_entries.add_child(_muted("No entries yet — write your first update below."))
		return
	for e in entries:
		_entries.add_child(_entry_row(e))

func _entry_row(e: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	panel.add_child(box)

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	box.add_child(header)

	var date := Label.new()
	date.theme_type_variation = &"InfoText"
	date.text = String(e.get("created_at", "")).substr(0, 10)
	header.add_child(date)

	var hours := float(e.get("hours", 0))
	if hours > 0.0:
		var hs := String.num(hours, 2)
		if hs.contains("."):
			hs = hs.rstrip("0").rstrip(".")
		var h := Label.new()
		h.text = "%sh" % hs
		h.add_theme_color_override("font_color", COLOR_ACCENT)
		header.add_child(h)

	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(spacer)

	var del := Button.new()
	del.theme_type_variation = &"StepButton"
	del.text = "X"
	del.focus_mode = Control.FOCUS_NONE
	del.pressed.connect(_delete_entry.bind(int(e.get("id", 0))))
	header.add_child(del)

	var body := RichTextLabel.new()
	body.bbcode_enabled = true
	body.fit_content = true
	body.selection_enabled = true
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.text = _md_to_bbcode(String(e.get("content", "")))
	body.meta_clicked.connect(func(meta): OS.shell_open(String(meta)))
	box.add_child(body)
	return panel

func _delete_entry(entry_id: int) -> void:
	_api(HTTPClient.METHOD_DELETE, "/api/projects/%d/journal/%d" % [_project_id, entry_id], null, func(_code, _json): _refresh())

func _md_to_bbcode(md: String) -> String:
	var lines := PackedStringArray()
	for line in md.replace("[", "[lb]").split("\n"):
		var l := String(line)
		if l.begins_with("### "):
			l = "[b]" + l.substr(4) + "[/b]"
		elif l.begins_with("## "):
			l = "[font_size=20][b]" + l.substr(3) + "[/b][/font_size]"
		elif l.begins_with("# "):
			l = "[font_size=24][b]" + l.substr(2) + "[/b][/font_size]"
		elif l.begins_with("- ") or l.begins_with("* "):
			l = "  • " + l.substr(2)
		lines.append(l)
	var text := "\n".join(lines)
	text = _re_sub(text, "\\*\\*(.+?)\\*\\*", "[b]$1[/b]")
	text = _re_sub(text, "\\*(.+?)\\*", "[i]$1[/i]")
	text = _re_sub(text, "`(.+?)`", "[code]$1[/code]")
	text = _re_sub(text, "\\[lb\\]([^\\]]+?)\\]\\((https?://[^)\\s]+)\\)", "[url=$2]$1[/url]")
	return text

func _re_sub(text: String, pattern: String, replacement: String) -> String:
	var re := RegEx.new()
	re.compile(pattern)
	return re.sub(text, replacement, true)

func _set_submitting(on: bool) -> void:
	_submitting = on
	_add_button.disabled = on
	_back_button.disabled = on
	_add_button.text = "Saving…" if on else "Add entry"

func _show_error(message: String) -> void:
	_error.text = message
	_error.visible = true

func _clear_entries() -> void:
	for c in _entries.get_children():
		c.queue_free()

func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"InfoText"
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l

func _api(method: int, path: String, body: Variant, cb: Callable) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	var sep := "&" if path.contains("?") else "?"
	var url := NetworkManager.SERVER_HTTP_URL + path + sep + "token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		var json = null
		if data.size() > 0:
			json = JSON.parse_string(data.get_string_from_utf8())
		cb.call(code, json)
		req.queue_free()
	)
	var headers := PackedStringArray(["Content-Type: application/json"])
	var payload := JSON.stringify(body) if body != null else ""
	req.request(url, headers, method, payload)
