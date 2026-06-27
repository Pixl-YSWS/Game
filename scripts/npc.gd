extends Node2D

const MONOCRAFT := preload("res://assets/fonts/Monocraft.ttf")

@export var npc_name: String = "Villager"
@export_multiline var dialogue: String = "Hello there!"
@export var skin: String = "cvc:1"
@export var opens_projects: bool = false

var _in_range := false

func _ready() -> void:
	$Sprite2D.texture = SkinUtil.portrait(skin)
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
