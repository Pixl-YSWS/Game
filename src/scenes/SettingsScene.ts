import Phaser from "phaser";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";
import { CURSORS } from "../ui/theme";
import {
  loadSettings,
  saveSettings,
  ZOOM_OPTIONS,
  HUD_SCALE_OPTIONS,
  getKeybinds,
  setKeybind,
  resetKeybinds,
  type ControlAction,
} from "../data/Settings";

interface SettingsInit {
  from?: string;
}

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
  ["talk", "Toggle Mic"],
];

export function prettyKey(name: string): string {
  const map: Record<string, string> = {
    UP: "↑",
    DOWN: "↓",
    LEFT: "←",
    RIGHT: "→",
    SHIFT: "Shift",
    SPACE: "Space",
    ENTER: "Enter",
    TAB: "Tab",
  };
  return map[name] ?? name;
}

export function eventToKeyName(e: KeyboardEvent): string | null {
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) return e.key.toUpperCase();
  if (e.key.length === 1 && /[0-9]/.test(e.key)) {
    return [
      "ZERO", "ONE", "TWO", "THREE", "FOUR",
      "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
    ][+e.key];
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
  private modal?: DomModal;
  private fromKey?: string;
  private statusLabels: Map<string, HTMLSpanElement> = new Map();

  private controlsModal?: DomModal;
  private keySpans: Map<ControlAction, HTMLSpanElement> = new Map();
  private listeningFor?: ControlAction;
  private onKey?: (e: KeyboardEvent) => void;

  constructor() {
    super({ key: "SettingsScene" });
  }

  init(data: SettingsInit) {
    this.fromKey = data?.from;
  }

  create() {
    if (this.fromKey) this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      if (this.fromKey) this.scene.resume(this.fromKey);
      if (this.onKey) window.removeEventListener("keydown", this.onKey, true);
      this.modal = undefined;
    });

    this.modal = openDomModal(this, {
      title: "Settings",
      width: 420,
      onClose: () => this.scene.stop(),
      bgVideo:
        this.fromKey === "MainMenuScene" ? "/main-menu.mp4" : undefined,
    });

    const body = this.modal.body;

    body.append(this.settingRow("Zoom", this.zoomLabel(), () => this.cycleZoom()));
    body.append(this.settingRow("HUD Size", this.hudLabel(), () => this.cycleHud()));
    body.append(this.settingRow("Sound", this.soundLabel(), () => this.toggleSound()));
    body.append(this.settingRow("Voice Chat", this.voiceLabel(), () => this.toggleVoice()));
    body.append(this.settingRow("Fullscreen", this.fullscreenLabel(), () => this.scale.toggleFullscreen()));

    const controlsRow = el("div", "pixl-row");
    const controlsLabel = el("div", "pixl-row-main");
    controlsLabel.append(el("div", "pixl-row-name", "Controls"));
    controlsRow.append(controlsLabel, domBtn(this, "Remap", () => this.showControls()));
    body.append(controlsRow);

    const actions = el("div", "pixl-actions");
    actions.append(domBtn(this, "Back", () => this.scene.stop(), { variant: "grey", big: true }));
    body.append(actions);

    const syncFs = () => this.statusLabels.get("Fullscreen")!.textContent = this.fullscreenLabel();
    this.scale.on("enterfullscreen", syncFs);
    this.scale.on("leavefullscreen", syncFs);
    this.events.once("shutdown", () => {
      this.scale.off("enterfullscreen", syncFs);
      this.scale.off("leavefullscreen", syncFs);
    });
  }

  private settingRow(label: string, status: string, onClick: () => void): HTMLDivElement {
    const row = el("div", "pixl-row");
    const main = el("div", "pixl-row-main");
    main.append(el("div", "pixl-row-name", label));
    const span = document.createElement("span");
    span.className = "pixl-row-meta";
    span.textContent = status;
    main.append(span);
    this.statusLabels.set(label, span);
    row.append(main, domBtn(this, "Toggle", onClick));
    row.style.cursor = CURSORS.pointer;
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName !== "BUTTON") onClick();
    });
    return row;
  }

  private showControls() {
    if (this.controlsModal) return;

    this.controlsModal = openDomModal(this, {
      title: "Controls",
      width: 500,
      onClose: () => this.hideControls(),
    });

    const body = this.controlsModal.body;
    const hint = el("div", "pixl-hint");
    hint.textContent = "Arrows always move  •  Esc pauses";
    body.append(hint);

    const list = el("div", "pixl-list");
    list.style.maxHeight = "360px";

    REMAP_ROWS.forEach(([action, label]) => {
      const row = el("div", "pixl-row");
      const nameEl = el("div", "pixl-row-name", label);
      row.append(nameEl);

      const keySpan = document.createElement("span");
      keySpan.className = "pixl-btn";
      keySpan.style.fontSize = "13px";
      keySpan.style.padding = "4px 14px 3px";
      keySpan.style.cursor = CURSORS.pointer;
      keySpan.textContent = prettyKey(getKeybinds()[action]);
      keySpan.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startListening(action);
      });
      this.keySpans.set(action, keySpan);
      row.append(keySpan);
      list.append(row);
    });

    body.append(list);

    const actions = el("div", "pixl-actions");
    actions.append(
      domBtn(this, "Reset", () => {
        resetKeybinds();
        this.refreshKeySpans();
      }, { variant: "grey", big: true }),
      domBtn(this, "Close", () => this.hideControls(), { big: true }),
    );
    body.append(actions);

    this.onKey = (e: KeyboardEvent) => {
      if (this.listeningFor) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          this.listeningFor = undefined;
          this.refreshKeySpans();
          return;
        }
        const name = eventToKeyName(e);
        if (!name) return;
        setKeybind(this.listeningFor, name);
        this.listeningFor = undefined;
        this.refreshKeySpans();
        return;
      }
      if (e.key === "Escape") {
        this.hideControls();
      }
    };
    window.addEventListener("keydown", this.onKey, true);
  }

  private startListening(action: ControlAction) {
    this.listeningFor = action;
    const span = this.keySpans.get(action);
    if (span) span.textContent = "Press…";
  }

  private refreshKeySpans() {
    for (const [action, span] of this.keySpans) {
      span.textContent = prettyKey(getKeybinds()[action]);
    }
  }

  private hideControls() {
    this.listeningFor = undefined;
    this.keySpans.clear();
    if (this.onKey) {
      window.removeEventListener("keydown", this.onKey, true);
      this.onKey = undefined;
    }
    if (this.controlsModal) {
      this.controlsModal.destroy();
      this.controlsModal = undefined;
    }
  }

  private fullscreenLabel(): string {
    return `FULLSCREEN:  ${this.scale.isFullscreen ? "ON" : "OFF"}`;
  }

  private zoomLabel(): string {
    return `ZOOM:  ${loadSettings().defaultZoom}x`;
  }

  private hudLabel(): string {
    return `HUD SIZE:  ${Math.round(loadSettings().hudScale * 100)}%`;
  }

  private soundLabel(): string {
    return `SOUND:  ${loadSettings().soundEnabled ? "ON" : "OFF"}`;
  }

  private voiceLabel(): string {
    return `VOICE CHAT:  ${loadSettings().voiceEnabled ? "ON" : "OFF"}`;
  }

  private cycleZoom() {
    const s = loadSettings();
    const idx = ZOOM_OPTIONS.indexOf(s.defaultZoom);
    const next = ZOOM_OPTIONS[(idx + 1) % ZOOM_OPTIONS.length];
    saveSettings({ ...s, defaultZoom: next });
    this.statusLabels.get("Zoom")!.textContent = this.zoomLabel();
  }

  private cycleHud() {
    const s = loadSettings();
    const idx = HUD_SCALE_OPTIONS.indexOf(s.hudScale);
    const next = HUD_SCALE_OPTIONS[(idx + 1) % HUD_SCALE_OPTIONS.length];
    saveSettings({ ...s, hudScale: next });
    this.statusLabels.get("HUD Size")!.textContent = this.hudLabel();
  }

  private toggleSound() {
    const s = loadSettings();
    saveSettings({ ...s, soundEnabled: !s.soundEnabled });
    this.statusLabels.get("Sound")!.textContent = this.soundLabel();
  }

  private toggleVoice() {
    const s = loadSettings();
    saveSettings({ ...s, voiceEnabled: !s.voiceEnabled });
    this.statusLabels.get("Voice Chat")!.textContent = this.voiceLabel();
  }
}
