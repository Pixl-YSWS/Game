extends CharacterBody2D

const MONOCRAFT := preload("res://assets/fonts/Monocraft.ttf")

@export var npc_name: String = "Villager"
@export_multiline var dialogue: String = "Hello there!"
@export var skin: String = "cvc:1"
@export var opens_projects: bool = false
@export var wanders: bool = true
@export var speed: float = 50.0
@export var wander_radius: float = 56.0
@export var min_wait: float = 1.2
@export var max_wait: float = 4.5

var _in_range := false
var _base_frames: SpriteFrames
var _home: Vector2
var _target: Vector2
var _state: String = "idle"
var _dir: String = "bottom"
var _walk_timeout: float = 0.0

func _ready() -> void:
	_base_frames = $AnimatedSprite2D.sprite_frames
	set_skin(skin)
	_home = position
	_target = position
	_play_anim(false)
	var nl: Label = $NameLabel
	nl.text = npc_name
	nl.add_theme_font_override("font", MONOCRAFT)
	nl.add_theme_font_size_override("font_size", 24)
	nl.add_theme_color_override("font_color", Color(1, 0.819608, 0.4))
	nl.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	nl.add_theme_constant_override("outline_size", 6)
	nl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nl.scale = Vector2.ONE / 3.5
	$InteractArea.body_entered.connect(_on_body_entered)
	$InteractArea.body_exited.connect(_on_body_exited)
	await get_tree().process_frame
	nl.reset_size()
	nl.position = Vector2(-nl.size.x * nl.scale.x / 2.0, -42.0 - nl.size.y * nl.scale.y)
	if wanders:
		_wait_then_move()

func set_skin(desc: String) -> void:
	skin = desc
	var tex := SkinUtil.resolve_sheet(desc)
	if tex == null:
		return
	var frames: SpriteFrames = _base_frames.duplicate(true)
	for anim in frames.get_animation_names():
		for i in frames.get_frame_count(anim):
			var frame_tex = frames.get_frame_texture(anim, i)
			if frame_tex is AtlasTexture:
				frame_tex.atlas = tex
	$AnimatedSprite2D.sprite_frames = frames

func _physics_process(delta: float) -> void:
	if not wanders or _state != "walk":
		return
	if _in_range and Dialogue.is_open:
		velocity = Vector2.ZERO
		_play_anim(false)
		return
	var to_target := _target - position
	_walk_timeout -= delta
	if to_target.length() < 2.0 or _walk_timeout <= 0.0:
		velocity = Vector2.ZERO
		_state = "idle"
		_play_anim(false)
		_wait_then_move()
		return
	var move := to_target.normalized()
	velocity = move * speed
	_dir = _dir_from_vec(move)
	_play_anim(true)
	move_and_slide()

func _wait_then_move() -> void:
	await get_tree().create_timer(randf_range(min_wait, max_wait)).timeout
	if not is_inside_tree():
		return
	var ang := randf() * TAU
	var r := wander_radius * sqrt(randf())
	_target = _home + Vector2(cos(ang), sin(ang)) * r
	_walk_timeout = position.distance_to(_target) / speed + 1.5
	_state = "walk"

func _dir_from_vec(v: Vector2) -> String:
	if absf(v.x) > absf(v.y):
		return "right" if v.x > 0.0 else "left"
	return "bottom" if v.y > 0.0 else "top"

func _play_anim(moving: bool) -> void:
	var anim := $AnimatedSprite2D
	match _dir:
		"right":
			anim.flip_h = false
			anim.play("side_walk" if moving else "side_idle")
		"left":
			anim.flip_h = true
			anim.play("side_walk" if moving else "side_idle")
		"top":
			anim.play("back_walk" if moving else "back_idle")
		_:
			anim.play("front_walk" if moving else "front_idle")

func _on_body_entered(body: Node2D) -> void:
	if body.has_method("player") and body.is_local:
		_in_range = true

func _on_body_exited(body: Node2D) -> void:
	if body.has_method("player") and body.is_local:
		_in_range = false

func _unhandled_input(event: InputEvent) -> void:
	if not _in_range or Dialogue.is_open:
		return
	if event.is_action_pressed("interact"):
		get_viewport().set_input_as_handled()
		if opens_projects:
			ProjectsHud.open()
		else:
			Dialogue.open(npc_name, dialogue.split("\n"))
