import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT, FONT_TITLE, FONT_NARROW, COLORS } from "../ui/theme";
import { panel, closeButton, fitModal } from "../ui/UIKit";
import { getCustomSkin, setCustomSkin } from "../network/playerIdentity";
import { gameSocket } from "../network/socket";
import { CozyAvatar } from "../entities/CozyAvatar";
import {
  type Outfit,
  PRESET_OUTFITS,
  decodeOutfit,
  encodeOutfit,
  clampOutfit,
  encodePresetChar,
  decodePresetChar,
  texNpcChar,
  NPC_CHARS,
  ANIM,
  NUM_BODY,
  NUM_HAIR,
  NUM_TOP,
  NUM_BOTTOM,
} from "../world/cozyChar";

interface CharInit {
  from?: string;
}

export class CharacterScene extends Phaser.Scene {
  private fromKey?: string;
  private outfit: Outfit = { ...PRESET_OUTFITS[0] };
  private preview?: CozyAvatar;
  private valueLabels: Partial<Record<keyof Outfit, Phaser.GameObjects.Text>> =
    {};
  private steppers: MenuButton[] = [];
  // Which pre-assembled character is selected (1..9), or null when using a
  // custom outfit from the steppers.
  private selectedPreset: number | null = null;
  private presetHighlights: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super({ key: "CharacterScene" });
  }

  init(data: CharInit) {
    this.fromKey = data?.from;
    const existing = getCustomSkin();
    this.selectedPreset = decodePresetChar(existing);
    this.outfit = (existing && decodeOutfit(existing)) || {
      ...PRESET_OUTFITS[0],
    };
  }

  create() {
    if (this.fromKey) this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      if (this.fromKey) this.scene.resume(this.fromKey);
      this.preview?.destroy();
    });

    const W = this.scale.width;
    const H = this.scale.height;
    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    const panelW = 540;
    const panelH = 470;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");
    closeButton(this, px + panelW - 26, py + 24, () => this.scene.stop());
    fitModal(this, panelW, panelH);

    this.add
      .text(W / 2, py + 30, "CUSTOMISE YOUR LOOK", {
        fontFamily: FONT_TITLE,
        fontSize: "18px",
        color: "#f0a500",
      })
      .setOrigin(0.5);

    const previewX = px + 120;
    const previewY = py + 150;
    this.add
      .rectangle(previewX, previewY - 4, 150, 190, 0x000000, 0.22)
      .setStrokeStyle(1, 0xffffff, 0.12);
    this.add.ellipse(previewX, previewY + 78, 70, 26, 0x000000, 0.25);
    this.preview = new CozyAvatar(this, this.outfit);
    this.preview.setPosition(previewX, previewY + 80).setScale(4);
    this.preview.setAnim("idle", "down", false);

    const rowX = px + 250;
    const rowW = panelW - (rowX - px) - 30;
    let y = py + 78;
    const rowGap = 52;
    this.buildStepper("Skin", "body", 1, NUM_BODY, rowX, y, rowW);
    y += rowGap;
    this.buildStepper("Hair", "hair", 0, NUM_HAIR, rowX, y, rowW);
    y += rowGap;
    this.buildStepper("Top", "top", 1, NUM_TOP, rowX, y, rowW);
    y += rowGap;
    this.buildStepper("Bottom", "bottom", 1, NUM_BOTTOM, rowX, y, rowW);

    makeMenuButton(this, rowX + rowW / 2, y + rowGap - 4, "RANDOM", {
      width: rowW,
      height: 34,
      variant: "grey",
      onClick: () => this.randomise(),
    });

    this.buildCharacterPicker(px, py + 312, panelW);

    makeMenuButton(this, W / 2, py + panelH - 30, "DONE", {
      width: 220,
      height: 42,
      onClick: () => this.scene.stop(),
    });

    this.refresh();
    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());
  }

  private buildCharacterPicker(px: number, y: number, panelW: number) {
    this.add
      .text(px + panelW / 2, y, "— OR PICK A CHARACTER —", {
        fontFamily: FONT_NARROW,
        fontSize: "12px",
        color: COLORS.textDim,
      })
      .setOrigin(0.5);

    const idleFrame = ANIM.idle.down[0];
    const margin = 34;
    const usable = panelW - margin * 2;
    const gap = usable / NPC_CHARS;
    const cellY = y + 42;
    for (let n = 1; n <= NPC_CHARS; n++) {
      const cx = px + margin + gap * (n - 0.5);
      const bg = this.add
        .rectangle(cx, cellY, gap - 6, 56, 0x000000, 0.25)
        .setStrokeStyle(2, 0xf0a500, 0)
        .setInteractive({ useHandCursor: true });
      this.presetHighlights[n] = bg;
      this.add
        .sprite(cx, cellY + 22, texNpcChar(n), idleFrame)
        .setOrigin(0.5, 1)
        .setScale(1.5);
      bg.on("pointerdown", () => this.selectPreset(n));
    }
  }

  private selectPreset(n: number) {
    this.selectedPreset = n;
    this.preview?.setPresetChar(n);
    this.preview?.setAnim("idle", "down", false);
    this.updatePresetHighlights();
    const encoded = encodePresetChar(n);
    setCustomSkin(encoded);
    if (gameSocket.connected) gameSocket.setSkin(encoded);
  }

  private updatePresetHighlights() {
    for (let n = 1; n <= NPC_CHARS; n++) {
      this.presetHighlights[n]?.setStrokeStyle(
        2,
        0xf0a500,
        this.selectedPreset === n ? 1 : 0,
      );
    }
  }

  private buildStepper(
    label: string,
    key: keyof Outfit,
    min: number,
    max: number,
    x: number,
    y: number,
    w: number,
  ) {
    this.add
      .text(x, y - 16, label, {
        fontFamily: FONT_NARROW,
        fontSize: "13px",
        color: COLORS.textDim,
      })
      .setOrigin(0, 0.5);
    const cycle = (delta: number) => {
      const span = max - min + 1;
      this.outfit[key] =
        min + ((((this.outfit[key] - min + delta) % span) + span) % span);
      this.apply();
    };
    this.steppers.push(
      makeMenuButton(this, x + 16, y + 12, "<", {
        width: 34,
        height: 32,
        variant: "grey",
        onClick: () => cycle(-1),
      }),
    );
    this.valueLabels[key] = this.add
      .text(x + w / 2, y + 12, "", {
        fontFamily: FONT,
        fontSize: "13px",
        color: "#ffffff",
      })
      .setOrigin(0.5);
    this.steppers.push(
      makeMenuButton(this, x + w - 16, y + 12, ">", {
        width: 34,
        height: 32,
        variant: "grey",
        onClick: () => cycle(1),
      }),
    );
  }

  private randomise() {
    const r = (n: number, from = 1) =>
      from + Math.floor(Math.random() * (n - from + 1));
    this.outfit = {
      body: r(NUM_BODY),
      hair: r(NUM_HAIR, 0),
      top: r(NUM_TOP),
      bottom: r(NUM_BOTTOM),
    };
    this.apply();
  }

  private refresh() {
    this.outfit = clampOutfit(this.outfit);
    this.valueLabels.body?.setText(`${this.outfit.body} / ${NUM_BODY}`);
    this.valueLabels.hair?.setText(
      this.outfit.hair === 0 ? "none" : `${this.outfit.hair} / ${NUM_HAIR}`,
    );
    this.valueLabels.top?.setText(`${this.outfit.top} / ${NUM_TOP}`);
    this.valueLabels.bottom?.setText(`${this.outfit.bottom} / ${NUM_BOTTOM}`);
    if (this.selectedPreset) {
      this.preview?.setPresetChar(this.selectedPreset);
    } else {
      this.preview?.setOutfit(this.outfit);
    }
    this.preview?.setAnim("idle", "down", false);
    this.updatePresetHighlights();
  }

  private apply() {
    // Tweaking the steppers means going back to a custom outfit.
    this.selectedPreset = null;
    this.refresh();
    const encoded = encodeOutfit(this.outfit);
    setCustomSkin(encoded);
    if (gameSocket.connected) gameSocket.setSkin(encoded);
  }
}
