// Client-side identity is now anchored to a Hack Club account. We keep a
// session token (sent to the server to authenticate the socket) plus the
// account id + display name the server hands back on login.
const SESSION_KEY = "pixlgame:session";
const ACCOUNT_KEY = "pixlgame:accountId";
const NAME_KEY = "pixlgame:accountName";

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string) {
  localStorage.setItem(SESSION_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(NAME_KEY);
}

export function hasSession(): boolean {
  return !!localStorage.getItem(SESSION_KEY);
}

// The account id is the player's stable identity (used for world ownership,
// seeds, etc). Populated from /auth/verify at boot and the socket `init`.
export function getAccountId(): string {
  return localStorage.getItem(ACCOUNT_KEY) ?? "";
}

export function setAccountId(id: string) {
  localStorage.setItem(ACCOUNT_KEY, id);
}

export function getAccountName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function setAccountName(name: string) {
  localStorage.setItem(NAME_KEY, name);
}

// Chosen character skin index. -1 means "not chosen — use the server default".
const CHAR_KEY = "pixlgame:char";

export function getCharIndex(): number {
  const v = localStorage.getItem(CHAR_KEY);
  return v === null ? -1 : Number(v);
}

export function setCharIndex(index: number) {
  localStorage.setItem(CHAR_KEY, String(index));
}

// Custom hand-drawn skin (encoded pixel grid; see src/world/skin.ts). null
// means "no custom skin — use the preset". Mirrors the server-side account
// value so the editor can preload the last drawing and the avatar applies it
// before the socket `init` round-trips.
const SKIN_KEY = "pixlgame:skin";

export function getCustomSkin(): string | null {
  return localStorage.getItem(SKIN_KEY);
}

export function setCustomSkin(skin: string) {
  localStorage.setItem(SKIN_KEY, skin);
}

export function clearCustomSkin() {
  localStorage.removeItem(SKIN_KEY);
}
