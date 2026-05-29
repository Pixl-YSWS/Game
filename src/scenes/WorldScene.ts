import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { Npc } from "../entities/Npc";
import type { PlayerState, WorldRef, WorldState, InviteInfo } from "../types/network";
import type { MapDef } from "../types/map";
import { generateMap } from "../world/MapGen";
import { makeHouseInterior } from "../world/HouseMap";
import { gameSocket } from "../network/socket";
import { TILE_H, TILE_W, cartToIso } from "../utils/IsoUtils";
import {
  getAccountId,
  setAccountId,
  setAccountName,
  clearSession,
  getCharIndex,
  setCharIndex,
} from "../network/playerIdentity";
import { loadSettings } from "../data/Settings";
import { UIScene } from "./UIScene";
import { CURSORS, FONT } from "../ui/theme";
import { emoteGlyph } from "../ui/emotes";
import { formatChatBubble } from "../ui/ChatBox";
import { playUiSound } from "../ui/UIKit";

export class WorldScene extends Phaser.Scene {
  private isoMap?: IsoMap;
  private localPlayer?: Player;
  private mapDef?: MapDef;
  private loadingText?: Phaser.GameObjects.Text;
  private connErrorText?: Phaser.GameObjects.Text;
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
  // Transparent click targets over each door tile (mouse + hand cursor).
  private doorZones: Phaser.GameObjects.Zone[] = [];

  private npcs: Npc[] = [];
  // Same shape as door indicators, but anchored above each NPC and shown
  // when the player is on an adjacent tile.
  private npcIndicators: {
    cx: number;
    cy: number;
    label: Phaser.GameObjects.Text;
    bobTween: Phaser.Tweens.Tween;
  }[] = [];
  // HUD + dialogue both live in a separate UI scene running on top of this
  // one so they aren't subject to the world camera's zoom.
  private ui?: UIScene;

  // Currently displayed world (set by server).
  private world: WorldRef = { kind: "village", ownerPlayerId: getAccountId() };
  // Our own appearance, from the server `init` (used when (re)building the
  // local avatar on every world switch).
  private myChar = 0;
  private myVerified = false;
  // Optional world to request right after connecting, set from the main menu.
  private initialWorld?: WorldRef;

  // Pending invites awaiting our Y/N answer.
  private inviteQueue: InviteInfo[] = [];
  private invitePromptText?: Phaser.GameObjects.Text;

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
      .text(this.scale.width / 2, this.scale.height / 2, "Connecting to server...", {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    if (!this.scene.isActive("UIScene")) {
      this.scene.launch("UIScene");
    }
    this.ui = this.scene.get("UIScene") as UIScene;
    this.bindKeyHandlers();
    this.connectMultiplayer();

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.ui?.isDialogueOpen) {
        this.ui.closeDialogue();
        return;
      }
      this.openPause();
    });

    // Enter / T open the chat input. While it's open the DOM input swallows
    // keystrokes (see ChatBox), so these only fire when chat is closed.
    const openChat = () => {
      if (this.ui && !this.ui.isChatOpen && !this.ui.isDialogueOpen) {
        this.ui.openChat();
      }
    };
    this.input.keyboard!.on("keydown-ENTER", openChat);
    this.input.keyboard!.on("keydown-T", openChat);

    this.events.once("shutdown", () => {
      this.clearDoorIndicators();
      this.clearNpcs();
      this.clearConnError();
      this.ui?.closeDialogue();
      this.scene.stop("UIScene");
      this.ui = undefined;
      gameSocket.clearHandlers();
    });
  }

  private openPause() {
    if (this.scene.isActive("PauseScene")) return;
    this.scene.pause();
    this.scene.launch("PauseScene", { pausedSceneKey: "WorldScene" });
  }

  // Tear down gameplay and bounce back to the login screen. `clear` wipes the
  // stored session (use for an expired/invalid token; skip when the token may
  // still be valid, e.g. a kick from another device).
  private returnToLogin(message: string, clear = true) {
    if (clear) clearSession();
    gameSocket.disconnect();
    this.scene.stop("UIScene");
    this.scene.stop("ShopScene");
    this.scene.stop("PauseScene");
    this.scene.start("LoginScene", { message });
  }

  // Centre-screen overlay shown when the connection drops or never lands, so
  // a dead server gives the player a clear message instead of a silent hang.
  private showConnError(message: string) {
    this.loadingText?.destroy();
    this.loadingText = undefined;
    if (!this.connErrorText) {
      this.connErrorText = this.add
        .text(this.scale.width / 2, this.scale.height / 2, "", {
          fontFamily: FONT,
          fontSize: "12px",
          color: "#ff6666",
          align: "center",
          lineSpacing: 8,
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(100000);
    }
    this.connErrorText.setText(message);
  }

  private clearConnError() {
    this.connErrorText?.destroy();
    this.connErrorText = undefined;
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer) return;

    // Movement is locked while a dialogue line or the chat input is open —
    // feeds inputs into a no-op so any held key gets cleared rather than queued.
    if (!this.ui?.isDialogueOpen && !this.ui?.isChatOpen) {
      this.localPlayer.handleInput(this.cursors, this.wasd, delta);
    }

    const { cx, cy } = this.localPlayer;
    if (gameSocket.connected && (cx !== this.lastSentCx || cy !== this.lastSentCy)) {
      gameSocket.sendMove(cx, cy);
      this.lastSentCx = cx;
      this.lastSentCy = cy;
    }

    this.refreshDoorPrompt();
    this.refreshNpcPrompt();
    if (cx !== this.lastTileCx || cy !== this.lastTileCy) {
      this.lastTileCx = cx;
      this.lastTileCy = cy;
      // Inside the shared house, stepping onto the doorway exits to the
      // open world automatically — no E press needed.
      if (this.world.kind === "house" && this.doorTiles.has(`${cx},${cy}`)) {
        gameSocket.enterWorld({ kind: "openworld" });
      }
    }

    this.syncDepth(this.localPlayer);
    for (const remote of this.remotePlayers.values()) {
      this.syncDepth(remote);
    }

    this.ui?.setCoords(cx, cy);
  }

  private bindKeyHandlers() {
    // O — toggle between your village and the shared open world. From the
    // shared house this also kicks you back out to the open world.
    this.hotkeys.O.on("down", () => {
      if (this.world.kind === "openworld") {
        gameSocket.enterWorld({ kind: "village", ownerPlayerId: getAccountId() });
      } else {
        gameSocket.enterWorld({ kind: "openworld" });
      }
    });
    // I — invite the nearest other player in the same world.
    this.hotkeys.I.on("down", () => this.inviteNearest());
    // Y / N — respond to the front of the invite queue.
    this.hotkeys.Y.on("down", () => this.respondToInvite(true));
    this.hotkeys.N.on("down", () => this.respondToInvite(false));
    // E — advance dialogue, talk to an adjacent NPC, or enter a house door.
    this.hotkeys.E.on("down", () => {
      if (!this.localPlayer) return;
      if (this.ui?.isDialogueOpen) {
        this.ui.advanceDialogue();
        return;
      }
      const npc = this.adjacentNpc();
      if (npc) {
        this.interactWithNpc(npc);
        return;
      }
      const { cx, cy } = this.localPlayer;
      if (this.doorTiles.has(`${cx},${cy}`)) this.enterHouse(cx, cy);
    });
  }

  // Shared by the E key and clicking an NPC. Opens the shop for merchants,
  // otherwise a dialogue (server validates adjacency + grants any reward).
  private interactWithNpc(npc: Npc) {
    if (npc.def.shopId) {
      this.scene.launch("ShopScene", { from: "WorldScene" });
      return;
    }
    this.ui?.openDialogue(npc.def.name, npc.def.dialogue);
    gameSocket.npcInteract(npc.def.id);
  }

  // Click handler wired up on each NPC. Talking requires adjacency, matching
  // the E-key behaviour and the server-side reward check.
  private onNpcClick(npc: Npc) {
    if (!this.localPlayer) return;
    if (this.ui?.isChatOpen || this.ui?.isDialogueOpen) return;
    const dx = Math.abs(npc.def.cx - this.localPlayer.cx);
    const dy = Math.abs(npc.def.cy - this.localPlayer.cy);
    if (dx + dy > 1) {
      this.flashStatus("Walk closer to talk");
      return;
    }
    this.interactWithNpc(npc);
  }

  private adjacentNpc(): Npc | undefined {
    if (!this.localPlayer) return undefined;
    const { cx, cy } = this.localPlayer;
    for (const npc of this.npcs) {
      const dx = Math.abs(npc.def.cx - cx);
      const dy = Math.abs(npc.def.cy - cy);
      // 4-connected adjacency, including standing on the same tile.
      if (dx + dy <= 1) return npc;
    }
    return undefined;
  }

  private rebuildDoorIndicators() {
    this.clearDoorIndicators();
    if (!this.mapDef) return;

    // Clickable zone on every door tile (enter from outside, exit the house),
    // so the door works with the mouse + hand cursor as well as the E key.
    for (const d of this.mapDef.doors) {
      const { x, y } = cartToIso(d.cx, d.cy);
      const zone = this.add
        .zone(x + TILE_W / 2, y + TILE_H / 2, TILE_W, TILE_H)
        .setInteractive({ cursor: CURSORS.pointer });
      zone.on("pointerdown", () => this.onDoorClick(d.cx, d.cy));
      this.doorZones.push(zone);
    }

    // Inside the shared house, exit is automatic on stepping through the
    // doorway — no "E" prompt needed.
    if (this.world.kind === "house") return;
    for (const d of this.mapDef.doors) {
      const { x, y } = cartToIso(d.cx, d.cy);
      const label = this.add
        .text(x + TILE_W / 2, y - 4, "E", {
          fontFamily: FONT,
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
    for (const z of this.doorZones) z.destroy();
    this.doorZones.length = 0;
  }

  // Click handler for door zones. Requires the player to be on/next to the
  // door, then runs the same enter/exit logic as the E key.
  private onDoorClick(cx: number, cy: number) {
    if (!this.localPlayer) return;
    if (this.ui?.isChatOpen || this.ui?.isDialogueOpen) return;
    const dx = Math.abs(cx - this.localPlayer.cx);
    const dy = Math.abs(cy - this.localPlayer.cy);
    if (dx + dy > 1) {
      this.flashStatus("Walk to the door first");
      return;
    }
    this.enterHouse(cx, cy);
  }

  private rebuildNpcs() {
    this.clearNpcs();
    if (!this.mapDef) return;
    for (const def of this.mapDef.npcs) {
      const npc = new Npc(this, def);
      npc.on("pointerdown", () => this.onNpcClick(npc));
      this.npcs.push(npc);
      const { x, y } = cartToIso(def.cx, def.cy);
      const label = this.add
        .text(x + TILE_W / 2, y - TILE_H, "E", {
          fontFamily: FONT,
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
        y: y - TILE_H - 4,
        duration: 450,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });
      this.npcIndicators.push({ cx: def.cx, cy: def.cy, label, bobTween });
    }
  }

  private clearNpcs() {
    for (const ind of this.npcIndicators) {
      ind.bobTween.stop();
      ind.label.destroy();
    }
    this.npcIndicators.length = 0;
    for (const n of this.npcs) n.destroy();
    this.npcs.length = 0;
  }

  private refreshNpcPrompt() {
    if (!this.localPlayer) return;
    if (this.ui?.isDialogueOpen) {
      for (const ind of this.npcIndicators) ind.label.setVisible(false);
      return;
    }
    const { cx, cy } = this.localPlayer;
    for (const ind of this.npcIndicators) {
      const dx = Math.abs(ind.cx - cx);
      const dy = Math.abs(ind.cy - cy);
      ind.label.setVisible(dx + dy <= 1);
    }
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

    this.mapDef =
      state.world.kind === "house"
        ? makeHouseInterior()
        : generateMap(state.seed, {
            houses: state.world.kind !== "openworld",
            // The open world gets a single house whose door leads into the
            // shared multiplayer house.
            sharedHouse: state.world.kind === "openworld",
          });
    this.isoMap = new IsoMap(this, this.mapDef);
    this.isoMap.build();
    this.rebuildDoorIndicators();
    this.rebuildNpcs();
    this.ui?.closeDialogue();

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
      { id: gameSocket.id ?? "local", cx, cy, name: "You", char: this.myChar, verified: this.myVerified },
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
    if (!this.ui) return;
    let label: string;
    if (this.world.kind === "openworld") {
      label = "Open World  [E] house  [O] village  [I] invite";
    } else if (this.world.kind === "house") {
      label = "Shared House  walk through the doorway to exit";
    } else if (this.world.ownerPlayerId === getAccountId()) {
      label = "Your Village  [O] open world  [Shift] run";
    } else {
      label = "Visiting Village  [O] open world  [Shift] run";
    }
    this.ui.setStatus(label);
  }

  // ── Multiplayer ───────────────────────────────────────────────────

  private connectMultiplayer() {
    gameSocket.connect();

    gameSocket.onStatus((status, detail) => {
      switch (status) {
        case "connected":
          this.clearConnError();
          break;
        case "offline":
          // Retries exhausted — the server is almost certainly not running.
          this.showConnError(
            "Can't reach the game server.\n\nStart it with:\nbun run server/index.ts\n\nthen reload this page.",
          );
          break;
        case "disconnected":
          // Lost an established connection; socket.io is auto-retrying.
          this.showConnError(
            `Disconnected from server${detail ? ` (${detail})` : ""}.\nReconnecting…`,
          );
          break;
        case "unauthorized":
          // Session token rejected — force a re-login.
          this.returnToLogin("Your session has expired. Please log in again.");
          break;
      }
    });

    // The server kicks older sockets when the same account logs in elsewhere.
    gameSocket.on("auth:kicked", () => {
      this.returnToLogin("This account was opened somewhere else.", false);
    });

    gameSocket.on("init", ({ accountId, name, char, verified, world, pixels, dayCycle }) => {
      setAccountId(accountId);
      setAccountName(name);
      this.myVerified = verified;
      // Reconcile any locally-chosen skin with the server's stored one: if the
      // player picked one before connecting, push it; otherwise adopt theirs.
      const pref = getCharIndex();
      if (pref >= 0 && pref !== char) {
        this.myChar = pref;
        gameSocket.setCharacter(pref);
      } else {
        this.myChar = char;
        setCharIndex(char);
      }
      this.ui?.setWallet(pixels, 0);
      this.ui?.setDayCycle(dayCycle.tNow, dayCycle.dayLengthMs, dayCycle.serverNow);
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

    gameSocket.on("wallet:update", ({ pixels, delta }) => {
      this.ui?.setWallet(pixels, delta);
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

    gameSocket.on("chat:message", (msg) => {
      this.ui?.addChatMessage(msg);
      this.playerBySocketId(msg.id)?.showBubble(formatChatBubble(msg.text), "chat");
    });

    gameSocket.on("player:emote", ({ id, emote }) => {
      this.playerBySocketId(id)?.showBubble(emoteGlyph(emote), "emote");
      if (id !== gameSocket.id) playUiSound(this, "sfx-switch", 0.25);
    });

    gameSocket.on("player:appearance", ({ id, char }) => {
      this.playerBySocketId(id)?.setCharacter(char);
      if (id === gameSocket.id) this.myChar = char;
    });

    gameSocket.on("world:denied", ({ reason }) => {
      this.flashStatus(reason);
    });
  }

  // Resolve a socket id to its on-screen avatar (local player or a remote).
  private playerBySocketId(id: string): Player | undefined {
    if (id === gameSocket.id) return this.localPlayer;
    return this.remotePlayers.get(id);
  }

  private spawnRemote(state: PlayerState) {
    if (state.id === gameSocket.id) return;
    if (this.remotePlayers.has(state.id)) return;
    if (!this.mapDef) return;
    const player = new Player(this, state, false, this.mapDef);
    // Click a nearby player to wave at them.
    player.makeClickable(CURSORS.pointer, () => {
      if (!this.localPlayer) return;
      const dx = Math.abs(player.cx - this.localPlayer.cx);
      const dy = Math.abs(player.cy - this.localPlayer.cy);
      if (dx + dy > 4) {
        this.flashStatus("Too far away to wave");
        return;
      }
      gameSocket.sendEmote("wave");
    });
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
          fontFamily: FONT,
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
    this.ui?.setStatus(msg);
    this.time.delayedCall(1800, () => this.refreshStatus());
  }

  getLocalPlayer() {
    return this.localPlayer;
  }
}
