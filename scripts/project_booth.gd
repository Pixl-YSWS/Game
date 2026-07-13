extends Area2D

const MONOCRAFT := preload("res://assets/fonts/Monocraft.ttf")
const BOOTH_TEX := preload("res://assets/cozy-towns/CozyValley_Premium_1.3/Tilesets/Crafters.png")

var project: Dictionary = {}

var _in_range := false
var _prompt: Label

func _ready() -> void:
	collision_layer = 0
	collision_mask = 2
	z_index = 10

	var at := AtlasTexture.new()
	at.atlas = BOOTH_TEX
	at.region = Rect2(0, 0, 16, 16)
	var sprite := Sprite2D.new()
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.texture = at
	sprite.offset = Vector2(0, -8)
	add_child(sprite)

	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = 20.0
	shape.shape = circle
	shape.position = Vector2(0, -8)
	add_child(shape)

	var nl := _label(String(project.get("name", "?")), Color(1, 0.819608, 0.4), 24)
	add_child(nl)
	var ol := _label("by " + String(project.get("owner_name", "?")), Color(0.956863, 0.890196, 0.760784), 18)
	add_child(ol)
	_prompt = _label("[E] view", Color(0.956863, 0.890196, 0.760784), 20)
	_prompt.visible = false
	add_child(_prompt)

	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	Dialogue.closed.connect(_update_prompt)

	await get_tree().process_frame
	_place(nl, -33.0)
	_place(ol, -26.0)
	_place(_prompt, -40.0)

func _label(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", MONOCRAFT)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	l.add_theme_constant_override("outline_size", 6)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.scale = Vector2.ONE / 3.5
	l.z_index = 21
	return l

func _place(l: Label, y: float) -> void:
	l.reset_size()
	l.position = Vector2(-l.size.x * l.scale.x / 2.0, y)

func _on_body_entered(body: Node2D) -> void:
	if body.has_method("player") and body.is_local:
		_in_range = true
		_update_prompt()

func _on_body_exited(body: Node2D) -> void:
	if body.has_method("player") and body.is_local:
		_in_range = false
		_update_prompt()

func _update_prompt() -> void:
	if _prompt != null:
		_prompt.visible = _in_range and not Dialogue.is_open

func _unhandled_input(event: InputEvent) -> void:
	if not _in_range or Dialogue.is_open or global.ui_blocked():
		return
	if event.is_action_pressed("interact"):
		get_viewport().set_input_as_handled()
		ExploreHud.open_project(project)
		_update_prompt()
