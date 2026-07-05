extends "res://scripts/multiplayer_world.gd"

const NPC := preload("res://scenes/npc.tscn")

func _ready() -> void:
	super._ready()
	_spawn_showcase()

func _spawn_showcase() -> void:
	var curator := NPC.instantiate()
	curator.position = Vector2(110, -140)
	curator.npc_name = "Curator"
	curator.skin = "cvc:7"
	curator.wanders = false
	curator.dialogue = "Welcome to the Project Showcase!\nSoon, projects shipped by players will be on display right here.\nCheck back after the open world update!"
	add_child(curator)
