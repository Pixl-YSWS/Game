extends Node2D
var remote_players: Dictionary = {} 
const PLAYER_SCENE = preload("res://scenes/player.tscn")

func _ready() -> void:
	NetworkManager.scene_init.connect(_on_scene_init)
	NetworkManager.player_joined.connect(_on_player_joined)
	NetworkManager.player_moved.connect(_on_player_moved)
	NetworkManager.player_left.connect(_on_player_left)
	NetworkManager.player_skin_changed.connect(_on_player_skin_changed)
	NetworkManager.send_scene_change("openworld")

func spawn_local_player(pos: Vector2) -> void:
	var player = PLAYER_SCENE.instantiate()
	player.z_index = 10
	player.is_local = true
	player.global_position = pos
	add_child(player)
	Loader.hide_loading()

func _on_scene_init(your_id: String, your_pos: Vector2, others: Array, spawn_at_default: bool) -> void:
	if spawn_at_default:
		var marker = get_node_or_null("PlayerSpawn")
		your_pos = marker.global_position if marker else Vector2.ZERO
	spawn_local_player(your_pos)
	for p in others:
		if p["userId"] == your_id:
			continue
		_spawn_remote(p["userId"], p["displayName"], Vector2(p["posX"], p["posY"]), String(p.get("skin", "cvc:1")))

func _on_player_joined(user_id: String, name: String, pos: Vector2, direction: String, skin: String) -> void:
	_spawn_remote(user_id, name, pos, skin)

func _on_player_skin_changed(user_id: String, skin: String) -> void:
	if user_id == NetworkManager.user_id:
		var local := _find_local_player()
		if local:
			local.set_skin(skin)
	elif remote_players.has(user_id):
		remote_players[user_id].set_skin(skin)

func _find_local_player() -> Node:
	for child in get_children():
		if child is CharacterBody2D and child.is_local:
			return child
	return null

func _on_player_moved(user_id: String, pos: Vector2, direction: String) -> void:
	if remote_players.has(user_id):
		remote_players[user_id].remote_update(pos, direction)

func _on_player_left(user_id: String) -> void:
	if remote_players.has(user_id):
		remote_players[user_id].queue_free()
		remote_players.erase(user_id)

func _spawn_remote(user_id: String, name: String, pos: Vector2, skin: String = "cvc:1") -> void:
	if remote_players.has(user_id):
		return
	var node = PLAYER_SCENE.instantiate()
	node.z_index = 10
	node.is_local = false
	node.player_name = name
	node.skin = skin
	node.global_position = pos
	add_child(node)
	remote_players[user_id] = node
