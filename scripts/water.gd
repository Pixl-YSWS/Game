extends TileMapLayer

@export var frame_atlas_coords: Array[Vector2i] = [
	Vector2i(0, 0),
	Vector2i(1, 0),
	Vector2i(2, 0),
	Vector2i(3, 0)
]
@export var frame_duration: float = 0.2
@export var source_id: int = 0

var current_frame := 0
var timer := 0.0
var water_cells: Array[Vector2i] = []

func _ready():
	for cell in get_used_cells():
		water_cells.append(cell)

func _process(delta):
	timer += delta
	if timer >= frame_duration:
		timer = 0.0
		current_frame = (current_frame + 1) % frame_atlas_coords.size()
		_update_water_frame()

func _update_water_frame():
	var coords = frame_atlas_coords[current_frame]
	for cell in water_cells:
		set_cell(cell, source_id, coords)
