const KEY = "pixlgame.settings.v1";

export interface GameSettings {
  defaultZoom: number;
  soundEnabled: boolean;
}

const DEFAULTS: GameSettings = {
  defaultZoom: 4,
  soundEnabled: true,
};

let cached: GameSettings | null = null;

export function loadSettings(): GameSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      cached = { ...DEFAULTS, ...parsed };
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

export const ZOOM_OPTIONS = [3, 4, 5, 6];
