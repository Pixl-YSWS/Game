extends Node

const OUT := "/tmp/claude-1000/-home-ridit-Documents-Godot-Games-pixl--the-game/0d2cdf42-ef6e-4714-b6d4-9776e868b115/scratchpad/"

func _ready() -> void:
	var ps: PackedScene = load("res://scenes/lobby_menu.tscn")
	var lm: Node = ps.instantiate()
	lm.set_script(null)
	add_child(lm)
	var list_box: VBoxContainer = lm.find_child("ListBox", true, false)
	var lobby_script := load("res://scripts/lobby_menu.gd")
	var helper: Control = Control.new()
	helper.set_script(lobby_script)
	list_box.add_child(helper.call("_build_row", {"id": "AB12", "name": "Riley's hangout", "isPublic": true, "mine": false, "count": 3, "capacity": 16}))
	list_box.add_child(helper.call("_build_row", {"id": "XY99", "name": "secret base", "isPublic": false, "mine": true, "count": 1, "capacity": 16, "password": "4242"}))
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(OUT + "lobbies.png")
	lm.queue_free()
	PlayerHud.set_process(false)
	PlayerHud._players = {"a": "Riley", "b": "Sam"}
	PlayerHud._update_online()
	PlayerHud._toggle_list()
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(OUT + "players.png")
	get_tree().quit()
