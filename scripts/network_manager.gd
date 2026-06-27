extends Node
signal logged_in(display_name: String)
signal connected_to_server
signal disconnected_from_server
signal player_joined(user_id: String, display_name: String, pos: Vector2, direction: String, skin: String)
signal player_moved(user_id: String, pos: Vector2, direction: String)
signal player_left(user_id: String)
signal scene_init(your_user_id: String, your_pos: Vector2, other_players: Array, spawn_at_default: bool)
signal player_skin_changed(user_id: String, skin: String)

const DEV_SERVER_URL = "http://localhost:4728"
const DEV_WS_URL = "ws://localhost:4728/ws"
const PROD_SERVER_URL = "https://server.pixl.rsvp"
const PROD_WS_URL = "wss://server.pixl.rsvp/ws"

const USE_PROD: bool = true 

const SERVER_HTTP_URL = PROD_SERVER_URL if USE_PROD else DEV_SERVER_URL
const SERVER_WS_URL = PROD_WS_URL if USE_PROD else DEV_WS_URL

var session_token: String = ""
var user_id: String = ""
var display_name: String = ""
var local_skin: String = "cvc:1"
var current_scene_name: String = "village"
var _socket: WebSocketPeer = WebSocketPeer.new()
var _connected: bool = false
const TOKEN_SAVE_PATH = "user://session.dat"
const LOCAL_CALLBACK_PORT = 7777
var _tcp_server: TCPServer = TCPServer.new()
var _listening: bool = false
var _http: HTTPRequest

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS

	_http = HTTPRequest.new()
	add_child(_http)

	if OS.has_feature("web"):
		_check_web_login_callback()

	_try_auto_login()

func _try_auto_login() -> void:
	var saved = _load_session()
	if saved.has("token") and saved["token"] != "":
		session_token = saved["token"]
		display_name = saved.get("display_name", "")
		_connect_to_server()
		emit_signal("logged_in", display_name)

func _save_session() -> void:
	if OS.has_feature("web"):
		pass
	var file = FileAccess.open(TOKEN_SAVE_PATH, FileAccess.WRITE)
	if file:
		var data = { "token": session_token, "display_name": display_name }
		file.store_string(JSON.stringify(data))
		file.close()

func _load_session() -> Dictionary:
	if not FileAccess.file_exists(TOKEN_SAVE_PATH):
		return {}
	var file = FileAccess.open(TOKEN_SAVE_PATH, FileAccess.READ)
	if not file:
		return {}
	var content = file.get_as_text()
	file.close()
	var parsed = JSON.parse_string(content)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	return parsed

func clear_session() -> void:
	session_token = ""
	display_name = ""
	user_id = ""
	if FileAccess.file_exists(TOKEN_SAVE_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(TOKEN_SAVE_PATH))

func _process(_delta: float) -> void:
	if _listening:
		_process_login_listener()
	if not _connected:
		return
	_socket.poll()
	var state = _socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		while _socket.get_available_packet_count() > 0:
			var packet = _socket.get_packet().get_string_from_utf8()
			_handle_message(packet)
	elif state == WebSocketPeer.STATE_CLOSED:
		if _connected:
			var code = _socket.get_close_code()
			if code == 4001:
				clear_session()
		_connected = false
		emit_signal("disconnected_from_server")

func start_login() -> void:
	if OS.has_feature("web"):
		_start_login_web()
	else:
		_start_login_desktop()

func _start_login_desktop() -> void:
	var err = _tcp_server.listen(LOCAL_CALLBACK_PORT, "127.0.0.1")
	if err != OK:
		push_error("Could not start local login listener: %s" % err)
		return
	_listening = true
	OS.shell_open(SERVER_HTTP_URL + "/auth/hackclub")

func _start_login_web() -> void:
	var current_url = JavaScriptBridge.eval(
		"window.location.origin + window.location.pathname", true
	)
	var redirect_target = SERVER_HTTP_URL + "/auth/hackclub?web_redirect=" + String(current_url).uri_encode()
	JavaScriptBridge.eval("window.location.href = '%s';" % redirect_target, true)

func _check_web_login_callback() -> void:
	var query = JavaScriptBridge.eval("window.location.search", true)
	if query == null or String(query) == "":
		return
	var query_str: String = String(query).lstrip("?")
	var token = _extract_query_param_from_string(query_str, "token")
	var name = _extract_query_param_from_string(query_str, "name")
	if token != "":
		session_token = token
		display_name = name
		_save_session()
		emit_signal("logged_in", display_name)
		_connect_to_server()
		JavaScriptBridge.eval(
			"window.history.replaceState({}, document.title, window.location.pathname);", true
		)
func _process_login_listener() -> void:
	if not _tcp_server.is_connection_available():
		return
	var conn: StreamPeerTCP = _tcp_server.take_connection()
	await get_tree().create_timer(0.05).timeout
	conn.poll()
	var available = conn.get_available_bytes()
	if available <= 0:
		return
	var request = conn.get_utf8_string(available)
	var token = _extract_query_param(request, "token")
	var name = _extract_query_param(request, "name")
	var body = "<html><body style='font-family:sans-serif;text-align:center;margin-top:4rem;'><h2>Logged in! You can close this tab.</h2></body></html>"
	var response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" % [body.length(), body]
	conn.put_data(response.to_utf8_buffer())
	conn.disconnect_from_host()
	_tcp_server.stop()
	_listening = false
	if token != "":
		session_token = token
		display_name = name
		_save_session()
		emit_signal("logged_in", display_name)
		_connect_to_server()
	else:
		push_error("Login callback did not contain a token")

func _extract_query_param(http_request: String, key: String) -> String:
	var first_line = http_request.split("\r\n")[0]
	var parts = first_line.split(" ")
	if parts.size() < 2:
		return ""
	var path_and_query = parts[1]
	var query_index = path_and_query.find("?")
	if query_index == -1:
		return ""
	var query = path_and_query.substr(query_index + 1)
	return _extract_query_param_from_string(query, key)

func _extract_query_param_from_string(query: String, key: String) -> String:
	for pair in query.split("&"):
		var kv = pair.split("=")
		if kv.size() == 2 and kv[0] == key:
			return kv[1].uri_decode()
	return ""

# --- CONNECTION ---
func _connect_to_server() -> void:
	var state = _socket.get_ready_state()
	if state != WebSocketPeer.STATE_CLOSED:
		_socket.close()
		_connected = false

	var url = SERVER_WS_URL + "?token=" + session_token
	var err = _socket.connect_to_url(url)
	if err != OK:
		push_error("WebSocket connection failed: %s" % err)
		return
	_connected = true

func _handle_message(raw: String) -> void:
	var json = JSON.parse_string(raw)
	if json == null:
		return
	match json.get("type"):
		"init":
			user_id = json["you"]["userId"]
			display_name = json["you"]["displayName"]
			local_skin = String(json["you"].get("skin", local_skin))
			var my_pos = Vector2(json["you"]["posX"], json["you"]["posY"])

			var spawn_at_default = json.get("spawnAtDefault", false)
			emit_signal("scene_init", user_id, my_pos, json.get("players", []), spawn_at_default)
			emit_signal("connected_to_server")
		"player_joined":
			emit_signal(
				"player_joined",
				json["userId"],
				json["displayName"],
				Vector2(json["posX"], json["posY"]),
				json.get("direction", "bottom"),
				String(json.get("skin", "cvc:1"))
			)
		"player_moved":
			emit_signal(
				"player_moved",
				json["userId"],
				Vector2(json["posX"], json["posY"]),
				json.get("direction", "bottom")
			)
		"player_left":
			emit_signal("player_left", json["userId"])
		"player_skin":
			var uid = json["userId"]
			var sk = String(json.get("skin", "cvc:1"))
			if uid == user_id:
				local_skin = sk
			emit_signal("player_skin_changed", uid, sk)

func send_move(pos: Vector2, direction: String) -> void:
	if not _connected:
		return
	var msg = {
		"type": "move",
		"posX": pos.x,
		"posY": pos.y,
		"direction": direction
	}
	_socket.send_text(JSON.stringify(msg))

func send_set_skin(skin: String) -> void:
	local_skin = skin
	if not _connected:
		return
	_socket.send_text(JSON.stringify({
		"type": "set_skin",
		"skin": skin
	}))

func send_scene_change(scene_name: String) -> void:
	if not _connected:
		return
	current_scene_name = scene_name
	var msg = {
		"type": "change_scene",
		"scene": scene_name
	}
	_socket.send_text(JSON.stringify(msg))

func is_connected_to_server() -> bool:
	return _connected

func logout() -> void:
	if _socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		_socket.close()
	_connected = false
	clear_session()
