extends Control

@onready var status_label: Label = $CenterContainer/VBoxContainer/StatusLabel
@onready var play_button: Button = $CenterContainer/VBoxContainer/PlayButton
@onready var openworld_button: Button = $CenterContainer/VBoxContainer/OpenworldButton
@onready var lobbies_button: Button = $CenterContainer/VBoxContainer/LobbiesButton
@onready var character_button: Button = $CenterContainer/VBoxContainer/CharacterButton
@onready var logout_button: Button = $CenterContainer/VBoxContainer/LogoutButton

func _ready() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
		return

	status_label.text = "Logged in as: " + NetworkManager.display_name

	play_button.pressed.connect(_on_play_pressed)
	openworld_button.pressed.connect(_on_openworld_pressed)
	lobbies_button.pressed.connect(_on_lobbies_pressed)
	character_button.pressed.connect(_on_character_pressed)
	logout_button.pressed.connect(_on_logout_pressed)

	NetworkManager.disconnected_from_server.connect(_on_disconnected)

func _on_play_pressed() -> void:
	Loader.change_scene("res://scenes/village.tscn", "Entering village")

func _on_openworld_pressed() -> void:
	NetworkManager.current_lobby_id = ""
	Loader.change_scene("res://scenes/open_world.tscn", "Joining open-world")

func _on_lobbies_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/lobby_menu.tscn")

func _on_character_pressed() -> void:
	global.editor_return_scene = "res://scenes/main_menu.tscn"
	get_tree().change_scene_to_file("res://scenes/character_editor.tscn")

func _on_logout_pressed() -> void:
	NetworkManager.logout()
	get_tree().change_scene_to_file("res://scenes/login.tscn")

func _on_disconnected() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
