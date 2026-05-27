import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import type { PlayerState } from "../entities/Player";
import { cartToIso } from "../utils/IsoUtils";
import { gameSocket } from "../network/socket";

const PLAYER_START = { cx: 16, cy: 15 }; // town square

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

  // Drag-to-pan state
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private camStart = { x: 0, y: 0 };

  constructor() {
    super({ key: "WorldScene" });
  }

  create() {
    // ── Build isometric world ──────────────────────────────────────
    this.isoMap = new IsoMap(this);
    this.isoMap.build();

    // ── Camera setup ───────────────────────────────────────────────
    const cam = this.cameras.main;
    const centre = this.isoMap.centre;
    cam.centerOn(centre.x, centre.y);
    cam.setZoom(3); // 3× zoom: 16px tiles render at 48px — crisp top-down

    // Allow camera to scroll freely over the world bounds
    // tight bounds — no empty space outside the map
    cam.setBounds(
      this.isoMap.boundsX,
      this.isoMap.boundsY,
      this.isoMap.boundsW,
      this.isoMap.boundsH,
    );

    // ── Input ──────────────────────────────────────────────────────
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Drag to pan (mouse / touch)
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
    this.input.on("pointerup", () => {
      this.isDragging = false;
    });

    // Scroll-wheel zoom
    this.input.on("wheel", (_: any, __: any, ___: any, deltaY: number) => {
      const newZoom = Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, 1, 4);
      cam.setZoom(newZoom);
    });

    // ── Spawn local player (offline placeholder id) ────────────────
    const offlineState: PlayerState = {
      id: "local",
      cx: PLAYER_START.cx,
      cy: PLAYER_START.cy,
      name: "You",
    };
    this.localPlayer = new Player(this, offlineState, true);

    // Camera follow local player
    this.cameras.main.startFollow(this.localPlayer, true, 0.08, 0.08);

    // ── Multiplayer ────────────────────────────────────────────────
    this.connectMultiplayer();

    // ── Launch the HUD on top (parallel scene) ─────────────────────
    this.scene.launch("UIScene", { worldScene: this });
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer) return;

    const moved = this.localPlayer.handleInput(this.cursors, this.wasd, delta);

    if (moved && gameSocket.connected) {
      gameSocket.sendMove(this.localPlayer.cx, this.localPlayer.cy);
    }
  }

  // ── Multiplayer helpers ──────────────────────────────────────────

  private connectMultiplayer() {
    gameSocket.connect();

    gameSocket.on("init", ({ id, players }) => {
      // Re-assign the local player's id from the server
      (this.localPlayer as any).playerId = id;

      // Spawn all existing remote players
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
    const player = new Player(this, state, false);
    this.remotePlayers.set(state.id, player);
  }

  /** Expose for UIScene */
  getLocalPlayer() {
    return this.localPlayer;
  }
}
