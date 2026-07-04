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
var _mic_btn: TextureButton
var _mic_circle: StyleBoxFlat
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
		_hoverify(b, 1.0)
		grid.add_child(b)

func _hoverify(b: Control, rest_alpha: float) -> void:
	b.modulate.a = rest_alpha
	b.pivot_offset = b.custom_minimum_size / 2.0
	b.mouse_entered.connect(func():
		var tw := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_property(b, "scale", Vector2(1.25, 1.25), 0.12)
		b.modulate.a = 1.0)
	b.mouse_exited.connect(func():
		var tw := create_tween().set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.tween_property(b, "scale", Vector2.ONE, 0.1)
		b.modulate.a = rest_alpha)

func _build_quick_bar() -> void:
	_quick = Control.new()
	_quick.set_anchors_preset(Control.PRESET_FULL_RECT)
	_quick.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_quick)

	var bar := HBoxContainer.new()
	bar.theme = preload("res://themes/main_theme.tres")
	bar.add_theme_constant_override("separation", 8)
	bar.alignment = BoxContainer.ALIGNMENT_END
	bar.anchor_left = 1.0
	bar.anchor_top = 1.0
	bar.anchor_right = 1.0
	bar.anchor_bottom = 1.0
	bar.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bar.offset_right = -12
	bar.offset_bottom = -12
	_quick.add_child(bar)

	_mic_circle = StyleBoxFlat.new()
	_mic_circle.bg_color = Color(0.168627, 0.113725, 0.070588)
	_mic_circle.set_border_width_all(3)
	_mic_circle.border_color = Color(0.090196, 0.062745, 0.039216)
	_mic_circle.set_corner_radius_all(24)

	var mic_panel := PanelContainer.new()
	mic_panel.add_theme_stylebox_override("panel", _mic_circle)
	mic_panel.custom_minimum_size = Vector2(48, 48)
	mic_panel.size_flags_vertical = Control.SIZE_SHRINK_END
	bar.add_child(mic_panel)

	_mic_btn = TextureButton.new()
	_mic_btn.ignore_texture_size = true
	_mic_btn.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	_mic_btn.custom_minimum_size = Vector2(30, 30)
	_mic_btn.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_mic_btn.tooltip_text = "Toggle voice (hold V to talk)"
	_mic_btn.pressed.connect(_toggle_mic)
	_hoverify(_mic_btn, 0.85)
	mic_panel.add_child(_mic_btn)
	_update_mic()

	var panel := PanelContainer.new()
	panel.theme_type_variation = &"HudPanel"
	panel.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	bar.add_child(panel)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	panel.add_child(row)

	for key in QUICK:
		var b := TextureButton.new()
		b.texture_normal = texture_for(key)
		b.ignore_texture_size = true
		b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
		b.custom_minimum_size = Vector2(40, 40)
		b.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		b.pressed.connect(func(): NetworkManager.send_emote(key))
		_hoverify(b, 0.85)
		row.add_child(b)

	var more := Button.new()
	more.flat = true
	more.text = "•••"
	more.custom_minimum_size = Vector2(34, 40)
	more.add_theme_font_size_override("font_size", 14)
	more.add_theme_color_override("font_color", Color(0.956863, 0.890196, 0.760784))
	more.add_theme_color_override("font_hover_color", Color(1, 0.905882, 0.639216))
	more.tooltip_text = "All reactions (T)"
	more.pressed.connect(func():
		_open = true
		_root.visible = true)
	_hoverify(more, 0.85)
	row.add_child(more)

func _toggle_mic() -> void:
	Settings.set_voice_enabled(not Settings.voice_enabled)
	_update_mic()

func _update_mic() -> void:
	if _mic_btn:
		_mic_btn.texture_normal = _mic_texture(not Settings.voice_enabled)

func _mic_texture(muted: bool) -> ImageTexture:
	var img := Image.create(15, 15, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var col := Color(0.55, 0.55, 0.55) if muted else Color(0.96, 0.96, 0.96)
	for y in range(2, 9):
		for x in range(5, 10):
			img.set_pixelv(Vector2i(x, y), col)
	img.set_pixelv(Vector2i(5, 2), Color(0, 0, 0, 0))
	img.set_pixelv(Vector2i(9, 2), Color(0, 0, 0, 0))
	img.set_pixelv(Vector2i(5, 8), Color(0, 0, 0, 0))
	img.set_pixelv(Vector2i(9, 8), Color(0, 0, 0, 0))
	for y in range(7, 10):
		img.set_pixelv(Vector2i(3, y), col)
		img.set_pixelv(Vector2i(11, y), col)
	for x in range(4, 11):
		img.set_pixelv(Vector2i(x, 10), col)
	img.set_pixelv(Vector2i(7, 11), col)
	img.set_pixelv(Vector2i(7, 12), col)
	for x in range(4, 11):
		img.set_pixelv(Vector2i(x, 13), col)
	if muted:
		var red := Color(0.92, 0.23, 0.23)
		for i in range(15):
			img.set_pixelv(Vector2i(i, i), red)
			if i + 1 < 15:
				img.set_pixelv(Vector2i(i + 1, i), red)
	return ImageTexture.create_from_image(img)

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
