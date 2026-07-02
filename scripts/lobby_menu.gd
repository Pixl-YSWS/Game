extends Control

@onready var status_label: Label = $CenterContainer/VBoxContainer/StatusLabel
@onready var quick_join_button: Button = $CenterContainer/VBoxContainer/ActionsRow/QuickJoinButton
@onready var refresh_button: Button = $CenterContainer/VBoxContainer/ActionsRow/RefreshButton
@onready var name_edit: LineEdit = $CenterContainer/VBoxContainer/CreateRow/NameEdit
@onready var create_public_button: Button = $CenterContainer/VBoxContainer/CreateRow/CreatePublicButton
@onready var create_private_button: Button = $CenterContainer/VBoxContainer/CreateRow/CreatePrivateButton
@onready var code_edit: LineEdit = $CenterContainer/VBoxContainer/CodeRow/CodeEdit
@onready var password_edit: LineEdit = $CenterContainer/VBoxContainer/CodeRow/PasswordEdit
@onready var join_code_button: Button = $CenterContainer/VBoxContainer/CodeRow/JoinCodeButton
@onready var list_box: VBoxContainer = $CenterContainer/VBoxContainer/ListScroll/ListBox
@onready var back_button: Button = $CenterContainer/VBoxContainer/BackButton

var _joining := false

func _ready() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
		return

	quick_join_button.pressed.connect(_on_quick_join)
	refresh_button.pressed.connect(_refresh)
	create_public_button.pressed.connect(_on_create.bind(true))
	create_private_button.pressed.connect(_on_create.bind(false))
	join_code_button.pressed.connect(_on_join_code)
	back_button.pressed.connect(_on_back)

	NetworkManager.lobby_list_received.connect(_on_list)
	NetworkManager.lobby_joined.connect(_on_joined)
	NetworkManager.lobby_denied.connect(_on_denied)
	NetworkManager.disconnected_from_server.connect(_on_disconnected)

	var timer := Timer.new()
	timer.wait_time = 5.0
	timer.autostart = true
	timer.timeout.connect(_refresh)
	add_child(timer)

	status_label.text = "Fetching lobbies"
	_refresh()

func _refresh() -> void:
	NetworkManager.request_lobby_list()

func _on_quick_join() -> void:
	status_label.text = "Finding you a lobby"
	NetworkManager.send_lobby_quick_join()

func _on_create(is_public: bool) -> void:
	status_label.text = "Creating lobby"
	NetworkManager.send_lobby_create(is_public, name_edit.text.strip_edges())

func _on_join_code() -> void:
	var code := code_edit.text.strip_edges().to_upper()
	if code == "":
		status_label.text = "Enter a lobby code first."
		return
	status_label.text = "Joining " + code
	NetworkManager.send_lobby_join(code, password_edit.text.strip_edges())

func _on_joined(lobby: Dictionary) -> void:
	if _joining:
		return
	_joining = true
	var lobby_name := String(lobby.get("name", "lobby"))
	Loader.change_scene("res://scenes/open_world.tscn", "Joining " + lobby_name)

func _on_denied(reason: String) -> void:
	status_label.text = reason

func _on_disconnected() -> void:
	if NetworkManager.session_token == "":
		get_tree().change_scene_to_file("res://scenes/login.tscn")
	else:
		status_label.text = "Disconnected from server."

func _on_list(lobbies: Array) -> void:
	for child in list_box.get_children():
		child.queue_free()
	if status_label.text == "Fetching lobbies":
		status_label.text = ""
	if lobbies.is_empty():
		var empty := Label.new()
		empty.theme_type_variation = &"InfoText"
		empty.text = "No lobbies yet. Create one or quick join!"
		list_box.add_child(empty)
		return
	for lobby in lobbies:
		if typeof(lobby) == TYPE_DICTIONARY:
			list_box.add_child(_build_row(lobby))

func _build_row(lobby: Dictionary) -> Control:
	var id := String(lobby.get("id", ""))
	var is_public := bool(lobby.get("isPublic", true))
	var mine := bool(lobby.get("mine", false))

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)

	var name_label := Label.new()
	name_label.text = "%s [%s]" % [String(lobby.get("name", id)), id]
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_label.clip_text = true
	row.add_child(name_label)

	var info := Label.new()
	info.theme_type_variation = &"InfoText"
	var tag := "" if is_public else " private"
	if mine:
		tag += " yours"
		if not is_public and lobby.has("password"):
			tag += " pass:" + String(lobby["password"])
	info.text = "%d/%d%s" % [int(lobby.get("count", 0)), int(lobby.get("capacity", 16)), tag]
	row.add_child(info)

	var join := Button.new()
	join.text = "Join"
	join.pressed.connect(_on_row_join.bind(id, is_public, mine))
	row.add_child(join)

	if mine:
		var rename := Button.new()
		rename.text = "Rename"
		rename.pressed.connect(_on_row_rename.bind(id))
		row.add_child(rename)

		var vis := Button.new()
		vis.text = "Hide" if is_public else "Open"
		vis.tooltip_text = "Make private" if is_public else "Make public"
		vis.pressed.connect(_on_row_visibility.bind(id, not is_public))
		row.add_child(vis)

		var del := Button.new()
		del.text = "X"
		del.tooltip_text = "Delete lobby"
		del.pressed.connect(_on_row_delete.bind(id))
		row.add_child(del)

	return row

func _on_row_join(id: String, is_public: bool, mine: bool) -> void:
	if is_public or mine:
		status_label.text = "Joining " + id
		NetworkManager.send_lobby_join(id)
		return
	var pw := password_edit.text.strip_edges()
	if pw == "":
		code_edit.text = id
		status_label.text = "Private lobby: type its password below, then press Join."
		password_edit.grab_focus()
		return
	status_label.text = "Joining " + id
	NetworkManager.send_lobby_join(id, pw)

func _on_row_rename(id: String) -> void:
	var new_name := name_edit.text.strip_edges()
	if new_name == "":
		status_label.text = "Type the new name in the name box, then press Rename."
		name_edit.grab_focus()
		return
	NetworkManager.send_lobby_rename(id, new_name)
	name_edit.text = ""

func _on_row_visibility(id: String, is_public: bool) -> void:
	NetworkManager.send_lobby_visibility(id, is_public)

func _on_row_delete(id: String) -> void:
	NetworkManager.send_lobby_delete(id)

func _on_back() -> void:
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
