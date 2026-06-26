extends CanvasLayer
## Autoloaded projects/HackTime HUD. Press H in a gameplay scene to open it,
## connect HackTime, and create/list projects. Pauses the tree while open (so
## the player doesn't walk around); NetworkManager keeps polling via ALWAYS.

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]

var _root: Control
var _status: Label
var _connect_button: Button
var _list: VBoxContainer
var _name_input: LineEdit
var _open := false

func _ready() -> void:
	layer = 105
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_H:
		_toggle()
		get_viewport().set_input_as_handled()

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
	_root.visible = false

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = THEME
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.031373, 0.019608, 0.9)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var panel := VBoxContainer.new()
	panel.custom_minimum_size = Vector2(440, 0)
	panel.add_theme_constant_override("separation", 12)
	center.add_child(panel)

	var title := Label.new()
	title.text = "Projects"
	title.theme_type_variation = &"TitleText"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	panel.add_child(title)

	# HackTime status + connect/refresh.
	var ht_row := HBoxContainer.new()
	ht_row.add_theme_constant_override("separation", 10)
	panel.add_child(ht_row)
	_status = Label.new()
	_status.text = "HackTime: …"
	_status.theme_type_variation = &"StatusText"
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ht_row.add_child(_status)
	var refresh_button := Button.new()
	refresh_button.text = "Refresh"
	refresh_button.pressed.connect(refresh)
	ht_row.add_child(refresh_button)
	_connect_button = Button.new()
	_connect_button.text = "Connect"
	_connect_button.pressed.connect(_on_connect)
	ht_row.add_child(_connect_button)

	# Project list (scrollable).
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 220)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 6)
	scroll.add_child(_list)

	# Create form.
	var form := HBoxContainer.new()
	form.add_theme_constant_override("separation", 8)
	panel.add_child(form)
	_name_input = LineEdit.new()
	_name_input.placeholder_text = "New project name"
	_name_input.max_length = 120
	_name_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_input.text_submitted.connect(func(_t): _on_create())
	form.add_child(_name_input)
	var create_button := Button.new()
	create_button.text = "Create"
	create_button.pressed.connect(_on_create)
	form.add_child(create_button)

	var close_button := Button.new()
	close_button.text = "Close"
	close_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	close_button.pressed.connect(close)
	panel.add_child(close_button)

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
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var name_label := Label.new()
	name_label.text = String(p.get("name", "?"))
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_label)
	var del := Button.new()
	del.text = "✕"
	del.pressed.connect(_on_delete.bind(int(p.get("id", 0))))
	row.add_child(del)
	return row

func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"InfoText"
	return l

func _on_create() -> void:
	var name := _name_input.text.strip_edges()
	if name == "":
		return
	_name_input.clear()
	_api(HTTPClient.METHOD_POST, "/api/projects", {"name": name}, func(_code, _json): _api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects))

func _on_delete(id: int) -> void:
	_api(HTTPClient.METHOD_DELETE, "/api/projects/%d" % id, null, func(_code, _json): _api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects))

func _on_connect() -> void:
	var url := NetworkManager.SERVER_HTTP_URL + "/hackatime/connect?token=" + NetworkManager.session_token.uri_encode()
	if OS.has_feature("web"):
		JavaScriptBridge.eval('window.open("%s","_blank")' % url, true)
	else:
		OS.shell_open(url)
	_status.text = "HackTime: finish in your browser, then Refresh"
