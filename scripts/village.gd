extends "res://scripts/multiplayer_world.gd"

const NPC := preload("res://scenes/npc.tscn")

var can_transition: bool = false
var _npcs: Array = []
var _npcs_by_id: Dictionary = {}
var _save_accum: float = 0.0

func _ready() -> void:
	super._ready()
	_spawn_npcs()
	if NetworkManager.is_connected_to_server():
		NetworkManager.npc_init.connect(_on_npc_init)
	await get_tree().create_timer(0.3).timeout
	can_transition = true
	GuideHud.maybe_show_intro()

func _exit_tree() -> void:
	_save_npcs()

func _spawn_npcs() -> void:
	var defs := [
		{"pos": Vector2(120, -81), "name": "Pip", "skin": "cvc:4", "projects": true,
			"dialogue": "Built something? Talk to me to log your project."},
		{"pos": Vector2(0, -120), "name": "Ridit", "skin": "cvc:3",
			"dialogue": "Hey, I'm Ridit — welcome to the village!\nNice day for a stroll across the bridges, huh?"},
		{"pos": Vector2(-430, -50), "name": "Mangoman", "skin": "cvc:2",
			"dialogue": "Mango? Mango. The bridges link the whole village together."},
		{"pos": Vector2(-410, -160), "name": "Imu", "skin": "cvc:6",
			"dialogue": "I watch over the village from the shadows."},
		{"pos": Vector2(-465, -440), "name": "Gabin", "skin": "cvc:8",
			"dialogue": "Hi hi~ I'm Gabin! Cutest one in the village, obviously.\nDon't be shy, come hang out with me anytime!"},
		{"pos": Vector2(-510, -465), "name": "Ricky", "skin": "cvc:5",
			"dialogue": "Yo, I'm Ricky. Gabin dragged me here but honestly?\nThis village is pretty cool."},
	]
	for d in defs:
		var n := NPC.instantiate()
		n.position = d["pos"]
		n.npc_name = d["name"]
		n.skin = d["skin"]
		n.dialogue = d["dialogue"]
		n.opens_projects = d.get("projects", false)
		add_child(n)
		_npcs.append(n)
		_npcs_by_id[d["name"]] = n

func _on_npc_init(scene: String, npcs: Array) -> void:
	if scene != _network_scene_name():
		return
	for saved in npcs:
		var n = _npcs_by_id.get(saved["id"])
		if n:
			n.apply_saved_position(saved["pos"])

func _save_npcs() -> void:
	if not NetworkManager.is_connected_to_server():
		return
	var payload: Array = []
	for n in _npcs:
		if is_instance_valid(n):
			payload.append({"id": n.npc_id(), "posX": n.position.x, "posY": n.position.y})
	NetworkManager.send_save_npcs(_network_scene_name(), payload)

func _process(delta: float) -> void:
	_save_accum += delta
	if _save_accum >= 5.0:
		_save_accum = 0.0
		_save_npcs()
	if global.player_in_range and can_transition and not Dialogue.is_open and not global.ui_blocked() and Input.is_action_just_pressed("interact"):
		can_transition = false
		_save_npcs()
		var door := Vector2i(global.active_door_pos.round())
		global.house_variant = absi(door.x * 928371 + door.y * 1237) % 4
		global.request_transition("house_interior", "PlayerSpawn")
		Loader.change_scene("res://scenes/house_interior.tscn", "Loading")
