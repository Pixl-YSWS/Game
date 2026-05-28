import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import type { PlayerState } from "../types/network";
import type { MapDef } from "../types/map";
import { generateMap } from "../world/MapGen";
import { gameSocket } from "../network/socket";
import { TILE_H } from "../utils/IsoUtils";

export class WorldScene extends Phaser.Scene {
  private isoMap?: IsoMap;
  private localPlayer?: Player;
  private mapDef?: MapDef;
  private loadingText?: Phaser.GameObjects.Text;
  private remotePlayers = new Map<string, Player>();
  private lastSentCx = -1;
  private lastSentCy = -1;
  // Track previous tile to detect a *transition* onto a door tile, so
  // returning from an interior doesn't immediately re-trigger entry.
  private lastTileCx = -1;
  private lastTileCy = -1;
  private doorTiles = new Set<string>();

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: "WorldScene" });
  }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Scroll-wheel zoom only — no mouse drag (camera follows player)
    const cam = this.cameras.main;
    this.input.on("wheel", (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, 1, 6));
    });

    // World build is deferred until the server hands us our seed (init event).
    this.loadingText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading village...", {
        fontFamily: '"Press Start 2P"',
        fontSize: "12px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    this.connectMultiplayer();
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer) return;

    this.localPlayer.handleInput(this.cursors, this.wasd, delta);

    const { cx, cy } = this.localPlayer;
    if (gameSocket.connected && (cx !== this.lastSentCx || cy !== this.lastSentCy)) {
      gameSocket.sendMove(cx, cy);
      this.lastSentCx = cx;
      this.lastSentCy = cy;
    }

    // Door check fires only on the frame we *moved* onto a door tile,
    // so re-entry on resume doesn't recursively launch the interior.
    if (cx !== this.lastTileCx || cy !== this.lastTileCy) {
      if (this.doorTiles.has(`${cx},${cy}`)) {
        this.enterHouse(cx, cy);
      }
      this.lastTileCx = cx;
      this.lastTileCy = cy;
    }

    this.syncDepth(this.localPlayer);
    for (const remote of this.remotePlayers.values()) {
      this.syncDepth(remote);
    }
  }

  private enterHouse(doorCx: number, doorCy: number) {
    this.scene.pause();
    this.scene.launch("InteriorScene", { returnTo: { cx: doorCx, cy: doorCy } });
  }

  private syncDepth(player: Player) {
    player.setDepth(Math.floor(player.y / TILE_H) + 1.5);
  }

  // ── World construction ────────────────────────────────────────────

  private buildWorld(seed: number) {
    this.mapDef = generateMap(seed);
    this.isoMap = new IsoMap(this, this.mapDef);
    this.isoMap.build();

    const cam = this.cameras.main;
    cam.centerOn(this.isoMap.centre.x, this.isoMap.centre.y);
    cam.setZoom(4);
    cam.setBounds(
      this.isoMap.boundsX, this.isoMap.boundsY,
      this.isoMap.boundsW, this.isoMap.boundsH,
    );

    this.doorTiles.clear();
    for (const d of this.mapDef.doors) {
      this.doorTiles.add(`${d.cx},${d.cy}`);
    }

    const { cx, cy } = this.mapDef.spawnPoint;
    this.localPlayer = new Player(
      this,
      { id: "local", cx, cy, name: "You" },
      true,
      this.mapDef,
    );
    this.lastTileCx = cx;
    this.lastTileCy = cy;
    cam.startFollow(this.localPlayer, true, 0.08, 0.08);

    this.loadingText?.destroy();
    this.loadingText = undefined;

    this.scene.launch("UIScene", { worldScene: this });
  }

  // ── Multiplayer ───────────────────────────────────────────────────

  private connectMultiplayer() {
    gameSocket.connect();

    gameSocket.on("init", ({ id, players, seed }) => {
      this.buildWorld(seed);
      this.localPlayer?.assignId(id);
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
    if (!this.mapDef) return;
    const player = new Player(this, state, false, this.mapDef);
    this.remotePlayers.set(state.id, player);
  }

  getLocalPlayer() {
    return this.localPlayer;
  }
}
