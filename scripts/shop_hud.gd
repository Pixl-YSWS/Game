extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const COLOR_ACCENT := Color(1, 0.819608, 0.4)
const COLOR_MUTED := Color(0.62, 0.58, 0.5)

const ITEMS := [
	{"name": "PIXEL STICKER", "price": 25, "desc": "A red pixel-heart sticker. Priva wants one."},
	{"name": "HOLO STICKER", "price": 60, "desc": "Holographic, shimmery. Looks great on a laptop."},
	{"name": "NAME GLOW", "price": 120, "desc": "Your name shines gold above your head."},
	{"name": "CUSTOM EMOTE", "price": 200, "desc": "Add your own emote to the wheel."},
	{"name": "HOUSE PAINT", "price": 260, "desc": "Fresh colors for your house interior."},
	{"name": "MYSTERY CRATE", "price": 500, "desc": "Nobody knows what's inside. Not even us."},
]

var _root: Control
var _pixels_label: Label

func _ready() -> void:
	layer = 96

func is_open() -> bool:
	return _root != null and _root.visible

func open() -> void:
	if _root == null:
		_build_ui()
	_root.visible = true
	_fetch_wallet()

func close() -> void:
	if _root != null:
		_root.visible = false

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if event.keycode == KEY_ESCAPE and is_open():
		close()
		get_viewport().set_input_as_handled()
	elif event.keycode == KEY_B:
		if is_open():
			close()
			get_viewport().set_input_as_handled()
		elif _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
			open()
			get_viewport().set_input_as_handled()

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = THEME
	_root.visible = false
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0.039216, 0.023529, 0.007843, 0.66)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(dim)

	var close_catch := Button.new()
	close_catch.flat = true
	close_catch.set_anchors_preset(Control.PRESET_FULL_RECT)
	close_catch.pressed.connect(close)
	_root.add_child(close_catch)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
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
	plate_label.text = "PIXL SHOP"
	plate.add_child(plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(560, 0)
	wrap.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 26)
	margin.add_theme_constant_override("margin_right", 26)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_bottom", 20)
	panel.add_child(margin)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	margin.add_child(body)

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	body.add_child(header)

	var subtitle := Label.new()
	subtitle.text = "STICKERS & GOODS"
	subtitle.add_theme_color_override("font_color", COLOR_ACCENT)
	subtitle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(subtitle)

	var wallet := HBoxContainer.new()
	wallet.add_theme_constant_override("separation", 6)
	header.add_child(wallet)

	var coin := TextureRect.new()
	coin.texture = load("res://assets/ui/pixel_currency_red.png")
	coin.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	coin.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	coin.custom_minimum_size = Vector2(22, 22)
	coin.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	coin.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	wallet.add_child(coin)

	_pixels_label = Label.new()
	_pixels_label.add_theme_color_override("font_color", COLOR_ACCENT)
	_pixels_label.text = "— pixels"
	wallet.add_child(_pixels_label)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 380)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(scroll)

	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 8)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)

	for item in ITEMS:
		list.add_child(_item_row(item))

	var footer := Label.new()
	footer.theme_type_variation = &"SubText"
	footer.text = "The shop opens soon — window shopping only for now!"
	footer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(footer)

func _item_row(item: Dictionary) -> Control:
	var card := PanelContainer.new()
	card.theme_type_variation = &"HudPanel"
	card.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 12)
	pad.add_theme_constant_override("margin_right", 12)
	pad.add_theme_constant_override("margin_top", 8)
	pad.add_theme_constant_override("margin_bottom", 8)
	card.add_child(pad)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	pad.add_child(row)

	var text_box := VBoxContainer.new()
	text_box.add_theme_constant_override("separation", 2)
	text_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(text_box)

	var name_row := HBoxContainer.new()
	name_row.add_theme_constant_override("separation", 8)
	text_box.add_child(name_row)

	var name_label := Label.new()
	name_label.text = String(item["name"])
	name_label.add_theme_color_override("font_color", COLOR_ACCENT)
	name_row.add_child(name_label)

	var price_label := Label.new()
	price_label.text = "%d px" % int(item["price"])
	price_label.add_theme_color_override("font_color", COLOR_MUTED)
	name_row.add_child(price_label)

	var desc := Label.new()
	desc.theme_type_variation = &"SubText"
	desc.text = String(item["desc"])
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text_box.add_child(desc)

	var buy := Button.new()
	buy.theme_type_variation = &"GreyButton"
	buy.text = "Soon"
	buy.disabled = true
	buy.tooltip_text = "Purchases aren't open yet."
	buy.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(buy)

	return card

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
		var pixels := float(json.get("pixels", 0))
		_pixels_label.text = "%d pixels" % int(round(pixels))
	)
	req.request(url, PackedStringArray(), HTTPClient.METHOD_GET)
