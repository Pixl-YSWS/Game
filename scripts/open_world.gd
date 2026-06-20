extends Node2D

var remote_players: Dictionary = {}  # user_id -> player node

const REMOTE_PLAYER_SCENE = preload("res://scenes/player.tscn")
# A lightweight version of player.tscn: just AnimatedSprite2D + a Label for the name,
# no input handling, no CharacterBody2D physics needed unless you want collision with others.

func _ready() -> void:
	NetworkManager.scene_init.connect(_on_scene_init)
	NetworkManager.player_joined.connect(_on_player_joined)
	NetworkManager.player_moved.connect(_on_player_moved)
	NetworkManager.player_left.connect(_on_player_left)

	NetworkManager.send_scene_change("openworld")
	spawn_local_player()

func spawn_local_player() -> void:
	var player = global.PLAYER_SCENE.instantiate()
	player.global_position = NetworkManager_last_known_pos()  # or a spawn marker
	add_child(player)
	# Hook your local player's movement to broadcast position —
	# easiest: in player.gd's _physics_process, after move_and_slide(), call:
	# NetworkManager.send_move(global_position, current_dir)

func _on_scene_init(your_id: String, your_pos: Vector2, others: Array) -> void:
	for p in others:
		_spawn_remote(p["userId"], p["displayName"], Vector2(p["posX"], p["posY"]))

func _on_player_joined(user_id: String, name: String, pos: Vector2, direction: String) -> void:
	_spawn_remote(user_id, name, pos)

func _on_player_moved(user_id: String, pos: Vector2, direction: String) -> void:
	if remote_players.has(user_id):
		var node = remote_players[user_id]
		node.global_position = pos  # consider lerping for smoothness, see below
		node.play_anim_for_direction(direction)

func _on_player_left(user_id: String) -> void:
	if remote_players.has(user_id):
		remote_players[user_id].queue_free()
		remote_players.erase(user_id)

func _spawn_remote(user_id: String, name: String, pos: Vector2) -> void:
	if remote_players.has(user_id):
		return
	var node = REMOTE_PLAYER_SCENE.instantiate()
	node.global_position = pos
	node.get_node("Label").text = name
	add_child(node)
	remote_players[user_id] = node
