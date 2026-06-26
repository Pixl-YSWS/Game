extends Node2D
var remote_players: Dictionary = {} 
const PLAYER_SCENE = preload("res://scenes/player.tscn")

func _ready() -> void:
	NetworkManager.scene_init.connect(_on_scene_init)
	NetworkManager.player_joined.connect(_on_player_joined)
	NetworkManager.player_moved.connect(_on_player_moved)
	NetworkManager.player_left.connect(_on_player_left)
	NetworkManager.send_scene_change("openworld")

func spawn_local_player(pos: Vector2) -> void:
	var player = PLAYER_SCENE.instantiate()
	player.z_index = 10
	player.is_local = true
	player.global_position = pos
	add_child(player)

func _on_scene_init(your_id: String, your_pos: Vector2, others: Array, spawn_at_default: bool) -> void:
	if spawn_at_default:
		var marker = get_node_or_null("PlayerSpawn")
		your_pos = marker.global_position if marker else Vector2.ZERO
	spawn_local_player(your_pos)
	for p in others:
		if p["userId"] == your_id:
			continue
		_spawn_remote(p["userId"], p["displayName"], Vector2(p["posX"], p["posY"]))

func _on_player_joined(user_id: String, name: String, pos: Vector2, direction: String) -> void:
	_spawn_remote(user_id, name, pos)

func _on_player_moved(user_id: String, pos: Vector2, direction: String) -> void:
	if remote_players.has(user_id):
		remote_players[user_id].remote_update(pos, direction)

func _on_player_left(user_id: String) -> void:
	if remote_players.has(user_id):
		remote_players[user_id].queue_free()
		remote_players.erase(user_id)

func _spawn_remote(user_id: String, name: String, pos: Vector2) -> void:
	if remote_players.has(user_id):
		return
	var node = PLAYER_SCENE.instantiate()
	node.z_index = 10
	node.is_local = false
	node.get_node("NameLabel").text = name
	node.global_position = pos
	add_child(node)
	remote_players[user_id] = node
