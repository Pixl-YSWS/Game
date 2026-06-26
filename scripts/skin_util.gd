class_name SkinUtil
#
const PRESET_DIR := "res://assets/cozy-towns/CozyValley_Premium_1.3/Characters/-- Pre-assembled Characters/"
const BASE_DIR := "res://assets/cozy-towns/CozyValley_Basic_1.0/Characters/"
const SHEET_SIZE := Vector2i(160, 576)

const PORTRAIT_REGION := Rect2(0, 288, 32, 32)

const NUM_BODY := 3
const NUM_HAIR := 6
const NUM_TOP := 6
const NUM_BOTTOM := 6
const NUM_PRESETS := 9

static func encode_outfit(body: int, hair: int, top: int, bottom: int) -> String:
	return "cv1:b%dh%dt%do%d" % [body, hair, top, bottom]

static func is_preset(desc: String) -> bool:
	return desc.begins_with("cvc:")

## Pre-assembled character number (1..9), or 0 if `desc` is an outfit.
static func preset_index(desc: String) -> int:
	if is_preset(desc):
		return clampi(int(desc.substr(4)), 1, NUM_PRESETS)
	return 0

## Parses an outfit descriptor into {body, hair, top, bottom}, with sane defaults.
static func parse_outfit(desc: String) -> Dictionary:
	var re := RegEx.new()
	re.compile("^cv1:b([1-3])h([0-6])t([1-6])o([1-6])$")
	var m := re.search(desc)
	if m == null:
		return {"body": 1, "hair": 1, "top": 1, "bottom": 1}
	return {
		"body": int(m.get_string(1)),
		"hair": int(m.get_string(2)),
		"top": int(m.get_string(3)),
		"bottom": int(m.get_string(4)),
	}

static func is_valid(desc: String) -> bool:
	var re := RegEx.new()
	re.compile("^(cvc:[1-9]|cv1:b[1-3]h[0-6]t[1-6]o[1-6])$")
	return re.search(desc) != null

static func random_outfit() -> String:
	return encode_outfit(
		randi_range(1, NUM_BODY),
		randi_range(1, NUM_HAIR),
		randi_range(1, NUM_TOP),
		randi_range(1, NUM_BOTTOM),
	)

## Full character sprite sheet (160x576) for a descriptor. Presets load directly;
## outfits are composited from their layers, back to front.
static func resolve_sheet(desc: String) -> Texture2D:
	if is_preset(desc):
		return load(PRESET_DIR + "char%d.png" % preset_index(desc))
	if desc.begins_with("cv1:"):
		return _bake_outfit(parse_outfit(desc))
	return load(PRESET_DIR + "char1.png")

static func _bake_outfit(o: Dictionary) -> Texture2D:
	var paths: Array[String] = [
		BASE_DIR + "Base/Base%d_hand_back.png" % o.body,
		BASE_DIR + "Base/Base%d_body.png" % o.body,
		BASE_DIR + "Bottoms/Bottoms_shorts_%d.png" % o.bottom,
		BASE_DIR + "Tops/Tops_shirt_%d.png" % o.top,
	]
	if int(o.hair) > 0:
		paths.append(BASE_DIR + "Hairstyles/Hairstyles_short_%d.png" % o.hair)
	paths.append(BASE_DIR + "Base/Base%d_hand_front.png" % o.body)

	var result := Image.create_empty(SHEET_SIZE.x, SHEET_SIZE.y, false, Image.FORMAT_RGBA8)
	for p in paths:
		var tex := load(p) as Texture2D
		if tex == null:
			continue
		var img := tex.get_image()
		if img == null:
			continue
		if img.is_compressed():
			img.decompress()
		img.convert(Image.FORMAT_RGBA8)
		result.blend_rect(img, Rect2i(Vector2i.ZERO, SHEET_SIZE), Vector2i.ZERO)
	return ImageTexture.create_from_image(result)

## A small portrait (front idle frame) of a descriptor, for menu buttons/preview.
static func portrait(desc: String) -> AtlasTexture:
	var at := AtlasTexture.new()
	at.atlas = resolve_sheet(desc)
	at.region = PORTRAIT_REGION
	return at
