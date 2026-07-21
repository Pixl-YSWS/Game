import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT, FONT_TITLE, FONT_CHAT, COLORS, CURSORS } from "../ui/theme";
import { panel, closeButton } from "../ui/UIKit";
import { gameSocket } from "../network/socket";
import type { WorldScene } from "./WorldScene";
import type { MapRevisionMeta } from "../types/network";
import type { EditLayer } from "../world/mapOverrides";
import {
  TILE_SRC,
  GRASS,
  GRASS_DARK,
  PATH,
  WATER,
  SOLID,
  FLOWER_A,
  FLOWER_B,
  FLOWER_C,
  FLOWER_D,
  ROCK_A,
  ROCK_B,
} from "../world/tileset";

interface PaletteEntry {
  label: string;
  layer: EditLayer;
  tile: number;
}

const GROUND_PALETTE: PaletteEntry[] = [
  { label: "Grass", layer: "ground", tile: GRASS },
  { label: "Dark", layer: "ground", tile: GRASS_DARK },
  { label: "Path", layer: "ground", tile: PATH },
  { label: "Water", layer: "ground", tile: WATER },
];

const DECO_PALETTE: PaletteEntry[] = [
  { label: "Erase", layer: "deco", tile: -1 },
  { label: "Flower", layer: "deco", tile: FLOWER_A },
  { label: "Tulip", layer: "deco", tile: FLOWER_B },
  { label: "Bloom", layer: "deco", tile: FLOWER_C },
  { label: "Daisy", layer: "deco", tile: FLOWER_D },
  { label: "Rock", layer: "deco", tile: ROCK_A },
  { label: "Stone", layer: "deco", tile: ROCK_B },
  { label: "Wall", layer: "deco", tile: SOLID },
];

type Mode = "paint" | "history";

export class MapEditorScene extends Phaser.Scene {
  private world!: WorldScene;
  private mode: Mode = "paint";
  private content: Phaser.GameObjects.GameObject[] = [];
  private buttons: MenuButton[] = [];
  private pendingText?: Phaser.GameObjects.Text;
  private selectedTile = `ground:${GRASS}`;
  private selectedNpcTool?: "add" | "move" | "remove";
  private revisions: MapRevisionMeta[] = [];
  private editable = true;

  constructor() {
    super({ key: "MapEditorScene" });
  }

  create() {
    this.world = this.scene.get("WorldScene") as WorldScene;

    this.editable =
      this.scene.isActive("WorldScene") && this.world.isEditableWorld();

    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");

    if (this.editable) this.world.setEditMode(true);
    this.world.events.on("map:pendingChanged", this.onPendingChanged, this);
    gameSocket.on("map:history", this.onHistory);

    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.mode === "history") this.setMode("paint");
      else this.scene.stop();
    });

    this.events.once("shutdown", () => {
      this.world.discardMapEdits();
      this.world.setEditMode(false);
      this.world.setEditorBlockRect(undefined);
      this.world.events.off("map:pendingChanged", this.onPendingChanged, this);
      gameSocket.off("map:history", this.onHistory);
    });

    this.scale.on("resize", this.render, this);
    this.render();

    if (this.editable) this.world.setEditBrush("ground", GRASS);
  }

  private setMode(mode: Mode) {
    this.mode = mode;

    if (mode === "history") gameSocket.requestMapHistory();
    this.render();
  }

  private clearContent() {
    for (const o of this.content) o.destroy();
    for (const b of this.buttons) b.destroy();
    this.content.length = 0;
    this.buttons.length = 0;
    this.pendingText = undefined;
  }

  private render() {
    this.clearContent();
    if (!this.editable) this.renderNotice();
    else if (this.mode === "history") this.renderHistory();
    else this.renderPaint();
  }

  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.content.push(obj);
    return obj;
  }

  private renderNotice() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0.7)");
    const pw = 360;
    const ph = 200;
    this.track(panel(this, W / 2, H / 2, pw, ph, "ui-panel-dark"));
    this.track(
      closeButton(this, W / 2 + pw / 2 - 26, H / 2 - ph / 2 + 24, () =>
        this.scene.stop(),
      ),
    );
    this.track(
      this.add
        .text(W / 2, H / 2 - 50, "MAP EDITOR", {
          fontFamily: FONT_TITLE,
          fontSize: "18px",
          color: COLORS.accent,
        })
        .setOrigin(0.5),
    );
    this.track(
      this.add
        .text(
          W / 2,
          H / 2,
          "You can't edit a building interior.\n\nStep back outside, then reopen\nthe map editor.",
          {
            fontFamily: FONT_CHAT,
            fontSize: "13px",
            color: COLORS.textDim,
            align: "center",
            lineSpacing: 4,
          },
        )
        .setOrigin(0.5)
        .setResolution(3),
    );
    this.buttons.push(
      makeMenuButton(this, W / 2, H / 2 + 70, "CLOSE", {
        variant: "grey",
        width: 160,
        height: 40,
        onClick: () => this.scene.stop(),
      }),
    );
  }

  private renderPaint() {
    const px = 10;
    const py = 10;
    const pw = 196;
    const ph = Math.min(this.scale.height - 20, 540);

    this.track(panel(this, px + pw / 2, py + ph / 2, pw, ph, "ui-panel-dark"));

    this.world.setEditorBlockRect(new Phaser.Geom.Rectangle(px, py, pw, ph));

    this.track(
      this.add
        .text(px + pw / 2, py + 22, "MAP EDITOR", {
          fontFamily: FONT_TITLE,
          fontSize: "16px",
          color: COLORS.accent,
        })
        .setOrigin(0.5),
    );
    this.track(
      closeButton(this, px + pw - 22, py + 20, () => this.scene.stop()),
    );

    let y = py + 44;
    y = this.renderPaletteGroup("GROUND", GROUND_PALETTE, px + 14, y, pw - 28);
    y += 6;
    y = this.renderPaletteGroup("DECO", DECO_PALETTE, px + 14, y, pw - 28);
    y += 6;
    y = this.renderNpcTools(px + 14, y, pw - 28);

    y += 10;
    this.pendingText = this.track(
      this.add
        .text(px + pw / 2, y, "", {
          fontFamily: FONT_CHAT,
          fontSize: "12px",
          color: COLORS.good,
        })
        .setOrigin(0.5)
        .setResolution(3),
    );
    this.updatePendingText(this.world.getPendingEditCount());

    y += 18;
    const bw = pw - 28;
    this.buttons.push(
      makeMenuButton(this, px + pw / 2, y + 16, "SAVE CHANGES", {
        width: bw,
        height: 34,
        onClick: () => this.onSave(),
      }),
    );
    this.buttons.push(
      makeMenuButton(this, px + pw / 2, y + 56, "DISCARD", {
        variant: "grey",
        width: bw,
        height: 34,
        onClick: () => this.world.discardMapEdits(),
      }),
    );
    this.buttons.push(
      makeMenuButton(this, px + pw / 2, y + 96, "HISTORY", {
        variant: "grey",
        width: bw,
        height: 34,
        onClick: () => this.setMode("history"),
      }),
    );

    const hint = this.selectedNpcTool
      ? this.selectedNpcTool === "add"
        ? "Click the world to place an NPC"
        : this.selectedNpcTool === "move"
          ? "Click an NPC, then its destination"
          : "Click an NPC to remove it"
      : "Click / drag the world to paint";
    this.track(
      this.add
        .text(px + pw / 2, py + ph - 14, hint, {
          fontFamily: FONT_CHAT,
          fontSize: "10px",
          color: COLORS.textDim,
          align: "center",
          wordWrap: { width: pw - 24 },
        })
        .setOrigin(0.5)
        .setResolution(3),
    );
  }

  private renderPaletteGroup(
    title: string,
    entries: PaletteEntry[],
    x: number,
    y: number,
    w: number,
  ): number {
    this.track(
      this.add
        .text(x, y, title, {
          fontFamily: FONT,
          fontSize: "10px",
          color: COLORS.textDim,
        })
        .setResolution(3),
    );
    y += 16;
    const size = 30;
    const gap = 8;
    const perRow = Math.max(1, Math.floor((w + gap) / (size + gap)));
    entries.forEach((entry, i) => {
      const col = i % perRow;
      const rowi = Math.floor(i / perRow);
      const sx = x + col * (size + gap) + size / 2;
      const sy = y + rowi * (size + gap) + size / 2;
      this.makeSwatch(sx, sy, size, entry);
    });
    const rows = Math.ceil(entries.length / perRow);
    return y + rows * (size + gap);
  }

  private renderNpcTools(x: number, y: number, w: number): number {
    this.track(
      this.add
        .text(x, y, "NPCS", {
          fontFamily: FONT,
          fontSize: "10px",
          color: COLORS.textDim,
        })
        .setResolution(3),
    );
    y += 18;
    const tools: ("add" | "move" | "remove")[] = ["add", "move", "remove"];
    const labels = { add: "Add", move: "Move", remove: "Remove" } as const;
    const gap = 6;
    const bw = (w - gap * 2) / 3;
    tools.forEach((op, i) => {
      const cx = x + bw / 2 + i * (bw + gap);
      this.buttons.push(
        makeMenuButton(this, cx, y + 15, labels[op], {
          width: bw,
          height: 30,
          variant: this.selectedNpcTool === op ? "blue" : "grey",
          onClick: () => {
            this.selectedNpcTool = op;
            this.selectedTile = "";
            this.world.setEditNpcTool(op);
            this.render();
          },
        }),
      );
    });
    return y + 34;
  }

  private makeSwatch(
    cx: number,
    cy: number,
    size: number,
    entry: PaletteEntry,
  ) {
    const id = `${entry.layer}:${entry.tile}`;
    const border = this.track(
      this.add
        .rectangle(cx, cy, size + 6, size + 6, 0x000000, 0.25)
        .setStrokeStyle(2, this.selectedTile === id ? 0xffd166 : 0x000000, 0.6),
    );

    const src = TILE_SRC[entry.tile];
    if (src) {
      const frameKey = `pal_${src.key}_${entry.tile}`;
      const tex = this.textures.get(src.key);
      if (!tex.has(frameKey))
        tex.add(frameKey, 0, src.fx * 16, src.fy * 16, 16, 16);
      this.track(
        this.add.image(cx, cy, src.key, frameKey).setDisplaySize(size, size),
      );
    } else {
      const isErase = entry.tile === -1;
      this.track(
        this.add.rectangle(
          cx,
          cy,
          size,
          size,
          isErase ? 0x2a2f3a : 0x6b7280,
          1,
        ),
      );
      this.track(
        this.add
          .text(cx, cy, isErase ? "✕" : "▦", {
            fontFamily: FONT,
            fontSize: "14px",
            color: isErase ? "#ff6b6b" : "#e5e7eb",
          })
          .setOrigin(0.5),
      );
    }

    this.track(
      this.add
        .text(cx, cy + size / 2 + 8, entry.label, {
          fontFamily: FONT_CHAT,
          fontSize: "9px",
          color: COLORS.textDim,
        })
        .setOrigin(0.5)
        .setResolution(3),
    );

    border.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, size + 6, size + 6),
      Phaser.Geom.Rectangle.Contains,
    );
    border.input!.cursor = CURSORS.pointer;
    border.on("pointerdown", () => {
      this.selectedTile = id;
      this.selectedNpcTool = undefined;
      this.world.setEditBrush(entry.layer, entry.tile);
      this.render();
    });
  }

  private onSave() {
    if (this.world.getPendingEditCount() === 0) {
      this.updatePendingText(0, "Nothing to save");
      return;
    }
    const raw = window.prompt(
      "Describe this change (optional — helps you revert later):",
      "",
    );
    const label = raw && raw.trim() ? raw.trim() : undefined;
    const n = this.world.commitMapEdits(label);
    if (n > 0) this.updatePendingText(0, `Saved ${n} tile(s)`);
  }

  private updatePendingText(count: number, override?: string) {
    if (!this.pendingText) return;
    if (override) {
      this.pendingText.setColor(COLORS.good).setText(override);
      return;
    }
    if (count === 0)
      this.pendingText.setColor(COLORS.textDim).setText("No unsaved edits");
    else
      this.pendingText
        .setColor(COLORS.accent)
        .setText(`${count} unsaved edit(s)`);
  }

  private onPendingChanged = (count: number) => {
    this.updatePendingText(count);
  };

  private onHistory = (data: {
    editable: boolean;
    revisions: MapRevisionMeta[];
  }) => {
    this.revisions = [...data.revisions].reverse();
    if (this.mode === "history") this.render();
  };

  private renderHistory() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0.7)");

    this.world.setEditorBlockRect(new Phaser.Geom.Rectangle(0, 0, W, H));
    this.track(this.add.zone(0, 0, W, H).setOrigin(0).setInteractive());

    const pw = 540;
    const ph = 460;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    this.track(panel(this, W / 2, H / 2, pw, ph, "ui-panel-dark"));
    this.track(
      closeButton(this, px + pw - 26, py + 24, () => this.setMode("paint")),
    );

    this.track(
      this.add
        .text(W / 2, py + 28, "EDIT HISTORY", {
          fontFamily: FONT_TITLE,
          fontSize: "18px",
          color: COLORS.accent,
        })
        .setOrigin(0.5),
    );
    this.track(
      this.add
        .text(
          W / 2,
          py + 50,
          "Revert any change to undo it for everyone. Restore brings it back.",
          {
            fontFamily: FONT_CHAT,
            fontSize: "11px",
            color: COLORS.textDim,
          },
        )
        .setOrigin(0.5)
        .setResolution(3),
    );

    if (this.revisions.length === 0) {
      this.track(
        this.add
          .text(W / 2, H / 2, "No saved changes yet.", {
            fontFamily: FONT_CHAT,
            fontSize: "14px",
            color: COLORS.textDim,
          })
          .setOrigin(0.5)
          .setResolution(3),
      );
    } else {
      const listX = px + 24;
      const listW = pw - 48;
      const rowH = 46;
      const top = py + 74;
      const maxRows = Math.floor((ph - 74 - 56) / rowH);
      this.revisions.slice(0, maxRows).forEach((rev, i) => {
        const y = top + i * rowH + rowH / 2;
        this.track(
          this.add
            .rectangle(
              listX + listW / 2,
              y,
              listW,
              rowH - 6,
              0xffffff,
              rev.active ? 0.06 : 0.02,
            )
            .setStrokeStyle(1, 0xffffff, 0.12),
        );
        const when = new Date(rev.createdAt).toLocaleString();
        const summary = summarise(rev);
        const title = rev.label ? rev.label : summary;
        this.track(
          this.add
            .text(listX + 12, y - 8, title, {
              fontFamily: FONT_CHAT,
              fontSize: "14px",
              color: rev.active ? COLORS.text : COLORS.textDim,
            })
            .setOrigin(0, 0.5)
            .setResolution(3),
        );
        this.track(
          this.add
            .text(
              listX + 12,
              y + 11,
              `${rev.authorName} · ${summary} · ${when}` +
                (rev.active ? "" : "  (reverted)"),
              {
                fontFamily: FONT_CHAT,
                fontSize: "10px",
                color: rev.active ? COLORS.textDim : COLORS.bad,
              },
            )
            .setOrigin(0, 0.5)
            .setResolution(3),
        );
        this.buttons.push(
          makeMenuButton(
            this,
            listX + listW - 52,
            y,
            rev.active ? "Revert" : "Restore",
            {
              width: 92,
              height: 30,
              variant: rev.active ? "grey" : "blue",
              onClick: () => gameSocket.mapSetActive(rev.id, !rev.active),
            },
          ),
        );
      });
    }

    this.buttons.push(
      makeMenuButton(this, W / 2, py + ph - 30, "BACK TO PAINTING", {
        width: 220,
        height: 38,
        onClick: () => this.setMode("paint"),
      }),
    );
  }
}

function summarise(rev: MapRevisionMeta): string {
  const parts: string[] = [];
  if (rev.tileCount) parts.push(`${rev.tileCount} tile(s)`);
  if (rev.npcCount) parts.push(`${rev.npcCount} NPC(s)`);
  return parts.length ? parts.join(", ") : "no changes";
}
