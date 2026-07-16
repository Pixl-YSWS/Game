extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const COLOR_ONLINE := Color(0.290196, 0.870588, 0.501961)
const COLOR_ACCENT := Color(1, 0.819608, 0.4)

var _root: Control
var _name_label: Label
var _online_label: Label
var _clock_dot: ColorRect
var _clock_label: Label
var _inbox_dot: ColorRect
var _inbox_label: Label
var _pixels_label: Label
var _hours_label: Label
var _players := {}
var _list_root: Control
var _list_box: VBoxContainer

func _ready() -> void:
	layer = 95
	_build_ui()
	_build_list_ui()
	NetworkManager.logged_in.connect(_on_logged_in)
	NetworkManager.scene_init.connect(_on_scene_init)
	NetworkManager.player_joined.connect(_on_player_joined)
	NetworkManager.player_left.connect(_on_player_left)
	var wallet_timer := Timer.new()
	wallet_timer.wait_time = 45.0
	wallet_timer.autostart = true
	wallet_timer.timeout.connect(_fetch_wallet)
	add_child(wallet_timer)
	_fetch_wallet()

func _process(_delta: float) -> void:
	var in_game := _in_gameplay() and not global.ui_blocked()
	_root.visible = in_game
	if not in_game:
		_list_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if event.keycode == KEY_TAB:
		if _in_gameplay() and not global.ui_blocked() and not ChatHud.is_typing() and not Dialogue.is_open:
			_toggle_list()
			get_viewport().set_input_as_handled()
	elif event.keycode == KEY_ESCAPE and _list_root.visible:
		_list_root.visible = false
		get_viewport().set_input_as_handled()

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.theme = THEME
	_root.visible = false
	add_child(_root)

	var column := VBoxContainer.new()
	column.position = Vector2(12, 12)
	column.add_theme_constant_override("separation", 6)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(column)

	var wallet_card := PanelContainer.new()
	wallet_card.theme_type_variation = &"HudPanel"
	wallet_card.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	wallet_card.custom_minimum_size = Vector2(200, 0)
	wallet_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(wallet_card)

	var wallet_margin := MarginContainer.new()
	wallet_margin.add_theme_constant_override("margin_left", 10)
	wallet_margin.add_theme_constant_override("margin_right", 10)
	wallet_margin.add_theme_constant_override("margin_top", 6)
	wallet_margin.add_theme_constant_override("margin_bottom", 6)
	wallet_card.add_child(wallet_margin)

	var wallet_box := VBoxContainer.new()
	wallet_box.add_theme_constant_override("separation", 1)
	wallet_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wallet_margin.add_child(wallet_box)

	var pixels_row := HBoxContainer.new()
	pixels_row.add_theme_constant_override("separation", 8)
	pixels_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wallet_box.add_child(pixels_row)

	var coin := ColorRect.new()
	coin.color = COLOR_ACCENT
	coin.custom_minimum_size = Vector2(14, 14)
	coin.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	coin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pixels_row.add_child(coin)

	_pixels_label = Label.new()
	_pixels_label.add_theme_font_size_override("font_size", 26)
	_pixels_label.add_theme_color_override("font_color", COLOR_ACCENT)
	_pixels_label.text = "— pixels"
	pixels_row.add_child(_pixels_label)

	_hours_label = Label.new()
	_hours_label.theme_type_variation = &"SubText"
	_hours_label.add_theme_font_size_override("font_size", 16)
	_hours_label.text = "0h approved"
	wallet_box.add_child(_hours_label)

	var card := PanelContainer.new()
	card.theme_type_variation = &"HudPanel"
	card.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	card.custom_minimum_size = Vector2(200, 0)
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(card)

	var card_margin := MarginContainer.new()
	card_margin.add_theme_constant_override("margin_left", 6)
	card_margin.add_theme_constant_override("margin_right", 6)
	card_margin.add_theme_constant_override("margin_top", 2)
	card_margin.add_theme_constant_override("margin_bottom", 3)
	card.add_child(card_margin)

	_name_label = Label.new()
	_name_label.theme_type_variation = &"SubText"
	_name_label.add_theme_font_size_override("font_size", 15)
	_name_label.text = NetworkManager.display_name if NetworkManager.display_name != "" else "Player"
	_name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	card_margin.add_child(_name_label)

	var chip := PanelContainer.new()
	chip.theme_type_variation = &"HudPanel"
	chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(chip)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	chip.add_child(row)

	var dot := ColorRect.new()
	dot.color = COLOR_ONLINE
	dot.custom_minimum_size = Vector2(8, 8)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(dot)

	_online_label = Label.new()
	_online_label.add_theme_font_size_override("font_size", 15)
	_online_label.text = "1 online  [Tab]"
	row.add_child(_online_label)

	var friends_chip := PanelContainer.new()
	friends_chip.theme_type_variation = &"HudPanel"
	friends_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	friends_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	friends_chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(friends_chip)

	var friends_row := HBoxContainer.new()
	friends_row.add_theme_constant_override("separation", 7)
	friends_chip.add_child(friends_row)

	var friends_dot := ColorRect.new()
	friends_dot.color = COLOR_ACCENT
	friends_dot.custom_minimum_size = Vector2(8, 8)
	friends_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	friends_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	friends_row.add_child(friends_dot)

	var friends_label := Label.new()
	friends_label.add_theme_font_size_override("font_size", 15)
	friends_label.text = "Friends  [F]"
	friends_row.add_child(friends_label)

	var inbox_chip := PanelContainer.new()
	inbox_chip.theme_type_variation = &"HudPanel"
	inbox_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	inbox_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	inbox_chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(inbox_chip)

	var inbox_row := HBoxContainer.new()
	inbox_row.add_theme_constant_override("separation", 7)
	inbox_chip.add_child(inbox_row)

	_inbox_dot = ColorRect.new()
	_inbox_dot.custom_minimum_size = Vector2(8, 8)
	_inbox_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_inbox_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inbox_row.add_child(_inbox_dot)

	_inbox_label = Label.new()
	_inbox_label.add_theme_font_size_override("font_size", 15)
	inbox_row.add_child(_inbox_label)

	_update_inbox(InboxHud.unread_count)
	InboxHud.unread_changed.connect(_update_inbox)

	var clock_chip := PanelContainer.new()
	clock_chip.theme_type_variation = &"HudPanel"
	clock_chip.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	clock_chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	clock_chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(clock_chip)

	var clock_row := HBoxContainer.new()
	clock_row.add_theme_constant_override("separation", 7)
	clock_chip.add_child(clock_row)

	_clock_dot = ColorRect.new()
	_clock_dot.custom_minimum_size = Vector2(8, 8)
	_clock_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_clock_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	clock_row.add_child(_clock_dot)

	_clock_label = Label.new()
	_clock_label.add_theme_font_size_override("font_size", 15)
	clock_row.add_child(_clock_label)

	_update_clock()
	var clock_timer := Timer.new()
	clock_timer.wait_time = 5.0
	clock_timer.autostart = true
	clock_timer.timeout.connect(_update_clock)
	add_child(clock_timer)

func _update_inbox(unread: int) -> void:
	if unread > 0:
		_inbox_dot.color = COLOR_ACCENT
		_inbox_label.text = "Inbox  [N]  •  %d new" % unread
		_inbox_label.add_theme_color_override("font_color", COLOR_ACCENT)
	else:
		_inbox_dot.color = Color(0.62, 0.58, 0.5)
		_inbox_label.text = "Inbox  [N]"
		_inbox_label.remove_theme_color_override("font_color")

func _update_clock() -> void:
	var phase := global.day_phase()
	var td := Time.get_time_dict_from_system()
	_clock_dot.color = phase["color"]
	_clock_label.text = "%s %02d:%02d  •  %s" % [phase["name"], td.hour, td.minute, phase["next"]]

func _fetch_wallet() -> void:
	if NetworkManager.session_token == "":
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/profile/wallet?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if code != 200:
			return
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			return
		_set_wallet(float(json.get("pixels", 0)), float(json.get("approvedHours", 0)))
	)
	req.request(url, PackedStringArray(), HTTPClient.METHOD_GET)

func _set_wallet(pixels: float, hours: float) -> void:
	if _pixels_label == null:
		return
	_pixels_label.text = "%s pixels" % _fmt_amount(pixels)
	_hours_label.text = "%sh approved" % _fmt_amount(hours)

func _fmt_amount(v: float) -> String:
	if absf(v - roundf(v)) < 0.05:
		return str(int(round(v)))
	return "%.1f" % v

func _build_list_ui() -> void:
	_list_root = Control.new()
	_list_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_list_root.theme = THEME
	_list_root.visible = false
	add_child(_list_root)

	var dim := ColorRect.new()
	dim.color = Color(0.039216, 0.023529, 0.007843, 0.66)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_list_root.add_child(dim)

	var close_catch := Button.new()
	close_catch.flat = true
	close_catch.set_anchors_preset(Control.PRESET_FULL_RECT)
	close_catch.pressed.connect(func(): _list_root.visible = false)
	_list_root.add_child(close_catch)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_list_root.add_child(center)

	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", -22)
	center.add_child(wrap)

	var plate := PanelContainer.new()
	plate.theme_type_variation = &"TitlePlate"
	plate.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	plate.z_index = 1
	var plate_label := Label.new()
	plate_label.theme_type_variation = &"TitlePlateText"
	plate_label.text = "PLAYERS ONLINE"
	plate.add_child(plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(320, 0)
	wrap.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 26)
	margin.add_theme_constant_override("margin_right", 26)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_bottom", 22)
	panel.add_child(margin)

	_list_box = VBoxContainer.new()
	_list_box.add_theme_constant_override("separation", 8)
	margin.add_child(_list_box)

func _toggle_list() -> void:
	_list_root.visible = not _list_root.visible
	if _list_root.visible:
		_refresh_list()

func _refresh_list() -> void:
	for child in _list_box.get_children():
		child.queue_free()
	var entries: Array = []
	for uid in _players:
		entries.append([String(_players[uid]), false])
	entries.sort_custom(func(a, b): return String(a[0]).naturalnocasecmp_to(String(b[0])) < 0)
	var me := NetworkManager.display_name if NetworkManager.display_name != "" else "Player"
	entries.push_front([me, true])
	for entry in entries:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var dot := ColorRect.new()
		dot.color = COLOR_ONLINE
		dot.custom_minimum_size = Vector2(8, 8)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(dot)
		var label := Label.new()
		label.text = "%s  (you)" % entry[0] if entry[1] else String(entry[0])
		if entry[1]:
			label.add_theme_color_override("font_color", COLOR_ACCENT)
		label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(label)
		_list_box.add_child(row)

func _on_logged_in(display_name: String) -> void:
	_name_label.text = display_name if display_name != "" else "Player"
	_fetch_wallet()

func _on_scene_init(your_id: String, _pos: Vector2, others: Array, _spawn_at_default: bool) -> void:
	_players.clear()
	for p in others:
		var uid := String(p["userId"])
		if uid != your_id:
			_players[uid] = String(p.get("displayName", "Player"))
	_update_online()
	_fetch_wallet()

func _on_player_joined(user_id: String, name: String, _pos: Vector2, _dir: String, _skin: String) -> void:
	_players[user_id] = name
	_update_online()

func _on_player_left(user_id: String) -> void:
	_players.erase(user_id)
	_update_online()

func _update_online() -> void:
	_online_label.text = "%d online  [Tab]" % (1 + _players.size())
	if _list_root != null and _list_root.visible:
		_refresh_list()

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())
