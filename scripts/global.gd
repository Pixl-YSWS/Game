extends Node

const PLAYER_SCENE = preload("res://scenes/player.tscn")

var current_scene: String = "village"
var transition_scene: bool = false
var spawn_point: String = "PlayerSpawn"
var player_in_range: bool = false
## Scene the character editor returns to when the player presses Done.
var editor_return_scene: String = "res://scenes/main_menu.tscn"

func request_transition(target_scene: String, spawn_name: String = "PlayerSpawn") -> void:
	transition_scene = true
	current_scene = target_scene
	spawn_point = spawn_name
