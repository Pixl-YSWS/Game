extends Node

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
const WEB_BASE_URL := "https://play.pixl.rsvp"

func open(path: String) -> void:
	var base := path
	var fragment := ""
	var hash_pos := path.find("#")
	if hash_pos != -1:
		base = path.substr(0, hash_pos)
		fragment = path.substr(hash_pos)
	var url := WEB_BASE_URL + "/" + base + "/"
	if NetworkManager.session_token != "":
		url += "?token=" + NetworkManager.session_token.uri_encode()
	url += fragment
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.open(%s, 'pixl_web');" % JSON.stringify(url), true)
	else:
		OS.shell_open(url)

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if not _in_gameplay() or global.ui_blocked() or ChatHud.is_typing() or Dialogue.is_open:
		return
	match event.keycode:
		KEY_H:
			open("projects")
		KEY_B:
			open("shop")
		KEY_J:
			open("quests")
		_:
			return
	get_viewport().set_input_as_handled()
