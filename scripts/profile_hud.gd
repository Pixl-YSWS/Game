extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")

var _root: Control
var _portrait: TextureRect
var _name_label: Label
var _info_label: Label
var _status_label: Label
var _action_button: Button
var _open := false
var _user_id := ""
var _friend_status := "none"

func _ready() -> void:
	layer = 105
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if _open and event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()

func is_open() -> bool:
	return _open

func open(user_id: String) -> void:
	if user_id == "" or user_id == NetworkManager.user_id:
		return
	_user_id = user_id
	_open = true
	get_tree().paused = true
	_root.visible = true
	_portrait.texture = null
	_name_label.text = "Loading"
	_info_label.text = ""
	_status_label.text = ""
	_action_button.visible = false
	_api(HTTPClient.METHOD_GET, "/api/players/profile", {"userId": user_id}, _on_profile)

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
	panel.custom_minimum_size = Vector2(360, 0)
	panel.add_theme_constant_override("separation", 10)
	center.add_child(panel)

	_portrait = TextureRect.new()
	_portrait.custom_minimum_size = Vector2(96, 96)
	_portrait.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_portrait.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_portrait.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_portrait.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	panel.add_child(_portrait)

	_name_label = Label.new()
	_name_label.theme_type_variation = &"TitleText"
	_name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(_name_label)

	_info_label = Label.new()
	_info_label.theme_type_variation = &"InfoText"
	_info_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(_info_label)

	_status_label = Label.new()
	_status_label.theme_type_variation = &"InfoText"
	_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(_status_label)

	_action_button = Button.new()
	_action_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_action_button.pressed.connect(_on_action)
	panel.add_child(_action_button)

	var close_button := Button.new()
	close_button.text = "Close"
	close_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	close_button.pressed.connect(close)
	panel.add_child(close_button)

func _on_profile(code: int, json: Variant) -> void:
	if not _open:
		return
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_name_label.text = "Couldn't load profile."
		return
	_name_label.text = String(json.get("name", "Player"))
	_portrait.texture = SkinUtil.portrait(String(json.get("skin", "cvc:1")))
	var joined := String(json.get("createdAt", ""))
	if joined.length() >= 10:
		joined = joined.substr(0, 10)
	var online := "online" if bool(json.get("online", false)) else "offline"
	_info_label.text = "Joined %s  •  %d project(s)  •  %s" % [joined, int(json.get("projects", 0)), online]
	_friend_status = String(json.get("friendStatus", "none"))
	_action_button.visible = true
	match _friend_status:
		"none":
			_action_button.text = "Add Friend"
			_action_button.disabled = false
		"outgoing":
			_action_button.text = "Request Sent"
			_action_button.disabled = true
		"incoming":
			_action_button.text = "Accept Friend Request"
			_action_button.disabled = false
		"friends":
			_action_button.text = "Remove Friend"
			_action_button.disabled = false
		_:
			_action_button.visible = false

func _on_action() -> void:
	var path := ""
	match _friend_status:
		"none":
			path = "/api/friends/request"
		"incoming":
			path = "/api/friends/accept"
		"friends":
			path = "/api/friends/remove"
		_:
			return
	_action_button.disabled = true
	_api(HTTPClient.METHOD_POST, path, {"userId": _user_id}, func(_code, _json):
		if _open:
			_api(HTTPClient.METHOD_GET, "/api/players/profile", {"userId": _user_id}, _on_profile)
	)

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
