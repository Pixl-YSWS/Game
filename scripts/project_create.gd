extends Control

signal submitted(data: Dictionary)
signal cancelled

const MAIN_THEME := preload("res://themes/main_theme.tres")
const LEVEL_LABELS := ["L1 Greenhorn", "L2 Deputy", "L3 Outlaw", "L4 Legend"]
const LEVEL_TIPS := [
	"A first ship: simple site, script, or tiny tool.",
	"A focused app, CLI, or game with clean polish.",
	"Multiple systems working together: backend, state, infra.",
	"Deep systems work: complex architecture, serious scope.",
]

@onready var _name: LineEdit = %Name
@onready var _desc: TextEdit = %Description
@onready var _repo: LineEdit = %Repo
@onready var _demo: LineEdit = %Demo
@onready var _error: Label = %ErrorLabel
@onready var _grid: GridContainer = %HtGrid
@onready var _title: Label = %Title
@onready var _create_button: Button = %CreateButton
@onready var _cancel_button: Button = %CancelButton
@onready var _level_row: HBoxContainer = %LevelRow
@onready var _thumb_button: Button = %ThumbButton
@onready var _thumb_paste: Button = %ThumbPaste
@onready var _thumb_status: Label = %ThumbStatus
@onready var _ai_check: CheckBox = %AiCheck

var _submitting := false
var _edit_id := 0
var _level := 1
var _thumb_url := ""
var _uploading := false
var _level_buttons: Array[Button] = []
var _readable_font: SystemFont

func _ht_font() -> SystemFont:
	if _readable_font == null:
		_readable_font = SystemFont.new()
		_readable_font.font_names = PackedStringArray(["Sans-Serif", "Noto Sans", "DejaVu Sans", "Arial"])
	return _readable_font

func _readable_theme() -> Theme:
	var t := MAIN_THEME.duplicate(true)
	t.default_font = _ht_font()
	t.default_font_size = 18
	return t

func _ready() -> void:
	theme = _readable_theme()
	visible = false
	_cancel_button.pressed.connect(func(): cancelled.emit())
	_create_button.pressed.connect(_submit)
	_thumb_button.pressed.connect(_choose_thumb)
	_thumb_paste.pressed.connect(_paste_thumb)
	_thumb_button.tooltip_text = "Opens the file picker. If it can't reach your files, copy an image and press Paste, or drag one onto the window."
	get_window().files_dropped.connect(_on_files_dropped)
	var group := ButtonGroup.new()
	for i in LEVEL_LABELS.size():
		var b := Button.new()
		b.toggle_mode = true
		b.button_group = group
		b.theme_type_variation = &"StepButton"
		b.text = LEVEL_LABELS[i]
		b.tooltip_text = LEVEL_TIPS[i]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.pressed.connect(func(): _level = i + 1)
		_level_buttons.append(b)
		_level_row.add_child(b)

func open(ht_projects: Array) -> void:
	_edit_id = 0
	_title.text = "NEW PROJECT"
	_fill({}, ht_projects)
	_show()

func open_edit(project: Dictionary, ht_projects: Array) -> void:
	_edit_id = int(project.get("id", 0))
	_title.text = "EDIT PROJECT"
	_fill(project, ht_projects)
	_show()

func on_submit_failed(message := "") -> void:
	_set_submitting(false)
	if message != "":
		_show_error(message)

func _show() -> void:
	_set_submitting(false)
	_error.visible = false
	visible = true
	_name.grab_focus()

func _show_error(message: String) -> void:
	_error.text = message
	_error.visible = true

func _fill(project: Dictionary, ht_projects: Array) -> void:
	_name.text = String(project.get("name", ""))
	_desc.text = String(project.get("description", ""))
	_repo.text = String(project.get("repo_url", ""))
	_demo.text = String(project.get("demo_url", ""))
	_level = clampi(int(project.get("level", 1)), 1, 4)
	_level_buttons[_level - 1].button_pressed = true
	_thumb_url = String(project.get("image_url", ""))
	_ai_check.button_pressed = bool(project.get("used_ai", false))
	_update_thumb_status()
	_populate(ht_projects, project.get("hackatime_projects", []))

func _update_thumb_status() -> void:
	if _uploading:
		_thumb_status.text = "Uploading…"
		_thumb_status.remove_theme_color_override("font_color")
	elif _thumb_url == "":
		_thumb_status.text = "No thumbnail yet (required to ship)"
		_thumb_status.remove_theme_color_override("font_color")
	else:
		_thumb_status.text = "Image added ✔"
		_thumb_status.add_theme_color_override("font_color", Color(0.45, 0.85, 0.5))

func _choose_thumb() -> void:
	if _uploading:
		return
	var filters := PackedStringArray(["*.png, *.jpg, *.jpeg, *.webp, *.gif ; Images"])
	var start_dir := OS.get_system_dir(OS.SYSTEM_DIR_PICTURES)
	if start_dir == "":
		start_dir = OS.get_environment("HOME")
	var native_cb := func(ok: bool, paths: PackedStringArray, _filter: int):
		if ok and not paths.is_empty():
			_upload_thumb_file(paths[0])
	if DisplayServer.has_method("file_dialog_show"):
		var err: int = DisplayServer.file_dialog_show(
			"Choose a thumbnail", start_dir, "", false,
			DisplayServer.FILE_DIALOG_MODE_OPEN_FILE, filters, native_cb)
		if err == OK:
			return
	var fd := FileDialog.new()
	fd.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	fd.access = FileDialog.ACCESS_FILESYSTEM
	fd.use_native_dialog = true
	fd.filters = filters
	if start_dir != "":
		fd.current_dir = start_dir
	add_child(fd)
	fd.file_selected.connect(func(path: String):
		fd.queue_free()
		_upload_thumb_file(path))
	fd.canceled.connect(func(): fd.queue_free())
	fd.popup_centered(Vector2i(700, 500))

func _on_files_dropped(files: PackedStringArray) -> void:
	if not visible or _uploading:
		return
	for f in files:
		if f.get_extension().to_lower() in ["png", "jpg", "jpeg", "webp", "gif"]:
			_upload_thumb_file(f)
			return
	_show_error("Drop a PNG, JPG, WEBP or GIF image.")

func _upload_thumb_file(path: String) -> void:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		_show_error("Couldn't read that file.")
		return
	var mime := "image/png"
	match path.get_extension().to_lower():
		"jpg", "jpeg":
			mime = "image/jpeg"
		"webp":
			mime = "image/webp"
		"gif":
			mime = "image/gif"
	_upload_thumb(bytes, mime)

func _paste_thumb() -> void:
	if _uploading:
		return
	if not DisplayServer.clipboard_has_image():
		_show_error("Copy an image first, then press Paste.")
		return
	var img := DisplayServer.clipboard_get_image()
	if img == null or img.is_empty():
		_show_error("Couldn't read an image from the clipboard.")
		return
	_upload_thumb(img.save_png_to_buffer(), "image/png")

func _upload_thumb(bytes: PackedByteArray, mime: String) -> void:
	_uploading = true
	_error.visible = false
	_update_thumb_status()
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/uploads?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		_uploading = false
		var json = JSON.parse_string(data.get_string_from_utf8()) if data.size() > 0 else null
		if code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false):
			_thumb_url = String(json.get("url", ""))
		else:
			_show_error("Image upload failed — try again.")
		_update_thumb_status()
	)
	req.request_raw(url, PackedStringArray(["Content-Type: " + mime]), HTTPClient.METHOD_POST, bytes)

func _populate(ht_projects: Array, linked: Array) -> void:
	for c in _grid.get_children():
		c.queue_free()
	if ht_projects.is_empty():
		_grid.columns = 1
		var l := Label.new()
		l.text = "Connect HackTime to link projects."
		l.theme_type_variation = &"InfoText"
		_grid.add_child(l)
		return
	_grid.columns = 3
	for p in ht_projects:
		var nm := String(p.get("name", ""))
		var b := Button.new()
		b.toggle_mode = true
		b.clip_text = true
		b.custom_minimum_size = Vector2(0, 44)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var secs := int(p.get("seconds", 0))
		b.text = "%s\n%.1fh" % [nm if nm != "" else "?", secs / 3600.0]
		b.add_theme_font_override("font", _ht_font())
		b.add_theme_font_size_override("font_size", 15)
		b.set_meta("ht_name", nm)
		b.button_pressed = linked.has(nm)
		_grid.add_child(b)

func _set_submitting(on: bool) -> void:
	_submitting = on
	_create_button.disabled = on
	_cancel_button.disabled = on
	if on:
		_create_button.text = "Saving…" if _edit_id != 0 else "Creating…"
	else:
		_create_button.text = "Save" if _edit_id != 0 else "Create"

func _is_github_repo(url: String) -> bool:
	var rest := ""
	var lower := url.to_lower()
	for prefix: String in ["https://github.com/", "http://github.com/", "https://www.github.com/", "http://www.github.com/"]:
		if lower.begins_with(prefix):
			rest = url.substr(prefix.length())
			break
	if rest == "":
		return false
	return rest.split("/", false).size() >= 2

func _submit() -> void:
	if _submitting:
		return
	var pname := _name.text.strip_edges()
	if pname == "":
		_name.grab_focus()
		return
	var repo := _repo.text.strip_edges()
	if repo.to_lower().begins_with("github.com/") or repo.to_lower().begins_with("www.github.com/"):
		repo = "https://" + repo
	if repo != "" and not _is_github_repo(repo):
		_show_error("Repo link must be a GitHub repository (github.com/owner/repo).")
		_repo.grab_focus()
		return
	_error.visible = false
	var selected: Array = []
	for cb in _grid.get_children():
		if cb is Button and cb.button_pressed:
			selected.append(cb.get_meta("ht_name"))
	var data := {
		"name": pname,
		"description": _desc.text.strip_edges(),
		"repoUrl": repo,
		"demoUrl": _demo.text.strip_edges(),
		"imageUrl": _thumb_url,
		"level": _level,
		"usedAi": _ai_check.button_pressed,
		"hackatimeProjects": selected,
	}
	if _edit_id != 0:
		data["id"] = _edit_id
	_set_submitting(true)
	submitted.emit(data)
