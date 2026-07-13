extends Control

signal submitted(data: Dictionary)
signal cancelled

const TYPES := ["game", "website", "app", "cli", "hardware", "other"]
const TYPE_LABELS := ["Game", "Website", "App", "CLI", "Hardware", "Other"]

@onready var _name: LineEdit = %Name
@onready var _desc: TextEdit = %Description
@onready var _repo: LineEdit = %Repo
@onready var _demo: LineEdit = %Demo
@onready var _type: OptionButton = %Type
@onready var _error: Label = %ErrorLabel
@onready var _grid: GridContainer = %HtGrid
@onready var _title: Label = %Title
@onready var _create_button: Button = %CreateButton
@onready var _cancel_button: Button = %CancelButton

var _submitting := false
var _edit_id := 0

func _ready() -> void:
	visible = false
	for label in TYPE_LABELS:
		_type.add_item(label)
	_cancel_button.pressed.connect(func(): cancelled.emit())
	_create_button.pressed.connect(_submit)

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
	var idx := TYPES.find(String(project.get("type", "game")))
	_type.selected = idx if idx >= 0 else TYPES.find("other")
	_populate(ht_projects, project.get("hackatime_projects", []))

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
		"type": TYPES[maxi(_type.selected, 0)],
		"hackatimeProjects": selected,
	}
	if _edit_id != 0:
		data["id"] = _edit_id
	_set_submitting(true)
	submitted.emit(data)
