extends CanvasLayer

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const PROJECT_CREATE := preload("res://scenes/project_create.tscn")

@onready var _root: Control = %Root
@onready var _status: Label = %Status
@onready var _connect_button: Button = %ConnectButton
@onready var _list: VBoxContainer = %List
@onready var _name_input: LineEdit = %NameInput
var _open := false
var _ht_projects: Array = []
var _create_screen: Control

func _ready() -> void:
	_root.visible = false
	%RefreshButton.pressed.connect(refresh)
	_connect_button.pressed.connect(_on_connect)
	%CloseButton.pressed.connect(close)
	_name_input.visible = false
	var create_button: Button = %CreateButton
	create_button.text = "+ New Project"
	create_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	create_button.pressed.connect(_open_create)
	_create_screen = PROJECT_CREATE.instantiate()
	_root.add_child(_create_screen)
	_create_screen.submitted.connect(_on_create_submitted)
	_create_screen.cancelled.connect(func(): _create_screen.visible = false)

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
	_create_screen.visible = false
	_root.visible = false

func _open_create() -> void:
	_create_screen.open(_ht_projects)

func _on_create_submitted(data: Dictionary) -> void:
	_api(HTTPClient.METHOD_POST, "/api/projects", data, func(_code, _json):
		_create_screen.visible = false
		_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)
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

func _on_delete(id: int) -> void:
	_api(HTTPClient.METHOD_DELETE, "/api/projects/%d" % id, null, func(_code, _json): _api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects))

func _on_connect() -> void:
	var url := NetworkManager.SERVER_HTTP_URL + "/hackatime/connect?token=" + NetworkManager.session_token.uri_encode()
	if OS.has_feature("web"):
		JavaScriptBridge.eval('window.open("%s","_blank")' % url, true)
	else:
		OS.shell_open(url)
	_status.text = "HackTime: finish in your browser, then Refresh"
