extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]

var _root: Control
var _resume_button: Button
var _is_paused := false

func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = THEME
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.031373, 0.019608, 0.85)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var vbox := VBoxContainer.new()
	vbox.custom_minimum_size = Vector2(320, 0)
	vbox.add_theme_constant_override("separation", 12)
	center.add_child(vbox)

	var title := Label.new()
	title.text = "Paused"
	title.theme_type_variation = &"TitleText"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(title)

	_resume_button = Button.new()
	_resume_button.text = "Resume"
	_resume_button.pressed.connect(resume_game)
	vbox.add_child(_resume_button)

	var character_button := Button.new()
	character_button.text = "Customise Look"
	character_button.pressed.connect(_on_character)
	vbox.add_child(character_button)

	var menu_button := Button.new()
	menu_button.text = "Main Menu"
	menu_button.pressed.connect(_quit_to_menu)
	vbox.add_child(menu_button)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		_toggle()
		get_viewport().set_input_as_handled()

func _toggle() -> void:
	if _is_paused:
		resume_game()
		return
	var current := get_tree().current_scene
	if current == null:
		return
	var scene_name := current.scene_file_path.get_file().get_basename()
	if GAMEPLAY_SCENES.has(scene_name):
		pause_game()

func pause_game() -> void:
	_is_paused = true
	get_tree().paused = true
	_root.visible = true
	_resume_button.grab_focus()

func resume_game() -> void:
	_is_paused = false
	get_tree().paused = false
	_root.visible = false

func _on_character() -> void:
	# Return to the world we paused over once the player is done customising.
	var current := get_tree().current_scene
	if current and current.scene_file_path != "":
		global.editor_return_scene = current.scene_file_path
	resume_game()
	get_tree().change_scene_to_file("res://scenes/character_editor.tscn")

func _quit_to_menu() -> void:
	resume_game()
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
