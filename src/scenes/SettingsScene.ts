import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT_CHAT, FONT_TITLE, COLORS } from "../ui/theme";
import { panel } from "../ui/UIKit";
import {
  loadSettings,
  saveSettings,
  ZOOM_OPTIONS,
  getKeybinds,
  setKeybind,
  resetKeybinds,
  type ControlAction,
} from "../data/Settings";

interface SettingsInit {
  from?: string;
}

// Remappable actions in display order (action → label).
const REMAP_ROWS: [ControlAction, string][] = [
  ["up", "Move Up"],
  ["down", "Move Down"],
  ["left", "Move Left"],
  ["right", "Move Right"],
  ["run", "Run"],
  ["interact", "Interact"],
  ["chat", "Chat"],
  ["players", "Players"],
  ["invite", "Invite"],
  ["inbox", "Inbox"],
  ["bag", "Bag"],
];

// Friendly display for a stored Phaser key-code name.
function prettyKey(name: string): string {
  const map: Record<string, string> = {
    UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→",
    SHIFT: "Shift", SPACE: "Space", ENTER: "Enter", TAB: "Tab",
  };
  return map[name] ?? name;
}

// Map a raw keydown event to a storable Phaser key-code name, or null if it's
// a key we don't allow binding to (modifiers alone, function keys, etc.).
function eventToKeyName(e: KeyboardEvent): string | null {
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) return e.key.toUpperCase();
  if (e.key.length === 1 && /[0-9]/.test(e.key)) {
    return ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"][+e.key];
  }
  switch (e.code) {
    case "ArrowUp": return "UP";
    case "ArrowDown": return "DOWN";
    case "ArrowLeft": return "LEFT";
    case "ArrowRight": return "RIGHT";
    case "Space": return "SPACE";
    case "Enter": return "ENTER";
    case "Tab": return "TAB";
    case "ShiftLeft": case "ShiftRight": return "SHIFT";
    default: return null;
  }
}

export class SettingsScene extends Phaser.Scene {
  private zoomBtn?: MenuButton;
  private soundBtn?: MenuButton;
  private fullscreenBtn?: MenuButton;
  private controlsObjects: Phaser.GameObjects.GameObject[] = [];
  // Per-action key buttons (so their labels can be refreshed after a rebind).
  private keyButtons = new Map<ControlAction, MenuButton>();
  // The action currently waiting for a key press (rebind in progress).
  private listeningFor?: ControlAction;
  private fromKey?: string;

  constructor() {
    super({ key: "SettingsScene" });
  }

  init(data: SettingsInit) {
    this.fromKey = data?.from;
  }

  create() {
    // Pause the launching scene so its buttons don't keep receiving hover
    // events while Settings is on top of them.
    if (this.fromKey) this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      if (this.fromKey) this.scene.resume(this.fromKey);
    });

    const W = this.scale.width;
    const H = this.scale.height;

    // Dim backdrop (this scene runs as an overlay when launched from pause).
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.78);
    overlay.fillRect(0, 0, W, H);
    // Eat clicks so they don't reach buttons in the paused scene underneath.
    this.add
      .zone(0, 0, W, H)
      .setOrigin(0)
      .setInteractive();

    // Panel.
    const panelW = 380;
    const panelH = 446;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");

    this.add
      .text(W / 2, py + 34, "SETTINGS", {
        fontFamily: FONT_TITLE,
        fontSize: "20px",
        color: "#f0a500",
      })
      .setOrigin(0.5);

    const cx = W / 2;
    let by = py + 84;
    const STEP = 58;

    this.zoomBtn = makeMenuButton(this, cx, by, this.zoomLabel(), {
      onClick: () => this.cycleZoom(),
    });
    by += STEP;

    this.soundBtn = makeMenuButton(this, cx, by, this.soundLabel(), {
      onClick: () => this.toggleSound(),
    });
    by += STEP;

    this.fullscreenBtn = makeMenuButton(this, cx, by, this.fullscreenLabel(), {
      onClick: () => this.scale.toggleFullscreen(),
    });
    by += STEP;

    makeMenuButton(this, cx, by, "CONTROLS", {
      onClick: () => this.showControls(),
    });
    by += STEP + 14;

    makeMenuButton(this, cx, by, "BACK", {
      variant: "grey",
      onClick: () => this.scene.stop(),
    });

    // Keep the fullscreen label in sync however it changes (button, F11, Esc).
    const syncFs = () => this.fullscreenBtn?.setText(this.fullscreenLabel());
    this.scale.on("enterfullscreen", syncFs);
    this.scale.on("leavefullscreen", syncFs);
    this.events.once("shutdown", () => {
      this.scale.off("enterfullscreen", syncFs);
      this.scale.off("leavefullscreen", syncFs);
    });

    // One keyboard handler drives both the rebind capture and Esc, so there's
    // no ambiguity about which fires first.
    this.input.keyboard?.on("keydown", this.onKeyDown, this);
    this.events.once("shutdown", () => this.input.keyboard?.off("keydown", this.onKeyDown, this));
  }

  private onKeyDown(e: KeyboardEvent) {
    if (this.listeningFor) {
      e.preventDefault();
      if (e.key === "Escape") {
        this.cancelListening();
        return;
      }
      const name = eventToKeyName(e);
      if (!name) return; // unsupported key — keep listening
      setKeybind(this.listeningFor, name);
      this.listeningFor = undefined;
      this.refreshKeyButtons();
      return;
    }
    if (e.key === "Escape") {
      if (this.controlsObjects.length > 0) this.hideControls();
      else this.scene.stop();
    }
  }

  private fullscreenLabel(): string {
    return `FULLSCREEN:  ${this.scale.isFullscreen ? "ON" : "OFF"}`;
  }

  // Interactive remap overlay: each row shows an action and a clickable button
  // with its current key; clicking listens for the next key press.
  private showControls() {
    if (this.controlsObjects.length > 0) return;
    const W = this.scale.width;
    const H = this.scale.height;

    // Built after the settings buttons, so it stacks on top by display order;
    // the full-screen blocker eats clicks meant for the panel underneath.
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.7).setOrigin(0);
    const blocker = this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();
    const rowH = 30;
    const panelW = 440;
    const panelH = 58 + REMAP_ROWS.length * rowH + 92;
    const py = (H - panelH) / 2;
    const box = panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");
    const title = this.add
      .text(W / 2, py + 28, "CONTROLS", { fontFamily: FONT_TITLE, fontSize: "18px", color: "#f0a500" })
      .setOrigin(0.5);
    const hint = this.add
      .text(W / 2, py + 48, "Arrows always move  •  Esc pauses", {
        fontFamily: FONT_CHAT, fontSize: "12px", color: COLORS.textDim,
      })
      .setOrigin(0.5)
      .setResolution(3);
    this.controlsObjects.push(dim, blocker, box, title, hint);

    const leftX = W / 2 - panelW / 2 + 30;
    const btnX = W / 2 + panelW / 2 - 90;
    REMAP_ROWS.forEach(([action, label], i) => {
      const ry = py + 70 + i * rowH + rowH / 2;
      const a = this.add
        .text(leftX, ry, label, { fontFamily: FONT_CHAT, fontSize: "15px", color: COLORS.text })
        .setOrigin(0, 0.5)
        .setResolution(3);
      const btn = makeMenuButton(this, btnX, ry, prettyKey(getKeybinds()[action]), {
        width: 128,
        height: 26,
        onClick: () => this.startListening(action),
      });
      this.keyButtons.set(action, btn);
      this.controlsObjects.push(a, btn.container);
    });

    const resetBtn = makeMenuButton(this, W / 2 - 86, py + panelH - 34, "RESET", {
      width: 150,
      height: 38,
      variant: "grey",
      onClick: () => {
        resetKeybinds();
        this.cancelListening();
        this.refreshKeyButtons();
      },
    });
    const closeBtn = makeMenuButton(this, W / 2 + 86, py + panelH - 34, "CLOSE", {
      width: 150,
      height: 38,
      onClick: () => this.hideControls(),
    });
    this.controlsObjects.push(resetBtn.container, closeBtn.container);
  }

  // Enter "press a key" mode for one action.
  private startListening(action: ControlAction) {
    this.cancelListening();
    this.listeningFor = action;
    this.keyButtons.get(action)?.setText("Press…");
  }

  private cancelListening() {
    this.listeningFor = undefined;
    this.refreshKeyButtons();
  }

  // Refresh every key button's label from the saved binds.
  private refreshKeyButtons() {
    for (const [action, btn] of this.keyButtons) {
      btn.setText(prettyKey(getKeybinds()[action]));
    }
  }

  private hideControls() {
    this.listeningFor = undefined;
    this.keyButtons.clear();
    for (const o of this.controlsObjects) o.destroy();
    this.controlsObjects.length = 0;
  }

  private zoomLabel(): string {
    return `ZOOM:  ${loadSettings().defaultZoom}x`;
  }

  private soundLabel(): string {
    return `SOUND:  ${loadSettings().soundEnabled ? "ON" : "OFF"}`;
  }

  private cycleZoom() {
    const s = loadSettings();
    const idx = ZOOM_OPTIONS.indexOf(s.defaultZoom);
    const next = ZOOM_OPTIONS[(idx + 1) % ZOOM_OPTIONS.length];
    saveSettings({ ...s, defaultZoom: next });
    this.zoomBtn?.setText(this.zoomLabel());
  }

  private toggleSound() {
    const s = loadSettings();
    saveSettings({ ...s, soundEnabled: !s.soundEnabled });
    this.soundBtn?.setText(this.soundLabel());
  }
}
