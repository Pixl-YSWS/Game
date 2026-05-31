import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { TILE_H } from "../utils/IsoUtils";
import type { MapDef } from "../types/map";
import { getKeybinds } from "../data/Settings";

// 16:9 aspect so the map exactly fills the 1280×720 canvas — no letterbox.
const COLS = 32;
const ROWS = 18;
const ROOM_COLS = 10;
const ROOM_ROWS = 8;
const ROOM_X = Math.floor((COLS - ROOM_COLS) / 2);
const ROOM_Y = Math.floor((ROWS - ROOM_ROWS) / 2);
const DOOR_COL = ROOM_X + Math.floor(ROOM_COLS / 2);
const DOOR_ROW = ROOM_Y + ROOM_ROWS - 1;

function makeInteriorMap(): MapDef {
  // Grass everywhere by default — fills the area around the house so the
  // viewport doesn't show void. No trees or other decos outside the walls.
  const ground = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  const deco = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  // Room floor: cobblestone
  for (let r = ROOM_Y; r <= ROOM_Y + ROOM_ROWS - 1; r++) {
    for (let c = ROOM_X; c <= ROOM_X + ROOM_COLS - 1; c++) {
      ground[r][c] = 1;
    }
  }

  // Walls around the room
  for (let c = ROOM_X; c < ROOM_X + ROOM_COLS; c++) {
    deco[ROOM_Y][c] = 45;
    if (c !== DOOR_COL) deco[DOOR_ROW][c] = 68;
  }
  for (let r = ROOM_Y + 1; r < DOOR_ROW; r++) {
    deco[r][ROOM_X] = 56;
    deco[r][ROOM_X + ROOM_COLS - 1] = 80;
  }
  deco[DOOR_ROW][DOOR_COL] = 43; // door

  return {
    key: "interior_default",
    cols: COLS,
    rows: ROWS,
    tilesetKey: "tiles-town",
    tilesetCols: 12,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: new Set([0, 1, 2]),
    solidDeco: new Set([44, 45, 56, 68, 80, 82, 94]),
    flatDeco: new Set([43]),
    spawnPoint: { cx: DOOR_COL, cy: DOOR_ROW - 1 },
    doors: [],
    npcs: [],
  };
}

interface InteriorInitData {
  returnTo: { cx: number; cy: number };
}

export class InteriorScene extends Phaser.Scene {
  private localPlayer?: Player;
  private mapDef?: MapDef;
  private returnTo!: { cx: number; cy: number };
  private exitTile!: { cx: number; cy: number };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  // Held direction from the on-screen mobile D-pad (set by UIScene).
  private touchDir = { dx: 0, dy: 0 };
  private controlKeys: Phaser.Input.Keyboard.Key[] = [];
  private exiting = false;

  constructor() {
    super({ key: "InteriorScene" });
  }

  init(data: InteriorInitData) {
    this.returnTo = data.returnTo;
    this.exiting = false;
  }

  create() {
    this.applyKeybinds();
    // Rebuild movement keys when returning from a paused state (the player may
    // have just remapped controls in Settings).
    this.events.on("resume", this.applyKeybinds, this);
    this.events.once("shutdown", () => this.events.off("resume", this.applyKeybinds, this));

    this.mapDef = makeInteriorMap();
    const isoMap = new IsoMap(this, this.mapDef);
    isoMap.build();

    const cam = this.cameras.main;
    cam.setZoom(Math.min(
      this.scale.width / isoMap.boundsW,
      this.scale.height / isoMap.boundsH,
    ));
    cam.centerOn(isoMap.centre.x, isoMap.centre.y);

    const { cx, cy } = this.mapDef.spawnPoint;
    this.localPlayer = new Player(
      this,
      { id: "local", cx, cy, name: "You" },
      true,
      this.mapDef,
    );
    this.exitTile = { cx: DOOR_COL, cy: DOOR_ROW };

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.scene.isActive("PauseScene")) return;
      this.scene.pause();
      this.scene.launch("PauseScene", { pausedSceneKey: "InteriorScene" });
    });
  }

  // (Re)build movement keys from the saved keybinds (arrows stay on as fixed
  // alternates; the run key drives sprint). Tears down prior keys so remapping
  // applies on resume.
  private applyKeybinds() {
    const kb = this.input.keyboard;
    if (!kb) return;
    for (const key of this.controlKeys) kb.removeKey(key, true, true);
    this.controlKeys.length = 0;
    const b = getKeybinds();
    const k = (code: string) => {
      const key = kb.addKey(code, true);
      this.controlKeys.push(key);
      return key;
    };
    this.cursors = {
      up: k("UP"), down: k("DOWN"), left: k("LEFT"), right: k("RIGHT"),
      space: k("SPACE"), shift: k(b.run),
    } as Phaser.Types.Input.Keyboard.CursorKeys;
    this.wasd = { W: k(b.up), A: k(b.left), S: k(b.down), D: k(b.right) };
  }

  // Held direction from the on-screen mobile D-pad (UIScene calls this). An
  // interior is exited just by walking onto the door tile, so there's no
  // separate mobile interact action to wire up here.
  setTouchDir(dx: number, dy: number) {
    this.touchDir = { dx, dy };
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer) return;
    this.localPlayer.handleInput(this.cursors, this.wasd, delta, this.touchDir);
    this.localPlayer.setDepth(Math.floor(this.localPlayer.y / TILE_H) + 1.5);

    if (this.exiting) return;
    if (
      this.localPlayer.cx === this.exitTile.cx &&
      this.localPlayer.cy === this.exitTile.cy
    ) {
      this.exiting = true;
      this.scene.stop();
      this.scene.resume("WorldScene", { returnTo: this.returnTo });
    }
  }
}
