extends Node2D
var can_transition: bool = false

func _ready() -> void:
	if NetworkManager.is_connected_to_server():
		NetworkManager.scene_init.connect(_on_scene_init, CONNECT_ONE_SHOT)
		NetworkManager.send_scene_change("village")
	else:
		spawn_player_at_marker()
	await get_tree().create_timer(0.3).timeout
	can_transition = true

func _on_scene_init(your_user_id: String, your_pos: Vector2, other_players: Array, spawn_at_default: bool) -> void:
	if spawn_at_default:
		spawn_player_at_marker()
	else:
		spawn_player_at(your_pos)

func spawn_player_at_marker() -> void:
	var marker = get_node_or_null(global.spawn_point)
	var pos = marker.global_position if marker else Vector2.ZERO
	spawn_player_at(pos)

func spawn_player_at(pos: Vector2) -> void:
	var player = global.PLAYER_SCENE.instantiate()
	player.z_index = 10
	player.global_position = pos
	add_child(player)

func _process(delta: float) -> void:
	if global.player_in_range and can_transition and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("house_interior", "PlayerSpawn")
		call_deferred("_do_scene_change", "res://scenes/house_interior.tscn")

func _do_scene_change(path: String) -> void:
	get_tree().change_scene_to_file(path)
