extends Control
## Standalone "Customise your look" screen (its own scene, not an overlay).
## Skin/Hair/Top/Bottom steppers + Random + a grid of 9 pre-assembled
## characters, with a live preview. Choices are sent to the server (persisted
## and broadcast); Done returns to whichever scene opened the editor.

var _preview: TextureRect
var _value_labels: Dictionary = {}        # part -> Label ("n / max")
var _preset_buttons: Array[TextureButton] = []

# Current outfit (used when not on a preset) and the selected preset (0 = none).
var _body := 1
var _hair := 1
var _top := 1
var _bottom := 1
var _preset := 1

func _ready() -> void:
	_build_ui()
	_load_from(NetworkManager.local_skin)
	_refresh()

func _build_ui() -> void:
	var backdrop := ColorRect.new()
	backdrop.color = Color(0.078431, 0.062745, 0.039216, 1.0)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 12)
	center.add_child(vbox)

	var title := Label.new()
	title.text = "Customise your look"
	title.theme_type_variation = &"TitleText"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(title)

	# Top row: live preview on the left, steppers on the right.
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 20)
	top.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(top)

	_preview = TextureRect.new()
	_preview.custom_minimum_size = Vector2(96, 96)
	_preview.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_preview.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_preview.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	top.add_child(_preview)

	var steppers := VBoxContainer.new()
	steppers.add_theme_constant_override("separation", 8)
	top.add_child(steppers)
	steppers.add_child(_stepper("Skin", "body", SkinUtil.NUM_BODY))
	steppers.add_child(_stepper("Hair", "hair", SkinUtil.NUM_HAIR))
	steppers.add_child(_stepper("Top", "top", SkinUtil.NUM_TOP))
	steppers.add_child(_stepper("Bottom", "bottom", SkinUtil.NUM_BOTTOM))

	var random_btn := Button.new()
	random_btn.text = "Random"
	random_btn.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	random_btn.pressed.connect(_on_random)
	vbox.add_child(random_btn)

	var hint := Label.new()
	hint.text = "— or pick a character —"
	hint.theme_type_variation = &"StatusText"
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(hint)

	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(grid)
	for n in range(1, SkinUtil.NUM_PRESETS + 1):
		var btn := TextureButton.new()
		btn.ignore_texture_size = true
		btn.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
		btn.custom_minimum_size = Vector2(52, 52)
		btn.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		btn.texture_normal = SkinUtil.portrait("cvc:%d" % n)
		btn.pressed.connect(_on_pick_preset.bind(n))
		grid.add_child(btn)
		_preset_buttons.append(btn)

	var done_btn := Button.new()
	done_btn.text = "Done"
	done_btn.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	done_btn.pressed.connect(_on_done)
	vbox.add_child(done_btn)

func _stepper(label_text: String, part: String, maxv: int) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)

	var name_label := Label.new()
	name_label.text = label_text
	name_label.custom_minimum_size = Vector2(70, 0)
	row.add_child(name_label)

	var dec := Button.new()
	dec.text = "<"
	dec.pressed.connect(_on_step.bind(part, -1, maxv))
	row.add_child(dec)

	var value := Label.new()
	value.custom_minimum_size = Vector2(56, 0)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	row.add_child(value)
	_value_labels[part] = value

	var inc := Button.new()
	inc.text = ">"
	inc.pressed.connect(_on_step.bind(part, 1, maxv))
	row.add_child(inc)
	return row

func _load_from(desc: String) -> void:
	var o := SkinUtil.parse_outfit(desc)
	_body = o.body
	_hair = o.hair
	_top = o.top
	_bottom = o.bottom
	_preset = SkinUtil.preset_index(desc)  # 0 if this is an outfit

func _current_desc() -> String:
	if _preset > 0:
		return "cvc:%d" % _preset
	return SkinUtil.encode_outfit(_body, _hair, _top, _bottom)

func _on_step(part: String, delta: int, maxv: int) -> void:
	# Touching a stepper drops out of preset mode into the layered outfit.
	_preset = 0
	var v: int = _get_part(part) + delta
	if v < 1:
		v = maxv
	elif v > maxv:
		v = 1
	_set_part(part, v)
	_apply()

func _on_pick_preset(n: int) -> void:
	_preset = n
	_apply()

func _on_random() -> void:
	_load_from(SkinUtil.random_outfit())
	_preset = 0
	_apply()

func _on_done() -> void:
	var target := global.editor_return_scene
	# World scenes wait on a server round-trip before the player spawns, so cover
	# the gap with the loading overlay (they hide it once spawned). The menu has
	# nothing to wait on, so it just switches instantly.
	if target.ends_with("village.tscn"):
		Loader.change_scene(target, "Entering village")
	elif target.ends_with("open_world.tscn"):
		Loader.change_scene(target, "Joining open-world")
	else:
		get_tree().change_scene_to_file(target)

func _get_part(part: String) -> int:
	match part:
		"body": return _body
		"hair": return _hair
		"top": return _top
		_: return _bottom

func _set_part(part: String, v: int) -> void:
	match part:
		"body": _body = v
		"hair": _hair = v
		"top": _top = v
		"bottom": _bottom = v

func _apply() -> void:
	NetworkManager.send_set_skin(_current_desc())
	_refresh()

func _refresh() -> void:
	_value_labels["body"].text = "%d / %d" % [_body, SkinUtil.NUM_BODY]
	_value_labels["hair"].text = "%d / %d" % [_hair, SkinUtil.NUM_HAIR]
	_value_labels["top"].text = "%d / %d" % [_top, SkinUtil.NUM_TOP]
	_value_labels["bottom"].text = "%d / %d" % [_bottom, SkinUtil.NUM_BOTTOM]
	_preview.texture = SkinUtil.portrait(_current_desc())
	for i in _preset_buttons.size():
		_preset_buttons[i].modulate = Color.WHITE if (i + 1) == _preset else Color(0.5, 0.5, 0.5, 1.0)
