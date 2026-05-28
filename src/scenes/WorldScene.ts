import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import type { PlayerState } from "../types/network";
import { gameSocket } from "../network/socket";
import { TILE_H } from "../utils/IsoUtils";
import { TOWN_MAP } from "../data/MapData";

export class WorldScene extends Phaser.Scene {
  private isoMap!: IsoMap;
  private localPlayer!: Player;
  private remotePlayers = new Map<string, Player>();

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private camStart = { x: 0, y: 0 };

  constructor() {
    super({ key: "WorldScene" });
  }

  create() {
    this.isoMap = new IsoMap(this, TOWN_MAP);
    this.isoMap.build();

    const cam = this.cameras.main;
    const centre = this.isoMap.centre;
    cam.centerOn(centre.x, centre.y);
    cam.setZoom(3);
    cam.setBounds(this.isoMap.boundsX, this.isoMap.boundsY, this.isoMap.boundsW, this.isoMap.boundsH);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.dragStart.x = p.x;
      this.dragStart.y = p.y;
      this.camStart.x = cam.scrollX;
      this.camStart.y = cam.scrollY;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      const dx = (this.dragStart.x - p.x) / cam.zoom;
      const dy = (this.dragStart.y - p.y) / cam.zoom;
      cam.setScroll(this.camStart.x + dx, this.camStart.y + dy);
    });
    this.input.on("pointerup", () => { this.isDragging = false; });

    this.input.on("wheel", (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, 1, 4));
    });

    const { cx, cy } = TOWN_MAP.spawnPoint;
    this.localPlayer = new Player(
      this,
      { id: "local", cx, cy, name: "You" },
      true,
      TOWN_MAP,
    );

    this.cameras.main.startFollow(this.localPlayer, true, 0.08, 0.08);
    this.connectMultiplayer();
    this.scene.launch("UIScene", { worldScene: this });
  }

  private syncDepth(player: Player) {
    player.setDepth(player.y / TILE_H + 1);
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer) return;

    this.syncDepth(this.localPlayer);
    for (const p of this.remotePlayers.values()) this.syncDepth(p);

    const moved = this.localPlayer.handleInput(this.cursors, this.wasd, delta);
    if (moved && gameSocket.connected) {
      gameSocket.sendMove(this.localPlayer.cx, this.localPlayer.cy);
    }
  }

  private connectMultiplayer() {
    gameSocket.connect();

    gameSocket.on("init", ({ id, players }) => {
      this.localPlayer.assignId(id);
      for (const state of players) {
        if (state.id !== id) this.spawnRemote(state);
      }
    });

    gameSocket.on("player:join", (state) => {
      if (state.id !== gameSocket.id) this.spawnRemote(state);
    });

    gameSocket.on("player:move", ({ id, cx, cy }) => {
      const remote = this.remotePlayers.get(id);
      if (remote) remote.applyServerState({ id, cx, cy, name: "" });
    });

    gameSocket.on("player:leave", (id) => {
      const remote = this.remotePlayers.get(id);
      if (remote) {
        remote.destroy();
        this.remotePlayers.delete(id);
      }
    });
  }

  private spawnRemote(state: PlayerState) {
    if (this.remotePlayers.has(state.id)) return;
    const player = new Player(this, state, false, TOWN_MAP);
    this.remotePlayers.set(state.id, player);
  }

  getLocalPlayer() {
    return this.localPlayer;
  }
}
