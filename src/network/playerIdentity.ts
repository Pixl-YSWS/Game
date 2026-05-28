const KEY = "pixlgame:playerId";

// Returns a stable per-browser id. Persisted in localStorage so the server
// recognises the same player across reloads / sessions and hands back the
// same world seed.
export function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
