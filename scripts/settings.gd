extends Node

signal font_scale_changed

const PATH := "user://settings.json"

var music_enabled := true
var music_volume := 0.6
var voice_enabled := true
var font_scale := 1.0

func _ready() -> void:
	_load()

func _load() -> void:
	if not FileAccess.file_exists(PATH):
		return
	var f := FileAccess.open(PATH, FileAccess.READ)
	if f == null:
		return
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(data) != TYPE_DICTIONARY:
		return
	music_enabled = bool(data.get("music_enabled", music_enabled))
	music_volume = float(data.get("music_volume", music_volume))
	voice_enabled = bool(data.get("voice_enabled", voice_enabled))
	font_scale = clampf(float(data.get("font_scale", font_scale)), 1.0, 1.6)

func save() -> void:
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify({
		"music_enabled": music_enabled,
		"music_volume": music_volume,
		"voice_enabled": voice_enabled,
		"font_scale": font_scale,
	}))
	f.close()

func set_music_enabled(on: bool) -> void:
	music_enabled = on
	save()
	Music.apply_settings()

func set_music_volume(v: float) -> void:
	music_volume = clampf(v, 0.0, 1.0)
	save()
	Music.apply_settings()

func set_voice_enabled(on: bool) -> void:
	voice_enabled = on
	save()

func set_font_scale(v: float) -> void:
	font_scale = clampf(v, 1.0, 1.6)
	save()
	font_scale_changed.emit()

func fs(base: int) -> int:
	return int(round(base * font_scale))
