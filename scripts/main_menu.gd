extends Control

@onready var welcome_label: Label = $CenterContainer/VBoxContainer/TitleLabel
@onready var play_button: Button = $CenterContainer/VBoxContainer/PlayButton
@onready var openworld_button: Button = $CenterContainer/VBoxContainer/OpenworldButton
@onready var logout_button: Button = $CenterContainer/VBoxContainer/LogoutButton

func _ready() -> void:
	welcome_label.text = "Logged in as: " + NetworkManager.display_name

	play_button.pressed.connect(_on_play_pressed)
	openworld_button.pressed.connect(_on_openworld_pressed)
	logout_button.pressed.connect(_on_logout_pressed)

	NetworkManager.disconnected_from_server.connect(_on_disconnected)

func _on_play_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/village.tscn")

func _on_openworld_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/open_world.tscn")

func _on_logout_pressed() -> void:
	NetworkManager.logout()
	get_tree().change_scene_to_file("res://scenes/login.tscn")

func _on_disconnected() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
