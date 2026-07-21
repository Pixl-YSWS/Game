import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { cartToIso, TILE_H, TILE_W } from "../utils/IsoUtils";
import type { MapDef } from "../types/map";
import { getKeybinds } from "../data/Settings";
import { gameSocket } from "../network/socket";
import { makeInteriorMap } from "../world/interior";

interface InteriorInitData {
  returnTo: { cx: number; cy: number };

  // Per-house seed (derived from the door tile + world) — picks this house's
  // room size, colour theme and furniture. Falls back to a fixed default.
  houseSeed?: number;

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
  private houseSeed = 0;
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
    this.houseSeed = data.houseSeed ?? 0x1a7e1;
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

    const layout = makeInteriorMap(this.houseSeed);
    this.mapDef = layout.map;
    const isoMap = new IsoMap(this, this.mapDef);
    isoMap.build();

    // Fit the camera to the room (not the mostly-empty 32×18 map) so the
    // interior fills the screen, and hide the world scene rendering behind
    // the transparent tiles with an opaque backdrop.
    const roomCentre = cartToIso(
      layout.roomX + layout.roomCols / 2 - 0.5,
      layout.roomY + layout.roomRows / 2 - 0.5,
    );
    this.add
      .rectangle(roomCentre.x, roomCentre.y, 4096, 4096, 0x0d0d0d)
      .setDepth(-500);
    const cam = this.cameras.main;
    cam.setZoom(
      Math.min(
        this.scale.width / ((layout.roomCols + 2) * TILE_W),
        this.scale.height / ((layout.roomRows + 2) * TILE_H),
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
    this.exitTile = { cx: layout.doorCol, cy: layout.doorRow };

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
    } else {
      this.localPlayer.idle();
    }

    const d = this.localPlayer.y / TILE_H + 1;
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
