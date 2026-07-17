extends "res://scripts/multiplayer_world.gd"

var can_transition: bool = false

func _ready() -> void:
	$TileMapLayer.modulate = Color(1.02, 0.92, 0.74)
	$TileMapLayer2.modulate = Color(1.05, 0.85, 0.62)
	$TileMapLayer4.modulate = Color(1.0, 0.95, 0.85)
	super._ready()
	_spawn_counter_trigger()
	await get_tree().create_timer(0.3).timeout
	can_transition = true

func _spawn_counter_trigger() -> void:
	var trigger := Area2D.new()
	trigger.position = Vector2(34, -58)
	trigger.collision_mask = 2
	trigger.set_script(load("res://scripts/house_trigger.gd"))
	trigger.action = "shop"
	trigger.sign_text = "SHOP"
	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = 34.0
	shape.shape = circle
	trigger.add_child(shape)
	add_child(trigger)

func _on_scene_init(your_id: String, _your_pos: Vector2, others: Array, _spawn_at_default: bool) -> void:
	super._on_scene_init(your_id, Vector2.ZERO, others, true)

func _process(_delta: float) -> void:
	if global.player_in_range and can_transition and not Dialogue.is_open and not global.ui_blocked() and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("village", "PlayerSpawn")
		Loader.change_scene("res://scenes/village.tscn", "Loading")
