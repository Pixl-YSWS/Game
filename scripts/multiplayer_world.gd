extends Node2D

const PLAYER_SCENE := preload("res://scenes/player.tscn")

var remote_players: Dictionary = {}
var _local_player = null

func _ready() -> void:
	global.player_in_range = false
	setup_multiplayer()

func _network_scene_name() -> String:
	return scene_file_path.get_file().get_basename()

func setup_multiplayer() -> void:
	if not NetworkManager.is_connected_to_server():
		_spawn_local(_default_spawn())
		return
	NetworkManager.scene_init.connect(_on_scene_init)
	NetworkManager.player_joined.connect(_on_player_joined)
	NetworkManager.player_moved.connect(_on_player_moved)
	NetworkManager.player_left.connect(_on_player_left)
	NetworkManager.player_skin_changed.connect(_on_player_skin_changed)
	NetworkManager.chat_message.connect(_on_chat)
	NetworkManager.emote_received.connect(_on_emote)
	NetworkManager.send_scene_change(_network_scene_name())
	await get_tree().create_timer(5.0).timeout
	if not is_instance_valid(_local_player):
		_spawn_local(_default_spawn())

func _default_spawn() -> Vector2:
	var marker = get_node_or_null(global.spawn_point)
	if marker == null:
		marker = get_node_or_null("PlayerSpawn")
	return marker.global_position if marker else Vector2.ZERO

func _spawn_local(pos: Vector2) -> void:
	if is_instance_valid(_local_player):
		_local_player.global_position = pos
		Loader.hide_loading()
		return
	var p = PLAYER_SCENE.instantiate()
	p.z_index = 10
	p.is_local = true
	p.global_position = pos
	add_child(p)
	_local_player = p
	Loader.hide_loading()

func _on_scene_init(your_id: String, your_pos: Vector2, others: Array, spawn_at_default: bool) -> void:
	if spawn_at_default:
		your_pos = _default_spawn()
	_spawn_local(your_pos)
	var seen := {}
	for p in others:
		var uid := String(p["userId"])
		if uid == your_id:
			continue
		seen[uid] = true
		_spawn_remote(uid, String(p["displayName"]), Vector2(p["posX"], p["posY"]), String(p.get("skin", "cvc:1")))
	for uid in remote_players.keys():
		if not seen.has(uid):
			_despawn_remote(uid)

func _on_player_joined(user_id: String, name: String, pos: Vector2, _direction: String, skin: String) -> void:
	if user_id == NetworkManager.user_id:
		return
	_spawn_remote(user_id, name, pos, skin)

func _on_player_moved(user_id: String, pos: Vector2, direction: String) -> void:
	if remote_players.has(user_id):
		remote_players[user_id].remote_update(pos, direction)

func _on_player_left(user_id: String) -> void:
	_despawn_remote(user_id)

func _on_player_skin_changed(user_id: String, skin: String) -> void:
	if user_id == NetworkManager.user_id:
		if is_instance_valid(_local_player):
			_local_player.set_skin(skin)
	elif remote_players.has(user_id):
		remote_players[user_id].set_skin(skin)

func _spawn_remote(user_id: String, name: String, pos: Vector2, skin: String = "cvc:1") -> void:
	if remote_players.has(user_id):
		remote_players[user_id].remote_update(pos, remote_players[user_id].current_dir)
		return
	var node = PLAYER_SCENE.instantiate()
	node.z_index = 10
	node.is_local = false
	node.player_name = name
	node.skin = skin
	node.global_position = pos
	add_child(node)
	remote_players[user_id] = node

func _on_chat(user_id: String, _display_name: String, text: String) -> void:
	var node = _local_player if user_id == NetworkManager.user_id else remote_players.get(user_id)
	if is_instance_valid(node):
		node.show_chat_bubble(text)

func _on_emote(user_id: String, key: String) -> void:
	var node = _local_player if user_id == NetworkManager.user_id else remote_players.get(user_id)
	if is_instance_valid(node):
		node.show_emote(key)

func _despawn_remote(user_id: String) -> void:
	if remote_players.has(user_id):
		remote_players[user_id].queue_free()
		remote_players.erase(user_id)
