extends Control

signal submitted(data: Dictionary)
signal cancelled

@onready var _name: LineEdit = %Name
@onready var _desc: TextEdit = %Description
@onready var _repo: LineEdit = %Repo
@onready var _demo: LineEdit = %Demo
@onready var _grid: GridContainer = %HtGrid

func _ready() -> void:
	visible = false
	%CancelButton.pressed.connect(func(): cancelled.emit())
	%CreateButton.pressed.connect(_submit)

func open(ht_projects: Array) -> void:
	_name.text = ""
	_desc.text = ""
	_repo.text = ""
	_demo.text = ""
	_populate(ht_projects)
	visible = true
	_name.grab_focus()

func _populate(ht_projects: Array) -> void:
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
		var b := Button.new()
		b.toggle_mode = true
		b.clip_text = true
		b.custom_minimum_size = Vector2(0, 44)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var secs := int(p.get("seconds", 0))
		b.text = "%s\n%.1fh" % [String(p.get("name", "?")), secs / 3600.0]
		b.set_meta("ht_name", String(p.get("name", "")))
		_grid.add_child(b)

func _submit() -> void:
	var pname := _name.text.strip_edges()
	if pname == "":
		_name.grab_focus()
		return
	var selected: Array = []
	for cb in _grid.get_children():
		if cb is Button and cb.button_pressed:
			selected.append(cb.get_meta("ht_name"))
	submitted.emit({
		"name": pname,
		"description": _desc.text.strip_edges(),
		"repoUrl": _repo.text.strip_edges(),
		"demoUrl": _demo.text.strip_edges(),
		"hackatimeProjects": selected,
	})
