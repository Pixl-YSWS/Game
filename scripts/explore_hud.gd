extends CanvasLayer

const THEME := preload("res://themes/main_theme.tres")
const ACCENT_GOLD := Color(0.85098, 0.643137, 0.25098)
const COLOR_ACCENT := Color(1, 0.819608, 0.4)

var _root: Control
var _plate_label: Label
var _search_edit: LineEdit
var _tabs_row: HBoxContainer
var _tab_players: Button
var _tab_projects: Button
var _tab_board: Button
var _board_view: VBoxContainer
var _board_list: VBoxContainer
var _players_view: VBoxContainer
var _players_list: VBoxContainer
var _browse_view: VBoxContainer
var _browse_list: VBoxContainer
var _browse_search: LineEdit
var _player_view: VBoxContainer
var _player_info: Label
var _projects_list: VBoxContainer
var _project_view: VBoxContainer
var _project_meta: RichTextLabel
var _entries_list: VBoxContainer
var _open := false
var _current_player: Dictionary = {}
var _from_browse := false

func _readable_theme() -> Theme:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Sans-Serif", "Noto Sans", "DejaVu Sans", "Arial"])
	var t: Theme = THEME.duplicate(true)
	t.default_font = f
	t.default_font_size = Settings.fs(20)
	return t

func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_E:
		if ChatHud.is_typing() or Dialogue.is_open or (not _open and (global.ui_blocked() or global.player_in_range)):
			return
		if _open:
			close()
		else:
			open()
		get_viewport().set_input_as_handled()
		return
	if not _open:
		return
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		if _project_view.visible:
			_back_from_project()
		elif _player_view.visible:
			_show_players()
		else:
			close()

func is_open() -> bool:
	return _open

func open() -> void:
	if _open:
		return
	_open = true
	global.push_ui_blocker()
	_root.visible = true
	_show_players()
	_search_edit.text = ""
	_load_players("")

func close() -> void:
	if not _open:
		return
	_open = false
	global.pop_ui_blocker()
	_root.visible = false

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = _readable_theme()
	Settings.font_scale_changed.connect(func(): _root.theme = _readable_theme())
	add_child(_root)

	var backdrop := ColorRect.new()
	backdrop.color = Color(0.039216, 0.023529, 0.007843, 0.78)
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
	_plate_label = Label.new()
	_plate_label.theme_type_variation = &"TitlePlateText"
	_plate_label.text = "EXPLORE"
	plate.add_child(_plate_label)
	wrap.add_child(plate)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(720, 540)
	wrap.add_child(panel)

	var accents := Control.new()
	accents.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(accents)
	for i in 4:
		var dot := ColorRect.new()
		dot.color = ACCENT_GOLD
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var right := i % 2 == 1
		var bottom := i >= 2
		dot.anchor_left = 1.0 if right else 0.0
		dot.anchor_right = dot.anchor_left
		dot.anchor_top = 1.0 if bottom else 0.0
		dot.anchor_bottom = dot.anchor_top
		dot.offset_left = -17.0 if right else 9.0
		dot.offset_right = dot.offset_left + 8.0
		dot.offset_top = -17.0 if bottom else 9.0
		dot.offset_bottom = dot.offset_top + 8.0
		accents.add_child(dot)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 30)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_right", 30)
	margin.add_theme_constant_override("margin_bottom", 22)
	panel.add_child(margin)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	margin.add_child(body)

	_tabs_row = HBoxContainer.new()
	_tabs_row.add_theme_constant_override("separation", 8)
	body.add_child(_tabs_row)
	_tab_players = _tab_button("PLAYERS", _show_players)
	_tabs_row.add_child(_tab_players)
	_tab_projects = _tab_button("PROJECTS", _show_browse)
	_tabs_row.add_child(_tab_projects)
	_tab_board = _tab_button("LEADERBOARD", _show_board)
	_tabs_row.add_child(_tab_board)

	_players_view = _build_players_view()
	body.add_child(_players_view)
	_browse_view = _build_browse_view()
	body.add_child(_browse_view)
	_board_view = VBoxContainer.new()
	_board_view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_board_view.add_theme_constant_override("separation", 10)
	_board_view.visible = false
	_board_list = _make_list(_board_view)
	body.add_child(_board_view)
	_player_view = _build_player_view()
	body.add_child(_player_view)
	_project_view = _build_project_view()
	body.add_child(_project_view)

	var footer := HBoxContainer.new()
	body.add_child(footer)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(spacer)
	var close_btn := Button.new()
	close_btn.theme_type_variation = &"GreyButton"
	close_btn.text = "Close"
	close_btn.custom_minimum_size = Vector2(130, 0)
	close_btn.pressed.connect(close)
	footer.add_child(close_btn)

func _build_players_view() -> VBoxContainer:
	var view := VBoxContainer.new()
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.add_theme_constant_override("separation", 10)

	var search_row := HBoxContainer.new()
	search_row.add_theme_constant_override("separation", 8)
	view.add_child(search_row)
	_search_edit = LineEdit.new()
	_search_edit.placeholder_text = "Search players…"
	_search_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_search_edit.text_submitted.connect(func(_t): _load_players(_search_edit.text.strip_edges()))
	search_row.add_child(_search_edit)
	var search_btn := Button.new()
	search_btn.theme_type_variation = &"StepButton"
	search_btn.text = "Search"
	search_btn.pressed.connect(func(): _load_players(_search_edit.text.strip_edges()))
	search_row.add_child(search_btn)

	_players_list = _make_list(view)
	return view

func _tab_button(text: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(140, 0)
	b.pressed.connect(action)
	return b

func _build_browse_view() -> VBoxContainer:
	var view := VBoxContainer.new()
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.add_theme_constant_override("separation", 10)
	view.visible = false

	var search_row := HBoxContainer.new()
	search_row.add_theme_constant_override("separation", 8)
	view.add_child(search_row)
	_browse_search = LineEdit.new()
	_browse_search.placeholder_text = "Search projects…"
	_browse_search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_browse_search.text_submitted.connect(func(_t): _load_browse())
	search_row.add_child(_browse_search)
	var search_btn := Button.new()
	search_btn.theme_type_variation = &"StepButton"
	search_btn.text = "Search"
	search_btn.pressed.connect(_load_browse)
	search_row.add_child(search_btn)

	_browse_list = _make_list(view)
	return view

func _load_browse() -> void:
	_clear(_browse_list)
	_browse_list.add_child(_muted("Loading…"))
	var path := "/api/explore/projects"
	var params := PackedStringArray()
	var q := _browse_search.text.strip_edges()
	if q != "":
		params.append("q=" + q.uri_encode())
	if not params.is_empty():
		path += "?" + "&".join(params)
	_api(path, _on_browse)

func _on_browse(code: int, json: Variant) -> void:
	_clear(_browse_list)
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_browse_list.add_child(_muted("Couldn't load projects."))
		return
	var projects: Array = json.get("projects", [])
	if projects.is_empty():
		_browse_list.add_child(_muted("No projects found."))
		return
	for pr in projects:
		_browse_list.add_child(_project_row(pr, true))

func _build_player_view() -> VBoxContainer:
	var view := VBoxContainer.new()
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.add_theme_constant_override("separation", 10)
	view.visible = false

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	view.add_child(header)
	header.add_child(_back_button(_show_players))
	_player_info = Label.new()
	_player_info.theme_type_variation = &"InfoText"
	_player_info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(_player_info)

	_projects_list = _make_list(view)
	return view

func _build_project_view() -> VBoxContainer:
	var view := VBoxContainer.new()
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.add_theme_constant_override("separation", 10)
	view.visible = false

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	view.add_child(header)
	header.add_child(_back_button(_back_from_project))
	_project_meta = RichTextLabel.new()
	_project_meta.bbcode_enabled = true
	_project_meta.fit_content = true
	_project_meta.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_project_meta.meta_clicked.connect(func(meta): OS.shell_open(String(meta)))
	header.add_child(_project_meta)

	_entries_list = _make_list(view)
	return view

func _back_button(action: Callable) -> Button:
	var b := Button.new()
	b.theme_type_variation = &"StepButton"
	b.text = "< Back"
	b.pressed.connect(action)
	return b

func _make_list(view: VBoxContainer) -> VBoxContainer:
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	view.add_child(scroll)
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 8)
	scroll.add_child(list)
	return list

func _show_players() -> void:
	_plate_label.text = "EXPLORE"
	_tabs_row.visible = true
	_players_view.visible = true
	_browse_view.visible = false
	_board_view.visible = false
	_player_view.visible = false
	_project_view.visible = false
	_update_tabs("players")

func _show_browse() -> void:
	_plate_label.text = "PROJECTS"
	_tabs_row.visible = true
	_players_view.visible = false
	_browse_view.visible = true
	_board_view.visible = false
	_player_view.visible = false
	_project_view.visible = false
	_update_tabs("projects")
	if _browse_list.get_child_count() == 0:
		_load_browse()

func _show_board() -> void:
	_plate_label.text = "LEADERBOARD"
	_tabs_row.visible = true
	_players_view.visible = false
	_browse_view.visible = false
	_board_view.visible = true
	_player_view.visible = false
	_project_view.visible = false
	_update_tabs("board")
	_load_board()

func _load_board() -> void:
	_clear(_board_list)
	_board_list.add_child(_muted("Loading…"))
	_api("/api/explore/leaderboard", _on_board)

func _on_board(code: int, json: Variant) -> void:
	_clear(_board_list)
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_board_list.add_child(_muted("Couldn't load the leaderboard."))
		return
	var sprint: Variant = json.get("sprint")
	if typeof(sprint) == TYPE_DICTIONARY:
		var sprint_head := Label.new()
		sprint_head.text = "EVENT: %s" % String(sprint.get("name", "Sprint")).to_upper()
		sprint_head.add_theme_color_override("font_color", COLOR_ACCENT)
		_board_list.add_child(sprint_head)
		var sprint_players: Array = sprint.get("players", [])
		if sprint_players.is_empty():
			_board_list.add_child(_muted("Nobody has scored yet — ship during the event!"))
		else:
			for sp in sprint_players:
				_board_list.add_child(_board_row(sp))
		var yours := int(sprint.get("your_pixels", 0))
		var me_sprint := Label.new()
		me_sprint.theme_type_variation = &"InfoText"
		me_sprint.text = "You this event: %d px" % yours
		me_sprint.add_theme_color_override("font_color", COLOR_ACCENT)
		_board_list.add_child(me_sprint)
		var all_head := Label.new()
		all_head.theme_type_variation = &"InfoText"
		all_head.text = "ALL-TIME"
		_board_list.add_child(all_head)
	var players: Array = json.get("players", [])
	if players.is_empty():
		_board_list.add_child(_muted("Nobody has pixels yet — ship something!"))
		return
	for p in players:
		_board_list.add_child(_board_row(p))
	var your_rank := int(json.get("yourRank", 0))
	var your_pixels := int(json.get("yourPixels", 0))
	if your_rank > players.size():
		var me := Label.new()
		me.theme_type_variation = &"InfoText"
		me.text = "You: #%d · %d pixels" % [your_rank, your_pixels]
		me.add_theme_color_override("font_color", COLOR_ACCENT)
		_board_list.add_child(me)

func _board_row(p: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	panel.add_child(row)

	var rank := Label.new()
	rank.text = "#%d" % int(p.get("rank", 0))
	rank.custom_minimum_size = Vector2(52, 0)
	var r := int(p.get("rank", 0))
	if r == 1:
		rank.add_theme_color_override("font_color", Color(1, 0.819608, 0.4))
	elif r == 2:
		rank.add_theme_color_override("font_color", Color(0.78, 0.78, 0.8))
	elif r == 3:
		rank.add_theme_color_override("font_color", Color(0.8, 0.52, 0.25))
	row.add_child(rank)

	var name_label := Label.new()
	name_label.text = String(p.get("display_name", "?"))
	if bool(p.get("you", false)):
		name_label.text += "  (you)"
		name_label.add_theme_color_override("font_color", COLOR_ACCENT)
	name_label.clip_text = true
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_label)

	var px := Label.new()
	px.text = "%d px" % int(p.get("pixels", 0))
	px.add_theme_color_override("font_color", COLOR_ACCENT)
	row.add_child(px)
	return panel

func _update_tabs(active: String) -> void:
	_tab_players.theme_type_variation = &"" if active == "players" else &"GreyButton"
	_tab_projects.theme_type_variation = &"" if active == "projects" else &"GreyButton"
	_tab_board.theme_type_variation = &"" if active == "board" else &"GreyButton"

func _show_player(p: Dictionary) -> void:
	_current_player = p
	var pname := String(p.get("display_name", "?"))
	_plate_label.text = pname.to_upper().left(24)
	_tabs_row.visible = false
	_players_view.visible = false
	_browse_view.visible = false
	_board_view.visible = false
	_player_view.visible = true
	_project_view.visible = false
	_player_info.text = "joined %s" % String(p.get("created_at", "")).substr(0, 10)
	_clear(_projects_list)
	_projects_list.add_child(_muted("Loading…"))
	_api("/api/explore/players/" + String(p.get("id", "")), _on_player)

func _back_from_project() -> void:
	if _from_browse:
		_show_browse()
	else:
		_show_player(_current_player)

func _show_project(pr: Dictionary, from_browse := false) -> void:
	_from_browse = from_browse
	_plate_label.text = String(pr.get("name", "?")).to_upper().left(24)
	_tabs_row.visible = false
	_players_view.visible = false
	_browse_view.visible = false
	_board_view.visible = false
	_player_view.visible = false
	_project_view.visible = true
	_project_meta.text = ""
	_clear(_entries_list)
	_entries_list.add_child(_muted("Loading…"))
	_api("/api/explore/projects/%d" % int(pr.get("id", 0)), _on_project)

func _load_players(q: String) -> void:
	_clear(_players_list)
	_players_list.add_child(_muted("Loading…"))
	var path := "/api/explore/players"
	if q != "":
		path += "?q=" + q.uri_encode()
	_api(path, _on_players)

func _on_players(code: int, json: Variant) -> void:
	_clear(_players_list)
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_players_list.add_child(_muted("Couldn't load players."))
		return
	var players: Array = json.get("players", [])
	if players.is_empty():
		_players_list.add_child(_muted("No players found."))
		return
	for p in players:
		_players_list.add_child(_player_row(p))

func _player_row(p: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	panel.add_child(row)

	var main := VBoxContainer.new()
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.add_theme_constant_override("separation", 2)
	row.add_child(main)
	var name_label := Label.new()
	name_label.text = String(p.get("display_name", "?"))
	name_label.clip_text = true
	main.add_child(name_label)
	var meta := Label.new()
	meta.theme_type_variation = &"InfoText"
	var count := int(p.get("project_count", 0))
	meta.text = "joined %s · %d project%s" % [String(p.get("created_at", "")).substr(0, 10), count, "" if count == 1 else "s"]
	main.add_child(meta)

	var view_btn := Button.new()
	view_btn.theme_type_variation = &"StepButton"
	view_btn.text = "View"
	view_btn.pressed.connect(_show_player.bind(p))
	row.add_child(view_btn)
	return panel

func _on_player(code: int, json: Variant) -> void:
	_clear(_projects_list)
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_projects_list.add_child(_muted("Couldn't load this player."))
		return
	var projects: Array = json.get("projects", [])
	if projects.is_empty():
		_projects_list.add_child(_muted("No projects yet."))
		return
	for pr in projects:
		_projects_list.add_child(_project_row(pr))

func _project_row(pr: Dictionary, show_owner := false) -> Control:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	panel.add_child(row)

	var main := VBoxContainer.new()
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.add_theme_constant_override("separation", 2)
	row.add_child(main)
	var name_label := Label.new()
	name_label.text = String(pr.get("name", "?"))
	name_label.clip_text = true
	main.add_child(name_label)
	if show_owner:
		var owner := Label.new()
		owner.theme_type_variation = &"InfoText"
		var parts := PackedStringArray(["by %s" % String(pr.get("owner_name", "?"))])
		if String(pr.get("status", "")) == "approved":
			parts.append("approved ✔")
		owner.text = " · ".join(parts)
		owner.add_theme_color_override("font_color", COLOR_ACCENT)
		owner.clip_text = true
		main.add_child(owner)
	var desc := String(pr.get("description", "")).strip_edges()
	if desc != "":
		var meta := Label.new()
		meta.theme_type_variation = &"InfoText"
		meta.text = desc
		meta.clip_text = true
		main.add_child(meta)
	var links := PackedStringArray()
	var repo := String(pr.get("repo_url", ""))
	if repo != "":
		links.append("[url=%s]repo[/url]" % repo)
	var demo := String(pr.get("demo_url", ""))
	if demo != "":
		links.append("[url=%s]demo[/url]" % demo)
	if not links.is_empty():
		var link_label := RichTextLabel.new()
		link_label.bbcode_enabled = true
		link_label.fit_content = true
		link_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		link_label.text = " · ".join(links)
		link_label.meta_clicked.connect(func(meta): OS.shell_open(String(meta)))
		main.add_child(link_label)

	var open_btn := Button.new()
	open_btn.theme_type_variation = &"StepButton"
	open_btn.text = "Open"
	open_btn.pressed.connect(_show_project.bind(pr, show_owner))
	row.add_child(open_btn)
	return panel

func _on_project(code: int, json: Variant) -> void:
	_clear(_entries_list)
	if code != 200 or typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
		_entries_list.add_child(_muted("Couldn't load this project."))
		return
	var pr: Dictionary = json.get("project", {})
	var owner: Variant = json.get("owner", null)
	var parts := PackedStringArray()
	if typeof(owner) == TYPE_DICTIONARY:
		parts.append("by [b]%s[/b]" % String(owner.get("display_name", "?")).replace("[", "[lb]"))
	parts.append("created %s" % String(pr.get("created_at", "")).substr(0, 10))
	var repo := String(pr.get("repo_url", ""))
	if repo != "":
		parts.append("[url=%s]repo[/url]" % repo)
	var demo := String(pr.get("demo_url", ""))
	if demo != "":
		parts.append("[url=%s]demo[/url]" % demo)
	var ht: Array = pr.get("hackatime_projects", [])
	if not ht.is_empty():
		parts.append("hackatime: %s" % ", ".join(PackedStringArray(ht)).replace("[", "[lb]"))
	_project_meta.text = " · ".join(parts)

	var image_url := String(pr.get("image_url", "")).strip_edges()
	if image_url != "":
		var thumb := TextureRect.new()
		thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		thumb.custom_minimum_size = Vector2(0, 220)
		thumb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_entries_list.add_child(thumb)
		_load_image(image_url, thumb)

	var badges := PackedStringArray()
	var lvl := int(pr.get("level", 0))
	if lvl >= 1:
		badges.append("Level %d" % lvl)
	if bool(pr.get("used_ai", false)):
		badges.append("AI used")
	if bool(pr.get("other_ysws", false)):
		badges.append("Other YSWS disclosed")
	if String(pr.get("status", "")) == "approved":
		var ah: Variant = pr.get("approved_hours")
		badges.append("Approved ✔ · %d pixels" % int(round(float(ah) * 5.0)) if ah != null else "Approved ✔")
	if not badges.is_empty():
		var badge_label := Label.new()
		badge_label.theme_type_variation = &"InfoText"
		badge_label.text = " · ".join(badges)
		badge_label.add_theme_color_override("font_color", COLOR_ACCENT)
		badge_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_entries_list.add_child(badge_label)

	var desc := String(pr.get("description", "")).strip_edges()
	if desc != "":
		var desc_label := Label.new()
		desc_label.text = desc
		desc_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_entries_list.add_child(desc_label)

	var journal_head := Label.new()
	journal_head.theme_type_variation = &"InfoText"
	journal_head.text = "Journal"
	_entries_list.add_child(journal_head)
	var entries: Array = json.get("entries", [])
	if entries.is_empty():
		_entries_list.add_child(_muted("No journal entries yet."))
		return
	for e in entries:
		_entries_list.add_child(_entry_row(e))

func _load_image(url: String, target: TextureRect) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if code != 200 or data.is_empty():
			return
		var img := Image.new()
		var err := img.load_png_from_buffer(data)
		if err != OK:
			err = img.load_jpg_from_buffer(data)
		if err != OK:
			err = img.load_webp_from_buffer(data)
		if err != OK:
			return
		target.texture = ImageTexture.create_from_image(img)
	)
	req.request(url)

func _entry_row(e: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.theme_type_variation = &"RowPanel"
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	panel.add_child(box)

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	box.add_child(header)
	var date := Label.new()
	date.theme_type_variation = &"InfoText"
	date.text = String(e.get("created_at", "")).substr(0, 10)
	header.add_child(date)
	var hours := float(e.get("hours", 0))
	if hours > 0.0:
		var h := Label.new()
		h.text = "%sh" % MarkdownUtil.format_hours(hours)
		h.add_theme_color_override("font_color", COLOR_ACCENT)
		header.add_child(h)

	box.add_child(MarkdownUtil.build_body(String(e.get("content", ""))))
	return panel

func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = &"InfoText"
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l

func _clear(list: VBoxContainer) -> void:
	for c in list.get_children():
		c.queue_free()

func _api(path: String, cb: Callable) -> void:
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
	req.request(url)
