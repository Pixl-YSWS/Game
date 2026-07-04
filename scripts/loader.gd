extends CanvasLayer
## Fullscreen loading overlay. Autoloaded so it survives `change_scene_to_file`,
## covering the gap between leaving the menu and the new scene spawning the
## player (which waits on a `scene_init` round-trip from the server).

const MONOCRAFT := preload("res://assets/fonts/Monocraft.ttf")
## Safety net: hide even if the new scene never reports ready (e.g. the server
## never sends scene_init), so the player is never stuck on the loading screen.
const TIMEOUT_SEC := 8.0

var _label: Label
var _base := "Loading"
var _dots := 0
var _accum := 0.0
var _timeout := 0.0
var _active := false
var _pending_path := ""

func _ready() -> void:
	layer = 128
	process_mode = Node.PROCESS_MODE_ALWAYS
	visible = false

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.078431, 0.062745, 0.039216, 1.0)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(backdrop)

	_label = Label.new()
	_label.add_theme_font_override("font", MONOCRAFT)
	_label.add_theme_font_size_override("font_size", 28)
	_label.add_theme_color_override("font_color", Color(1, 0.819608, 0.4, 1))
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_label.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_label)

## Show the overlay and switch scenes. The scene loads on a background thread
## so the overlay keeps animating instead of freezing on the swap.
func change_scene(path: String, message: String = "Loading") -> void:
	show_loading(message)
	_pending_path = path
	ResourceLoader.load_threaded_request(path)

func show_loading(message: String = "Loading") -> void:
	_base = message
	_dots = 0
	_accum = 0.0
	_timeout = 0.0
	_active = true
	_label.text = _base
	visible = true

func hide_loading() -> void:
	_active = false
	visible = false

func _process(delta: float) -> void:
	if _pending_path != "":
		var status := ResourceLoader.load_threaded_get_status(_pending_path)
		if status == ResourceLoader.THREAD_LOAD_LOADED:
			var packed: PackedScene = ResourceLoader.load_threaded_get(_pending_path)
			_pending_path = ""
			get_tree().change_scene_to_packed(packed)
		elif status != ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			var failed := _pending_path
			_pending_path = ""
			get_tree().change_scene_to_file(failed)
	if not _active:
		return
	_timeout += delta
	if _timeout >= TIMEOUT_SEC:
		hide_loading()
		return
	_accum += delta
	if _accum >= 0.4:
		_accum = 0.0
		_dots = (_dots + 1) % 4
		_label.text = _base + ".".repeat(_dots)
