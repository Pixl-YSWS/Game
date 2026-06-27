extends Area2D

@onready var label: Label = $Label

func _on_body_entered(body: Node2D) -> void:
	if body.has_method("player") and body.is_local:
		global.player_in_range = true
		label.visible = true


func _on_body_exited(body: Node2D) -> void:
	if body.has_method("player") and body.is_local:
		global.player_in_range = false
		label.visible = false
