extends CanvasLayer

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const PROJECT_CREATE := preload("res://scenes/project_create.tscn")
const PROJECT_JOURNAL := preload("res://scenes/project_journal.tscn")

const STATUS_BADGES := {
	"draft": ["draft", Color(0.72, 0.67, 0.58)],
	"shipped": ["in review", Color(1, 0.819608, 0.4)],
	"approved": ["approved", Color(0.45, 0.85, 0.5)],
	"needs_changes": ["needs changes", Color(1, 0.419608, 0.419608)],
}

@onready var _root: Control = %Root
@onready var _modal: Control = %Root.get_node("CenterContainer")
@onready var _status: Label = %Status
@onready var _connect_button: Button = %ConnectButton
@onready var _list: VBoxContainer = %List
var _open := false
var _ht_projects: Array = []
var _create_screen: Control
var _journal_screen: Control
var _confirm_root: Control
var _confirm_label: Label
var _confirm_button: Button
var _confirm_action := Callable()

func _ready() -> void:
	_root.visible = false
	%RefreshButton.pressed.connect(refresh)
	_connect_button.pressed.connect(_on_connect)
	%CloseButton.pressed.connect(close)
	%CreateButton.pressed.connect(_open_create)
	_create_screen = PROJECT_CREATE.instantiate()
	_root.add_child(_create_screen)
	_create_screen.submitted.connect(_on_create_submitted)
	_create_screen.cancelled.connect(_hide_create)
	_journal_screen = PROJECT_JOURNAL.instantiate()
	_root.add_child(_journal_screen)
	_journal_screen.closed.connect(_hide_journal)
	_build_confirm_ui()

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if event.keycode == KEY_H:
		_toggle()
		get_viewport().set_input_as_handled()
	elif event.keycode == KEY_ESCAPE and _open:
		get_viewport().set_input_as_handled()
		if _confirm_root.visible:
			_confirm_root.visible = false
			_modal.visible = true
		elif _create_screen.visible:
			_hide_create()
		elif _journal_screen.visible:
			_hide_journal()
		else:
			close()

func _toggle() -> void:
	if _open:
		close()
		return
	var current := get_tree().current_scene
	if current == null:
		return
	if GAMEPLAY_SCENES.has(current.scene_file_path.get_file().get_basename()):
		open()

func is_open() -> bool:
	return _open

func open() -> void:
	if _open:
		return
	_open = true
	global.push_ui_blocker()
	_root.visible = true
	refresh()

func close() -> void:
	if not _open:
		return
	_open = false
	global.pop_ui_blocker()
	_create_screen.visible = false
	_journal_screen.visible = false
	_confirm_root.visible = false
	_modal.visible = true
	_root.visible = false

func _hide_create() -> void:
	_create_screen.visible = false
	_modal.visible = true

func _open_create() -> void:
	_modal.visible = false
	_create_screen.open(_ht_projects)

func _open_edit(project: Dictionary) -> void:
	_modal.visible = false
	_create_screen.open_edit(project, _ht_projects)

func _open_journal(project: Dictionary) -> void:
	_modal.visible = false
	_journal_screen.open(project)

func _hide_journal() -> void:
	_journal_screen.visible = false
	_modal.visible = true

func _on_create_submitted(data: Dictionary) -> void:
	var method := HTTPClient.METHOD_POST
	var path := "/api/projects"
	if data.has("id"):
		method = HTTPClient.METHOD_PUT
		path = "/api/projects/%d" % int(data["id"])
	_api(method, path, data, func(code, json):
		if code >= 200 and code < 300:
			_hide_create()
			_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)
		else:
			var msg := ""
			if typeof(json) == TYPE_DICTIONARY:
				match String(json.get("error", "")):
					"repo_not_github":
						msg = "Repo link must be a GitHub repository."
					"name_required":
						msg = "Project name is required."
			_create_screen.on_submit_failed(msg)
	)

# --- networking ------------------------------------------------------------

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

func refresh() -> void:
	_api(HTTPClient.METHOD_GET, "/api/hackatime/stats", null, _on_stats)
	_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)

func _on_stats(code: int, json: Variant) -> void:
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_status.text = "HackTime: unknown"
		return
	var stats: Dictionary = json.get("stats", {})
	_ht_projects = stats.get("projects", [])
	if stats.get("connected", false):
		var hours := int(stats.get("totalSeconds", 0)) / 3600.0
		_status.text = "HackTime: connected (%.1fh)" % hours
		_connect_button.text = "Reconnect"
	else:
		_status.text = "HackTime: not connected"
		_connect_button.text = "Connect"

func _on_projects(code: int, json: Variant) -> void:
	for child in _list.get_children():
		child.queue_free()
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_list.add_child(_muted("Couldn't load projects."))
		return
	var projects: Array = json.get("projects", [])
	if projects.is_empty():
		_list.add_child(_muted("No projects yet — create one below."))
		return
	for p in projects:
		_list.add_child(_project_row(p))

func _project_row(p: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	panel.add_child(row)

	var main := VBoxContainer.new()
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.add_theme_constant_override("separation", 2)
	row.add_child(main)

	var name_row := HBoxContainer.new()
	name_row.add_theme_constant_override("separation", 8)
	main.add_child(name_row)
	var name_label := Label.new()
	name_label.text = String(p.get("name", "?"))
	name_label.clip_text = true
	name_row.add_child(name_label)

	var status := String(p.get("status", "draft"))
	var badge_info: Array = STATUS_BADGES.get(status, STATUS_BADGES["draft"])
	var badge := Label.new()
	badge.theme_type_variation = &"InfoText"
	badge.text = "[%s]" % badge_info[0]
	badge.add_theme_color_override("font_color", badge_info[1])
	name_row.add_child(badge)

	var desc := String(p.get("description", "")).strip_edges()
	if desc != "":
		var meta := Label.new()
		meta.theme_type_variation = &"InfoText"
		meta.text = desc
		meta.clip_text = true
		main.add_child(meta)

	var note := String(p.get("review_note", "")).strip_edges()
	if status == "needs_changes" and note != "":
		var note_label := Label.new()
		note_label.theme_type_variation = &"InfoText"
		note_label.text = "Reviewer: " + note
		note_label.add_theme_color_override("font_color", Color(1, 0.419608, 0.419608))
		note_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		main.add_child(note_label)

	if status == "draft" or status == "needs_changes":
		var ship := Button.new()
		ship.theme_type_variation = &"StepButton"
		ship.text = "Ship"
		var missing := PackedStringArray()
		if String(p.get("repo_url", "")).strip_edges() == "":
			missing.append("a GitHub repo link")
		if String(p.get("demo_url", "")).strip_edges() == "":
			missing.append("a demo link")
		if not missing.is_empty():
			ship.disabled = true
			ship.tooltip_text = "Add %s first." % " and ".join(missing)
		else:
			ship.pressed.connect(_ask_ship.bind(p))
		row.add_child(ship)

	var journal := Button.new()
	journal.theme_type_variation = &"StepButton"
	journal.text = "Journal"
	journal.pressed.connect(_open_journal.bind(p))
	row.add_child(journal)

	var edit := Button.new()
	edit.theme_type_variation = &"StepButton"
	edit.text = "Edit"
	edit.pressed.connect(_open_edit.bind(p))
	row.add_child(edit)

	var del := Button.new()
	del.theme_type_variation = &"StepButton"
	del.text = "X"
	del.pressed.connect(_ask_delete.bind(p))
	row.add_child(del)
	return panel

func _build_confirm_ui() -> void:
	_confirm_root = Control.new()
	_confirm_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_confirm_root.visible = false
	_root.add_child(_confirm_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.031373, 0.019608, 0.8)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_confirm_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_confirm_root.add_child(center)

	var card := PanelContainer.new()
	center.add_child(card)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 22)
	margin.add_theme_constant_override("margin_right", 22)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 18)
	card.add_child(margin)

	var panel := VBoxContainer.new()
	panel.custom_minimum_size = Vector2(360, 0)
	panel.add_theme_constant_override("separation", 16)
	margin.add_child(panel)

	_confirm_label = Label.new()
	_confirm_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_confirm_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel.add_child(_confirm_label)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 10)
	panel.add_child(buttons)
	var cancel := Button.new()
	cancel.theme_type_variation = &"GreyButton"
	cancel.text = "Cancel"
	cancel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cancel.pressed.connect(func():
		_confirm_root.visible = false
		_modal.visible = true)
	buttons.add_child(cancel)
	_confirm_button = Button.new()
	_confirm_button.text = "Delete"
	_confirm_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_confirm_button.pressed.connect(func():
		_confirm_root.visible = false
		_modal.visible = true
		if _confirm_action.is_valid():
			_confirm_action.call())
	buttons.add_child(_confirm_button)

func _ask_confirm(text: String, button_text: String, action: Callable) -> void:
	_confirm_label.text = text
	_confirm_button.text = button_text
	_confirm_action = action
	_modal.visible = false
	_confirm_root.visible = true

func _refresh_projects() -> void:
	_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)

func _ask_delete(p: Dictionary) -> void:
	var id := int(p.get("id", 0))
	_ask_confirm(
		"Delete \"%s\"?" % String(p.get("name", "this project")),
		"Delete",
		func(): _api(HTTPClient.METHOD_DELETE, "/api/projects/%d" % id, null, func(_code, _json): _refresh_projects()),
	)

func _ask_ship(p: Dictionary) -> void:
	var id := int(p.get("id", 0))
	_ask_confirm(
		"Ship \"%s\" for review?\nReviewers will look at your repo, demo and journal, and you'll get the verdict in your inbox." % String(p.get("name", "?")),
		"Ship it",
		func(): _api(HTTPClient.METHOD_POST, "/api/projects/%d/ship" % id, null, func(_code, _json): _refresh_projects()),
	)

func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"InfoText"
	return l

func _on_connect() -> void:
	var url := NetworkManager.SERVER_HTTP_URL + "/hackatime/connect?token=" + NetworkManager.session_token.uri_encode()
	if OS.has_feature("web"):
		JavaScriptBridge.eval('window.open("%s","_blank")' % url, true)
	else:
		OS.shell_open(url)
	_status.text = "HackTime: finish in your browser, then Refresh"
