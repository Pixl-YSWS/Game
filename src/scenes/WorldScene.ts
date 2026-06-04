import Phaser from "phaser";
import { IsoMap } from "../world/IsoMap";
import { Player } from "../entities/Player";
import { Npc } from "../entities/Npc";
import { Animal } from "../entities/Animal";
import { Shark } from "../entities/Shark";
import type {
  PlayerState,
  WorldRef,
  WorldState,
  MapEdit,
  NpcEdit,
} from "../types/network";
import type { MapDef, MapObject, NpcDef } from "../types/map";
import { generateMap, generateVillage } from "../world/MapGen";
import { makeHouseInterior } from "../world/HouseMap";
import { TS } from "../world/tileset";
import {
  applyMapOverrides,
  applyNpcEdits,
  editKey,
  type EditLayer,
} from "../world/mapOverrides";
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

  private ocean?: Phaser.GameObjects.TileSprite;
  private oceanTimer?: Phaser.Time.TimerEvent;
  private localPlayer?: Player;
  private mapDef?: MapDef;
  private loadingText?: Phaser.GameObjects.Text;
  private connErrorText?: Phaser.GameObjects.Text;

  private loadingOverlay?: Phaser.GameObjects.Rectangle;
  private loadingOverlayText?: Phaser.GameObjects.Text;

  private loadingShownAt = 0;
  private static readonly MIN_LOADING_MS = 1000;
  private remotePlayers = new Map<string, Player>();
  private lastSentCx = -1;
  private lastSentCy = -1;

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

  private touchDir = { dx: 0, dy: 0 };

  private controlKeys: Phaser.Input.Keyboard.Key[] = [];

  private houseObjects = new Map<number, Phaser.GameObjects.Text>();

  private placingItem?: string;
  private placeGhost?: Phaser.GameObjects.Text;
  private placeHint?: Phaser.GameObjects.Text;

  // ── Admin map editor state ──
  // Committed server overrides for the current world, the pristine
  // seed-generated layers (so edits can be recomputed/undone), and the
  // admin's uncommitted brush strokes.
  private overrides: MapEdit[] = [];
  private baseGround?: number[][];
  private baseDeco?: number[][];
  private editMode = false;
  private editBrush?: { layer: EditLayer; tile: number };
  private editNpcTool?: "add" | "move" | "remove";
  private pendingEdits = new Map<string, MapEdit>();
  private lastPaintKey?: string;
  private awaitingOverrideEcho = false;
  private editorBlockRect?: Phaser.Geom.Rectangle;
  private repaintQueued = false;

  // NPC editing
  private npcEdits: NpcEdit[] = [];
  private baseNpcs: NpcDef[] = [];
  private pendingNpcEdits: NpcEdit[] = [];
  private pickedNpcId?: string;

  private doorIndicators: {
    cx: number;
    cy: number;
    label: Phaser.GameObjects.Text;
    bobTween: Phaser.Tweens.Tween;
  }[] = [];

  private doorZones: Phaser.GameObjects.Zone[] = [];

  private portalTile?: { cx: number; cy: number };
  private portalObjects: Phaser.GameObjects.GameObject[] = [];
  private portalLabel?: Phaser.GameObjects.Text;
  private portalTween?: Phaser.Tweens.Tween;

  private animals: Animal[] = [];
  private sharks: Shark[] = [];

  private npcs: Npc[] = [];

  private npcIndicators: {
    cx: number;
    cy: number;
    label: Phaser.GameObjects.Text;
    bobTween: Phaser.Tweens.Tween;
  }[] = [];

  private ui?: UIScene;

  private world: WorldRef = { kind: "village", ownerPlayerId: getAccountId() };

  private myChar = 0;

  private mySkin?: string;
  private myVerified = false;

  private initialWorld?: WorldRef;

  constructor() {
    super({ key: "WorldScene" });
  }

  init(data?: { initialWorld?: WorldRef }) {
    this.initialWorld = data?.initialWorld;
  }

  create() {
    this.input.on(
      "wheel",
      (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
        if (deltaY === 0) return;
        const cam = this.cameras.main;

        const next = Math.round(cam.zoom) + (deltaY > 0 ? -1 : 1);
        cam.setZoom(Phaser.Math.Clamp(next, 2, 8));
      },
    );

    this.loadingText = this.add
      .text(
        this.scale.width / 2,
        this.scale.height / 2,
        "Connecting to server...",
        {
          fontFamily: FONT,
          fontSize: "12px",
          color: "#ffffff",
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0);

    if (!this.scene.isActive("UIScene")) {
      this.scene.launch("UIScene");
    }
    this.ui = this.scene.get("UIScene") as UIScene;
    this.applyKeybinds();

    this.events.on("resume", this.applyKeybinds, this);
    this.connectMultiplayer();

    this.input.keyboard!.on("keydown-ESC", () => {
      // While the map editor is open it owns ESC (to close itself).
      if (this.editMode) return;
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

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.editMode && this.editBrush) {
        this.lastPaintKey = undefined;
        this.paintAt(pointer);
        return;
      }
      if (this.editMode && this.editNpcTool) {
        this.handleNpcClick(pointer);
        return;
      }
      if (!this.placingItem) return;
      const { worldX, worldY } = pointer;
      const { cx, cy } = isoToCart(worldX, worldY);
      gameSocket.placeHouseItem(this.placingItem, cx, cy);
      this.cancelPlacement();
    });

    // Drag-painting in map-editor mode.
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.editMode && this.editBrush && pointer.isDown)
        this.paintAt(pointer);
    });
    this.input.on("pointerup", () => {
      this.lastPaintKey = undefined;
    });

    this.scale.on("resize", this.onResize, this);

    this.events.once("shutdown", () => {
      this.oceanTimer?.remove(false);
      this.oceanTimer = undefined;
      this.clearDoorIndicators();
      this.clearPortal();
      this.hideLoadingOverlay();
      this.clearHouseObjects();
      this.cancelPlacement();
      this.clearNpcs();
      this.clearAnimals();
      this.clearSharks();
      this.clearConnError();
      this.ui?.closeDialogue();
      this.scale.off("resize", this.onResize, this);
      this.events.off("resume", this.applyKeybinds, this);
      this.scene.stop("UIScene");
      this.ui = undefined;
      gameSocket.clearHandlers();
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

    k(b.interact).on("down", () => this.mobileInteract());
    this.cursors.space?.on("down", () => {
      if (this.ui?.isChatOpen || this.ui?.isDialogueOpen || this.loadingOverlay)
        return;
      this.localPlayer?.tryJump();
    });
    k("P").on("down", () => {
      if (this.ui?.isChatOpen || this.ui?.isDialogueOpen || this.loadingOverlay)
        return;
      if (this.localPlayer)
        this.petAdjacentCritter(this.localPlayer.cx, this.localPlayer.cy);
    });
    k(b.invite).on("down", () => this.openInvitePanel());
    k(b.inbox).on("down", () => this.openInbox());
    k(b.bag).on("down", () => this.openInventory());

    const lbl = this.interactKeyLabel();
    for (const ind of this.doorIndicators) ind.label.setText(lbl);
    for (const ind of this.npcIndicators) ind.label.setText(lbl);
    this.portalLabel?.setText(lbl);
    this.refreshStatus();

    const openChat = () => {
      if (this.ui && !this.ui.isChatOpen && !this.ui.isDialogueOpen)
        this.ui.openChat();
    };
    k(b.chat).on("down", openChat);
    if (b.chat !== "T") k("T").on("down", openChat);

    const players = k(b.players);
    players.on("down", () => {
      if (!this.ui?.isChatOpen && !this.ui?.isDialogueOpen)
        this.ui?.showPlayerList();
    });
    players.on("up", () => this.ui?.hidePlayerList());
  }

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

  private returnToLogin(message: string, clear = true) {
    if (clear) clearSession();
    gameSocket.disconnect();
    this.scene.stop("UIScene");
    this.scene.stop("ShopScene");
    this.scene.stop("PauseScene");
    this.scene.start("LoginScene", { message });
  }

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

    // Flush at most one queued map-editor repaint per frame (see paintAt).
    if (this.repaintQueued) {
      this.repaintQueued = false;
      this.repaintMap();
    }

    if (
      !this.ui?.isDialogueOpen &&
      !this.ui?.isChatOpen &&
      !this.loadingOverlay &&
      !this.editMode
    ) {
      this.localPlayer.handleInput(
        this.cursors,
        this.wasd,
        delta,
        this.touchDir,
      );
    }

    const { cx, cy } = this.localPlayer;
    if (
      gameSocket.connected &&
      (cx !== this.lastSentCx || cy !== this.lastSentCy)
    ) {
      gameSocket.sendMove(cx, cy);
      this.lastSentCx = cx;
      this.lastSentCy = cy;
    }

    this.refreshDoorPrompt();
    this.refreshNpcPrompt();
    this.refreshPetPrompt();
    this.refreshPortalPrompt();
    if (cx !== this.lastTileCx || cy !== this.lastTileCy) {
      this.lastTileCx = cx;
      this.lastTileCy = cy;

      if (this.world.kind === "house" && this.doorTiles.has(`${cx},${cy}`)) {
        gameSocket.enterWorld({ kind: "openworld" });
      }
    }

    this.syncDepth(this.localPlayer);
    for (const remote of this.remotePlayers.values()) {
      this.syncDepth(remote);
    }

    this.ui?.setCoords(cx, cy);

    if (this.placingItem && this.placeGhost) {
      const p = this.input.activePointer;
      const t = isoToCart(p.worldX, p.worldY);
      const w = cartToIso(t.cx, t.cy);
      this.placeGhost
        .setPosition(w.x + TILE_W / 2, w.y + TILE_H / 2)
        .setDepth(t.cy + 1);
    }
  }

  setTouchDir(dx: number, dy: number) {
    this.touchDir = { dx, dy };
  }

  setSpeedMultiplier(mul: number) {
    this.localPlayer?.setSpeedMultiplier(mul);
  }

  teleport(cx: number, cy: number): boolean {
    if (!this.localPlayer?.teleport(cx, cy)) return false;
    gameSocket.sendMove(this.localPlayer.cx, this.localPlayer.cy);
    return true;
  }

  showSpeaking(id: string) {
    this.playerBySocketId(id)?.showSpeaking();
  }

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
    if (this.isAdjacentToPortal(cx, cy)) {
      this.usePortal();
      return;
    }
    this.petAdjacentCritter(cx, cy);
  }

  /** Pet the nearest adjacent cow/chicken/Blåhaj, if any. */
  private petAdjacentCritter(cx: number, cy: number): boolean {
    for (const animal of this.animals) {
      if (animal.isNear(cx, cy)) {
        animal.pet();
        return true;
      }
    }
    for (const shark of this.sharks) {
      if (shark.isNear(cx, cy)) {
        shark.pet();
        return true;
      }
    }
    return false;
  }

  private isAdjacentToPortal(cx: number, cy: number): boolean {
    if (!this.portalTile) return false;
    const dx = Math.abs(this.portalTile.cx - cx);
    const dy = Math.abs(this.portalTile.cy - cy);
    return dx + dy <= 1;
  }

  private usePortal() {
    if (this.world.kind === "openworld") {
      this.showLoadingOverlay("Entering your village…");
      gameSocket.enterWorld({ kind: "village", ownerPlayerId: getAccountId() });
    } else {
      this.showLoadingOverlay("Returning to the open world…");
      gameSocket.enterWorld({ kind: "openworld" });
    }
  }

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

  private onNpcClick(npc: Npc) {
    if (!this.localPlayer) return;
    if (this.editMode) return;
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

      if (dx + dy <= 1) return npc;
    }
    return undefined;
  }

  private rebuildDoorIndicators() {
    this.clearDoorIndicators();
    if (!this.mapDef) return;

    for (const d of this.mapDef.doors) {
      const { x, y } = cartToIso(d.cx, d.cy);
      const zone = this.add
        .zone(x + TILE_W / 2, y + TILE_H / 2, TILE_W, TILE_H)
        .setInteractive({ cursor: CURSORS.pointer });
      zone.on("pointerdown", () => this.onDoorClick(d.cx, d.cy));
      this.doorZones.push(zone);
    }

    if (this.world.kind === "house") return;
    for (const d of this.mapDef.doors) {
      const { x, y } = cartToIso(d.cx, d.cy);
      const label = this.add
        .text(x + TILE_W / 2, y - 4, this.interactKeyLabel(), {
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

  private interactKeyLabel(): string {
    return getKeybinds().interact || "E";
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

  private onDoorClick(cx: number, cy: number) {
    if (!this.localPlayer) return;
    if (this.editMode) return;
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
        .text(x + TILE_W / 2, y - TILE_H, this.interactKeyLabel(), {
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

  private extractAnimals(): MapObject[] {
    const animals: MapObject[] = [];
    if (!this.mapDef?.objects) return animals;
    const rest: MapObject[] = [];
    for (const obj of this.mapDef.objects) {
      if (Animal.isAnimal(obj.key)) {
        animals.push(obj);
        const tw = Math.ceil(obj.w / 16);
        const th = Math.ceil(obj.h / 16);
        for (let r = 0; r < th; r++) {
          for (let c = 0; c < tw; c++) {
            const gr = obj.cy + r;
            const gc = obj.cx + c;
            if (
              gr >= 0 &&
              gr < this.mapDef.decoLayer.length &&
              gc >= 0 &&
              gc < this.mapDef.decoLayer[0].length
            ) {
              this.mapDef.decoLayer[gr][gc] = -1;
            }
          }
        }
      } else {
        rest.push(obj);
      }
    }
    this.mapDef.objects = rest;
    return animals;
  }

  private rebuildAnimals(objs: MapObject[]) {
    this.clearAnimals();
    if (!this.mapDef) return;
    // Shared tile-occupancy set so animals don't walk onto each other.
    const occupancy = new Set<string>();
    for (const obj of objs) {
      const animal = new Animal(this, obj, this.mapDef, occupancy);
      animal.makeClickable(CURSORS.pointer, () => {
        if (
          this.localPlayer &&
          animal.isNear(this.localPlayer.cx, this.localPlayer.cy)
        )
          animal.pet();
        else this.flashStatus("Walk closer to pet");
      });
      this.animals.push(animal);
    }
  }

  private clearAnimals() {
    for (const a of this.animals) a.destroy();
    this.animals.length = 0;
  }

  private extractSharks(): MapObject[] {
    const sharks: MapObject[] = [];
    if (!this.mapDef?.objects) return sharks;
    const rest: MapObject[] = [];
    for (const obj of this.mapDef.objects) {
      if (Shark.isShark(obj.key)) {
        sharks.push(obj);
      } else {
        rest.push(obj);
      }
    }
    this.mapDef.objects = rest;
    return sharks;
  }

  private rebuildSharks(objs: MapObject[]) {
    this.clearSharks();
    if (!this.mapDef) return;
    for (const obj of objs) {
      const shark = new Shark(this, obj, this.mapDef, () => {
        const p = this.localPlayer;
        return p ? { cx: p.cx, cy: p.cy } : null;
      });
      shark.makeClickable(CURSORS.pointer, () => {
        if (
          this.localPlayer &&
          shark.isNear(this.localPlayer.cx, this.localPlayer.cy)
        )
          shark.pet();
        else this.flashStatus("Walk closer to pet Blåhaj");
      });
      this.sharks.push(shark);
    }
  }

  private clearSharks() {
    for (const s of this.sharks) s.destroy();
    this.sharks.length = 0;
  }

  private petPrompt?: Phaser.GameObjects.Text;

  /** Nearest cow/chicken/Blåhaj the player is standing next to, if any. */
  private nearestPettable(cx: number, cy: number): Animal | Shark | undefined {
    for (const a of this.animals) if (a.isNear(cx, cy)) return a;
    for (const s of this.sharks) if (s.isNear(cx, cy)) return s;
    return undefined;
  }

  private refreshPetPrompt() {
    const hidden = this.ui?.isDialogueOpen || this.ui?.isChatOpen;
    const target =
      !hidden && this.localPlayer
        ? this.nearestPettable(this.localPlayer.cx, this.localPlayer.cy)
        : undefined;
    if (!target) {
      this.petPrompt?.setVisible(false);
      return;
    }
    if (!this.petPrompt) {
      this.petPrompt = this.add
        .text(0, 0, "[P] pet", {
          fontFamily: FONT,
          fontSize: "8px",
          color: "#ffd24a",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(99999);
    }
    const a = target.getPetAnchor();
    this.petPrompt.setPosition(a.x, a.y).setVisible(true);
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
      const onIt = ind.cx === cx && ind.cy === cy;
      ind.label.setVisible(onIt);
    }
  }

  private rebuildPortal() {
    this.clearPortal();
    this.portalTile = this.mapDef?.portal;
    if (!this.portalTile) return;

    const { x, y } = cartToIso(this.portalTile.cx, this.portalTile.cy);
    const cx = x + TILE_W / 2;
    const cy = y + TILE_H / 2;
    const depth = this.portalTile.cy + 1;

    const glow = this.add
      .ellipse(cx, cy, TILE_W * 1.6, TILE_H * 1.0, 0x66ccff, 0.25)
      .setDepth(depth);
    const ring = this.add
      .ellipse(cx, cy, TILE_W * 1.1, TILE_H * 0.7, 0xaa66ff, 0.5)
      .setDepth(depth);
    const core = this.add
      .ellipse(cx, cy, TILE_W * 0.6, TILE_H * 0.4, 0xffffff, 0.85)
      .setDepth(depth);
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
      .text(cx, y - 4, this.interactKeyLabel(), {
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
      if (this.editMode) return;
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
    if (this.world.kind === "openworld") {
      gameSocket.enterWorld({ kind: "house" });
      return;
    }
    if (this.world.kind === "house") {
      gameSocket.enterWorld({ kind: "openworld" });
      return;
    }

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
    const d = Math.floor(player.y / TILE_H) + 1.5;
    if (player.depth !== d) player.setDepth(d);
  }

  private buildOcean() {
    if (!this.isoMap) return;
    const tex = this.textures.get(TS.water);
    const frames: string[] = [];
    for (let fx = 0; fx < 4; fx++) {
      const fk = `ocean_${fx}`;
      if (!tex.has(fk)) tex.add(fk, 0, fx * 16, 0, 16, 16);
      frames.push(fk);
    }
    const pad = 3000;
    this.ocean = this.add
      .tileSprite(
        this.isoMap.centre.x,
        this.isoMap.centre.y,
        this.isoMap.boundsW + pad * 2,
        this.isoMap.boundsH + pad * 2,
        TS.water,
        frames[0],
      )
      .setOrigin(0.5)
      .setDepth(-100);
    let i = 0;
    this.oceanTimer = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        i = (i + 1) % 4;
        this.ocean?.setFrame(frames[i]);
      },
    });
  }

  // ── Admin map editor API (driven by MapEditorScene) ──────────────────────

  isEditableWorld(): boolean {
    // Every world WorldScene renders (open world, shared house, villages) is
    // editable. Private building interiors live in InteriorScene and aren't.
    return (
      this.world.kind === "openworld" ||
      this.world.kind === "house" ||
      this.world.kind === "village"
    );
  }

  getPendingEditCount(): number {
    return this.pendingEdits.size + this.pendingNpcEdits.length;
  }

  setEditMode(on: boolean) {
    this.editMode = on && this.isEditableWorld();
    this.lastPaintKey = undefined;
    if (!this.editMode) {
      this.editBrush = undefined;
      this.editNpcTool = undefined;
      this.pickedNpcId = undefined;
    }
  }

  setEditBrush(layer: EditLayer, tile: number) {
    this.editBrush = { layer, tile };
    this.editNpcTool = undefined;
    this.pickedNpcId = undefined;
  }

  setEditNpcTool(op: "add" | "move" | "remove") {
    this.editNpcTool = op;
    this.editBrush = undefined;
    this.pickedNpcId = undefined;
  }

  // Screen-space rectangle of the editor panel, so clicks on the panel don't
  // also paint the world behind it.
  setEditorBlockRect(rect?: Phaser.Geom.Rectangle) {
    this.editorBlockRect = rect;
  }

  commitMapEdits(label?: string): number {
    const tiles = [...this.pendingEdits.values()];
    const npcs = [...this.pendingNpcEdits];
    if (tiles.length === 0 && npcs.length === 0) return 0;
    this.awaitingOverrideEcho = true;
    gameSocket.mapEdit({ tiles, npcs, label });
    return tiles.length + npcs.length;
  }

  discardMapEdits() {
    if (this.pendingEdits.size === 0 && this.pendingNpcEdits.length === 0)
      return;
    this.pendingEdits.clear();
    this.pendingNpcEdits.length = 0;
    this.pickedNpcId = undefined;
    this.lastPaintKey = undefined;
    this.repaintQueued = false;
    this.rebuildMapLayers();
    this.rebuildNpcLayers();
    this.repaintMap();
    this.events.emit("map:pendingChanged", 0);
  }

  private rebuildMapLayers() {
    if (!this.mapDef || !this.baseGround || !this.baseDeco) return;
    this.mapDef.groundLayer = this.baseGround.map((r) => [...r]);
    this.mapDef.decoLayer = this.baseDeco.map((r) => [...r]);
    applyMapOverrides(this.mapDef, this.overrides);
    applyMapOverrides(this.mapDef, [...this.pendingEdits.values()]);
  }

  private rebuildNpcLayers() {
    if (!this.mapDef) return;
    this.mapDef.npcs = applyNpcEdits(this.baseNpcs, [
      ...this.npcEdits,
      ...this.pendingNpcEdits,
    ]);
    this.rebuildNpcs();
  }

  private findNpcNear(cx: number, cy: number): NpcDef | undefined {
    if (!this.mapDef) return undefined;
    let best: NpcDef | undefined;
    let bestD = 2; // accept exact tile or an adjacent one
    for (const n of this.mapDef.npcs) {
      const d = Math.abs(n.cx - cx) + Math.abs(n.cy - cy);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  private handleNpcClick(pointer: Phaser.Input.Pointer) {
    if (!this.mapDef || !this.editNpcTool) return;
    if (
      this.editorBlockRect &&
      this.editorBlockRect.contains(pointer.x, pointer.y)
    )
      return;
    const { cx, cy } = isoToCart(pointer.worldX, pointer.worldY);
    if (cx < 0 || cy < 0 || cx >= this.mapDef.cols || cy >= this.mapDef.rows)
      return;

    if (this.editNpcTool === "add") {
      const name = window.prompt("NPC name:", "Villager");
      if (name === null) return; // cancelled
      const id = `npc_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
      this.pendingNpcEdits.push({
        op: "add",
        id,
        cx,
        cy,
        name: name.trim() || "Villager",
      });
      this.flashStatus(`Added ${name.trim() || "Villager"}`);
    } else if (this.editNpcTool === "remove") {
      const npc = this.findNpcNear(cx, cy);
      if (!npc) {
        this.flashStatus("Click an NPC to remove");
        return;
      }
      this.pendingNpcEdits.push({ op: "remove", id: npc.id, cx, cy });
      this.flashStatus(`Removed ${npc.name}`);
    } else {
      // move
      if (!this.pickedNpcId) {
        const npc = this.findNpcNear(cx, cy);
        if (!npc) {
          this.flashStatus("Click an NPC to move");
          return;
        }
        this.pickedNpcId = npc.id;
        this.flashStatus(`Moving ${npc.name} — click destination`);
        return;
      }
      this.pendingNpcEdits.push({ op: "move", id: this.pickedNpcId, cx, cy });
      this.pickedNpcId = undefined;
      this.flashStatus("NPC moved");
    }
    this.rebuildNpcLayers();
    this.events.emit("map:pendingChanged", this.getPendingEditCount());
  }

  // Re-stamp only the tile map + ocean, leaving players, camera, NPCs, doors
  // and objects untouched (tile edits never move them).
  private repaintMap() {
    if (!this.mapDef) return;
    this.isoMap?.destroy();
    this.oceanTimer?.remove(false);
    this.oceanTimer = undefined;
    this.ocean?.destroy();
    this.ocean = undefined;
    this.isoMap = new IsoMap(this, this.mapDef);
    this.isoMap.build();
    if (this.world.kind !== "house") this.buildOcean();
  }

  private paintAt(pointer: Phaser.Input.Pointer) {
    if (!this.editMode || !this.editBrush || !this.mapDef) return;
    // Ignore clicks that land on the editor panel itself.
    if (
      this.editorBlockRect &&
      this.editorBlockRect.contains(pointer.x, pointer.y)
    )
      return;
    const { cx, cy } = isoToCart(pointer.worldX, pointer.worldY);
    if (cx < 0 || cy < 0 || cx >= this.mapDef.cols || cy >= this.mapDef.rows)
      return;
    const { layer, tile } = this.editBrush;
    const key = editKey(layer, cx, cy);
    if (key === this.lastPaintKey) return;
    this.lastPaintKey = key;

    this.pendingEdits.set(key, { layer, cx, cy, tile });
    if (layer === "ground") this.mapDef.groundLayer[cy][cx] = tile;
    else this.mapDef.decoLayer[cy][cx] = tile;
    // Coalesce repaints: a fast drag can fire many pointermove events per
    // frame, and a full map re-stamp each time would thrash the GPU and can
    // crash the WebGL context. Queue one repaint and flush it in update().
    this.repaintQueued = true;
    this.events.emit("map:pendingChanged", this.getPendingEditCount());
  }

  // Live update: server pushed new committed edits for this world.
  private onMapOverrides = (data: {
    world: WorldRef;
    overrides: MapEdit[];
    npcEdits: NpcEdit[];
  }) => {
    if (this.worldKeyMatches(data.world)) {
      this.overrides = data.overrides;
      this.npcEdits = data.npcEdits;
      if (this.awaitingOverrideEcho) {
        this.pendingEdits.clear();
        this.pendingNpcEdits.length = 0;
        this.awaitingOverrideEcho = false;
        this.events.emit("map:pendingChanged", 0);
      }
      this.rebuildMapLayers();
      this.rebuildNpcLayers();
      this.repaintMap();
    }
  };

  private worldKeyMatches(other: WorldRef): boolean {
    if (this.world.kind !== other.kind) return false;
    if (this.world.kind === "village" && other.kind === "village")
      return this.world.ownerPlayerId === other.ownerPlayerId;
    return true;
  }

  private rebuildWorld(state: WorldState) {
    this.world = state.world;

    this.isoMap?.destroy();
    this.oceanTimer?.remove(false);
    this.oceanTimer = undefined;
    this.ocean?.destroy();
    this.ocean = undefined;
    this.localPlayer?.destroy();
    this.localPlayer = undefined;
    for (const remote of this.remotePlayers.values()) remote.destroy();
    this.remotePlayers.clear();
    this.clearDoorIndicators();
    this.clearPortal();
    this.clearHouseObjects();
    this.clearAnimals();
    this.clearSharks();
    this.cancelPlacement();

    this.mapDef =
      state.world.kind === "house"
        ? makeHouseInterior()
        : state.world.kind === "village"
          ? generateVillage()
          : generateMap(state.seed, {
              houses: false,

              sharedHouse: true,

              portal: "spawn",
            });
    // Snapshot the pristine seed-generated layers, then layer the persisted
    // admin overrides on top. Keeping the base lets us recompute the map after
    // a revert without regenerating from the seed.
    this.overrides = state.overrides ?? [];
    this.npcEdits = state.npcEdits ?? [];
    this.pendingEdits.clear();
    this.pendingNpcEdits.length = 0;
    this.pickedNpcId = undefined;
    this.lastPaintKey = undefined;
    this.repaintQueued = false;
    this.editMode = false;
    this.baseGround = this.mapDef.groundLayer.map((r) => [...r]);
    this.baseDeco = this.mapDef.decoLayer.map((r) => [...r]);
    this.baseNpcs = this.mapDef.npcs.map((n) => ({ ...n }));
    applyMapOverrides(this.mapDef, this.overrides);
    this.mapDef.npcs = applyNpcEdits(this.baseNpcs, this.npcEdits);

    const animalObjects = this.extractAnimals();
    const sharkObjects = this.extractSharks();
    this.isoMap = new IsoMap(this, this.mapDef);
    this.isoMap.build();
    if (state.world.kind !== "house") this.buildOcean();
    this.rebuildDoorIndicators();
    this.rebuildPortal();
    this.rebuildNpcs();
    this.rebuildAnimals(animalObjects);
    this.rebuildSharks(sharkObjects);
    this.ui?.closeDialogue();

    const cam = this.cameras.main;
    cam.stopFollow();
    cam.centerOn(this.isoMap.centre.x, this.isoMap.centre.y);
    cam.setZoom(loadSettings().defaultZoom);

    const M = 600;
    cam.setBounds(
      this.isoMap.boundsX - M,
      this.isoMap.boundsY - M,
      this.isoMap.boundsW + M * 2,
      this.isoMap.boundsH + M * 2,
    );

    this.doorTiles.clear();
    for (const d of this.mapDef.doors) {
      this.doorTiles.add(`${d.cx},${d.cy}`);
    }

    const { cx, cy } = state.spawn;
    this.localPlayer = new Player(
      this,
      {
        id: gameSocket.id ?? "local",
        cx,
        cy,
        name: "You",
        char: this.myChar,
        skin: this.mySkin,
        verified: this.myVerified,
      },
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

  private scheduleHideLoadingOverlay() {
    if (!this.loadingOverlay) return;
    const remaining =
      WorldScene.MIN_LOADING_MS - (this.time.now - this.loadingShownAt);
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

  private connectMultiplayer() {
    gameSocket.connect();

    gameSocket.onStatus((status, detail) => {
      switch (status) {
        case "connected":
          this.clearConnError();
          break;
        case "offline":
          this.showConnError(
            "Can't reach the game server.\n\nStart it with:\nbun run server/index.ts\n\nthen reload this page.",
          );
          break;
        case "disconnected":
          this.showConnError(
            `Disconnected from server${detail ? ` (${detail})` : ""}.\nReconnecting…`,
          );
          break;
        case "unauthorized":
          this.returnToLogin("Your session has expired. Please log in again.");
          break;
      }
    });

    gameSocket.on("auth:kicked", () => {
      this.returnToLogin("This account was opened somewhere else.", false);
    });

    gameSocket.on(
      "init",
      ({
        accountId,
        name,
        char,
        skin,
        verified,
        role,
        world,
        pixels,
        unread,
        dayCycle,
      }) => {
        setAccountId(accountId);
        setAccountName(name);
        this.myVerified = verified;
        this.ui?.setAdminRole(role);

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
        this.ui?.setDayCycle(
          dayCycle.tNow,
          dayCycle.dayLengthMs,
          dayCycle.serverNow,
        );
        this.rebuildWorld(world);

        const wanted = this.initialWorld;
        this.initialWorld = undefined;
        if (!wanted) return;
        const sameVillage =
          wanted.kind === "village" &&
          world.world.kind === "village" &&
          world.world.ownerPlayerId === wanted.ownerPlayerId;
        const sameOpen =
          wanted.kind === "openworld" && world.world.kind === "openworld";
        if (!sameVillage && !sameOpen) gameSocket.enterWorld(wanted);
      },
    );

    gameSocket.on("wallet:update", ({ pixels, delta }) => {
      this.ui?.setWallet(pixels, delta);
    });
    gameSocket.on("world:state", (state) => this.rebuildWorld(state));

    gameSocket.on("map:overrides", this.onMapOverrides);

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
      this.playerBySocketId(msg.id)?.showBubble(
        formatChatBubble(msg.text),
        "chat",
      );
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

    gameSocket.on("mod:notice", ({ text }) => {
      this.flashStatus(text);
      if (/sub-admin|moderator role/i.test(text)) {
        this.ui?.setAdminRole(
          /now a sub-admin/i.test(text) ? "subadmin" : null,
        );
      }
    });

    gameSocket.on("house:objects", ({ objects }) => {
      this.clearHouseObjects();
      for (const obj of objects) this.renderHouseObject(obj);
    });
    gameSocket.on("house:object:added", ({ object }) =>
      this.renderHouseObject(object),
    );
    gameSocket.on("house:object:removed", ({ id }) => {
      this.houseObjects.get(id)?.destroy();
      this.houseObjects.delete(id);
    });

    if (gameSocket.connected) {
      const wanted = this.initialWorld ?? this.world;
      this.initialWorld = undefined;
      gameSocket.enterWorld(wanted);
    }
  }

  private playerBySocketId(id: string): Player | undefined {
    if (id === gameSocket.id) return this.localPlayer;
    return this.remotePlayers.get(id);
  }

  private spawnRemote(state: PlayerState) {
    if (state.id === gameSocket.id) return;
    if (this.remotePlayers.has(state.id)) return;
    if (!this.mapDef) return;
    const player = new Player(this, state, false, this.mapDef);

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

  openInvitePanel() {
    if (this.scene.isActive("InvitePanelScene")) return;
    this.scene.launch("InvitePanelScene", { from: "WorldScene" });
  }

  openInbox() {
    if (this.scene.isActive("InboxScene")) return;
    this.scene.launch("InboxScene", { from: "WorldScene" });
  }

  openInventory() {
    if (this.scene.isActive("InventoryScene")) return;
    this.scene.launch("InventoryScene", { from: "WorldScene" });
  }

  isInHouse(): boolean {
    return this.world.kind === "house";
  }

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
      .text(
        this.scale.width / 2,
        40,
        `Placing ${item.name} — click a tile  •  ESC to cancel`,
        {
          fontFamily: FONT,
          fontSize: "9px",
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 8, y: 6 },
        },
      )
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

    if (obj.placedBy === getAccountId()) {
      glyph.setInteractive({ cursor: CURSORS.pointer });
      glyph.on("pointerdown", (p: Phaser.Input.Pointer) => {
        if (this.placingItem) return;
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
