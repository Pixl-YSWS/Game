extends "res://scripts/multiplayer_world.gd"

const NPC := preload("res://scenes/npc.tscn")

var can_transition: bool = false

func _ready() -> void:
	super._ready()
	_spawn_npcs()
	await get_tree().create_timer(0.3).timeout
	can_transition = true
	GuideHud.maybe_show_intro()

func _spawn_npcs() -> void:
	var defs := [
		{"pos": Vector2(120, -81), "name": "Pip", "skin": "cvc:4", "projects": true,
			"dialogue": "Built something? Talk to me to log your project."},
		{"pos": Vector2(0, -120), "name": "Ridit", "skin": "cvc:3",
			"dialogue": "Hey, I'm Ridit — welcome to the village!\nNice day for a stroll across the bridges, huh?"},
		{"pos": Vector2(-70, -50), "name": "Mara", "skin": "cvc:2",
			"dialogue": "The bridges link the whole village together."},
	]
	for d in defs:
		var n := NPC.instantiate()
		n.position = d["pos"]
		n.npc_name = d["name"]
		n.skin = d["skin"]
		n.dialogue = d["dialogue"]
		n.opens_projects = d.get("projects", false)
		add_child(n)

func _process(_delta: float) -> void:
	if global.player_in_range and can_transition and not Dialogue.is_open and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("house_interior", "PlayerSpawn")
		Loader.change_scene("res://scenes/house_interior.tscn", "Loading")
