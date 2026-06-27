extends CharacterBody2D

@export var speed: float = 40.0
@export var wander_radius: float = 80.0
@export var min_wait: float = 1.0
@export var max_wait: float = 3.0
@export var sit_chance: float = 0.3   # chance to sit instead of just idling
@export var eat_chance: float = 0.2   # chance to eat instead of just idling

var _spawn_pos: Vector2
var _target_pos: Vector2
var _state: String = "idle"  # "idle" | "walk" | "sit" | "eat"

func _ready() -> void:
	_spawn_pos = global_position
	_play_idle()
	_wait_then_move()

func _physics_process(delta: float) -> void:
	if _state == "walk":
		var direction = (_target_pos - global_position)
		if direction.length() < 2.0:
			velocity = Vector2.ZERO
			_enter_rest_state()
		else:
			direction = direction.normalized()
			velocity = direction * speed
			$AnimatedSprite2D.flip_h = direction.x < 0
			$AnimatedSprite2D.play("walk")
	else:
		velocity = Vector2.ZERO
	move_and_slide()

func _enter_rest_state() -> void:
	var roll = randf()
	if roll < sit_chance:
		_state = "sit"
		$AnimatedSprite2D.play("sit")
	elif roll < sit_chance + eat_chance:
		_state = "eat"
		$AnimatedSprite2D.play("eat")
	else:
		_state = "idle"
		_play_idle()
	_wait_then_move()

func _play_idle() -> void:
	_state = "idle"
	$AnimatedSprite2D.play("idle")

func _wait_then_move() -> void:
	var wait_time = randf_range(min_wait, max_wait)
	await get_tree().create_timer(wait_time).timeout
	_pick_new_target()

func _pick_new_target() -> void:
	var offset = Vector2(
		randf_range(-wander_radius, wander_radius),
		randf_range(-wander_radius, wander_radius)
	)
	_target_pos = _spawn_pos + offset
	_state = "walk"
