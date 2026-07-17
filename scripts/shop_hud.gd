extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]

const COLOR_GOLD := Color(1, 0.819608, 0.4)
const COLOR_TEAL := Color(0.44, 0.85, 0.85)
const COLOR_MUTED := Color(0.78, 0.72, 0.58)
const COLOR_PANEL := Color(0.16, 0.10, 0.055)
const COLOR_PANEL_EDGE := Color(0.05, 0.03, 0.015)

const ITEMS := [
	{"name": "PIXEL STICKER", "price": 25, "desc": "Red pixel-heart sticker. Priva wants one."},
	{"name": "HOLO STICKER", "price": 60, "desc": "Holographic, shimmery. Looks great on a laptop."},
	{"name": "LETTER PATCH", "price": 120, "desc": "Iron-on patch. The real-deal collectible."},
	{"name": "NAME GLOW", "price": 200, "desc": "Your name shines gold above your head."},
	{"name": "HOUSE PAINT", "price": 260, "desc": "Fresh colors for your house interior."},
	{"name": "MYSTERY CRATE", "price": 500, "desc": "Nobody knows what's inside. Not even us."},
]

var _root: Control
var _pixels_label: Label
var _bubble_label: Label
var _rows: Array = []
var _selected := 0
var _bubble_token := 0

func _ready() -> void:
	layer = 96

func is_open() -> bool:
	return _root != null and _root.visible

func open() -> void:
	if _root == null:
		_build_ui()
	_selected = 0
	_update_rows()
	_say("HEY %s!\nPICK ONE." % _short_name())
	_root.visible = true
	global.push_ui_blocker()
	_fetch_wallet()

func close() -> void:
	if is_open():
		_root.visible = false
		global.pop_ui_blocker()

func _short_name() -> String:
	var n := NetworkManager.display_name.strip_edges()
	if n == "":
		return "YOU"
	return n.split(" ")[0].to_upper()

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed):
		return
	if is_open():
		match event.keycode:
			KEY_ESCAPE, KEY_X:
				close()
			KEY_UP, KEY_W:
				_selected = (_selected - 1 + ITEMS.size()) % ITEMS.size()
				_update_rows()
			KEY_DOWN, KEY_S:
				_selected = (_selected + 1) % ITEMS.size()
				_update_rows()
			KEY_Z, KEY_ENTER:
				_say("NOT FOR SALE YET!\nCOME BACK SOON.")
			_:
				return
		get_viewport().set_input_as_handled()
	elif event.keycode == KEY_B and not event.echo:
		if _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
			open()
			get_viewport().set_input_as_handled()

func _say(text: String) -> void:
	if _bubble_label == null:
		return
	_bubble_token += 1
	var token := _bubble_token
	_bubble_label.text = text
	if text != "HEY %s!\nPICK ONE." % _short_name():
		var timer := get_tree().create_timer(2.0)
		timer.timeout.connect(func():
			if token == _bubble_token and is_open():
				_bubble_label.text = "HEY %s!\nPICK ONE." % _short_name())

func _flat(color: Color, border := Color.TRANSPARENT, border_w := 0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	if border_w > 0:
		sb.border_color = border
		sb.set_border_width_all(border_w)
	return sb

func _rect(parent: Control, color: Color) -> ColorRect:
	var r := ColorRect.new()
	r.color = color
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(r)
	return r

func _label(parent: Node, text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	parent.add_child(l)
	return l

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = THEME
	_root.visible = false
	add_child(_root)

	var wall := _rect(_root, Color(0.84, 0.65, 0.41))
	wall.set_anchors_preset(Control.PRESET_FULL_RECT)

	var planks := _rect(_root, Color(0.93, 0.86, 0.70))
	planks.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	planks.offset_bottom = 120.0
	for i in 3:
		var seam := _rect(_root, Color(0.84, 0.76, 0.60))
		seam.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
		seam.offset_top = 34.0 + i * 34.0
		seam.offset_bottom = 37.0 + i * 34.0

	var floor_rect := _rect(_root, Color(0.80, 0.60, 0.36))
	floor_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	floor_rect.anchor_top = 0.66
	floor_rect.offset_top = 0.0

	var counter_face := _rect(_root, Color(0.33, 0.19, 0.11))
	counter_face.set_anchors_preset(Control.PRESET_FULL_RECT)
	counter_face.anchor_top = 0.56
	counter_face.anchor_bottom = 0.66
	var counter_top := _rect(_root, Color(0.47, 0.29, 0.17))
	counter_top.set_anchors_preset(Control.PRESET_FULL_RECT)
	counter_top.anchor_top = 0.56
	counter_top.anchor_bottom = 0.56
	counter_top.offset_bottom = 12.0
	for i in 40:
		var stud := _rect(_root, Color(0.62, 0.30, 0.22))
		stud.set_anchors_preset(Control.PRESET_TOP_LEFT)
		stud.anchor_top = 0.60
		stud.position = Vector2(24.0 + i * 84.0, 0)
		stud.custom_minimum_size = Vector2(6, 6)
		stud.size = Vector2(6, 6)

	var register := _rect(_root, Color(0.12, 0.08, 0.05))
	register.set_anchors_preset(Control.PRESET_TOP_LEFT)
	register.anchor_left = 0.38
	register.anchor_top = 0.56
	register.offset_top = -26.0
	register.size = Vector2(64, 26)
	var register_key := _rect(register, Color(0.9, 0.3, 0.3))
	register_key.position = Vector2(8, 6)
	register_key.size = Vector2(8, 6)

	var sign := PanelContainer.new()
	sign.add_theme_stylebox_override("panel", _flat(Color(0.97, 0.94, 0.88), Color(0.1, 0.06, 0.03), 4))
	sign.set_anchors_preset(Control.PRESET_CENTER_TOP)
	sign.anchor_left = 0.5
	sign.anchor_right = 0.5
	sign.offset_top = 18.0
	sign.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_root.add_child(sign)
	var sign_pad := MarginContainer.new()
	sign_pad.add_theme_constant_override("margin_left", 24)
	sign_pad.add_theme_constant_override("margin_right", 24)
	sign_pad.add_theme_constant_override("margin_top", 8)
	sign_pad.add_theme_constant_override("margin_bottom", 8)
	sign.add_child(sign_pad)
	var sign_box := VBoxContainer.new()
	sign_box.add_theme_constant_override("separation", 0)
	sign_pad.add_child(sign_box)
	var sign_title := _label(sign_box, "STICKERS", 40, Color(0.85, 0.22, 0.25))
	sign_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var sign_sub := _label(sign_box, "PIXL  ·  MADE WITH <3", 15, Color(0.25, 0.18, 0.12))
	sign_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER

	var shelf := _rect(_root, Color(0.55, 0.36, 0.20))
	shelf.set_anchors_preset(Control.PRESET_TOP_LEFT)
	shelf.position = Vector2(70, 176)
	shelf.size = Vector2(230, 8)
	var sticker_colors := [Color(0.9, 0.3, 0.3), Color(0.3, 0.55, 0.9), Color(0.35, 0.75, 0.4), Color(0.95, 0.8, 0.35), Color(0.65, 0.4, 0.85)]
	for i in sticker_colors.size():
		var sticker := _rect(_root, sticker_colors[i])
		sticker.set_anchors_preset(Control.PRESET_TOP_LEFT)
		sticker.position = Vector2(82 + i * 44.0, 148)
		sticker.size = Vector2(24, 24)

	var wallet := PanelContainer.new()
	wallet.theme_type_variation = &"HudPanel"
	wallet.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	wallet.set_anchors_preset(Control.PRESET_TOP_LEFT)
	wallet.position = Vector2(16, 14)
	_root.add_child(wallet)
	var wallet_pad := MarginContainer.new()
	wallet_pad.add_theme_constant_override("margin_left", 12)
	wallet_pad.add_theme_constant_override("margin_right", 12)
	wallet_pad.add_theme_constant_override("margin_top", 6)
	wallet_pad.add_theme_constant_override("margin_bottom", 6)
	wallet.add_child(wallet_pad)
	var wallet_box := VBoxContainer.new()
	wallet_box.add_theme_constant_override("separation", 0)
	wallet_pad.add_child(wallet_box)
	_label(wallet_box, "WALLET", 14, COLOR_MUTED)
	var wallet_row := HBoxContainer.new()
	wallet_row.add_theme_constant_override("separation", 8)
	wallet_box.add_child(wallet_row)
	var coin := TextureRect.new()
	coin.texture = load("res://assets/ui/pixel_currency_red.png")
	coin.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	coin.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	coin.custom_minimum_size = Vector2(26, 26)
	coin.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	coin.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	wallet_row.add_child(coin)
	_pixels_label = _label(wallet_row, "—", 30, COLOR_GOLD)
	_label(wallet_box, "PIXELS", 14, COLOR_MUTED)

	var keeper := TextureRect.new()
	var atlas := AtlasTexture.new()
	atlas.atlas = load("res://assets/npcs/cheetah_char.png")
	atlas.region = Rect2(0, 288, 32, 32)
	keeper.texture = atlas
	keeper.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	keeper.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	keeper.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	keeper.set_anchors_preset(Control.PRESET_TOP_LEFT)
	keeper.anchor_left = 0.17
	keeper.anchor_top = 0.56
	keeper.offset_top = -150.0
	keeper.size = Vector2(150, 150)
	_root.add_child(keeper)

	var bubble := PanelContainer.new()
	bubble.add_theme_stylebox_override("panel", _flat(Color(0.94, 0.90, 0.80), Color(0.1, 0.06, 0.03), 3))
	bubble.set_anchors_preset(Control.PRESET_TOP_LEFT)
	bubble.anchor_left = 0.24
	bubble.anchor_top = 0.56
	bubble.offset_top = -210.0
	_root.add_child(bubble)
	var bubble_pad := MarginContainer.new()
	bubble_pad.add_theme_constant_override("margin_left", 12)
	bubble_pad.add_theme_constant_override("margin_right", 12)
	bubble_pad.add_theme_constant_override("margin_top", 7)
	bubble_pad.add_theme_constant_override("margin_bottom", 7)
	bubble.add_child(bubble_pad)
	_bubble_label = _label(bubble_pad, "HEY!", 17, Color(0.15, 0.10, 0.06))

	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _flat(COLOR_PANEL, COLOR_PANEL_EDGE, 4))
	panel.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.offset_left = -560.0
	panel.offset_right = -18.0
	panel.offset_top = 14.0
	_root.add_child(panel)
	var panel_pad := MarginContainer.new()
	panel_pad.add_theme_constant_override("margin_left", 18)
	panel_pad.add_theme_constant_override("margin_right", 18)
	panel_pad.add_theme_constant_override("margin_top", 14)
	panel_pad.add_theme_constant_override("margin_bottom", 16)
	panel.add_child(panel_pad)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 6)
	panel_pad.add_child(list)
	_label(list, "STICKERS & GOODS", 22, COLOR_GOLD)
	_label(list, "— — — — —", 14, Color(0.45, 0.36, 0.24))
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 4)
	list.add_child(spacer)

	_rows.clear()
	for i in ITEMS.size():
		var item: Dictionary = ITEMS[i]
		var row := PanelContainer.new()
		list.add_child(row)
		var row_pad := MarginContainer.new()
		row_pad.add_theme_constant_override("margin_left", 12)
		row_pad.add_theme_constant_override("margin_right", 10)
		row_pad.add_theme_constant_override("margin_top", 6)
		row_pad.add_theme_constant_override("margin_bottom", 6)
		row.add_child(row_pad)
		var row_box := VBoxContainer.new()
		row_box.add_theme_constant_override("separation", 2)
		row_pad.add_child(row_box)
		var name_row := HBoxContainer.new()
		row_box.add_child(name_row)
		var name_label := _label(name_row, String(item["name"]), 20, Color(0.95, 0.90, 0.75))
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_label(name_row, "%d PX" % int(item["price"]), 20, COLOR_TEAL)
		var desc := _label(row_box, String(item["desc"]), 15, COLOR_MUTED)
		desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_rows.append({"panel": row, "name": name_label, "item": item})

	var bar := _rect(_root, Color(0.05, 0.035, 0.02))
	bar.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	bar.anchor_top = 1.0
	bar.offset_top = -52.0
	var bar_row := HBoxContainer.new()
	bar_row.add_theme_constant_override("separation", 40)
	bar_row.set_anchors_preset(Control.PRESET_FULL_RECT)
	bar_row.offset_left = 26.0
	bar.add_child(bar_row)
	for hint in ["↑↓ BROWSE", "Z BUY", "X LEAVE SHOP"]:
		var h := _label(bar_row, hint, 19, Color(0.92, 0.88, 0.78))
		h.size_flags_vertical = Control.SIZE_SHRINK_CENTER

	_update_rows()

func _update_rows() -> void:
	for i in _rows.size():
		var row: Dictionary = _rows[i]
		var panel: PanelContainer = row["panel"]
		var name_label: Label = row["name"]
		var item: Dictionary = row["item"]
		if i == _selected:
			var sb := _flat(Color(0.24, 0.16, 0.08))
			sb.border_color = COLOR_GOLD
			sb.border_width_left = 4
			panel.add_theme_stylebox_override("panel", sb)
			name_label.text = "> " + String(item["name"])
			name_label.add_theme_color_override("font_color", COLOR_GOLD)
		else:
			panel.add_theme_stylebox_override("panel", _flat(Color(0, 0, 0, 0)))
			name_label.text = String(item["name"])
			name_label.add_theme_color_override("font_color", Color(0.95, 0.90, 0.75))

func _fetch_wallet() -> void:
	if NetworkManager.session_token == "" or _pixels_label == null:
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/profile/wallet?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if code != 200 or _pixels_label == null:
			return
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			return
		_pixels_label.text = str(int(round(float(json.get("pixels", 0)))))
	)
	req.request(url, PackedStringArray(), HTTPClient.METHOD_GET)
