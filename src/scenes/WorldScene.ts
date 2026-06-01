import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { Npc } from "../entities/Npc";
import type { PlayerState, WorldRef, WorldState } from "../types/network";
import type { MapDef } from "../types/map";
import { generateMap, generateVillage } from "../world/MapGen";
import { makeHouseInterior } from "../world/HouseMap";
import { gameSocket } from "../network/socket";
import { TILE_H, TILE_W, cartToIso, isoToCart } from "../utils/IsoUtils";
import { getShopItem } from "../shop/catalog";
import { FONT_EMOJI } from "../ui/theme";
import type { HouseObject } from "../types/network";
import {
  getAccountId,
  setAccountId,
  setAccountName,
  clearSession,
  getCharIndex,
  setCharIndex,
  getCustomSkin,
  setCustomSkin,
  clearCustomSkin,
} from "../network/playerIdentity";
import { loadSettings, getKeybinds } from "../data/Settings";
import { UIScene } from "./UIScene";
import { CURSORS, FONT } from "../ui/theme";
import { formatChatBubble } from "../ui/ChatBox";
import { playUiSound } from "../ui/UIKit";

export class WorldScene extends Phaser.Scene {
  private isoMap?: IsoMap;
  private localPlayer?: Player;
  private mapDef?: MapDef;
  private loadingText?: Phaser.GameObjects.Text;
  private connErrorText?: Phaser.GameObjects.Text;
  // Full-screen "loading" overlay shown while a world switch is in flight.
  private loadingOverlay?: Phaser.GameObjects.Rectangle;
  private loadingOverlayText?: Phaser.GameObjects.Text;
  // When the loading overlay was shown, so a fast world switch still lingers
  // long enough to read as a loading screen rather than an instant teleport.
  private loadingShownAt = 0;
  private static readonly MIN_LOADING_MS = 1000;
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
  // Held direction from the on-screen mobile D-pad (set by UIScene).
  private touchDir = { dx: 0, dy: 0 };
  // All dynamically-bound keys (movement + hotkeys), tracked so they can be
  // torn down and rebuilt when the player remaps controls in Settings.
  private controlKeys: Phaser.Input.Keyboard.Key[] = [];

  // Furniture placed in the shared house, keyed by object id.
  private houseObjects = new Map<number, Phaser.GameObjects.Text>();
  // Active furniture-placement mode (set from the inventory PLACE button):
  // the item id being placed, a ghost preview, and an on-screen hint.
  private placingItem?: string;
  private placeGhost?: Phaser.GameObjects.Text;
  private placeHint?: Phaser.GameObjects.Text;

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

  // World-switch portal: a drawn glowing pad, a bobbing "E" prompt, and a
  // clickable zone. `portalTile` is the tile players activate from; the
  // visuals are rebuilt on every world switch.
  private portalTile?: { cx: number; cy: number };
  private portalObjects: Phaser.GameObjects.GameObject[] = [];
  private portalLabel?: Phaser.GameObjects.Text;
  private portalTween?: Phaser.Tweens.Tween;

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
  // Our custom hand-drawn skin (encoded), or undefined when using the preset.
  private mySkin?: string;
  private myVerified = false;
  // Optional world to request right after connecting, set from the main menu.
  private initialWorld?: WorldRef;


  constructor() {
    super({ key: "WorldScene" });
  }

  init(data?: { initialWorld?: WorldRef }) {
    this.initialWorld = data?.initialWorld;
  }

  create() {
    this.input.on("wheel", (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
      const cam = this.cameras.main;
      // Min 3× so the player can't zoom out far enough to see past the map
      // edges / empty space; max 8× for a close look.
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, 3, 8));
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
    this.applyKeybinds();
    // Rebuild the keys whenever we come back from a paused state (e.g. the
    // player just remapped controls in the Settings overlay).
    this.events.on("resume", this.applyKeybinds, this);
    this.connectMultiplayer();

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.placingItem) {
        this.cancelPlacement();
        return;
      }
      if (this.ui?.isDialogueOpen) {
        this.ui.closeDialogue();
        return;
      }
      this.openPause();
    });

    // While in furniture-placement mode, a click drops the item on the
    // pointed-at tile (server validates ownership / walkability / overlap).
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.placingItem) return;
      const { worldX, worldY } = pointer;
      const { cx, cy } = isoToCart(worldX, worldY);
      gameSocket.placeHouseItem(this.placingItem, cx, cy);
      this.cancelPlacement();
    });

    // Keep the centred overlays (loading / connection error) glued to the
    // middle of the canvas when the window resizes or fullscreen toggles.
    this.scale.on("resize", this.onResize, this);

    this.events.once("shutdown", () => {
      this.clearDoorIndicators();
      this.clearPortal();
      this.hideLoadingOverlay();
      this.clearHouseObjects();
      this.cancelPlacement();
      this.clearNpcs();
      this.clearConnError();
      this.ui?.closeDialogue();
      this.scale.off("resize", this.onResize, this);
      this.events.off("resume", this.applyKeybinds, this);
      this.scene.stop("UIScene");
      this.ui = undefined;
      gameSocket.clearHandlers();
    });
  }

  // (Re)build every remappable key from the saved keybinds. Safe to call again
  // at any time — it tears down the previously-created keys first, so remapping
  // in Settings takes effect the moment the player returns to the game.
  private applyKeybinds() {
    const kb = this.input.keyboard;
    if (!kb) return;
    for (const key of this.controlKeys) kb.removeKey(key, true, true);
    this.controlKeys.length = 0;

    const b = getKeybinds();
    const k = (code: string) => {
      const key = kb.addKey(code, true); // capture so the page doesn't react
      this.controlKeys.push(key);
      return key;
    };

    // Movement: the bound keys fill the W/A/S/D slots; arrow keys stay on as
    // fixed alternates; the run key drives sprint via cursors.shift.
    this.cursors = {
      up: k("UP"), down: k("DOWN"), left: k("LEFT"), right: k("RIGHT"),
      space: k("SPACE"), shift: k(b.run),
    } as Phaser.Types.Input.Keyboard.CursorKeys;
    this.wasd = { W: k(b.up), A: k(b.left), S: k(b.down), D: k(b.right) };

    // Action hotkeys.
    k(b.interact).on("down", () => this.mobileInteract());
    k(b.invite).on("down", () => this.openInvitePanel());
    k(b.inbox).on("down", () => this.openInbox());
    k(b.bag).on("down", () => this.openInventory());

    // Chat opens on the bound key (Enter by default); T is always an alternate.
    const openChat = () => {
      if (this.ui && !this.ui.isChatOpen && !this.ui.isDialogueOpen) this.ui.openChat();
    };
    k(b.chat).on("down", openChat);
    if (b.chat !== "T") k("T").on("down", openChat);

    // Players list: hold to show (Minecraft-style).
    const players = k(b.players);
    players.on("down", () => {
      if (!this.ui?.isChatOpen && !this.ui?.isDialogueOpen) this.ui?.showPlayerList();
    });
    players.on("up", () => this.ui?.hidePlayerList());
  }

  // Recentre the full-screen overlays after a canvas resize. The world camera
  // follows the player and is resized by Phaser automatically under RESIZE.
  private onResize(gameSize: Phaser.Structs.Size) {
    const w = gameSize.width;
    const h = gameSize.height;
    this.loadingText?.setPosition(w / 2, h / 2);
    this.connErrorText?.setPosition(w / 2, h / 2);
    this.loadingOverlay?.setPosition(w / 2, h / 2).setSize(w, h);
    this.loadingOverlayText?.setPosition(w / 2, h / 2);
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
    if (!this.ui?.isDialogueOpen && !this.ui?.isChatOpen && !this.loadingOverlay) {
      this.localPlayer.handleInput(this.cursors, this.wasd, delta, this.touchDir);
    }

    const { cx, cy } = this.localPlayer;
    if (gameSocket.connected && (cx !== this.lastSentCx || cy !== this.lastSentCy)) {
      gameSocket.sendMove(cx, cy);
      this.lastSentCx = cx;
      this.lastSentCy = cy;
    }

    this.refreshDoorPrompt();
    this.refreshNpcPrompt();
    this.refreshPortalPrompt();
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

    // Snap the placement ghost to the tile under the cursor.
    if (this.placingItem && this.placeGhost) {
      const p = this.input.activePointer;
      const t = isoToCart(p.worldX, p.worldY);
      const w = cartToIso(t.cx, t.cy);
      this.placeGhost.setPosition(w.x + TILE_W / 2, w.y + TILE_H / 2).setDepth(t.cy + 1);
    }
  }

  // Held direction from the on-screen mobile D-pad (UIScene calls this).
  setTouchDir(dx: number, dy: number) {
    this.touchDir = { dx, dy };
  }

  // ── Admin chat commands (wired from UIScene) ──────────────────────
  // Local walk-speed multiplier (purely a movement feel — server doesn't
  // track speed, so this never desyncs other players).
  setSpeedMultiplier(mul: number) {
    this.localPlayer?.setSpeedMultiplier(mul);
  }

  // Teleport the local player to a tile and tell the server its new position.
  teleport(cx: number, cy: number): boolean {
    if (!this.localPlayer?.teleport(cx, cy)) return false;
    gameSocket.sendMove(this.localPlayer.cx, this.localPlayer.cy);
    return true;
  }

  // Flash the mic indicator above whoever just sent a voice clip (HUD relays
  // this on "player:voice").
  showSpeaking(id: string) {
    this.playerBySocketId(id)?.showSpeaking();
  }

  // The "E" interaction, exposed so the mobile action button can trigger it:
  // advance dialogue, talk to an adjacent NPC, enter a house door, or portal.
  mobileInteract() {
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
    if (this.doorTiles.has(`${cx},${cy}`)) {
      this.enterHouse(cx, cy);
      return;
    }
    if (this.isAdjacentToPortal(cx, cy)) this.usePortal();
  }

  // True when the player is on or 4-connected-adjacent to the portal tile.
  private isAdjacentToPortal(cx: number, cy: number): boolean {
    if (!this.portalTile) return false;
    const dx = Math.abs(this.portalTile.cx - cx);
    const dy = Math.abs(this.portalTile.cy - cy);
    return dx + dy <= 1;
  }

  // Activate the portal: open world → your village, anywhere else → open world.
  // Mirrors the destination logic the old O hotkey used. A loading overlay
  // covers the gap until the server streams back the new world.
  private usePortal() {
    if (this.world.kind === "openworld") {
      this.showLoadingOverlay("Entering your village…");
      gameSocket.enterWorld({ kind: "village", ownerPlayerId: getAccountId() });
    } else {
      this.showLoadingOverlay("Returning to the open world…");
      gameSocket.enterWorld({ kind: "openworld" });
    }
  }

  // Shared by the E key and clicking an NPC. Opens the shop for merchants,
  // otherwise a dialogue (server validates adjacency + grants any reward).
  private interactWithNpc(npc: Npc) {
    if (npc.def.shopId) {
      this.scene.launch("ShopScene", { from: "WorldScene" });
      return;
    }
    if (npc.def.panel === "projects") {
      this.scene.launch("ProjectsScene", { from: "WorldScene" });
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

  // Draw the world-switch portal: a glowing pad that pulses, plus a bobbing
  // "E" prompt and a clickable zone. Rebuilt on every world change.
  private rebuildPortal() {
    this.clearPortal();
    this.portalTile = this.mapDef?.portal;
    if (!this.portalTile) return;

    const { x, y } = cartToIso(this.portalTile.cx, this.portalTile.cy);
    const cx = x + TILE_W / 2;
    const cy = y + TILE_H / 2;
    const depth = this.portalTile.cy + 1;

    // Layered ellipses read as a glowing teleport pad even without art.
    const glow = this.add.ellipse(cx, cy, TILE_W * 1.6, TILE_H * 1.0, 0x66ccff, 0.25).setDepth(depth);
    const ring = this.add.ellipse(cx, cy, TILE_W * 1.1, TILE_H * 0.7, 0xaa66ff, 0.5).setDepth(depth);
    const core = this.add.ellipse(cx, cy, TILE_W * 0.6, TILE_H * 0.4, 0xffffff, 0.85).setDepth(depth);
    this.portalObjects.push(glow, ring, core);
    this.portalTween = this.tweens.add({
      targets: [glow, ring],
      scaleX: 1.25,
      scaleY: 1.25,
      alpha: { from: 0.6, to: 0.2 },
      duration: 900,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    this.portalLabel = this.add
      .text(cx, y - 4, "E", {
        fontFamily: FONT,
        fontSize: "8px",
        color: "#ffff66",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999)
      .setVisible(false);

    const zone = this.add
      .zone(cx, cy, TILE_W, TILE_H)
      .setInteractive({ cursor: CURSORS.pointer });
    zone.on("pointerdown", () => {
      if (!this.localPlayer) return;
      if (this.ui?.isChatOpen || this.ui?.isDialogueOpen) return;
      if (!this.isAdjacentToPortal(this.localPlayer.cx, this.localPlayer.cy)) {
        this.flashStatus("Walk to the portal first");
        return;
      }
      this.usePortal();
    });
    this.portalObjects.push(zone);
  }

  private clearPortal() {
    this.portalTween?.stop();
    this.portalTween = undefined;
    this.portalLabel?.destroy();
    this.portalLabel = undefined;
    for (const o of this.portalObjects) o.destroy();
    this.portalObjects.length = 0;
    this.portalTile = undefined;
  }

  private refreshPortalPrompt() {
    if (!this.portalLabel || !this.localPlayer) return;
    const visible =
      !this.ui?.isDialogueOpen &&
      this.isAdjacentToPortal(this.localPlayer.cx, this.localPlayer.cy);
    this.portalLabel.setVisible(visible);
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
    // Private village: local single-player interior. Carry the player's
    // appearance in so their avatar matches the one shown outside.
    for (const ind of this.doorIndicators) ind.label.setVisible(false);
    this.scene.pause();
    this.scene.launch("InteriorScene", {
      returnTo: { cx: doorCx, cy: doorCy },
      char: this.myChar,
      skin: this.mySkin,
      verified: this.myVerified,
    });
  }

  private syncDepth(player: Player) {
    // setDepth re-queues a full display-list depth-sort, so only call it when
    // the depth actually changes (once per tile-row, not every frame) —
    // otherwise the hundreds of static tile objects get re-sorted 60x/sec.
    const d = Math.floor(player.y / TILE_H) + 1.5;
    if (player.depth !== d) player.setDepth(d);
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
    this.clearPortal();
    this.clearHouseObjects();
    this.cancelPlacement();

    this.mapDef =
      state.world.kind === "house"
        ? makeHouseInterior()
        : state.world.kind === "village"
          ? // Private villages use a single fixed hand-authored layout (the
            // seed is ignored — see generateVillage).
            generateVillage()
          : generateMap(state.seed, {
              houses: false,
              // The open world gets a single house whose door leads into the
              // shared multiplayer house.
              sharedHouse: true,
              // Portal back/forth: near spawn in the open world.
              portal: "spawn",
            });
    this.isoMap = new IsoMap(this, this.mapDef);
    this.isoMap.build();
    this.rebuildDoorIndicators();
    this.rebuildPortal();
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
      { id: gameSocket.id ?? "local", cx, cy, name: "You", char: this.myChar, skin: this.mySkin, verified: this.myVerified },
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
    this.scheduleHideLoadingOverlay();
    this.refreshStatus();
  }

  // Full-screen dim + message shown while a portal world switch is in flight,
  // torn down once the new world finishes building (see rebuildWorld).
  private showLoadingOverlay(message: string) {
    if (!this.loadingOverlay) {
      this.loadingOverlay = this.add
        .rectangle(
          this.scale.width / 2,
          this.scale.height / 2,
          this.scale.width,
          this.scale.height,
          0x000000,
          0.7,
        )
        .setScrollFactor(0)
        .setDepth(100001);
    }
    if (!this.loadingOverlayText) {
      this.loadingOverlayText = this.add
        .text(this.scale.width / 2, this.scale.height / 2, "", {
          fontFamily: FONT,
          fontSize: "12px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(100002);
    }
    this.loadingOverlayText.setText(message);
    this.loadingShownAt = this.time.now;
  }

  // Hide the overlay, but keep it up for at least MIN_LOADING_MS so a fast
  // (effectively instant) world build still shows a loading screen. The new
  // world is already built behind it — we're just holding the curtain.
  private scheduleHideLoadingOverlay() {
    if (!this.loadingOverlay) return;
    const remaining = WorldScene.MIN_LOADING_MS - (this.time.now - this.loadingShownAt);
    if (remaining <= 0) {
      this.hideLoadingOverlay();
      return;
    }
    this.time.delayedCall(remaining, () => this.hideLoadingOverlay());
  }

  private hideLoadingOverlay() {
    this.loadingOverlay?.destroy();
    this.loadingOverlay = undefined;
    this.loadingOverlayText?.destroy();
    this.loadingOverlayText = undefined;
  }

  private refreshStatus() {
    if (!this.ui) return;
    let label: string;
    if (this.world.kind === "openworld") {
      label = "Open World  [E] house/portal  [N] inbox  [Tab] players";
    } else if (this.world.kind === "house") {
      label = "Shared House  walk through the doorway to exit  [Tab] players";
    } else if (this.world.ownerPlayerId === getAccountId()) {
      label = "Your Village  [E] portal  [Tab] players";
    } else {
      label = "Visiting Village  [E] portal  [Tab] players";
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

    gameSocket.on("init", ({ accountId, name, char, skin, verified, role, world, pixels, unread, dayCycle }) => {
      setAccountId(accountId);
      setAccountName(name);
      this.myVerified = verified;
      this.ui?.setAdminRole(role);
      // Reconcile appearance with the server's stored one. A locally-drawn
      // custom skin wins (push it); otherwise adopt the server's skin if it has
      // one; otherwise fall back to preset reconciliation.
      const localSkin = getCustomSkin();
      this.myChar = char;
      if (localSkin && localSkin !== skin) {
        this.mySkin = localSkin;
        gameSocket.setSkin(localSkin);
      } else if (skin) {
        this.mySkin = skin;
        setCustomSkin(skin);
      } else {
        this.mySkin = undefined;
        clearCustomSkin();
        const pref = getCharIndex();
        if (pref >= 0 && pref !== char) {
          this.myChar = pref;
          gameSocket.setCharacter(pref);
        } else {
          setCharIndex(char);
        }
      }
      this.ui?.setWallet(pixels, 0);
      this.ui?.setUnread(unread);
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

    // A notification arrived live — bump the inbox badge and toast it.
    gameSocket.on("notify:new", ({ item, unread }) => {
      this.ui?.setUnread(unread);
      this.flashStatus(item.message ?? "New notification  [N] inbox");
      playUiSound(this, "sfx-switch", 0.3);
    });
    gameSocket.on("invite:sent", ({ toName }) => {
      this.flashStatus(`Invite sent to ${toName}`);
    });
    gameSocket.on("invite:error", ({ reason }) => {
      const human: Record<string, string> = {
        already_invited: "You already invited them",
        invalid_target: "Can't invite that player",
        no_invite: "You need an invite to enter that village",
      };
      this.flashStatus(human[reason] ?? `Invite error: ${reason}`);
    });

    gameSocket.on("chat:message", (msg) => {
      this.ui?.addChatMessage(msg);
      this.playerBySocketId(msg.id)?.showBubble(formatChatBubble(msg.text), "chat");
    });

    gameSocket.on("player:emote", ({ id, emote }) => {
      this.playerBySocketId(id)?.showBubble(emote, "emote");
      if (id !== gameSocket.id) playUiSound(this, "sfx-switch", 0.25);
    });

    gameSocket.on("player:appearance", ({ id, char, skin }) => {
      this.playerBySocketId(id)?.setAppearance(char, skin);
      if (id === gameSocket.id) {
        this.myChar = char;
        this.mySkin = skin;
      }
    });

    gameSocket.on("world:denied", ({ reason }) => {
      this.flashStatus(reason);
    });

    // Moderation notices (muted / unmuted / role changed) — show as a toast,
    // and keep the admin button in sync if our own role just changed.
    gameSocket.on("mod:notice", ({ text }) => {
      this.flashStatus(text);
      if (/sub-admin|moderator role/i.test(text)) {
        this.ui?.setAdminRole(/now a sub-admin/i.test(text) ? "subadmin" : null);
      }
    });

    // Shared-house furniture.
    gameSocket.on("house:objects", ({ objects }) => {
      this.clearHouseObjects();
      for (const obj of objects) this.renderHouseObject(obj);
    });
    gameSocket.on("house:object:added", ({ object }) => this.renderHouseObject(object));
    gameSocket.on("house:object:removed", ({ id }) => {
      this.houseObjects.get(id)?.destroy();
      this.houseObjects.delete(id);
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

  // ── Invites / inbox ────────────────────────────────────────────────

  // Open the searchable invite panel (launched from the HUD button).
  openInvitePanel() {
    if (this.scene.isActive("InvitePanelScene")) return;
    this.scene.launch("InvitePanelScene", { from: "WorldScene" });
  }

  // Open the notifications inbox (N key, or the HUD bell).
  openInbox() {
    if (this.scene.isActive("InboxScene")) return;
    this.scene.launch("InboxScene", { from: "WorldScene" });
  }

  // Open the inventory bag (B key, or the HUD button).
  openInventory() {
    if (this.scene.isActive("InventoryScene")) return;
    this.scene.launch("InventoryScene", { from: "WorldScene" });
  }

  isInHouse(): boolean {
    return this.world.kind === "house";
  }

  // ── House furniture ────────────────────────────────────────────────

  // Enter placement mode for a placeable item: a ghost glyph follows the
  // cursor until the player clicks a tile (handled in create's pointerdown).
  beginPlacement(itemId: string) {
    if (this.world.kind !== "house") return;
    const item = getShopItem(itemId);
    if (!item?.placeable) return;
    this.cancelPlacement();
    this.placingItem = itemId;
    this.placeGhost = this.add
      .text(0, 0, item.glyph, { fontFamily: FONT_EMOJI, fontSize: "16px" })
      .setOrigin(0.5)
      .setAlpha(0.6)
      .setDepth(99998);
    this.placeHint = this.add
      .text(this.scale.width / 2, 40, `Placing ${item.name} — click a tile  •  ESC to cancel`, {
        fontFamily: FONT,
        fontSize: "9px",
        color: "#ffffff",
        backgroundColor: "#000000aa",
        padding: { x: 8, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(99999);
  }

  private cancelPlacement() {
    this.placingItem = undefined;
    this.placeGhost?.destroy();
    this.placeGhost = undefined;
    this.placeHint?.destroy();
    this.placeHint = undefined;
  }

  private renderHouseObject(obj: HouseObject) {
    const item = getShopItem(obj.itemId);
    if (!item) return;
    this.houseObjects.get(obj.id)?.destroy();
    const { x, y } = cartToIso(obj.cx, obj.cy);
    const glyph = this.add
      .text(x + TILE_W / 2, y + TILE_H / 2, item.glyph, {
        fontFamily: FONT_EMOJI,
        fontSize: "16px",
      })
      .setOrigin(0.5, 0.6)
      .setDepth(obj.cy + 1);
    // Only the placer can pick it back up (server enforces this too).
    if (obj.placedBy === getAccountId()) {
      glyph.setInteractive({ cursor: CURSORS.pointer });
      glyph.on("pointerdown", (p: Phaser.Input.Pointer) => {
        if (this.placingItem) return; // placing takes priority
        p.event.stopPropagation();
        gameSocket.removeHouseItem(obj.id);
      });
    }
    this.houseObjects.set(obj.id, glyph);
  }

  private clearHouseObjects() {
    for (const g of this.houseObjects.values()) g.destroy();
    this.houseObjects.clear();
  }

  private flashStatus(msg: string) {
    this.ui?.setStatus(msg);
    this.time.delayedCall(1800, () => this.refreshStatus());
  }

  getLocalPlayer() {
    return this.localPlayer;
  }
}
