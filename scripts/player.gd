extends CharacterBody2D
var speed = 150
var current_dir = "none"
var is_on_stairs = false
@export var is_local: bool = true
## Display name for a remote player; set by the spawner before add_child().
var player_name: String = ""

var _last_sent_pos: Vector2 = Vector2.INF
var _last_sent_dir: String = ""
## Latest position received from the network for a remote player. We interpolate
## toward this every frame so movement is smooth between (throttled) packets.
var _target_pos: Vector2 = Vector2.INF

func _ready() -> void:
	$AnimatedSprite2D.play("front_idle")
	if is_local:
		$NameLabel.text = "You"
	else:
		$NameLabel.text = player_name
		$CollisionShape2D.disabled = true

func _physics_process(delta: float) -> void:
	if is_local:
		player_movement(delta)
	else:
		remote_movement(delta)

func player_movement(delta: float)-> void:
	if Input.is_action_pressed("move_right"):
		current_dir = "right"
		play_anim(1)
		velocity.x = speed
		velocity.y = 0
	elif Input.is_action_pressed("move_left"):
		current_dir = "left"
		play_anim(1)
		velocity.x = -speed
		velocity.y = 0
	elif Input.is_action_pressed("move_bottom"):
		current_dir = "bottom"
		play_anim(1)
		velocity.y = speed
		velocity.x = 0
	elif Input.is_action_pressed("move_top"):
		current_dir = "top"
		play_anim(1)
		velocity.y = -speed
		velocity.x = 0
	else:
		play_anim(0)
		velocity.x = 0
		velocity.y = 0
	if Input.is_action_pressed("run") && !is_on_stairs:
		speed = 200
	else:
		if !is_on_stairs:
			speed = 150
	move_and_slide()

	if global_position.distance_squared_to(_last_sent_pos) > 1.0 or current_dir != _last_sent_dir:
		_last_sent_pos = global_position
		_last_sent_dir = current_dir
		NetworkManager.send_move(global_position, current_dir)

func play_anim(movement: int) -> void:
	var dir = current_dir
	var anim = $AnimatedSprite2D
	if dir == "right":
		anim.flip_h = false
		if movement == 1:
			anim.play("side_walk")
		elif movement == 0:
			anim.play("side_idle")
	elif dir == "left":
		anim.flip_h = true
		if movement == 1:
			anim.play("side_walk")
		elif movement == 0:
			anim.play("side_idle")
	if dir == "bottom":
		if movement == 1:
			anim.play("front_walk")
		elif movement == 0:
			anim.play("front_idle")
	elif dir == "top":
		if movement == 1:
			anim.play("back_walk")
		elif movement == 0:
			anim.play("back_idle")

## Called when a movement packet arrives; just records the latest target.
func remote_update(pos: Vector2, direction: String) -> void:
	_target_pos = pos
	current_dir = direction

## Smoothly chase the last known network position every frame, so remote
## players glide instead of teleporting on each packet. Plays the walk
## animation while moving and idles once we've caught up.
func remote_movement(delta: float) -> void:
	if _target_pos == Vector2.INF:
		return
	var dist := global_position.distance_to(_target_pos)
	global_position = global_position.lerp(_target_pos, clampf(delta * 12.0, 0.0, 1.0))
	if dist > 2.0:
		play_anim(1)
	else:
		play_anim(0)

func _on_stair_trigger_body_entered(body: Node2D) -> void:
	is_on_stairs = true
	speed = 60
func _on_stair_trigger_body_exited(body: Node2D) -> void:
	is_on_stairs = false
	speed = 100
func player():
	pass
