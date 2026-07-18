extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]
const ACCENT_GOLD := Color(0.85098, 0.643137, 0.25098)
const COLOR_LOCKED := Color(0.6, 0.55, 0.45)

var _root: Control
var _list: VBoxContainer
var _open := false
var _ui_font: SystemFont

func _rfont() -> SystemFont:
	if _ui_font == null:
		_ui_font = SystemFont.new()
		_ui_font.font_names = PackedStringArray(["Sans-Serif", "Noto Sans", "DejaVu Sans", "Arial"])
	return _ui_font

func _readable(c: Control, size: int) -> void:
	c.add_theme_font_override("font", _rfont())
	c.add_theme_font_size_override("font_size", Settings.fs(size))

func _ready() -> void:
	layer = 104
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_J:
		if ChatHud.is_typing() or Dialogue.is_open or (not _open and global.ui_blocked()):
			return
		_toggle()
		get_viewport().set_input_as_handled()
	elif _open and event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()

func is_open() -> bool:
	return _open

func _toggle() -> void:
	if _open:
		close()
		return
	var current := get_tree().current_scene
	if current and GAMEPLAY_SCENES.has(current.scene_file_path.get_file().get_basename()):
		open()

func open() -> void:
	if _open:
		return
	_open = true
	global.push_ui_blocker()
	_root.visible = true
	refresh()

func close() -> void:
	if not _open:
		return
	_open = false
	global.pop_ui_blocker()
	_root.visible = false

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = THEME
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.023529, 0.007843, 0.66)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)

	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", -22)
	center.add_child(wrap)

	var plate := PanelContainer.new()
	plate.theme_type_variation = &"TitlePlate"
	plate.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	plate.z_index = 1
	var plate_label := Label.new()
	plate_label.theme_type_variation = &"TitlePlateText"
	plate_label.text = "QUEST LOG"
	plate.add_child(plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(820, 0)
	wrap.add_child(panel)

	var accents := Control.new()
	accents.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(accents)
	for i in 4:
		var corner := ColorRect.new()
		corner.color = ACCENT_GOLD
		corner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var right := i % 2 == 1
		var bottom := i >= 2
		corner.anchor_left = 1.0 if right else 0.0
		corner.anchor_right = corner.anchor_left
		corner.anchor_top = 1.0 if bottom else 0.0
		corner.anchor_bottom = corner.anchor_top
		corner.offset_left = -17.0 if right else 9.0
		corner.offset_right = corner.offset_left + 8.0
		corner.offset_top = -17.0 if bottom else 9.0
		corner.offset_bottom = corner.offset_top + 8.0
		accents.add_child(corner)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 30)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_right", 30)
	margin.add_theme_constant_override("margin_bottom", 24)
	panel.add_child(margin)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	margin.add_child(body)

	var hint := Label.new()
	hint.theme_type_variation = &"InfoText"
	hint.text = "Talk to NPCs around the world to unlock sidequests. Ship a project that fits one to claim its reward."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_readable(hint, 17)
	body.add_child(hint)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 520)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 6)
	scroll.add_child(_list)

	var close_button := Button.new()
	close_button.theme_type_variation = &"GreyButton"
	close_button.text = "Close"
	close_button.pressed.connect(close)
	body.add_child(close_button)

func refresh() -> void:
	for child in _list.get_children():
		child.queue_free()
	_list.add_child(_muted("Loading sidequests…"))
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/sidequests?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		_on_list(code, json)
	)
	req.request(url)

func _on_list(code: int, json: Variant) -> void:
	for child in _list.get_children():
		child.queue_free()
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_list.add_child(_muted("Couldn't load the quest log."))
		return
	var quests: Array = json.get("quests", [])
	if quests.is_empty():
		_list.add_child(_muted("No sidequests posted yet — check back soon!"))
		return
	quests.sort_custom(func(a, b): return bool(a.get("unlocked", false)) and not bool(b.get("unlocked", false)))
	for q in quests:
		_list.add_child(_quest_row(q))

func _quest_row(q: Dictionary) -> Control:
	var unlocked := bool(q.get("unlocked", false))
	var shell := PanelContainer.new()
	shell.theme_type_variation = &"RowPanel"
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 2)
	shell.add_child(box)

	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 8)
	box.add_child(title_row)
	var status := Label.new()
	status.text = "◆" if unlocked else "◇"
	status.add_theme_color_override("font_color", ACCENT_GOLD if unlocked else COLOR_LOCKED)
	_readable(status, 21)
	title_row.add_child(status)
	var title := Label.new()
	title.text = String(q.get("name", "?"))
	if not unlocked:
		title.add_theme_color_override("font_color", COLOR_LOCKED)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_readable(title, 21)
	title_row.add_child(title)
	var region := String(q.get("region", ""))
	if region != "":
		var region_label := Label.new()
		region_label.theme_type_variation = &"InfoText"
		region_label.text = region
		_readable(region_label, 16)
		title_row.add_child(region_label)

	var desc := String(q.get("description", ""))
	if desc != "":
		var body := Label.new()
		body.text = desc
		body.theme_type_variation = &"InfoText"
		body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_readable(body, 18)
		box.add_child(body)

	var meta_parts := PackedStringArray()
	if unlocked:
		meta_parts.append("UNLOCKED")
	else:
		var npc := String(q.get("npc", ""))
		meta_parts.append("Talk to %s to unlock" % npc if npc != "" else "Locked")
	var reward := String(q.get("reward", ""))
	if reward != "":
		meta_parts.append("Reward: %s" % reward)
	var meta := Label.new()
	meta.text = "  ·  ".join(meta_parts)
	meta.add_theme_color_override("font_color", ACCENT_GOLD if unlocked else COLOR_LOCKED)
	_readable(meta, 16)
	box.add_child(meta)
	return shell

func _muted(text: String) -> Label:
	var l := Label.new()
	l.theme_type_variation = &"InfoText"
	l.text = text
	_readable(l, 18)
	return l
