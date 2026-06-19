extends Area2D

@export var prompt_text: String = "Press E to enter"
@onready var label: Label = $Label

var player_in_range := false

func _ready():
	label.visible = false
	label.text = prompt_text

func _on_body_entered(body: Node2D) -> void:
	player_in_range = true
	label.visible = true

func _on_body_exited(body: Node2D) -> void:

	player_in_range = false
	label.visible = false

func _process(_delta):
	if player_in_range and Input.is_action_just_pressed("interact"):
		_enter_house()

func _enter_house():
	print("Entering house...")
	# scene change, fade transition, etc.
