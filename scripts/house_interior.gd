extends "res://scripts/multiplayer_world.gd"

var can_transition: bool = false

func _ready() -> void:
	super._ready()
	await get_tree().create_timer(0.3).timeout
	can_transition = true

func _process(_delta: float) -> void:
	if global.player_in_range and can_transition and not Dialogue.is_open and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("village", "PlayerSpawn")
		Loader.change_scene("res://scenes/village.tscn", "Loading")
