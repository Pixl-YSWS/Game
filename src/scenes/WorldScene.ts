import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import type { PlayerState, WorldRef, WorldState, InviteInfo } from "../types/network";
import type { MapDef } from "../types/map";
import { generateMap } from "../world/MapGen";
import { makeHouseInterior } from "../world/HouseMap";
import { gameSocket } from "../network/socket";
import { TILE_H, TILE_W, cartToIso } from "../utils/IsoUtils";
import { getOrCreatePlayerId } from "../network/playerIdentity";
import { loadSettings } from "../data/Settings";

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
  private hotkeys!: {
    O: Phaser.Input.Keyboard.Key;
    I: Phaser.Input.Keyboard.Key;
    Y: Phaser.Input.Keyboard.Key;
    N: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
  };

  // World-space "E" indicators, one per door tile. The whole list is
  // re-built when the map changes; visibility is toggled per-frame based
  // on the player's tile position so only the door the player is on
  // shows a prompt.
  private doorIndicators: {
    cx: number;
    cy: number;
    label: Phaser.GameObjects.Text;
    bobTween: Phaser.Tweens.Tween;
  }[] = [];

  // Currently displayed world (set by server).
  private world: WorldRef = { kind: "village", ownerPlayerId: getOrCreatePlayerId() };
  // Optional world to request right after connecting, set from the main menu.
  private initialWorld?: WorldRef;

  // Pending invites awaiting our Y/N answer.
  private inviteQueue: InviteInfo[] = [];
  private invitePromptText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;

  // ── HUD state ─────────────────────────────────────────────────────
  private hp = 10;
  private hpMax = 10;
  private heartIcons: Phaser.GameObjects.Graphics[] = [];
  private coordText?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "WorldScene" });
  }

  init(data?: { initialWorld?: WorldRef }) {
    this.initialWorld = data?.initialWorld;
  }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.hotkeys = {
      O: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.O),
      I: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I),
      Y: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Y),
      N: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.N),
      E: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };

    this.input.on("wheel", (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, 1, 6));
    });

    this.loadingText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading village...", {
        fontFamily: '"Press Start 2P"',
        fontSize: "12px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    this.statusText = this.add
      .text(8, 8, "", {
        fontFamily: '"Press Start 2P"',
        fontSize: "8px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setScrollFactor(0);

    this.buildHud();
    this.bindKeyHandlers();
    this.connectMultiplayer();

    this.input.keyboard!.on("keydown-ESC", () => this.openPause());

    this.events.once("shutdown", () => {
      this.clearDoorIndicators();
      gameSocket.clearHandlers();
    });
  }

  private openPause() {
    if (this.scene.isActive("PauseScene")) return;
    this.scene.pause();
    this.scene.launch("PauseScene", { pausedSceneKey: "WorldScene" });
  }

  // ── HUD ───────────────────────────────────────────────────────────

  private buildHud() {
    // Stack the HUD under the status text in the top-left so it survives
    // narrow viewports (the body uses overflow:hidden, so anything past
    // the visible viewport edge gets clipped).
    const baseX = 8;

    // Hearts row, just under the status text.
    const heartsY = 24;
    for (let i = 0; i < this.hpMax; i++) {
      const g = this.add.graphics().setScrollFactor(0).setDepth(10000);
      g.x = baseX + i * 14;
      g.y = heartsY;
      this.heartIcons.push(g);
    }
    this.refreshHearts();

    // Coords below the hearts.
    this.coordText = this.add
      .text(baseX, heartsY + 22, "", {
        fontFamily: '"Press Start 2P"',
        fontSize: "8px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(10000);
  }

  private refreshHearts() {
    for (let i = 0; i < this.heartIcons.length; i++) {
      const g = this.heartIcons[i];
      g.clear();
      const filled = i < this.hp;
      drawHeart(g, filled);
    }
  }

  private updateHud() {
    if (!this.coordText) return;
    const p = this.localPlayer;
    if (p) this.coordText.setText(`X ${p.cx}  Y ${p.cy}`);
    else this.coordText.setText("");
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

    this.refreshDoorPrompt();
    if (cx !== this.lastTileCx || cy !== this.lastTileCy) {
      this.lastTileCx = cx;
      this.lastTileCy = cy;
    }

    this.syncDepth(this.localPlayer);
    for (const remote of this.remotePlayers.values()) {
      this.syncDepth(remote);
    }

    this.updateHud();
  }

  private bindKeyHandlers() {
    // O — toggle between your village and the shared open world. From the
    // shared house this also kicks you back out to the open world.
    this.hotkeys.O.on("down", () => {
      if (this.world.kind === "openworld") {
        gameSocket.enterWorld({ kind: "village", ownerPlayerId: getOrCreatePlayerId() });
      } else {
        gameSocket.enterWorld({ kind: "openworld" });
      }
    });
    // I — invite the nearest other player in the same world.
    this.hotkeys.I.on("down", () => this.inviteNearest());
    // Y / N — respond to the front of the invite queue.
    this.hotkeys.Y.on("down", () => this.respondToInvite(true));
    this.hotkeys.N.on("down", () => this.respondToInvite(false));
    // E — enter the house if standing on a door tile.
    this.hotkeys.E.on("down", () => {
      if (!this.localPlayer) return;
      const { cx, cy } = this.localPlayer;
      if (this.doorTiles.has(`${cx},${cy}`)) this.enterHouse(cx, cy);
    });
  }

  private rebuildDoorIndicators() {
    this.clearDoorIndicators();
    if (!this.mapDef) return;
    for (const d of this.mapDef.doors) {
      const { x, y } = cartToIso(d.cx, d.cy);
      const label = this.add
        .text(x + TILE_W / 2, y - 4, "E", {
          fontFamily: '"Press Start 2P"',
          fontSize: "8px",
          color: "#ffff66",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(9999)
        .setVisible(false);
      const bobTween = this.tweens.add({
        targets: label,
        y: y - 8,
        duration: 450,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });
      this.doorIndicators.push({ cx: d.cx, cy: d.cy, label, bobTween });
    }
  }

  private clearDoorIndicators() {
    for (const ind of this.doorIndicators) {
      ind.bobTween.stop();
      ind.label.destroy();
    }
    this.doorIndicators.length = 0;
  }

  private refreshDoorPrompt() {
    if (!this.localPlayer) return;
    const { cx, cy } = this.localPlayer;
    for (const ind of this.doorIndicators) {
      // Strict: only the door tile itself shows the prompt.
      const onIt = ind.cx === cx && ind.cy === cy;
      ind.label.setVisible(onIt);
    }
  }

  private enterHouse(doorCx: number, doorCy: number) {
    // In the open world, doors lead to the shared multiplayer house. Inside
    // the house, the same door tile takes you back out to the open world.
    if (this.world.kind === "openworld") {
      gameSocket.enterWorld({ kind: "house" });
      return;
    }
    if (this.world.kind === "house") {
      gameSocket.enterWorld({ kind: "openworld" });
      return;
    }
    // Private village: local single-player interior.
    for (const ind of this.doorIndicators) ind.label.setVisible(false);
    this.scene.pause();
    this.scene.launch("InteriorScene", { returnTo: { cx: doorCx, cy: doorCy } });
  }

  private syncDepth(player: Player) {
    player.setDepth(Math.floor(player.y / TILE_H) + 1.5);
  }

  // ── World construction ────────────────────────────────────────────

  private rebuildWorld(state: WorldState) {
    this.world = state.world;

    // Tear down existing scene objects so the new map can stamp cleanly.
    this.isoMap?.destroy();
    this.localPlayer?.destroy();
    this.localPlayer = undefined;
    for (const remote of this.remotePlayers.values()) remote.destroy();
    this.remotePlayers.clear();
    this.clearDoorIndicators();

    this.mapDef = state.world.kind === "house" ? makeHouseInterior() : generateMap(state.seed);
    this.isoMap = new IsoMap(this, this.mapDef);
    this.isoMap.build();
    this.rebuildDoorIndicators();

    const cam = this.cameras.main;
    cam.stopFollow();
    cam.centerOn(this.isoMap.centre.x, this.isoMap.centre.y);
    cam.setZoom(loadSettings().defaultZoom);
    cam.setBounds(
      this.isoMap.boundsX, this.isoMap.boundsY,
      this.isoMap.boundsW, this.isoMap.boundsH,
    );

    this.doorTiles.clear();
    for (const d of this.mapDef.doors) {
      this.doorTiles.add(`${d.cx},${d.cy}`);
    }

    const { cx, cy } = state.spawn;
    this.localPlayer = new Player(
      this,
      { id: gameSocket.id ?? "local", cx, cy, name: "You" },
      true,
      this.mapDef,
    );
    this.lastTileCx = cx;
    this.lastTileCy = cy;
    this.lastSentCx = -1;
    this.lastSentCy = -1;
    cam.startFollow(this.localPlayer, true, 0.08, 0.08);

    for (const peer of state.players) {
      this.spawnRemote(peer);
    }

    this.loadingText?.destroy();
    this.loadingText = undefined;
    this.refreshStatus();
  }

  private refreshStatus() {
    if (!this.statusText) return;
    let label: string;
    if (this.world.kind === "openworld") {
      label = "Open World  [O] village  [I] invite";
    } else if (this.world.kind === "house") {
      label = "Shared House  [E] on door to exit";
    } else if (this.world.ownerPlayerId === getOrCreatePlayerId()) {
      label = "Your Village  [O] open world";
    } else {
      label = "Visiting Village  [O] open world";
    }
    this.statusText.setText(label);
  }

  // ── Multiplayer ───────────────────────────────────────────────────

  private connectMultiplayer() {
    gameSocket.connect();

    gameSocket.on("init", ({ world }) => {
      this.rebuildWorld(world);
      // If the main menu asked for a specific world, request it now that the
      // server knows who we are. Skip if it already matches.
      const wanted = this.initialWorld;
      this.initialWorld = undefined;
      if (!wanted) return;
      const sameVillage =
        wanted.kind === "village" &&
        world.world.kind === "village" &&
        world.world.ownerPlayerId === wanted.ownerPlayerId;
      const sameOpen = wanted.kind === "openworld" && world.world.kind === "openworld";
      if (!sameVillage && !sameOpen) gameSocket.enterWorld(wanted);
    });
    gameSocket.on("world:state", (state) => this.rebuildWorld(state));

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

    gameSocket.on("invite:received", (info) => {
      this.inviteQueue.push(info);
      this.renderInvitePrompt();
    });
    gameSocket.on("invite:cancelled", ({ fromSocketId }) => {
      this.inviteQueue = this.inviteQueue.filter(i => i.fromSocketId !== fromSocketId);
      this.renderInvitePrompt();
    });
    gameSocket.on("invite:error", ({ reason }) => {
      this.flashStatus(`Invite error: ${reason}`);
    });
  }

  private spawnRemote(state: PlayerState) {
    if (state.id === gameSocket.id) return;
    if (this.remotePlayers.has(state.id)) return;
    if (!this.mapDef) return;
    const player = new Player(this, state, false, this.mapDef);
    this.remotePlayers.set(state.id, player);
  }

  // ── Invites ───────────────────────────────────────────────────────

  private inviteNearest() {
    if (!this.localPlayer) return;
    if (this.remotePlayers.size === 0) {
      this.flashStatus("No one nearby to invite");
      return;
    }
    let nearest: Player | undefined;
    let bestDist = Infinity;
    for (const r of this.remotePlayers.values()) {
      const dx = r.cx - this.localPlayer.cx;
      const dy = r.cy - this.localPlayer.cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; nearest = r; }
    }
    if (!nearest) return;
    gameSocket.sendInvite(nearest.playerId);
    this.flashStatus(`Invite sent to ${nearest.playerId.slice(0, 4)}`);
  }

  private respondToInvite(accept: boolean) {
    const next = this.inviteQueue.shift();
    if (!next) return;
    if (accept) gameSocket.acceptInvite(next.fromSocketId);
    else gameSocket.declineInvite(next.fromSocketId);
    this.renderInvitePrompt();
  }

  private renderInvitePrompt() {
    this.invitePromptText?.destroy();
    this.invitePromptText = undefined;
    const front = this.inviteQueue[0];
    if (!front) return;
    this.invitePromptText = this.add
      .text(
        this.scale.width / 2,
        24,
        `${front.fromName} invites you to their village  [Y] accept  [N] decline`,
        {
          fontFamily: '"Press Start 2P"',
          fontSize: "8px",
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 8, y: 6 },
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(1000);
  }

  private flashStatus(msg: string) {
    if (!this.statusText) return;
    this.statusText.setText(msg);
    this.time.delayedCall(1800, () => this.refreshStatus());
  }

  getLocalPlayer() {
    return this.localPlayer;
  }
}

// 12×11 pixel heart shape. Two colours (rim + fill) sell the chunky retro
// look without needing an actual sprite asset.
const HEART_PIXELS: { x: number; y: number }[] = (() => {
  const rows = [
    "0110011",
    "1111111",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000",
  ];
  const pts: { x: number; y: number }[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === "1") pts.push({ x: c, y: r });
    }
  }
  return pts;
})();

function drawHeart(g: Phaser.GameObjects.Graphics, filled: boolean) {
  const PX = 2;
  // shadow
  g.fillStyle(0x000000, 0.7);
  for (const { x, y } of HEART_PIXELS) g.fillRect(x * PX + 1, y * PX + 1, PX, PX);
  // body
  g.fillStyle(filled ? 0xcc2222 : 0x3a1212, 1);
  for (const { x, y } of HEART_PIXELS) g.fillRect(x * PX, y * PX, PX, PX);
  // highlight (top-left two rows of pixels)
  if (filled) {
    g.fillStyle(0xff8888, 1);
    for (const { x, y } of HEART_PIXELS) {
      if (y < 2) g.fillRect(x * PX, y * PX, PX, 1);
    }
  }
}
