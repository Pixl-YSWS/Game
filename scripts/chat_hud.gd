extends CanvasLayer

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior", "shop_interior"]
const MAX_LINES := 9
const LINE_TTL := 11.0
const FADE_TIME := 0.6
const WRAP_WIDTH := 460.0

const COLOR_TEXT := Color(0.956863, 0.890196, 0.760784)
const COLOR_DIM := Color(0.788235, 0.694118, 0.54902)
const COLOR_ACCENT := Color(1, 0.819608, 0.4)
const COLOR_DM := Color(0.85, 0.72, 1)

@onready var _lines_box: VBoxContainer = %Lines
@onready var _hint: Label = %Hint
@onready var _input: LineEdit = %Input

var _lines: Array[Dictionary] = []
var _unread := 0
var _line_style: StyleBoxFlat
var _closing := false
var _censor_regex := RegEx.create_from_string("([jJ])[oO]([bB])")

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	NetworkManager.chat_message.connect(_on_chat)
	NetworkManager.dm_received.connect(_on_dm)
	NetworkManager.dm_error.connect(add_system)
	_input.text_submitted.connect(_on_submit)
	_input.focus_exited.connect(_on_focus_exited)

	_line_style = StyleBoxFlat.new()
	_line_style.bg_color = Color(0, 0, 0, 0.6)
	_line_style.set_border_width_all(1)
	_line_style.border_color = Color(1, 1, 1, 0.1)
	_line_style.content_margin_left = 5.0
	_line_style.content_margin_right = 5.0
	_line_style.content_margin_top = 1.0
	_line_style.content_margin_bottom = 2.0
	_line_style.anti_aliasing = false

	_hint.add_theme_color_override("font_outline_color", Color.BLACK)
	_hint.add_theme_constant_override("outline_size", 3)
	_update_hint()

func _process(_delta: float) -> void:
	visible = _in_gameplay() and not global.ui_blocked()
	if _input.has_focus():
		return
	var now := Time.get_ticks_msec() / 1000.0
	for line in _lines:
		if line["fading"] or now < line["expire"]:
			continue
		line["fading"] = true
		var tw := create_tween()
		tw.tween_property(line["panel"], "modulate:a", 0.0, FADE_TIME)
		line["tween"] = tw

func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			if not _input.has_focus():
				_open_input()
				get_viewport().set_input_as_handled()
		elif event.keycode == KEY_ESCAPE and _input.has_focus():
			_close_input()
			get_viewport().set_input_as_handled()

func is_typing() -> bool:
	return _input.has_focus()

func add_system(text: String) -> void:
	_add_line(text, COLOR_ACCENT, true)

func _open_input() -> void:
	_unread = 0
	_update_hint()
	_hint.visible = false
	_input.clear()
	_input.visible = true
	_input.grab_focus()
	for line in _lines:
		if line["tween"] != null:
			line["tween"].kill()
			line["tween"] = null
		line["fading"] = false
		line["expire"] = INF
		line["panel"].modulate.a = 1.0

func _close_input() -> void:
	if _closing:
		return
	_closing = true
	_input.visible = false
	_input.release_focus()
	_hint.visible = true
	var now := Time.get_ticks_msec() / 1000.0
	for line in _lines:
		line["fading"] = false
		line["expire"] = now + LINE_TTL
		line["panel"].modulate.a = 1.0
	_closing = false

func _on_focus_exited() -> void:
	if _input.visible:
		_close_input()

func _on_submit(text: String) -> void:
	var t := text.strip_edges()
	if t.begins_with("/w ") or t.begins_with("/msg "):
		var rest := t.substr(t.find(" ") + 1).strip_edges()
		var space := rest.find(" ")
		if space <= 0:
			add_system("Usage: /w <name> <message>")
		else:
			NetworkManager.send_dm(rest.substr(0, space), rest.substr(space + 1).strip_edges())
	elif t != "":
		NetworkManager.send_chat(t)
	_close_input()

func _censor(text: String) -> String:
	return _censor_regex.sub(text, "$1*$2", true)

func _on_chat(user_id: String, display_name: String, text: String) -> void:
	_add_line("%s: %s" % [display_name, _censor(text)], COLOR_TEXT, user_id == NetworkManager.user_id)

func _on_dm(from_name: String, to_name: String, text: String, outgoing: bool) -> void:
	var prefix := "to %s" % to_name if outgoing else "from %s" % from_name
	_add_line("[%s] %s" % [prefix, _censor(text)], COLOR_DM, outgoing)

func _add_line(display: String, color: Color, own: bool) -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _line_style)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE

	var label := Label.new()
	label.text = display
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 3)
	label.add_theme_font_size_override("font_size", 15)

	var font := _lines_box.get_theme_default_font()
	var text_w := font.get_string_size(display, HORIZONTAL_ALIGNMENT_LEFT, -1, 15).x
	if text_w > WRAP_WIDTH:
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		panel.size_flags_horizontal = Control.SIZE_FILL
	else:
		panel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN

	panel.add_child(label)
	_lines_box.add_child(panel)
	panel.scale = Vector2(0.7, 0.7)
	var pop := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	pop.tween_property(panel, "scale", Vector2.ONE, 0.22)

	var line := {"panel": panel, "expire": INF, "fading": false, "tween": null}
	if not _input.has_focus():
		line["expire"] = Time.get_ticks_msec() / 1000.0 + LINE_TTL
	_lines.append(line)

	while _lines.size() > MAX_LINES:
		var old: Dictionary = _lines.pop_front()
		if old["tween"] != null:
			old["tween"].kill()
		old["panel"].queue_free()

	if not own and not _input.has_focus():
		_unread += 1
		_update_hint()

func _update_hint() -> void:
	if _unread > 0:
		_hint.text = "Press Enter to chat  (%d new)" % _unread
		_hint.add_theme_color_override("font_color", Color(COLOR_ACCENT, 0.95))
	else:
		_hint.text = "Press Enter to chat"
		_hint.add_theme_color_override("font_color", Color(COLOR_DIM, 0.55))

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())
