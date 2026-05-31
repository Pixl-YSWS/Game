const KEY = "pixlgame.settings.v1";

// Rebindable actions. Movement defaults to WASD (arrow keys always work too as
// fixed alternates). Stored as Phaser key-code names (e.g. "W", "SHIFT", "UP").
export type ControlAction =
  | "up" | "down" | "left" | "right" | "run"
  | "interact" | "chat" | "players" | "invite" | "inbox" | "bag";

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
};

export interface GameSettings {
  defaultZoom: number;
  soundEnabled: boolean;
  keybinds: Record<ControlAction, string>;
}

const DEFAULTS: GameSettings = {
  defaultZoom: 4,
  soundEnabled: true,
  keybinds: { ...DEFAULT_KEYBINDS },
};

let cached: GameSettings | null = null;

export function loadSettings(): GameSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      // keybinds is nested, so merge it on top of the defaults explicitly
      // (a plain spread would drop any actions added since the save).
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
