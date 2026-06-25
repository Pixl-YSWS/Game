extends Node2D

var can_transition: bool = false

func _ready() -> void:
	spawn_player()
	await get_tree().create_timer(0.3).timeout
	can_transition = true

func spawn_player() -> void:
	var player = global.PLAYER_SCENE.instantiate()
	player.z_index = 10
	var marker = get_node_or_null(global.spawn_point)
	if marker:
		player.global_position = marker.global_position
	add_child(player)

func _process(delta: float) -> void:
	if global.player_in_range and can_transition and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("village", "PlayerSpawn")
		call_deferred("_do_scene_change", "res://scenes/village.tscn")

func _do_scene_change(path: String) -> void:
	get_tree().change_scene_to_file(path)
