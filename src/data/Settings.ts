// MOSTLY WRITTEN BY CLAUDE ;(
// ik disappointing...

const KEY = "pixlgame.settings.v1";

export type ControlAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "run"
  | "interact"
  | "chat"
  | "players"
  | "invite"
  | "inbox"
  | "bag"
  | "talk";

export const DEFAULT_KEYBINDS: Record<ControlAction, string> = {
  up: "W",
  down: "S",
  left: "A",
  right: "D",
  run: "SHIFT",
  interact: "E",
  chat: "ENTER",
  players: "TAB",
  invite: "I",
  inbox: "N",
  bag: "B",

  talk: "V",
};

export interface GameSettings {
  defaultZoom: number;
  hudScale: number;
  soundEnabled: boolean;

  voiceEnabled: boolean;
  keybinds: Record<ControlAction, string>;
}

const DEFAULTS: GameSettings = {
  defaultZoom: 4,
  hudScale: 1,
  soundEnabled: true,
  voiceEnabled: true,
  keybinds: { ...DEFAULT_KEYBINDS },
};

let cached: GameSettings | null = null;

export function loadSettings(): GameSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;

      cached = {
        ...DEFAULTS,
        ...parsed,
        keybinds: { ...DEFAULT_KEYBINDS, ...(parsed.keybinds ?? {}) },
      };
      return cached;
    }
  } catch {}
  cached = { ...DEFAULTS };
  return cached;
}

export function saveSettings(next: GameSettings) {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export function getKeybinds(): Record<ControlAction, string> {
  return loadSettings().keybinds;
}

export function setKeybind(action: ControlAction, key: string) {
  const s = loadSettings();
  saveSettings({ ...s, keybinds: { ...s.keybinds, [action]: key } });
}

export function resetKeybinds() {
  const s = loadSettings();
  saveSettings({ ...s, keybinds: { ...DEFAULT_KEYBINDS } });
}

export const ZOOM_OPTIONS = [3, 4, 5, 6];
export const HUD_SCALE_OPTIONS = [1, 1.25, 1.5];
