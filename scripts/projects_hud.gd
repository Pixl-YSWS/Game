extends CanvasLayer

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const PROJECT_CREATE := preload("res://scenes/project_create.tscn")
const PROJECT_JOURNAL := preload("res://scenes/project_journal.tscn")
const MAIN_THEME := preload("res://themes/main_theme.tres")

const STATUS_BADGES := {
	"draft": ["draft", Color(0.72, 0.67, 0.58)],
	"shipped": ["in review", Color(1, 0.819608, 0.4)],
	"second_review": ["in review", Color(1, 0.819608, 0.4)],
	"approved": ["approved", Color(0.45, 0.85, 0.5)],
	"needs_changes": ["needs changes", Color(1, 0.419608, 0.419608)],
}

@onready var _root: Control = %Root
@onready var _modal: Control = %Root.get_node("CenterContainer")
@onready var _status: Label = %Status
@onready var _connect_button: Button = %ConnectButton
@onready var _list: VBoxContainer = %List
var _open := false
var _ht_projects: Array = []
var _create_screen: Control
var _journal_screen: Control
var _confirm_root: Control
var _confirm_label: Label
var _confirm_button: Button
var _confirm_action := Callable()
var _ship_root: Control
var _ship_title: Label
var _ship_info: Label
var _ship_notes: TextEdit
var _ship_ysws: CheckBox
var _ship_error: Label
var _ship_button: Button
var _ship_project_id := 0
var _ship_is_update := false
var _shipping := false
var _ui_font: SystemFont
var _poll_timer: Timer
var _poll_count := 0
var _list_timer: Timer
var _last_sig := ""

func _rfont() -> SystemFont:
	if _ui_font == null:
		_ui_font = SystemFont.new()
		_ui_font.font_names = PackedStringArray(["Sans-Serif", "Noto Sans", "DejaVu Sans", "Arial"])
	return _ui_font

func _readable(c: Control, size: int) -> void:
	c.add_theme_font_override("font", _rfont())
	c.add_theme_font_size_override("font_size", Settings.fs(size))

func _readable_theme() -> Theme:
	var t := MAIN_THEME.duplicate(true)
	t.default_font = _rfont()
	t.default_font_size = Settings.fs(20)
	return t

func _ready() -> void:
	_root.theme = _readable_theme()
	Settings.font_scale_changed.connect(func():
		_root.theme = _readable_theme()
		_last_sig = "")
	_root.visible = false
	%RefreshButton.pressed.connect(refresh)
	_connect_button.pressed.connect(_on_connect)
	%CloseButton.pressed.connect(close)
	%CreateButton.pressed.connect(_open_create)
	_readable(_status, 22)
	_readable(%RefreshButton, 20)
	_readable(_connect_button, 20)
	_readable(%CloseButton, 20)
	_readable(%CreateButton, 20)
	_create_screen = PROJECT_CREATE.instantiate()
	_root.add_child(_create_screen)
	_create_screen.submitted.connect(_on_create_submitted)
	_create_screen.cancelled.connect(_hide_create)
	_journal_screen = PROJECT_JOURNAL.instantiate()
	_root.add_child(_journal_screen)
	_journal_screen.closed.connect(_hide_journal)
	_build_confirm_ui()
	_build_ship_ui()
	_list_timer = Timer.new()
	_list_timer.wait_time = 12.0
	_list_timer.timeout.connect(_poll_projects)
	add_child(_list_timer)

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if event.keycode == KEY_H:
		_toggle()
		get_viewport().set_input_as_handled()
	elif event.keycode == KEY_ESCAPE and _open:
		get_viewport().set_input_as_handled()
		if _confirm_root.visible:
			_confirm_root.visible = false
			_modal.visible = true
		elif _ship_root.visible:
			_ship_root.visible = false
			_modal.visible = true
		elif _create_screen.visible:
			_hide_create()
		elif _journal_screen.visible:
			_hide_journal()
		else:
			close()

func _toggle() -> void:
	if _open:
		close()
		return
	var current := get_tree().current_scene
	if current == null:
		return
	if GAMEPLAY_SCENES.has(current.scene_file_path.get_file().get_basename()):
		open()

func is_open() -> bool:
	return _open

func open() -> void:
	if _open:
		return
	_open = true
	global.push_ui_blocker()
	_root.visible = true
	refresh()
	if _list_timer != null:
		_list_timer.start()

func close() -> void:
	if not _open:
		return
	_open = false
	if _poll_timer != null:
		_poll_timer.stop()
	if _list_timer != null:
		_list_timer.stop()
	global.pop_ui_blocker()
	_create_screen.visible = false
	_journal_screen.visible = false
	_confirm_root.visible = false
	_ship_root.visible = false
	_modal.visible = true
	_root.visible = false

func _hide_create() -> void:
	_create_screen.visible = false
	_modal.visible = true

func _open_create() -> void:
	_modal.visible = false
	_create_screen.open(_ht_projects)

func _open_edit(project: Dictionary) -> void:
	_modal.visible = false
	_create_screen.open_edit(project, _ht_projects)

func _open_journal(project: Dictionary) -> void:
	_modal.visible = false
	_journal_screen.open(project)

func _hide_journal() -> void:
	_journal_screen.visible = false
	_modal.visible = true

func _on_create_submitted(data: Dictionary) -> void:
	var method := HTTPClient.METHOD_POST
	var path := "/api/projects"
	if data.has("id"):
		method = HTTPClient.METHOD_PUT
		path = "/api/projects/%d" % int(data["id"])
	_api(method, path, data, func(code, json):
		if code >= 200 and code < 300:
			_hide_create()
			_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)
		else:
			var msg := ""
			if typeof(json) == TYPE_DICTIONARY:
				match String(json.get("error", "")):
					"repo_not_github":
						msg = "Repo link must be a GitHub repository."
					"name_required":
						msg = "Project name is required."
			_create_screen.on_submit_failed(msg)
	)

# --- networking ------------------------------------------------------------

func _api(method: int, path: String, body: Variant, cb: Callable) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	var sep := "&" if path.contains("?") else "?"
	var url := NetworkManager.SERVER_HTTP_URL + path + sep + "token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		var json = null
		if data.size() > 0:
			json = JSON.parse_string(data.get_string_from_utf8())
		cb.call(code, json)
		req.queue_free()
	)
	var headers := PackedStringArray(["Content-Type: application/json"])
	var payload := JSON.stringify(body) if body != null else ""
	req.request(url, headers, method, payload)

func refresh() -> void:
	_api(HTTPClient.METHOD_GET, "/api/hackatime/stats", null, _on_stats)
	_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)

func _on_stats(code: int, json: Variant) -> void:
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_status.text = "HackTime: unknown"
		return
	var stats: Dictionary = json.get("stats", {})
	_ht_projects = stats.get("projects", [])
	if stats.get("connected", false):
		var hours := int(stats.get("totalSeconds", 0)) / 3600.0
		_status.text = "HackTime: connected (%.1fh)" % hours
		_connect_button.text = "Reconnect"
	else:
		_status.text = "HackTime: not connected"
		_connect_button.text = "Connect"

func _poll_projects() -> void:
	if not _open or not _modal.visible:
		return
	_refresh_projects()

func _on_projects(code: int, json: Variant) -> void:
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_last_sig = "__error__"
		for child in _list.get_children():
			child.queue_free()
		_list.add_child(_muted("Couldn't load projects."))
		return
	var projects: Array = json.get("projects", [])
	var sig := JSON.stringify(projects)
	if sig == _last_sig:
		return
	_last_sig = sig
	for child in _list.get_children():
		child.queue_free()
	if projects.is_empty():
		_list.add_child(_muted("No projects yet — create one below."))
		return
	for p in projects:
		_list.add_child(_project_row(p))

func _project_row(p: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 4)
	panel.add_child(outer)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	outer.add_child(row)

	var main := VBoxContainer.new()
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	main.add_theme_constant_override("separation", 2)
	row.add_child(main)

	var name_row := HBoxContainer.new()
	name_row.add_theme_constant_override("separation", 8)
	main.add_child(name_row)
	var name_label := Label.new()
	name_label.text = String(p.get("name", "?"))
	name_label.clip_text = true
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_readable(name_label, 22)
	name_row.add_child(name_label)

	var status := String(p.get("status", "draft"))
	var rejected := p.get("rejected_at") != null
	var banned := p.get("banned_at") != null
	var badge := Label.new()
	badge.theme_type_variation = &"InfoText"
	_readable(badge, 18)
	if banned:
		badge.text = "[BANNED]"
		badge.add_theme_color_override("font_color", Color(0.92, 0.26, 0.32))
	elif rejected:
		badge.text = "[changes requested]"
		badge.add_theme_color_override("font_color", Color(1, 0.419608, 0.419608))
	else:
		var badge_info: Array = STATUS_BADGES.get(status, STATUS_BADGES["draft"])
		badge.text = "[%s]" % badge_info[0]
		badge.add_theme_color_override("font_color", badge_info[1])
	name_row.add_child(badge)

	var desc := String(p.get("description", "")).strip_edges()
	if desc != "":
		var meta := Label.new()
		meta.theme_type_variation = &"InfoText"
		meta.text = desc
		meta.clip_text = true
		_readable(meta, 18)
		main.add_child(meta)

	if banned:
		var ban_reason := String(p.get("ban_reason", "")).strip_edges()
		var ban_by := String(p.get("ban_by", "")).strip_edges()
		var ban_head := "Banned by " + ban_by if ban_by != "" else "Banned"
		var ban_label := Label.new()
		ban_label.theme_type_variation = &"InfoText"
		ban_label.text = (ban_head + ": " + ban_reason if ban_reason != "" else ban_head) + "\nThis project is permanently banned and can't be shipped. Contact the Pixl team if you think this is a mistake."
		ban_label.add_theme_color_override("font_color", Color(0.92, 0.26, 0.32))
		ban_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_readable(ban_label, 18)
		outer.add_child(ban_label)

	var note := String(p.get("review_note", "")).strip_edges()
	if status == "needs_changes" and note != "" and not rejected and not banned:
		var note_label := Label.new()
		note_label.theme_type_variation = &"InfoText"
		note_label.text = "Reviewer: " + note
		note_label.add_theme_color_override("font_color", Color(1, 0.419608, 0.419608))
		note_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_readable(note_label, 18)
		outer.add_child(note_label)

	if status == "approved" and not rejected and not banned:
		var approved_label := Label.new()
		approved_label.theme_type_variation = &"InfoText"
		var credited: Variant = p.get("approved_hours")
		var txt := "Approved ✔"
		if credited != null:
			txt += " · %.1fh approved · %d pixels" % [float(credited), int(round(float(credited) * 5.0))]
		if note != "":
			txt += "\nReviewer: " + note
		approved_label.text = txt
		approved_label.add_theme_color_override("font_color", Color(0.45, 0.85, 0.5))
		approved_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_readable(approved_label, 18)
		outer.add_child(approved_label)

	if rejected and not banned:
		var reason := String(p.get("reject_reason", "")).strip_edges()
		var by := String(p.get("reject_by", "")).strip_edges()
		var head := "Changes requested by " + by if by != "" else "Changes requested"
		var reject_label := Label.new()
		reject_label.theme_type_variation = &"InfoText"
		reject_label.text = (head + ": " + reason if reason != "" else head) + "\nFix it and ship again — contact the Pixl team if you think this is a mistake."
		reject_label.add_theme_color_override("font_color", Color(1, 0.419608, 0.419608))
		reject_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_readable(reject_label, 18)
		outer.add_child(reject_label)

	if not banned and (rejected or status == "draft" or status == "needs_changes" or status == "approved"):
		var ship := Button.new()
		ship.theme_type_variation = &"StepButton"
		ship.text = "Ship again" if rejected else ("Ship update" if status == "approved" else "Ship")
		_readable(ship, 20)
		var missing := PackedStringArray()
		if String(p.get("repo_url", "")).strip_edges() == "":
			missing.append("a GitHub repo link")
		if String(p.get("demo_url", "")).strip_edges() == "":
			missing.append("a demo link")
		if String(p.get("image_url", "")).strip_edges() == "":
			missing.append("a thumbnail")
		if not missing.is_empty():
			ship.disabled = true
			ship.tooltip_text = "Add %s first." % " and ".join(missing)
		else:
			ship.pressed.connect(_ask_ship.bind(p))
		row.add_child(ship)

	var journal := Button.new()
	journal.theme_type_variation = &"StepButton"
	journal.text = "Journal"
	_readable(journal, 20)
	journal.pressed.connect(_open_journal.bind(p))
	row.add_child(journal)

	var edit := Button.new()
	edit.theme_type_variation = &"StepButton"
	edit.text = "Edit"
	_readable(edit, 20)
	edit.pressed.connect(_open_edit.bind(p))
	row.add_child(edit)

	var del := Button.new()
	del.theme_type_variation = &"StepButton"
	del.text = "X"
	_readable(del, 20)
	del.pressed.connect(_ask_delete.bind(p))
	row.add_child(del)
	return panel

func _build_confirm_ui() -> void:
	_confirm_root = Control.new()
	_confirm_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_confirm_root.visible = false
	_root.add_child(_confirm_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.031373, 0.019608, 0.8)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_confirm_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_confirm_root.add_child(center)

	var card := PanelContainer.new()
	center.add_child(card)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 22)
	margin.add_theme_constant_override("margin_right", 22)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 18)
	card.add_child(margin)

	var panel := VBoxContainer.new()
	panel.custom_minimum_size = Vector2(360, 0)
	panel.add_theme_constant_override("separation", 16)
	margin.add_child(panel)

	_confirm_label = Label.new()
	_confirm_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_confirm_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_readable(_confirm_label, 20)
	panel.add_child(_confirm_label)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 10)
	panel.add_child(buttons)
	var cancel := Button.new()
	cancel.theme_type_variation = &"GreyButton"
	cancel.text = "Cancel"
	cancel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_readable(cancel, 20)
	cancel.pressed.connect(func():
		_confirm_root.visible = false
		_modal.visible = true)
	buttons.add_child(cancel)
	_confirm_button = Button.new()
	_confirm_button.text = "Delete"
	_confirm_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_readable(_confirm_button, 20)
	_confirm_button.pressed.connect(func():
		_confirm_root.visible = false
		_modal.visible = true
		if _confirm_action.is_valid():
			_confirm_action.call())
	buttons.add_child(_confirm_button)

func _ask_confirm(text: String, button_text: String, action: Callable) -> void:
	_confirm_label.text = text
	_confirm_button.text = button_text
	_confirm_action = action
	_modal.visible = false
	_confirm_root.visible = true

func _refresh_projects() -> void:
	_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects)

func _ask_delete(p: Dictionary) -> void:
	var id := int(p.get("id", 0))
	_ask_confirm(
		"Delete \"%s\"?" % String(p.get("name", "this project")),
		"Delete",
		func(): _api(HTTPClient.METHOD_DELETE, "/api/projects/%d" % id, null, func(_code, _json): _refresh_projects()),
	)

func _build_ship_ui() -> void:
	_ship_root = Control.new()
	_ship_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_ship_root.visible = false
	_root.add_child(_ship_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.031373, 0.019608, 0.8)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_ship_root.add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_ship_root.add_child(center)

	var card := PanelContainer.new()
	center.add_child(card)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 22)
	margin.add_theme_constant_override("margin_right", 22)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 18)
	card.add_child(margin)

	var panel := VBoxContainer.new()
	panel.custom_minimum_size = Vector2(460, 0)
	panel.add_theme_constant_override("separation", 12)
	margin.add_child(panel)

	_ship_title = Label.new()
	_ship_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_readable(_ship_title, 26)
	panel.add_child(_ship_title)

	_ship_info = Label.new()
	_ship_info.theme_type_variation = &"InfoText"
	_ship_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_readable(_ship_info, 20)
	panel.add_child(_ship_info)

	_ship_notes = TextEdit.new()
	_ship_notes.custom_minimum_size = Vector2(0, 90)
	_ship_notes.placeholder_text = "What changed since the last approval? Reviewers only look at what's new."
	_ship_notes.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_readable(_ship_notes, 20)
	panel.add_child(_ship_notes)

	_ship_ysws = CheckBox.new()
	_ship_ysws.text = "I also submitted this project to another YSWS"
	_readable(_ship_ysws, 20)
	panel.add_child(_ship_ysws)

	var warning := Label.new()
	warning.theme_type_variation = &"InfoText"
	warning.text = "No double dipping! If this project was already submitted to another YSWS, tick the box above. Undisclosed re-submissions are detected automatically, flagged to reviewers, and can get you banned."
	warning.add_theme_color_override("font_color", Color(1, 0.819608, 0.4))
	warning.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_readable(warning, 18)
	panel.add_child(warning)

	_ship_error = Label.new()
	_ship_error.visible = false
	_ship_error.add_theme_color_override("font_color", Color(1, 0.419608, 0.419608))
	_ship_error.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_readable(_ship_error, 18)
	panel.add_child(_ship_error)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 10)
	panel.add_child(buttons)
	var cancel := Button.new()
	cancel.theme_type_variation = &"GreyButton"
	cancel.text = "Cancel"
	cancel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_readable(cancel, 20)
	cancel.pressed.connect(func():
		_ship_root.visible = false
		_modal.visible = true)
	buttons.add_child(cancel)
	_ship_button = Button.new()
	_ship_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_readable(_ship_button, 20)
	_ship_button.pressed.connect(_submit_ship)
	buttons.add_child(_ship_button)

func _ask_ship(p: Dictionary) -> void:
	_ship_project_id = int(p.get("id", 0))
	var rejected := p.get("rejected_at") != null
	_ship_is_update = String(p.get("status", "")) == "approved" and not rejected
	var pname := String(p.get("name", "?"))
	if rejected:
		_ship_title.text = "SHIP AGAIN"
		_ship_info.text = "\"%s\" was rejected. Fix what the reviewer flagged, then ship it again for another review." % pname
	elif _ship_is_update:
		_ship_title.text = "SHIP AN UPDATE"
		_ship_info.text = "\"%s\" was already approved. Shipping again sends it back to the review queue as an update — tell reviewers what's new since then." % pname
	else:
		_ship_title.text = "SHIP FOR REVIEW"
		_ship_info.text = "Ship \"%s\" for review? Reviewers will look at your repo, demo and journal, and you'll get the verdict in your inbox." % pname
	_ship_notes.visible = _ship_is_update
	_ship_notes.text = ""
	_ship_ysws.button_pressed = false
	_ship_error.visible = false
	_shipping = false
	_ship_button.disabled = false
	_ship_button.text = "Ship update" if _ship_is_update else "Ship it"
	_modal.visible = false
	_ship_root.visible = true

func _submit_ship() -> void:
	if _shipping:
		return
	var notes := _ship_notes.text.strip_edges()
	if _ship_is_update and notes == "":
		_ship_error.text = "Tell reviewers what changed since the last approval."
		_ship_error.visible = true
		return
	_shipping = true
	_ship_button.disabled = true
	_ship_error.visible = false
	var body := {"updateNotes": notes, "otherYsws": _ship_ysws.button_pressed}
	_api(HTTPClient.METHOD_POST, "/api/projects/%d/ship" % _ship_project_id, body, func(code, json):
		_shipping = false
		_ship_button.disabled = false
		if code >= 200 and code < 300:
			_ship_root.visible = false
			_modal.visible = true
			_refresh_projects()
			return
		var msg := "Couldn't ship — try again."
		if typeof(json) == TYPE_DICTIONARY:
			match String(json.get("error", "")):
				"project_banned":
					msg = "This project was permanently banned and can't be shipped. Contact the Pixl team."
				"update_notes_required":
					msg = "Tell reviewers what changed since the last approval."
				"repo_required":
					msg = "Add a GitHub repo link first."
				"demo_required":
					msg = "Add a demo link first."
				"image_required":
					msg = "Add a thumbnail image first."
				"repo_not_found":
					msg = "Your GitHub repo link 404s — is the repo public?"
				"demo_unreachable":
					msg = "Your demo link doesn't respond — double-check it."
				"hackatime_hours_required":
					msg = "Link this project to Hackatime and log at least 1 hour of coding first."
				"hackatime_unavailable":
					msg = "Hackatime is unreachable right now — try again in a bit."
				"already_shipped":
					msg = "This project is already in the review queue."
		_ship_error.text = msg
		_ship_error.visible = true
	)

func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"InfoText"
	_readable(l, 20)
	return l

func _on_connect() -> void:
	var url := NetworkManager.SERVER_HTTP_URL + "/hackatime/connect?token=" + NetworkManager.session_token.uri_encode()
	if OS.has_feature("web"):
		JavaScriptBridge.eval('window.open("%s","_blank")' % url, true)
	else:
		OS.shell_open(url)
	_status.text = "HackTime: finishing in your browser…"
	_start_connect_poll()

func _start_connect_poll() -> void:
	_poll_count = 0
	if _poll_timer == null:
		_poll_timer = Timer.new()
		_poll_timer.wait_time = 3.0
		_poll_timer.timeout.connect(_poll_connection)
		add_child(_poll_timer)
	_poll_timer.start()

func _poll_connection() -> void:
	_poll_count += 1
	if _poll_count > 40:
		if _poll_timer != null:
			_poll_timer.stop()
		return
	_api(HTTPClient.METHOD_GET, "/api/hackatime/stats", null, func(code, json):
		if code == 200 and typeof(json) == TYPE_DICTIONARY and json.get("ok", false):
			var stats: Dictionary = json.get("stats", {})
			if stats.get("connected", false):
				if _poll_timer != null:
					_poll_timer.stop()
				_on_stats(code, json)
				_api(HTTPClient.METHOD_GET, "/api/projects", null, _on_projects))
