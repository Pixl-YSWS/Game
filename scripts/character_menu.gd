extends CanvasLayer
## Autoloaded character picker (pre-assembled char1..char9). Opened from the
## main menu and the pause menu. Picking sends the choice to the server, which
## persists it and broadcasts it so every client re-skins this player.

const THEME := preload("res://themes/main_theme.tres")
const CHAR_DIR := "res://assets/cozy-towns/CozyValley_Premium_1.3/Characters/-- Pre-assembled Characters/"
const NUM_CHARS := 9
## Front-facing idle frame, used as the portrait preview on each button.
const PREVIEW_REGION := Rect2(0, 288, 32, 32)

var _root: Control
var _buttons: Array[TextureButton] = []
var _selected: int = 1

func _ready() -> void:
	layer = 110
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = THEME
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.031373, 0.019608, 0.88)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 14)
	center.add_child(vbox)

	var title := Label.new()
	title.text = "Customise your look"
	title.theme_type_variation = &"TitleText"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(title)

	var hint := Label.new()
	hint.text = "— pick a character —"
	hint.theme_type_variation = &"StatusText"
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(hint)

	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(grid)

	for n in range(1, NUM_CHARS + 1):
		var btn := TextureButton.new()
		btn.ignore_texture_size = true
		btn.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
		btn.custom_minimum_size = Vector2(60, 60)
		btn.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		var at := AtlasTexture.new()
		at.atlas = load(CHAR_DIR + "char%d.png" % n)
		at.region = PREVIEW_REGION
		btn.texture_normal = at
		btn.pressed.connect(_on_pick.bind(n))
		grid.add_child(btn)
		_buttons.append(btn)

	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 12)
	vbox.add_child(actions)

	var random_btn := Button.new()
	random_btn.text = "Random"
	random_btn.pressed.connect(_on_random)
	actions.add_child(random_btn)

	var done_btn := Button.new()
	done_btn.text = "Done"
	done_btn.pressed.connect(close)
	actions.add_child(done_btn)

func open() -> void:
	_selected = NetworkManager.local_character
	_highlight()
	_root.visible = true

func close() -> void:
	_root.visible = false

func _on_pick(n: int) -> void:
	_selected = n
	_highlight()
	NetworkManager.send_set_character(n)
	# Instant local feedback: re-skin the local player in the current scene.
	var local := _find_local_player()
	if local:
		local.set_character(n)

func _on_random() -> void:
	_on_pick(randi_range(1, NUM_CHARS))

func _highlight() -> void:
	for i in _buttons.size():
		_buttons[i].modulate = Color.WHITE if (i + 1) == _selected else Color(0.5, 0.5, 0.5, 1.0)

func _find_local_player() -> Node:
	var scene := get_tree().current_scene
	if scene == null:
		return null
	for child in scene.get_children():
		if child is CharacterBody2D and child.is_local:
			return child
	return null
