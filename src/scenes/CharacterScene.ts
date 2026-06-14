import Phaser from "phaser";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";
import { getCustomSkin, setCustomSkin } from "../network/playerIdentity";
import { gameSocket } from "../network/socket";
import {
  type Outfit,
  PRESET_OUTFITS,
  decodeOutfit,
  encodeOutfit,
  clampOutfit,
  encodePresetChar,
  decodePresetChar,
  outfitLayers,
  texNpcChar,
  NPC_CHARS,
  FRAME_W,
  FRAME_H,
  NUM_BODY,
  NUM_HAIR,
  NUM_TOP,
  NUM_BOTTOM,
} from "../world/cozyChar";

interface CharInit {
  from?: string;
}

// Idle facing-down, first frame: ANIM.idle.down[0] = row 2 * SHEET_COLS(5).
const PREVIEW_FRAME = 10;

export class CharacterScene extends Phaser.Scene {
  private fromKey?: string;
  private outfit: Outfit = { ...PRESET_OUTFITS[0] };
  // Selected pre-assembled character (1..NPC_CHARS), or null for a custom outfit.
  private selectedPreset: number | null = null;

  private modal?: DomModal;
  private previewBox?: HTMLDivElement;
  private valueEls: Partial<Record<keyof Outfit, HTMLSpanElement>> = {};
  private presetCells: HTMLDivElement[] = [];

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
      this.modal?.destroy();
    });

    const modal = openDomModal(this, {
      title: "Customise your look",
      width: 460,
      onClose: () => this.scene.stop(),
    });
    this.modal = modal;

    // Top: preview on the left, outfit steppers on the right.
    const top = el("div");
    top.style.cssText = "display:flex; gap:20px; align-items:center;";

    this.previewBox = el("div");
    this.previewBox.style.cssText = [
      `width:${FRAME_W * 4}px`,
      `height:${FRAME_H * 4}px`,
      "position:relative",
      "flex-shrink:0",
      "background:rgba(0,0,0,0.22)",
      "box-shadow:inset 0 0 0 2px rgba(255,255,255,0.12)",
    ].join(";");
    top.append(this.previewBox);

    const steppers = el("div");
    steppers.style.cssText = "flex:1; display:flex; flex-direction:column; gap:10px;";
    steppers.append(
      this.stepper("Skin", "body", 1, NUM_BODY),
      this.stepper("Hair", "hair", 0, NUM_HAIR),
      this.stepper("Top", "top", 1, NUM_TOP),
      this.stepper("Bottom", "bottom", 1, NUM_BOTTOM),
    );
    top.append(steppers);
    modal.body.append(top);

    const randomRow = el("div", "pixl-actions");
    randomRow.append(
      domBtn(this, "Random", () => this.randomise(), { variant: "grey" }),
    );
    modal.body.append(randomRow);

    modal.body.append(el("div", "pixl-sub", "— or pick a character —"));
    modal.body.append(this.presetPicker());

    const done = el("div", "pixl-actions");
    done.append(domBtn(this, "Done", () => this.scene.stop(), { big: true }));
    modal.body.append(done);

    this.refresh();
  }

  private stepper(
    label: string,
    key: keyof Outfit,
    min: number,
    max: number,
  ): HTMLElement {
    const row = el("div");
    row.style.cssText = "display:flex; align-items:center; gap:10px;";
    const name = el("div", "pixl-row-meta", label);
    name.style.cssText = "width:64px; font-size:14px;";

    const cycle = (delta: number) => {
      const span = max - min + 1;
      this.outfit[key] =
        min + ((((this.outfit[key] - min + delta) % span) + span) % span);
      this.applyOutfit();
    };
    const value = el("span");
    value.style.cssText = "flex:1; text-align:center; font-size:14px;";
    this.valueEls[key] = value;

    row.append(
      name,
      domBtn(this, "<", () => cycle(-1), { variant: "grey" }),
      value,
      domBtn(this, ">", () => cycle(1), { variant: "grey" }),
    );
    return row;
  }

  private presetPicker(): HTMLElement {
    const row = el("div");
    row.style.cssText =
      "display:flex; gap:8px; justify-content:center; flex-wrap:wrap;";
    this.presetCells = [];
    for (let n = 1; n <= NPC_CHARS; n++) {
      const cell = el("div");
      cell.style.cssText = [
        "padding:4px",
        "background:rgba(0,0,0,0.25)",
        "border:2px solid transparent",
        "cursor:pointer",
        "line-height:0",
      ].join(";");
      cell.append(this.avatarImg([texNpcChar(n)], 2));
      cell.addEventListener("click", () => this.selectPreset(n));
      this.presetCells[n] = cell;
      row.append(cell);
    }
    return row;
  }

  // Stacks the avatar's layers as pixelated <img>s filling the container.
  private avatarImg(keys: (string | null)[], scale: number): HTMLElement {
    const box = el("div");
    box.style.cssText = [
      `width:${FRAME_W * scale}px`,
      `height:${FRAME_H * scale}px`,
      "position:relative",
      "image-rendering:pixelated",
    ].join(";");
    for (const key of keys) {
      if (!key) continue;
      const img = el("img");
      img.src = this.textures.getBase64(key, PREVIEW_FRAME);
      img.style.cssText =
        "position:absolute; inset:0; width:100%; height:100%; image-rendering:pixelated;";
      box.append(img);
    }
    return box;
  }

  private renderPreview() {
    if (!this.previewBox) return;
    const keys =
      this.selectedPreset != null
        ? [texNpcChar(this.selectedPreset)]
        : outfitLayers(this.outfit);
    this.previewBox.replaceChildren();
    const inner = this.avatarImg(keys, 4);
    inner.style.position = "absolute";
    inner.style.inset = "0";
    this.previewBox.append(inner);
  }

  private selectPreset(n: number) {
    this.selectedPreset = n;
    const encoded = encodePresetChar(n);
    setCustomSkin(encoded);
    if (gameSocket.connected) gameSocket.setSkin(encoded);
    this.refresh();
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
    this.applyOutfit();
  }

  // Tweaking the steppers/random means going back to a custom outfit.
  private applyOutfit() {
    this.selectedPreset = null;
    const encoded = encodeOutfit(this.outfit);
    setCustomSkin(encoded);
    if (gameSocket.connected) gameSocket.setSkin(encoded);
    this.refresh();
  }

  private refresh() {
    this.outfit = clampOutfit(this.outfit);
    const set = (key: keyof Outfit, text: string) => {
      const node = this.valueEls[key];
      if (node) node.textContent = text;
    };
    set("body", `${this.outfit.body} / ${NUM_BODY}`);
    set("hair", this.outfit.hair === 0 ? "none" : `${this.outfit.hair} / ${NUM_HAIR}`);
    set("top", `${this.outfit.top} / ${NUM_TOP}`);
    set("bottom", `${this.outfit.bottom} / ${NUM_BOTTOM}`);

    for (let n = 1; n <= NPC_CHARS; n++) {
      const cell = this.presetCells[n];
      if (cell)
        cell.style.borderColor =
          this.selectedPreset === n ? "#ffd166" : "transparent";
    }
    this.renderPreview();
  }
}
