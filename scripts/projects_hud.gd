extends CanvasLayer

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const PROJECT_CREATE := preload("res://scenes/project_create.tscn")

@onready var _root: Control = %Root
@onready var _modal: Control = %Root.get_node("CenterContainer")
@onready var _status: Label = %Status
@onready var _connect_button: Button = %ConnectButton
@onready var _list: VBoxContainer = %List
var _open := false
var _ht_projects: Array = []
var _create_screen: Control
var _confirm_root: Control
var _confirm_label: Label
var _pending_delete_id := 0

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

func open() -> void:
	_open = true
	get_tree().paused = true
	_root.visible = true
	refresh()

func close() -> void:
	_open = false
	get_tree().paused = false
	_create_screen.visible = false
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

func _on_create_submitted(data: Dictionary) -> void:
	var method := HTTPClient.METHOD_POST
	var path := "/api/projects"
	if data.has("id"):
		method = HTTPClient.METHOD_PUT
		path = "/api/projects/%d" % int(data["id"])
	_api(method, path, data, func(code, _json):
		if code >= 200 and code < 300:
			_hide_create()
			_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)
		else:
			_create_screen.on_submit_failed()
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

	var name_label := Label.new()
	name_label.text = String(p.get("name", "?"))
	name_label.clip_text = true
	main.add_child(name_label)

	var desc := String(p.get("description", "")).strip_edges()
	if desc != "":
		var meta := Label.new()
		meta.theme_type_variation = &"InfoText"
		meta.text = desc
		meta.clip_text = true
		main.add_child(meta)

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
	var confirm := Button.new()
	confirm.text = "Delete"
	confirm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	confirm.pressed.connect(_do_delete)
	buttons.add_child(confirm)

func _ask_delete(p: Dictionary) -> void:
	_pending_delete_id = int(p.get("id", 0))
	_confirm_label.text = "Delete \"%s\"?" % String(p.get("name", "this project"))
	_modal.visible = false
	_confirm_root.visible = true

func _do_delete() -> void:
	_confirm_root.visible = false
	_modal.visible = true
	_api(HTTPClient.METHOD_DELETE, "/api/projects/%d" % _pending_delete_id, null, func(_code, _json): _api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects))

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
