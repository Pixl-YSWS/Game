extends Node

const PTT_KEY := KEY_V
const DECIM := 3

var _mic_player: AudioStreamPlayer
var _capture: AudioEffectCapture
var _capturing := false
var _send_rate := 16000
var _playbacks: Dictionary = {}

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	NetworkManager.voice_received.connect(_on_voice)

func _ensure_mic() -> void:
	if _mic_player != null:
		return
	var bus := AudioServer.get_bus_index("Mic")
	if bus < 0:
		return
	_capture = AudioServer.get_bus_effect(bus, 0) as AudioEffectCapture
	_mic_player = AudioStreamPlayer.new()
	_mic_player.stream = AudioStreamMicrophone.new()
	_mic_player.bus = "Mic"
	add_child(_mic_player)

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or event.echo or event.keycode != PTT_KEY:
		return
	if event.pressed and not _capturing:
		_start()
	elif not event.pressed and _capturing:
		_stop()

func _start() -> void:
	if not Settings.voice_enabled or ChatHud.is_typing() or Dialogue.is_open:
		return
	_ensure_mic()
	if _mic_player == null or _capture == null:
		return
	_capturing = true
	_send_rate = int(AudioServer.get_mix_rate()) / DECIM
	_capture.clear_buffer()
	_mic_player.play()

func _stop() -> void:
	_capturing = false
	if _mic_player:
		_mic_player.stop()

func _process(_dt: float) -> void:
	if not _capturing or _capture == null:
		return
	var avail := _capture.get_frames_available()
	if avail <= 0:
		return
	var frames := _capture.get_buffer(avail)
	var out := PackedByteArray()
	out.resize(4)
	out.encode_u32(0, _send_rate)
	var i := 0
	while i < frames.size():
		var v := frames[i]
		var s := int(clampf((v.x + v.y) * 0.5, -1.0, 1.0) * 32767.0)
		out.append(s & 0xFF)
		out.append((s >> 8) & 0xFF)
		i += DECIM
	if out.size() > 4:
		NetworkManager.send_voice(out)

func _on_voice(user_id: String, payload: PackedByteArray) -> void:
	if not Settings.voice_enabled or payload.size() < 6:
		return
	var rate := int(payload.decode_u32(0))
	if rate <= 0:
		return
	var pb = _playbacks.get(user_id)
	if pb == null or not is_instance_valid(pb["player"]) or pb["rate"] != rate:
		pb = _make_playback(user_id, rate)
	var gen_pb: AudioStreamGeneratorPlayback = pb["playback"]
	var i := 4
	while i + 1 < payload.size():
		var f := float(payload.decode_s16(i)) / 32768.0
		gen_pb.push_frame(Vector2(f, f))
		i += 2

func _make_playback(user_id: String, rate: int) -> Dictionary:
	var old = _playbacks.get(user_id)
	if old and is_instance_valid(old["player"]):
		old["player"].queue_free()
	var gen := AudioStreamGenerator.new()
	gen.mix_rate = rate
	gen.buffer_length = 0.4
	var player := AudioStreamPlayer.new()
	player.stream = gen
	add_child(player)
	player.play()
	var pb := {"player": player, "rate": rate, "playback": player.get_stream_playback()}
	_playbacks[user_id] = pb
	return pb
