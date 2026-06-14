import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { cartToIso, TILE_H, TILE_W } from "../utils/IsoUtils";
import type { MapDef, MapObject } from "../types/map";
import { getKeybinds } from "../data/Settings";
import { gameSocket } from "../network/socket";
import {
  IFLOOR,
  IWALL,
  SOLID,
  IPROPS,
  interiorPropObject,
  type InteriorProp,
} from "../world/tileset";

const COLS = 32;
const ROWS = 18;
const ROOM_COLS = 18;
const ROOM_ROWS = 12;
const ROOM_X = Math.floor((COLS - ROOM_COLS) / 2);
const ROOM_Y = Math.floor((ROWS - ROOM_ROWS) / 2);
const ROOM_X1 = ROOM_X + ROOM_COLS - 1;
const ROOM_Y1 = ROOM_Y + ROOM_ROWS - 1;
const DOOR_COL = ROOM_X + Math.floor(ROOM_COLS / 2);
const DOOR_ROW = ROOM_Y1;

function makeInteriorMap(): MapDef {
  const ground = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
  const deco = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

  // Wood floor across the whole room.
  for (let r = ROOM_Y; r <= ROOM_Y1; r++)
    for (let c = ROOM_X; c <= ROOM_X1; c++) ground[r][c] = IFLOOR;

  // Wallpaper walls: a 2-tile-tall back wall plus a 1-tile border on the other
  // sides, with a doorway gap at the bottom centre.
  for (let c = ROOM_X; c <= ROOM_X1; c++) {
    deco[ROOM_Y][c] = IWALL;
    deco[ROOM_Y + 1][c] = IWALL;
    if (c !== DOOR_COL) deco[ROOM_Y1][c] = IWALL;
  }
  for (let r = ROOM_Y; r <= ROOM_Y1; r++) {
    deco[r][ROOM_X] = IWALL;
    deco[r][ROOM_X1] = IWALL;
  }

  const objects: MapObject[] = [];
  const place = (
    prop: InteriorProp,
    cx: number,
    cy: number,
    opts: { flat?: boolean; solid?: boolean } = {},
  ) => {
    objects.push(interiorPropObject(prop, cx, cy, opts.flat));
    if (opts.solid) {
      const tw = Math.max(1, Math.round(prop.w / 16));
      const th = Math.max(1, Math.round(prop.h / 16));
      for (let r = 0; r < th; r++)
        for (let c = 0; c < tw; c++) {
          const gc = cx + c;
          const gr = cy + r;
          if (gr > ROOM_Y + 1 && gr < ROOM_Y1 && gc > ROOM_X && gc < ROOM_X1)
            deco[gr][gc] = SOLID;
        }
    }
  };

  // Wall decorations (sit on the back wall, no collision needed).
  place(IPROPS.window, ROOM_X + 3, ROOM_Y);
  place(IPROPS.picture, ROOM_X + 8, ROOM_Y);
  place(IPROPS.window, ROOM_X + 13, ROOM_Y);

  // Furniture.
  place(IPROPS.bookshelf, ROOM_X + 1, ROOM_Y + 2, { solid: true });
  place(IPROPS.wardrobe, ROOM_X + 4, ROOM_Y + 2, { solid: true });
  place(IPROPS.bedDouble, ROOM_X + 13, ROOM_Y + 2, { solid: true });
  place(IPROPS.rug, ROOM_X + 6, ROOM_Y + 7, { flat: true });
  place(IPROPS.table, ROOM_X + 7, ROOM_Y + 6, { solid: true });
  place(IPROPS.sofa, ROOM_X + 12, ROOM_Y + 8, { solid: true });
  place(IPROPS.lamp, ROOM_X + 1, ROOM_Y + 9, { solid: true });

  return {
    key: "interior_default",
    cols: COLS,
    rows: ROWS,
    tilesetKey: "tiles-town",
    tilesetCols: 12,
    cozy: true,
    objects,
    groundLayer: ground,
    decoLayer: deco,
    walkableGround: new Set([IFLOOR]),
    solidDeco: new Set([SOLID, IWALL]),
    flatDeco: new Set(),
    spawnPoint: { cx: DOOR_COL, cy: DOOR_ROW - 1 },
    doors: [],
    npcs: [],
  };
}

interface InteriorInitData {
  returnTo: { cx: number; cy: number };

  char?: number;
  skin?: string;
  verified?: boolean;
}

export class InteriorScene extends Phaser.Scene {
  private static readonly OVERLAY_SCENES = [
    "PauseScene",
    "SettingsScene",
    "AdminScene",
    "InventoryScene",
    "InvitePanelScene",
    "InboxScene",
    "ShopScene",
    "ProjectsScene",
  ];
  private localPlayer?: Player;
  private mapDef?: MapDef;
  private returnTo!: { cx: number; cy: number };
  private appearance: { char?: number; skin?: string; verified?: boolean } = {};
  private exitTile!: { cx: number; cy: number };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  private touchDir = { dx: 0, dy: 0 };
  private controlKeys: Phaser.Input.Keyboard.Key[] = [];
  private exiting = false;

  constructor() {
    super({ key: "InteriorScene" });
  }

  init(data: InteriorInitData) {
    this.returnTo = data.returnTo;
    this.appearance = {
      char: data.char,
      skin: data.skin,
      verified: data.verified,
    };
    this.exiting = false;
  }

  create() {
    this.applyKeybinds();

    this.events.on("resume", this.applyKeybinds, this);
    this.events.once("shutdown", () => {
      this.events.off("resume", this.applyKeybinds, this);
      gameSocket.setInterior(false);
    });

    // Tell the server we've gone indoors so our avatar disappears for
    // everyone else in the village/open world; undone on any exit path.
    gameSocket.setInterior(true);

    this.mapDef = makeInteriorMap();
    const isoMap = new IsoMap(this, this.mapDef);
    isoMap.build();

    // Fit the camera to the room (not the mostly-empty 32×18 map) so the
    // interior fills the screen, and hide the world scene rendering behind
    // the transparent tiles with an opaque backdrop.
    const roomCentre = cartToIso(
      ROOM_X + ROOM_COLS / 2 - 0.5,
      ROOM_Y + ROOM_ROWS / 2 - 0.5,
    );
    this.add
      .rectangle(roomCentre.x, roomCentre.y, 4096, 4096, 0x0d0d0d)
      .setDepth(-500);
    const cam = this.cameras.main;
    cam.setZoom(
      Math.min(
        this.scale.width / ((ROOM_COLS + 2) * TILE_W),
        this.scale.height / ((ROOM_ROWS + 2) * TILE_H),
      ),
    );
    cam.centerOn(roomCentre.x, roomCentre.y);

    const { cx, cy } = this.mapDef.spawnPoint;
    this.localPlayer = new Player(
      this,
      {
        id: "local",
        cx,
        cy,
        name: "You",
        char: this.appearance.char,
        skin: this.appearance.skin,
        verified: this.appearance.verified,
      },
      true,
      this.mapDef,
    );
    this.exitTile = { cx: DOOR_COL, cy: DOOR_ROW };

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.scene.isActive("PauseScene")) return;
      this.scene.launch("PauseScene", { pausedSceneKey: "InteriorScene" });
    });
  }

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
      up: k("UP"),
      down: k("DOWN"),
      left: k("LEFT"),
      right: k("RIGHT"),
      space: k("SPACE"),
      shift: k(b.run),
    } as Phaser.Types.Input.Keyboard.CursorKeys;
    this.wasd = { W: k(b.up), A: k(b.left), S: k(b.down), D: k(b.right) };
  }

  setTouchDir(dx: number, dy: number) {
    this.touchDir = { dx, dy };
  }

  setSpeedMultiplier(mul: number) {
    this.localPlayer?.setSpeedMultiplier(mul);
  }

  // Interior coordinates are local to this client-side scene — never sent to
  // the server, which still has us parked at the door tile of the outer world.
  teleport(cx: number, cy: number): boolean {
    return this.localPlayer?.teleport(cx, cy) ?? false;
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer) return;

    // Menus overlay (don't pause) the scene; suspend input while one is open.
    const overlay = InteriorScene.OVERLAY_SCENES.some((k) =>
      this.scene.isActive(k),
    );
    if (this.input.keyboard) this.input.keyboard.enabled = !overlay;
    if (!overlay) {
      this.localPlayer.handleInput(this.cursors, this.wasd, delta, this.touchDir);
    }

    const d = Math.floor(this.localPlayer.y / TILE_H) + 1.5;
    if (this.localPlayer.depth !== d) this.localPlayer.setDepth(d);

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
