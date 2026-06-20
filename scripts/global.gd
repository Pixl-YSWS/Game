extends Node

const PLAYER_SCENE = preload("res://scenes/player.tscn")

var current_scene: String = "game"
var transition_scene: bool = false
var spawn_point: String = "PlayerSpawn" 

func request_transition(target_scene: String, spawn_name: String = "PlayerSpawn") -> void:
	transition_scene = true
	current_scene = target_scene
	spawn_point = spawn_name
