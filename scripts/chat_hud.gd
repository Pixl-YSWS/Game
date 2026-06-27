extends CanvasLayer

const MAX_LINES := 50

@onready var _scroll: ScrollContainer = %Scroll
@onready var _log: VBoxContainer = %Log
@onready var _input: LineEdit = %Input

func _ready() -> void:
	NetworkManager.chat_message.connect(_on_chat)
	_input.text_submitted.connect(_on_submit)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			if not _input.has_focus():
				_input.grab_focus()
				get_viewport().set_input_as_handled()
		elif event.keycode == KEY_ESCAPE and _input.has_focus():
			_input.release_focus()
			get_viewport().set_input_as_handled()

func is_typing() -> bool:
	return _input.has_focus()

func _on_submit(text: String) -> void:
	var t := text.strip_edges()
	_input.clear()
	_input.release_focus()
	if t == "":
		return
	NetworkManager.send_chat(t)

func _on_chat(_user_id: String, display_name: String, text: String) -> void:
	var line := Label.new()
	line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	line.text = "%s: %s" % [display_name, text]
	_log.add_child(line)
	while _log.get_child_count() > MAX_LINES:
		_log.get_child(0).free()
	await get_tree().process_frame
	_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)
