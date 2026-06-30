extends CanvasLayer

const DIR := "res://assets/emotes/"
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const EMOTES := [
	{"key": "happy", "file": "emote_faceHappy.png"},
	{"key": "laugh", "file": "emote_laugh.png"},
	{"key": "heart", "file": "emote_heart.png"},
	{"key": "sad", "file": "emote_faceSad.png"},
	{"key": "angry", "file": "emote_faceAngry.png"},
	{"key": "love", "file": "emote_hearts.png"},
	{"key": "cry", "file": "emote_drop.png"},
	{"key": "idea", "file": "emote_idea.png"},
	{"key": "music", "file": "emote_music.png"},
	{"key": "sleep", "file": "emote_sleep.png"},
	{"key": "star", "file": "emote_star.png"},
	{"key": "question", "file": "emote_question.png"},
	{"key": "alert", "file": "emote_alert.png"},
	{"key": "exclaim", "file": "emote_exclamation.png"},
	{"key": "dizzy", "file": "emote_swirl.png"},
]
const QUICK := ["heart", "laugh", "happy", "sad", "star", "music"]

var _root: Control
var _quick: Control
var _open := false

func _ready() -> void:
	layer = 106
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_build_quick_bar()

func _process(_delta: float) -> void:
	if _quick == null:
		return
	_quick.visible = _in_gameplay() and not _open and not get_tree().paused \
		and not ChatHud.is_typing() and not Dialogue.is_open

func texture_for(key: String) -> Texture2D:
	for e in EMOTES:
		if e["key"] == key:
			return load(DIR + e["file"])
	return load(DIR + "emote_question.png")

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.visible = false
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0.039216, 0.031373, 0.019608, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(dim)

	var close_catch := Button.new()
	close_catch.flat = true
	close_catch.set_anchors_preset(Control.PRESET_FULL_RECT)
	close_catch.pressed.connect(_close)
	_root.add_child(close_catch)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var panel := PanelContainer.new()
	panel.theme = preload("res://themes/main_theme.tres")
	center.add_child(panel)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_right", 16)
	margin.add_theme_constant_override("margin_top", 16)
	margin.add_theme_constant_override("margin_bottom", 16)
	panel.add_child(margin)

	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	margin.add_child(grid)

	for e in EMOTES:
		var b := TextureButton.new()
		b.texture_normal = load(DIR + e["file"])
		b.ignore_texture_size = true
		b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
		b.custom_minimum_size = Vector2(48, 48)
		b.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		b.pressed.connect(_pick.bind(String(e["key"])))
		grid.add_child(b)

func _build_quick_bar() -> void:
	_quick = Control.new()
	_quick.set_anchors_preset(Control.PRESET_FULL_RECT)
	_quick.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_quick)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.anchor_left = 1.0
	row.anchor_top = 1.0
	row.anchor_right = 1.0
	row.anchor_bottom = 1.0
	row.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	row.grow_vertical = Control.GROW_DIRECTION_BEGIN
	row.offset_right = -12
	row.offset_bottom = -12
	_quick.add_child(row)

	for key in QUICK:
		var b := TextureButton.new()
		b.texture_normal = texture_for(key)
		b.ignore_texture_size = true
		b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
		b.custom_minimum_size = Vector2(40, 40)
		b.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		b.modulate.a = 0.85
		b.pressed.connect(func(): NetworkManager.send_emote(key))
		row.add_child(b)

func _pick(key: String) -> void:
	_close()
	NetworkManager.send_emote(key)

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())

func _close() -> void:
	_open = false
	_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if ChatHud.is_typing() or Dialogue.is_open:
		return
	if event.keycode == KEY_T and _in_gameplay():
		_open = not _open
		_root.visible = _open
		get_viewport().set_input_as_handled()
	elif _open and event.keycode == KEY_ESCAPE:
		_close()
		get_viewport().set_input_as_handled()
	elif event.keycode >= KEY_1 and event.keycode <= KEY_5 and _in_gameplay():
		_pick(String(EMOTES[event.keycode - KEY_1]["key"]))
		get_viewport().set_input_as_handled()
