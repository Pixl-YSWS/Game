extends Control

@onready var status_label: Label = $CenterContainer/VBoxContainer/StatusLabel
@onready var play_button: Button = $CenterContainer/VBoxContainer/PlayButton
@onready var lobbies_button: Button = $CenterContainer/VBoxContainer/LobbiesButton
@onready var character_button: Button = $CenterContainer/VBoxContainer/CharacterButton
@onready var settings_button: Button = $CenterContainer/VBoxContainer/SettingsButton
@onready var logout_button: Button = $CenterContainer/VBoxContainer/LogoutButton

var _logout_armed := false
var _logout_revert: Timer

func _ready() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
		return

	status_label.text = "Signed in as " + NetworkManager.display_name

	play_button.pressed.connect(_on_play_pressed)
	lobbies_button.pressed.connect(_on_lobbies_pressed)
	character_button.pressed.connect(_on_character_pressed)
	settings_button.pressed.connect(_on_settings_pressed)
	logout_button.pressed.connect(_on_logout_pressed)

	_logout_revert = Timer.new()
	_logout_revert.one_shot = true
	_logout_revert.wait_time = 3.0
	_logout_revert.timeout.connect(_disarm_logout)
	add_child(_logout_revert)

	play_button.grab_focus()

	NetworkManager.disconnected_from_server.connect(_on_disconnected)

func _on_play_pressed() -> void:
	Loader.change_scene("res://scenes/village.tscn", "Entering village")

func _on_lobbies_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/lobby_menu.tscn")

func _on_character_pressed() -> void:
	global.editor_return_scene = "res://scenes/main_menu.tscn"
	get_tree().change_scene_to_file("res://scenes/character_editor.tscn")

func _on_settings_pressed() -> void:
	PauseMenu.open_settings()

func _on_logout_pressed() -> void:
	if not _logout_armed:
		_logout_armed = true
		logout_button.text = "Confirm logout?"
		_logout_revert.start()
		return
	_logout_revert.stop()
	NetworkManager.logout()
	get_tree().change_scene_to_file("res://scenes/login.tscn")

func _disarm_logout() -> void:
	_logout_armed = false
	logout_button.text = "Logout"

func _on_disconnected() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
