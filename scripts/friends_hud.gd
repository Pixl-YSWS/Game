extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const COLOR_ONLINE := Color(0.290196, 0.870588, 0.501961)
const COLOR_OFFLINE := Color(0.788235, 0.694118, 0.54902)

var _root: Control
var _list: VBoxContainer
var _status_label: Label
var _open := false
var _joining := false

func _ready() -> void:
	layer = 105
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false
	NetworkManager.lobby_joined.connect(_on_lobby_joined)
	NetworkManager.lobby_denied.connect(_on_lobby_denied)

func _unhandled_input(event: InputEvent) -> void:
	if _open and event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F:
		if ChatHud.is_typing() or Dialogue.is_open or ProfileHud.is_open():
			return
		_toggle()
		get_viewport().set_input_as_handled()

func is_open() -> bool:
	return _open

func _toggle() -> void:
	if _open:
		close()
		return
	var current := get_tree().current_scene
	if current and GAMEPLAY_SCENES.has(current.scene_file_path.get_file().get_basename()):
		open()

func open() -> void:
	_open = true
	_joining = false
	get_tree().paused = true
	_root.visible = true
	refresh()

func close() -> void:
	_open = false
	get_tree().paused = false
	_root.visible = false

func refresh() -> void:
	_status_label.text = ""
	_api(HTTPClient.METHOD_GET, "/api/friends", {}, _on_list)

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
	panel.custom_minimum_size = Vector2(480, 0)
	panel.add_theme_constant_override("separation", 12)
	center.add_child(panel)

	var title := Label.new()
	title.text = "Friends"
	title.theme_type_variation = &"TitleText"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 300)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 8)
	scroll.add_child(_list)

	_status_label = Label.new()
	_status_label.theme_type_variation = &"InfoText"
	_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(_status_label)

	var close_button := Button.new()
	close_button.text = "Close"
	close_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	close_button.pressed.connect(close)
	panel.add_child(close_button)

func _on_list(code: int, json: Variant) -> void:
	for child in _list.get_children():
		child.queue_free()
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_list.add_child(_muted("Couldn't load your friends list."))
		return
	var friends: Array = json.get("friends", [])
	var incoming: Array = json.get("incoming", [])
	var outgoing: Array = json.get("outgoing", [])
	if friends.is_empty() and incoming.is_empty() and outgoing.is_empty():
		_list.add_child(_muted("No friends yet. Click a player to send a request!"))
		return
	if not incoming.is_empty():
		_list.add_child(_header("Requests"))
		for f in incoming:
			_list.add_child(_incoming_row(f))
	if not friends.is_empty():
		_list.add_child(_header("Friends"))
		for f in friends:
			_list.add_child(_friend_row(f))
	if not outgoing.is_empty():
		_list.add_child(_header("Sent"))
		for f in outgoing:
			_list.add_child(_muted("%s (pending)" % String(f.get("name", ""))))

func _header(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"TitleText"
	return l

func _friend_row(f: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var name_label := Label.new()
	var online: bool = bool(f.get("online", false))
	name_label.text = "● " + String(f.get("name", ""))
	name_label.add_theme_color_override("font_color", COLOR_ONLINE if online else COLOR_OFFLINE)
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_label)
	var lobby_id := String(f.get("lobbyId", ""))
	if online and lobby_id != "" and lobby_id != NetworkManager.current_lobby_id:
		var join := Button.new()
		join.text = "Join  %s" % String(f.get("lobbyName", "lobby"))
		join.pressed.connect(_on_join.bind(String(f.get("userId", ""))))
		row.add_child(join)
	elif online:
		var where := Label.new()
		where.theme_type_variation = &"InfoText"
		where.text = "in your lobby" if lobby_id != "" else "in the village"
		row.add_child(where)
	return row

func _incoming_row(f: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var name_label := Label.new()
	name_label.text = String(f.get("name", ""))
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_label)
	var uid := String(f.get("userId", ""))
	var accept := Button.new()
	accept.text = "Accept"
	accept.pressed.connect(func():
		_api(HTTPClient.METHOD_POST, "/api/friends/accept", {"userId": uid}, func(_c, _j): refresh())
	)
	row.add_child(accept)
	var decline := Button.new()
	decline.text = "Decline"
	decline.pressed.connect(func():
		_api(HTTPClient.METHOD_POST, "/api/friends/remove", {"userId": uid}, func(_c, _j): refresh())
	)
	row.add_child(decline)
	return row

func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"InfoText"
	return l

func _on_join(friend_user_id: String) -> void:
	_joining = true
	_status_label.text = "Joining your friend"
	NetworkManager.send_join_friend(friend_user_id)

func _on_lobby_joined(lobby: Dictionary) -> void:
	if not _open or not _joining:
		return
	close()
	var lobby_name := String(lobby.get("name", "lobby"))
	Loader.change_scene("res://scenes/open_world.tscn", "Joining " + lobby_name)

func _on_lobby_denied(reason: String) -> void:
	if not _open or not _joining:
		return
	_joining = false
	_status_label.text = reason

func _api(method: int, path: String, params: Dictionary, cb: Callable) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + path + "?token=" + NetworkManager.session_token.uri_encode()
	var body := ""
	if method == HTTPClient.METHOD_GET:
		for k in params:
			url += "&%s=%s" % [k, String(params[k]).uri_encode()]
	else:
		body = JSON.stringify(params)
	req.request_completed.connect(func(_result, code, _headers, data):
		var json = null
		if data.size() > 0:
			json = JSON.parse_string(data.get_string_from_utf8())
		cb.call(code, json)
		req.queue_free()
	)
	req.request(url, PackedStringArray(["Content-Type: application/json"]), method, body)
