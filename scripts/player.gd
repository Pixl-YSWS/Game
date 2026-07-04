extends CharacterBody2D
var speed = 150
var current_dir = "none"
var is_on_stairs = false
@export var is_local: bool = true
## Display name for a remote player; set by the spawner before add_child().
var player_name: String = ""

var skin: String = "cvc:1"

var _last_sent_pos: Vector2 = Vector2.INF
var _last_sent_dir: String = ""

var _target_pos: Vector2 = Vector2.INF

var _prev_pos: Vector2 = Vector2.INF

var _base_frames: SpriteFrames

const BUBBLE_FONT := preload("res://assets/fonts/Monocraft.ttf")
var _bubble: Label
var _bubble_token: int = 0

func _ready() -> void:
	_base_frames = $AnimatedSprite2D.sprite_frames
	if is_local:
		$NameLabel.text = "You"
		skin = NetworkManager.local_skin
	else:
		$NameLabel.text = player_name
		$CollisionShape2D.disabled = true
	set_skin(skin)
	$AnimatedSprite2D.play("front_idle")
	_layout_name_label()

func _layout_name_label() -> void:
	var nl: Label = $NameLabel
	nl.scale = Vector2.ONE / _bubble_zoom()
	nl.add_theme_font_size_override("font_size", 24)
	nl.set_anchors_preset(Control.PRESET_TOP_LEFT)
	nl.custom_minimum_size = Vector2.ZERO
	await get_tree().process_frame
	nl.reset_size()
	nl.position = Vector2(-nl.size.x * nl.scale.x / 2.0, -36.0 - nl.size.y * nl.scale.y)

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
	if is_local:
		player_movement(delta)
	else:
		remote_movement(delta)

func player_movement(delta: float)-> void:
	if ChatHud.is_typing():
		velocity = Vector2.ZERO
		move_and_slide()
		return
	var before := global_position
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

	var max_step: float = speed * delta * 4.0
	if _prev_pos != Vector2.INF and global_position.distance_to(before) > maxf(max_step, 16.0):
		global_position = before
		velocity = Vector2.ZERO
	_prev_pos = global_position

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

func remote_update(pos: Vector2, direction: String) -> void:
	_target_pos = pos
	current_dir = direction

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

func show_emote(key: String) -> void:
	var tex := EmoteHud.texture_for(key)
	if tex == null:
		return
	var s := Sprite2D.new()
	s.texture = tex
	s.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	s.z_index = 23
	s.position = Vector2(0, -52)
	var h := float(maxi(tex.get_height(), 1))
	var target := Vector2.ONE * (16.0 / h)
	s.scale = target * 0.3
	add_child(s)
	var pop := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	pop.tween_property(s, "scale", target, 0.35)
	var tw := create_tween()
	tw.tween_property(s, "position:y", -66.0, 1.6).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(s, "modulate:a", 0.0, 1.6).from(1.0)
	tw.tween_callback(s.queue_free)

func _bubble_zoom() -> float:
	if has_node("Camera2d"):
		return maxf($Camera2d.zoom.x, 0.01)
	return 3.5

func show_chat_bubble(text: String) -> void:
	if _bubble == null:
		_bubble = Label.new()
		_bubble.z_index = 22
		_bubble.scale = Vector2.ONE / _bubble_zoom()
		_bubble.add_theme_font_override("font", BUBBLE_FONT)
		_bubble.add_theme_font_size_override("font_size", 24)
		_bubble.add_theme_color_override("font_color", Color(1, 1, 1))
		var bg := StyleBoxFlat.new()
		bg.bg_color = Color(0.05, 0.04, 0.03, 0.88)
		bg.content_margin_left = 10
		bg.content_margin_right = 10
		bg.content_margin_top = 6
		bg.content_margin_bottom = 6
		bg.corner_radius_top_left = 8
		bg.corner_radius_top_right = 8
		bg.corner_radius_bottom_left = 8
		bg.corner_radius_bottom_right = 8
		_bubble.add_theme_stylebox_override("normal", bg)
		add_child(_bubble)
	_bubble.text = text
	_bubble.visible = true
	_bubble_token += 1
	var token := _bubble_token
	await get_tree().process_frame
	if token == _bubble_token and is_instance_valid(_bubble):
		var s := Vector2.ONE / _bubble_zoom()
		_bubble.position = Vector2(-_bubble.size.x * s.x / 2.0, -44.0 - _bubble.size.y * s.y)
		_bubble.pivot_offset = Vector2(_bubble.size.x / 2.0, _bubble.size.y)
		_bubble.scale = s * 0.6
		var pop := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		pop.tween_property(_bubble, "scale", s, 0.25)
	await get_tree().create_timer(5.0).timeout
	if token == _bubble_token and is_instance_valid(_bubble):
		_bubble.visible = false
