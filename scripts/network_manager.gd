extends Node

signal logged_in(display_name: String)
signal connected_to_server
signal disconnected_from_server
signal player_joined(user_id: String, display_name: String, pos: Vector2, direction: String)
signal player_moved(user_id: String, pos: Vector2, direction: String)
signal player_left(user_id: String)
signal scene_init(your_user_id: String, your_pos: Vector2, other_players: Array)

const SERVER_HTTP_URL = "https://your-app.up.railway.app"
const SERVER_WS_URL = "wss://your-app.up.railway.app/ws"

var session_token: String = ""
var user_id: String = ""
var display_name: String = ""
var current_scene_name: String = "village"

var _socket: WebSocketPeer = WebSocketPeer.new()
var _connected: bool = false

func _process(_delta: float) -> void:
	if not _connected:
		return
	_socket.poll()
	var state = _socket.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		while _socket.get_available_packet_count() > 0:
			var packet = _socket.get_packet().get_string_from_utf8()
			_handle_message(packet)
	elif state == WebSocketPeer.STATE_CLOSED:
		_connected = false
		emit_signal("disconnected_from_server")


# --- LOGIN ---
# Call this to start login. Opens system browser to Hack Club Auth.
# Player logs in, server shows them a token, they paste it via paste_session_token().
func start_login() -> void:
	OS.shell_open(SERVER_HTTP_URL + "/auth/hackclub")

func paste_session_token(token: String) -> void:
	session_token = token.strip_edges()
	_connect_to_server()


# --- CONNECTION ---
func _connect_to_server() -> void:
	var url = SERVER_WS_URL + "?token=" + session_token
	var err = _socket.connect_to_url(url)
	if err != OK:
		push_error("WebSocket connection failed: %s" % err)
		return
	_connected = true


# --- MESSAGE HANDLING ---
func _handle_message(raw: String) -> void:
	var json = JSON.parse_string(raw)
	if json == null:
		return

	match json.get("type"):
		"init":
			user_id = json["you"]["userId"]
			display_name = json["you"]["displayName"]
			var my_pos = Vector2(json["you"]["posX"], json["you"]["posY"])
			emit_signal("scene_init", user_id, my_pos, json.get("players", []))
			emit_signal("connected_to_server")

		"player_joined":
			emit_signal(
				"player_joined",
				json["userId"],
				json["displayName"],
				Vector2(json["posX"], json["posY"]),
				json.get("direction", "bottom")
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


# --- SENDING ---
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

func send_scene_change(scene_name: String) -> void:
	if not _connected:
		return
	current_scene_name = scene_name
	var msg = {
		"type": "change_scene",
		"scene": scene_name
	}
	_socket.send_text(JSON.stringify(msg))
