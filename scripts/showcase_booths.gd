extends Node2D

const BOOTH := preload("res://scripts/project_booth.gd")
const SLOTS: Array[Vector2] = [Vector2(0, 0), Vector2(40, 0), Vector2(80, 0), Vector2(120, 0)]

func _ready() -> void:
	if not NetworkManager.is_connected_to_server():
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/explore/showcase?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if code != 200 or data.size() == 0:
			return
		var json = JSON.parse_string(data.get_string_from_utf8())
		if typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			return
		var projects: Array = json.get("projects", [])
		for i in mini(SLOTS.size(), projects.size()):
			var booth: Area2D = BOOTH.new()
			booth.project = projects[i]
			booth.position = SLOTS[i]
			add_child(booth)
	)
	req.request(url)
