extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const SEEN_PATH := "user://guide_seen.dat"

const CONTROLS := [
	["WASD / Arrows", "Move around"],
	["Shift", "Hold to run"],
	["E", "Talk to villagers, pet animals, enter buildings"],
	["Enter", "Open chat"],
	["T  then  1-5", "Send an emote"],
	["V", "Hold to talk (voice chat)"],
	["N", "Open your inbox"],
	["H", "Open Projects / Hackatime"],
	["Esc", "Pause menu"],
	["F1", "Open this guide again"],
]

const PEOPLE := [
	["Pip", "Built something? Talk to Pip to log a project."],
	["Ridit & Mara", "Villagers — say hi and have a chat."],
]

var _root: Control
var _open := false

func _ready() -> void:
	layer = 105
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F1:
		if ChatHud.is_typing() or Dialogue.is_open:
			return
		_toggle()
		get_viewport().set_input_as_handled()

func maybe_show_intro() -> void:
	if FileAccess.file_exists(SEEN_PATH):
		return
	var f := FileAccess.open(SEEN_PATH, FileAccess.WRITE)
	if f:
		f.store_string("1")
		f.close()
	open()

func _toggle() -> void:
	if _open:
		close()
		return
	var current := get_tree().current_scene
	if current and GAMEPLAY_SCENES.has(current.scene_file_path.get_file().get_basename()):
		open()

func open() -> void:
	_open = true
	get_tree().paused = true
	_root.visible = true

func close() -> void:
	_open = false
	get_tree().paused = false
	_root.visible = false

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = THEME
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.031373, 0.019608, 0.9)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var panel := VBoxContainer.new()
	panel.custom_minimum_size = Vector2(520, 0)
	panel.add_theme_constant_override("separation", 14)
	center.add_child(panel)

	var title := Label.new()
	title.text = "Welcome to Pixl"
	title.theme_type_variation = &"TitleText"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)

	var intro := Label.new()
	intro.text = "A cozy village where your real coding time comes to life. Walk around, meet people, and log what you build."
	intro.theme_type_variation = &"InfoText"
	intro.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	intro.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel.add_child(intro)

	panel.add_child(_section("Controls"))
	for c in CONTROLS:
		panel.add_child(_control_row(c[0], c[1]))

	panel.add_child(_section("People to meet"))
	for p in PEOPLE:
		panel.add_child(_control_row(p[0], p[1]))

	panel.add_child(_section("Logging your time"))
	var ht := Label.new()
	ht.text = "Press H or talk to Pip to open Projects. Create a project and link your Hackatime projects — the hours you code there show up here."
	ht.theme_type_variation = &"InfoText"
	ht.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel.add_child(ht)

	var close_button := Button.new()
	close_button.text = "Let's go"
	close_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	close_button.pressed.connect(close)
	panel.add_child(close_button)

func _section(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"StatusText"
	return l

func _control_row(key: String, desc: String) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var k := Label.new()
	k.text = key
	k.custom_minimum_size = Vector2(150, 0)
	k.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(k)
	var d := Label.new()
	d.text = desc
	d.theme_type_variation = &"InfoText"
	d.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	row.add_child(d)
	return row
