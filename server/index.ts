import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { promises as fs } from "fs";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import type {
  PlayerState,
  ServerToClientEvents,
  ClientToServerEvents,
  WorldRef,
  WorldState,
  Notification,
  HouseObject,
  InventoryEntry,
} from "../src/types/network.ts";
import { generateMap } from "../src/world/MapGen.ts";
import { makeHouseInterior } from "../src/world/HouseMap.ts";
import { getShopItem } from "../src/shop/catalog.ts";
import { setupAuth, type Account } from "./auth.ts";
import { censorChat } from "./moderation.ts";
import type { ModRole, AdminEntry, MuteEntry, AdminPlayerEntry } from "../src/types/network.ts";

// Fixed seed for the shared open world. Anything stable & distinct from
// the player-id-derived seeds is fine; spelling something out makes it
// easy to recognise in logs.
const OPENWORLD_SEED = 0xC0FFEE;

// Row shape for the notifications table (sans the `read` flag, which the
// client never sees).
interface NotificationRow {
  id: number;
  type: string;
  from_id: string;
  from_name: string;
  message: string | null;
  status: string;
  created_at: number;
}

// 8 minutes of real time per full day/night cycle. Tweak to taste.
const DAY_LENGTH_MS = 8 * 60 * 1000;
// Anchor point so cycle is consistent across all clients in this session.
// `tNow=0` corresponds to midnight at SERVER_BOOT.
const SERVER_BOOT = Date.now();
function currentDayT(): number {
  return ((Date.now() - SERVER_BOOT) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
}

// ── Seed persistence (SQLite) ────────────────────────────────────
// DATA_DIR defaults to a folder next to the code for local dev, but on a
// host like Railway set DATA_DIR to a mounted volume (e.g. /data) so the
// database survives redeploys instead of living on the ephemeral filesystem.
const DATA_DIR = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "players.db"));
db.run("PRAGMA journal_mode = WAL");
db.run(`
  CREATE TABLE IF NOT EXISTS players (
    player_id  TEXT PRIMARY KEY,
    seed       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Idempotent column adds — SQLite has no IF NOT EXISTS for ALTER, so try
// each one and swallow the "duplicate column" error on subsequent boots.
function addColumnIfMissing(sql: string) {
  try { db.run(sql); }
  catch (e: any) {
    if (!/duplicate column name/i.test(String(e?.message))) throw e;
  }
}
addColumnIfMissing("ALTER TABLE players ADD COLUMN last_world TEXT");
addColumnIfMissing("ALTER TABLE players ADD COLUMN last_cx   INTEGER");
addColumnIfMissing("ALTER TABLE players ADD COLUMN last_cy   INTEGER");
addColumnIfMissing("ALTER TABLE players ADD COLUMN pixels    INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("ALTER TABLE players ADD COLUMN updated_at INTEGER");

// Records which NPC rewards each player has already collected, so one-shot
// rewards stay one-shot across reconnects.
db.run(`
  CREATE TABLE IF NOT EXISTS npc_rewards (
    player_id  TEXT NOT NULL,
    npc_id     TEXT NOT NULL,
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, npc_id)
  )
`);

// Per-player count of each shop item the player owns. Used today only
// for persistence; future hotbar/inventory features will read from here.
db.run(`
  CREATE TABLE IF NOT EXISTS inventory (
    player_id TEXT NOT NULL,
    item_id   TEXT NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, item_id)
  )
`);
const incrementInventory = db.query<unknown, [string, string, number]>(
  "INSERT INTO inventory (player_id, item_id, count) VALUES (?, ?, ?) " +
    "ON CONFLICT(player_id, item_id) DO UPDATE SET count = inventory.count + excluded.count",
);
const selectInventory = db.query<{ item_id: string; count: number }, [string]>(
  "SELECT item_id, count FROM inventory WHERE player_id = ? AND count > 0 ORDER BY item_id",
);
const itemCount = db.query<{ count: number }, [string, string]>(
  "SELECT count FROM inventory WHERE player_id = ? AND item_id = ?",
);
const decrementInventory = db.query<unknown, [string, string]>(
  "UPDATE inventory SET count = count - 1 WHERE player_id = ? AND item_id = ? AND count > 0",
);

// Furniture placed in the single shared house. No house key is needed since
// there's exactly one shared interior.
db.run(`
  CREATE TABLE IF NOT EXISTS house_objects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    TEXT NOT NULL,
    cx         INTEGER NOT NULL,
    cy         INTEGER NOT NULL,
    placed_by  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
const insertHouseObject = db.query<{ id: number }, [string, number, number, string, number]>(
  "INSERT INTO house_objects (item_id, cx, cy, placed_by, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
);
const selectHouseObjects = db.query<
  { id: number; item_id: string; cx: number; cy: number; placed_by: string },
  []
>("SELECT id, item_id, cx, cy, placed_by FROM house_objects ORDER BY id");
const selectHouseObject = db.query<
  { id: number; item_id: string; cx: number; cy: number; placed_by: string },
  [number]
>("SELECT id, item_id, cx, cy, placed_by FROM house_objects WHERE id = ?");
const deleteHouseObject = db.query<unknown, [number]>(
  "DELETE FROM house_objects WHERE id = ?",
);
const houseObjectAtTile = db.query<{ n: number }, [number, number]>(
  "SELECT COUNT(*) AS n FROM house_objects WHERE cx = ? AND cy = ?",
);

function inventoryItems(playerId: string): InventoryEntry[] {
  return selectInventory.all(playerId).map(r => ({ itemId: r.item_id, count: r.count }));
}
function houseObjectsList(): HouseObject[] {
  return selectHouseObjects.all().map(r => ({
    id: r.id, itemId: r.item_id, cx: r.cx, cy: r.cy, placedBy: r.placed_by,
  }));
}

// Remembered position PER world, so leaving and returning to your village
// puts you back where you stood instead of at the village spawn.
db.run(`
  CREATE TABLE IF NOT EXISTS player_positions (
    player_id  TEXT NOT NULL,
    world_key  TEXT NOT NULL,
    cx         INTEGER NOT NULL,
    cy         INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, world_key)
  )
`);
const upsertPosition = db.query<unknown, [string, string, number, number, number]>(
  "INSERT INTO player_positions (player_id, world_key, cx, cy, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(player_id, world_key) DO UPDATE SET cx = excluded.cx, cy = excluded.cy, updated_at = excluded.updated_at",
);
const selectPosition = db.query<{ cx: number; cy: number }, [string, string]>(
  "SELECT cx, cy FROM player_positions WHERE player_id = ? AND world_key = ?",
);
const hasNpcReward = db.query<{ n: number }, [string, string]>(
  "SELECT COUNT(*) AS n FROM npc_rewards WHERE player_id = ? AND npc_id = ?",
);
const insertNpcReward = db.query<unknown, [string, string, number]>(
  "INSERT INTO npc_rewards (player_id, npc_id, granted_at) VALUES (?, ?, ?)",
);

// Persistent inbox. Currently only village invites, but `type` leaves room
// for system messages later. `status` tracks the invite lifecycle; an
// accepted village_invite is what grants the recipient access to that
// owner's village (and surfaces a join button on their main menu).
db.run(`
  CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id TEXT NOT NULL,
    type         TEXT NOT NULL,
    from_id      TEXT NOT NULL,
    from_name    TEXT NOT NULL,
    message      TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    read         INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id)");

const insertNotification = db.query<unknown, [string, string, string, string, string | null, number]>(
  "INSERT INTO notifications (recipient_id, type, from_id, from_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const selectNotifications = db.query<NotificationRow, [string]>(
  "SELECT id, type, from_id, from_name, message, status, created_at FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 50",
);
const selectNotification = db.query<NotificationRow & { recipient_id: string }, [number]>(
  "SELECT id, recipient_id, type, from_id, from_name, message, status, created_at FROM notifications WHERE id = ?",
);
const setNotificationStatus = db.query<unknown, [string, number]>(
  "UPDATE notifications SET status = ? WHERE id = ?",
);
const markNotificationsRead = db.query<unknown, [string]>(
  "UPDATE notifications SET read = 1 WHERE recipient_id = ? AND read = 0",
);
const countUnread = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND read = 0",
);
// A pending invite from the same inviter shouldn't pile up duplicates.
const countPendingInviteFrom = db.query<{ n: number }, [string, string]>(
  "SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND from_id = ? AND type = 'village_invite' AND status = 'pending'",
);
// Villages this account has been granted access to (accepted invites).
const selectAcceptedVillages = db.query<{ from_id: string; from_name: string }, [string]>(
  "SELECT DISTINCT from_id, from_name FROM notifications WHERE recipient_id = ? AND type = 'village_invite' AND status = 'accepted'",
);
const hasAcceptedVillage = db.query<{ n: number }, [string, string]>(
  "SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND from_id = ? AND type = 'village_invite' AND status = 'accepted'",
);
// Create the auth schema (the `accounts` table) up front so the prepared
// statements below can compile against it on a fresh database. The returned
// router is mounted later where the Express app is set up.
const auth = setupAuth(db);

// Account directory for the invite search panel.
const selectAllAccounts = db.query<{ account_id: string; name: string }, []>(
  "SELECT account_id, name FROM accounts ORDER BY name COLLATE NOCASE",
);
const selectAccountName = db.query<{ name: string }, [string]>(
  "SELECT name FROM accounts WHERE account_id = ?",
);

// ── Moderation: admin roles + chat mutes ─────────────────────────
// Built-in root admin: this account is auto-granted "admin" on login and can
// never be demoted/muted. Extra root admins can be added via ADMIN_EMAILS
// (comma-separated) without touching code.
const ROOT_ADMIN_EMAILS = new Set(
  ["riditjangra09@gmail.com", ...(process.env.ADMIN_EMAILS ?? "").split(",")]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

db.run(`
  CREATE TABLE IF NOT EXISTS admins (
    account_id TEXT PRIMARY KEY,
    role       TEXT NOT NULL,
    added_by   TEXT,
    created_at INTEGER NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS mutes (
    account_id TEXT PRIMARY KEY,
    reason     TEXT,
    muted_by   TEXT,
    created_at INTEGER NOT NULL
  )
`);
const selectRole = db.query<{ role: string }, [string]>(
  "SELECT role FROM admins WHERE account_id = ?",
);
const upsertRole = db.query<unknown, [string, string, string, number]>(
  "INSERT INTO admins (account_id, role, added_by, created_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(account_id) DO UPDATE SET role = excluded.role",
);
const deleteRole = db.query<unknown, [string]>("DELETE FROM admins WHERE account_id = ?");
const selectAdmins = db.query<{ account_id: string; role: string }, []>(
  "SELECT account_id, role FROM admins ORDER BY role, account_id",
);
const isMutedRow = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM mutes WHERE account_id = ?",
);
const upsertMute = db.query<unknown, [string, string | null, string, number]>(
  "INSERT INTO mutes (account_id, reason, muted_by, created_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(account_id) DO UPDATE SET reason = excluded.reason, muted_by = excluded.muted_by",
);
const deleteMute = db.query<unknown, [string]>("DELETE FROM mutes WHERE account_id = ?");
const selectMutes = db.query<{ account_id: string; reason: string | null }, []>(
  "SELECT account_id, reason FROM mutes ORDER BY created_at DESC",
);

function roleOf(accountId: string): ModRole {
  const r = selectRole.get(accountId)?.role;
  return r === "admin" || r === "subadmin" ? r : null;
}
function isMuted(accountId: string): boolean {
  return (isMutedRow.get(accountId)?.n ?? 0) > 0;
}
// Auto-grant the built-in root admin on login, by email.
function ensureRootAdmin(account: Account) {
  if (!account.email) return;
  if (!ROOT_ADMIN_EMAILS.has(account.email.toLowerCase())) return;
  if (roleOf(account.accountId) !== "admin") {
    upsertRole.run(account.accountId, "admin", "root", Date.now());
    console.log(`[admin] root admin granted to ${account.name} (${account.accountId})`);
  }
}

function unreadCount(playerId: string): number {
  return countUnread.get(playerId)?.n ?? 0;
}

function nameForAccount(accountId: string): string | undefined {
  return selectAccountName.get(accountId)?.name;
}

// Strip a DB row down to the client-facing Notification shape.
function toClientNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type as "village_invite",
    fromId: row.from_id,
    fromName: row.from_name,
    message: row.message ?? undefined,
    status: row.status as "pending" | "accepted" | "declined",
    createdAt: row.created_at,
  };
}

const selectSeed = db.query<{ seed: number }, [string]>(
  "SELECT seed FROM players WHERE player_id = ?",
);
const insertSeed = db.query<unknown, [string, number, number]>(
  "INSERT INTO players (player_id, seed, created_at) VALUES (?, ?, ?)",
);

function getOrCreateSeed(playerId: string): number {
  const row = selectSeed.get(playerId);
  if (row) return row.seed;
  const seed = Math.floor(Math.random() * 0x100000000);
  insertSeed.run(playerId, seed, Date.now());
  console.log(`[seeds] new player ${playerId.slice(0, 8)}… seed=${seed}`);
  return seed;
}

// ── Persistent player state ─────────────────────────────────────
function serializeWorld(w: WorldRef): string {
  if (w.kind === "openworld") return "openworld";
  if (w.kind === "house") return "house";
  return `village:${w.ownerPlayerId}`;
}

function deserializeWorld(s: string): WorldRef | null {
  if (s === "openworld") return { kind: "openworld" };
  if (s === "house") return { kind: "house" };
  if (s.startsWith("village:")) {
    const ownerPlayerId = s.slice("village:".length);
    if (!ownerPlayerId) return null;
    return { kind: "village", ownerPlayerId };
  }
  return null;
}

const selectSummary = db.query<
  { last_world: string | null; pixels: number },
  [string]
>("SELECT last_world, pixels FROM players WHERE player_id = ?");

const updateSummary = db.query<unknown, [string, number, number, string]>(
  "UPDATE players SET last_world = ?, pixels = ?, updated_at = ? WHERE player_id = ?",
);

interface LoadedPlayer {
  pixels: number;
  // Last world + remembered position there, or null if never persisted.
  position: { world: WorldRef; cx: number; cy: number } | null;
}

function loadPlayerState(playerId: string): LoadedPlayer | null {
  const row = selectSummary.get(playerId);
  if (!row) return null;
  const pixels = row.pixels ?? 0;
  if (!row.last_world) return { pixels, position: null };
  const world = deserializeWorld(row.last_world);
  if (!world) return { pixels, position: null };
  const pos = selectPosition.get(playerId, row.last_world);
  if (!pos) return { pixels, position: null };
  return { pixels, position: { world, cx: pos.cx, cy: pos.cy } };
}

function getRememberedPosition(
  playerId: string,
  world: WorldRef,
): { cx: number; cy: number } | null {
  return selectPosition.get(playerId, serializeWorld(world)) ?? null;
}

function isWalkable(world: WorldRef, cx: number, cy: number): boolean {
  const m = mapFor(world);
  if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return false;
  const g = m.groundLayer[cy]?.[cx];
  if (g === undefined || !m.walkableGround.has(g)) return false;
  const d = m.decoLayer[cy]?.[cx];
  if (d !== undefined && d >= 0 && m.solidDeco.has(d)) return false;
  return true;
}

async function migrateLegacyJson() {
  const legacy = join(DATA_DIR, "players.json");
  try {
    const txt = await fs.readFile(legacy, "utf-8");
    const old: Record<string, number> = JSON.parse(txt);
    const ins = db.query("INSERT OR IGNORE INTO players (player_id, seed, created_at) VALUES (?, ?, ?)");
    let n = 0;
    for (const [pid, seed] of Object.entries(old)) {
      const r = ins.run(pid, seed, Date.now());
      if (r.changes > 0) n++;
    }
    if (n > 0) console.log(`[seeds] migrated ${n} player(s) from players.json`);
  } catch (e: any) {
    if (e.code !== "ENOENT") console.error("[seeds] legacy migration failed:", e);
  }
}

// ── World helpers ────────────────────────────────────────────────

type WorldKey = "openworld" | "house" | `village:${string}`;

function worldKey(world: WorldRef): WorldKey {
  if (world.kind === "openworld") return "openworld";
  if (world.kind === "house") return "house";
  return `village:${world.ownerPlayerId}`;
}

function worldSeed(world: WorldRef): number {
  if (world.kind === "openworld") return OPENWORLD_SEED;
  if (world.kind === "house") return 0;
  return getOrCreateSeed(world.ownerPlayerId);
}

// Generated map cache, keyed by WorldKey. The MapDef is large; caching
// avoids regenerating it on every world switch / spawn lookup.
const mapCache = new Map<WorldKey, ReturnType<typeof generateMap>>();
function mapFor(world: WorldRef) {
  const key = worldKey(world);
  let m = mapCache.get(key);
  if (!m) {
    m = world.kind === "house"
      ? makeHouseInterior()
      : generateMap(worldSeed(world), { houses: world.kind !== "openworld" });
    mapCache.set(key, m);
  }
  return m;
}

// ── HTTP / Socket.IO ─────────────────────────────────────────────
const app = express();
app.use(cors());

// Lightweight health/landing route so hitting the server root returns 200
// (used as a reachability check and by platform healthchecks).
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "pixl-game-server" });
});

// Hack Club OAuth routes (/auth/login, /auth/callback, /auth/verify).
// `auth` is created earlier (so its schema exists before prepared statements
// compile); here we just mount its router.
app.use("/auth", auth.router);

// Villages this account may visit (from accepted invites), for the main menu.
// Token-gated like /auth/verify since the menu has no live socket yet.
app.get("/api/villages", (req, res) => {
  const token =
    (typeof req.query.token === "string" && req.query.token) ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "");
  const account = token ? auth.verifySession(token) : null;
  if (!account) {
    res.status(401).json({ ok: false });
    return;
  }
  const villages = selectAcceptedVillages
    .all(account.accountId)
    .map(v => ({ ownerId: v.from_id, name: v.from_name }));
  res.json({ ok: true, villages });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

// Reject any socket without a valid Hack Club session token. This is what
// stops anonymous play — no game events are wired up until this passes.
io.use((socket, next) => {
  const token = (socket.handshake.auth as { sessionToken?: string })?.sessionToken;
  const account = typeof token === "string" ? auth.verifySession(token) : null;
  if (!account) {
    next(new Error("unauthorized"));
    return;
  }
  (socket.data as { account: Account }).account = account;
  next();
});

interface ServerPlayerState extends PlayerState {
  playerId: string;
  world: WorldRef;
  pixels: number;
  char: number;
  verified: boolean;
}
const players = new Map<string, ServerPlayerState>();
// account id -> the one socket id currently allowed to play it (single session).
const liveByAccount = new Map<string, string>();

// Any logged-in account can enter the open world by default — note that most
// Hack Club accounts are NOT "verified" (that's a separate identity check), so
// gating on it would lock out normal logins. Opt into strict verified-only
// access with OPENWORLD_VERIFIED_ONLY=true. Guests always get in.
const OPENWORLD_REQUIRES_VERIFIED = process.env.OPENWORLD_VERIFIED_ONLY === "true";
function canEnterOpenworld(p: { verified: boolean; playerId: string }): boolean {
  if (!OPENWORLD_REQUIRES_VERIFIED) return true;
  if (p.playerId.startsWith("guest_")) return true;
  return p.verified;
}

// Socket ids whose state has changed but isn't persisted yet. Flushed in
// batches every FLUSH_INTERVAL_MS so we don't write SQLite on every tile
// step (a player walking is ~8 steps/sec).
const dirty = new Set<string>();
const FLUSH_INTERVAL_MS = 2000;

function markDirty(socketId: string) {
  dirty.add(socketId);
}

function persistPlayerState(state: ServerPlayerState) {
  try {
    const now = Date.now();
    const worldStr = serializeWorld(state.world);
    // Position is keyed by world so the previous slot for OTHER worlds is
    // preserved — visiting open world doesn't clobber the village position.
    upsertPosition.run(state.playerId, worldStr, state.cx, state.cy, now);
    updateSummary.run(worldStr, state.pixels, now, state.playerId);
  } catch (e) {
    // Don't let a persistence hiccup kill a world switch — the player can
    // keep playing; we just lose this snapshot.
    console.error("[persist] failed for", state.playerId.slice(0, 8) + "…", e);
  }
}

setInterval(() => {
  if (dirty.size === 0) return;
  for (const sid of dirty) {
    const state = players.get(sid);
    if (state) persistPlayerState(state);
  }
  dirty.clear();
}, FLUSH_INTERVAL_MS);

// Per-socket timestamps of the last chat line / emote, for rate limiting.
const chatLast = new Map<string, number>();
const emoteLast = new Map<string, number>();
// Per-socket timestamp of the last voice clip, + a hard size cap (~16s of Opus).
const voiceLast = new Map<string, number>();
const MAX_VOICE_BYTES = 800_000;
// Emotes the server will relay. Keep in sync with EMOTES in src/ui/emotes.ts.
const ALLOWED_EMOTES = new Set([
  "happy", "laugh", "heart", "sad", "angry", "love", "cry", "idea",
  "music", "sleep", "star", "question", "alert", "exclaim", "dizzy",
]);

// Resolve an account id to its live socket id, if that account is online.
function socketIdForAccount(accountId: string): string | undefined {
  return liveByAccount.get(accountId);
}

function peersInWorld(world: WorldRef, exceptSocketId?: string): PlayerState[] {
  const target = worldKey(world);
  return [...players.values()]
    .filter(p => worldKey(p.world) === target && p.id !== exceptSocketId)
    .map(({ id, cx, cy, name, char, verified }) => ({ id, cx, cy, name, char, verified }));
}

function worldStateFor(state: ServerPlayerState): WorldState {
  mapFor(state.world); // ensure the map is cached so spawn lookups are consistent
  return {
    world: state.world,
    seed: worldSeed(state.world),
    spawn: { cx: state.cx, cy: state.cy },
    players: peersInWorld(state.world, state.id),
  };
}

// Move a connected socket into a new world. Handles room membership,
// player:leave for the old world, world:state to the switcher, and
// player:join broadcast to the new world.
function switchWorld(socket: import("socket.io").Socket<ClientToServerEvents, ServerToClientEvents>, next: WorldRef) {
  const state = players.get(socket.id);
  if (!state) return;
  const oldRoom = worldKey(state.world);
  const newRoom = worldKey(next);
  if (oldRoom === newRoom) return;

  // Save where they were in the OLD world before overwriting state, so
  // returning here later restores the same spot.
  persistPlayerState(state);

  socket.leave(oldRoom);
  socket.to(oldRoom).emit("player:leave", socket.id);

  state.world = next;
  // The shared house is a small transient room whose only exit is the door
  // tile. Restoring a remembered position there would spawn the player ON the
  // door (that's where they stood to leave), and the door-step exit only fires
  // on a tile *change* onto the door — so they'd be unable to get back out.
  // Always spawn at the house's spawnPoint (just above the door) instead.
  const remembered = next.kind === "house"
    ? null
    : getRememberedPosition(state.playerId, next);
  if (remembered && isWalkable(next, remembered.cx, remembered.cy)) {
    state.cx = remembered.cx;
    state.cy = remembered.cy;
  } else {
    const nextMap = mapFor(next);
    state.cx = nextMap.spawnPoint.cx;
    state.cy = nextMap.spawnPoint.cy;
  }

  socket.join(newRoom);
  socket.emit("world:state", worldStateFor(state));
  if (next.kind === "house") socket.emit("house:objects", { objects: houseObjectsList() });
  socket.to(newRoom).emit("player:join", {
    id: state.id, cx: state.cx, cy: state.cy, name: state.name,
    char: state.char, verified: state.verified,
  });
  // World switches are the natural rollback points — persist the NEW
  // world's record too so a crash mid-session never strands a player.
  persistPlayerState(state);
  dirty.delete(socket.id);
  console.log(`[~] ${socket.id} → ${newRoom}  @(${state.cx},${state.cy})`);
}

io.on("connection", (socket) => {
  // Guaranteed by the io.use() auth middleware above.
  const account = (socket.data as { account: Account }).account;
  const playerId = account.accountId;
  // Auto-grant the built-in root admin (by email) the first time they connect.
  ensureRootAdmin(account);

  // Single session per account: a fresh login kicks any older live socket.
  const prevSocketId = liveByAccount.get(playerId);
  if (prevSocketId && prevSocketId !== socket.id) {
    const prevSock = io.sockets.sockets.get(prevSocketId);
    if (prevSock) {
      prevSock.emit("auth:kicked");
      prevSock.disconnect(true);
    }
  }
  liveByAccount.set(playerId, socket.id);

  // Restore saved world + position if we have one and it's still valid
  // (the tile must be walkable on the current map). A visit to someone
  // else's village never auto-resumes — invites are one-shot.
  const saved = loadPlayerState(playerId);
  let world: WorldRef;
  let cx: number;
  let cy: number;
  if (
    saved?.position &&
    (saved.position.world.kind !== "village" ||
      saved.position.world.ownerPlayerId === playerId) &&
    // Don't auto-resume into the open world if the account can't enter it.
    (saved.position.world.kind !== "openworld" ||
      canEnterOpenworld({ verified: account.verified, playerId })) &&
    isWalkable(saved.position.world, saved.position.cx, saved.position.cy)
  ) {
    world = saved.position.world;
    if (world.kind === "house") {
      // Same reasoning as switchWorld: never restore onto the house door tile.
      const map = mapFor(world);
      cx = map.spawnPoint.cx;
      cy = map.spawnPoint.cy;
    } else {
      cx = saved.position.cx;
      cy = saved.position.cy;
    }
  } else {
    world = { kind: "village", ownerPlayerId: playerId };
    const map = mapFor(world);
    cx = map.spawnPoint.cx;
    cy = map.spawnPoint.cy;
  }

  const state: ServerPlayerState = {
    id: socket.id,
    playerId,
    cx,
    cy,
    name: account.name,
    char: account.char,
    verified: account.verified,
    world,
    pixels: saved?.pixels ?? 0,
  };
  players.set(socket.id, state);
  const room = worldKey(world);
  socket.join(room);
  console.log(
    `[+] ${socket.id} (player ${playerId.slice(0, 8)}…) → ${room}  @(${cx},${cy})  ₱${state.pixels}`,
  );

  socket.emit("init", {
    id: socket.id,
    accountId: playerId,
    name: account.name,
    char: state.char,
    verified: state.verified,
    role: roleOf(playerId),
    world: worldStateFor(state),
    pixels: state.pixels,
    unread: unreadCount(playerId),
    dayCycle: {
      tNow: currentDayT(),
      dayLengthMs: DAY_LENGTH_MS,
      serverNow: Date.now(),
    },
  });
  socket.to(room).emit("player:join", {
    id: state.id, cx: state.cx, cy: state.cy, name: state.name,
    char: state.char, verified: state.verified,
  });
  if (world.kind === "house") socket.emit("house:objects", { objects: houseObjectsList() });

  socket.on("player:move", ({ cx, cy }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const m = mapFor(player.world);
    if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return;
    player.cx = cx;
    player.cy = cy;
    markDirty(socket.id);
    socket.to(worldKey(player.world)).emit("player:move", { id: socket.id, cx, cy });
  });

  socket.on("world:enter", (target) => {
    const player = players.get(socket.id);
    if (!player) return;

    if (target.kind === "openworld" || target.kind === "house") {
      if (target.kind === "openworld" && !canEnterOpenworld(player)) {
        socket.emit("world:denied", {
          reason: "The open world is for verified Hack Clubbers. Verify your account at auth.hackclub.com.",
        });
        return;
      }
      switchWorld(socket, target);
      return;
    }

    // Entering own village always allowed.
    if (target.ownerPlayerId === player.playerId) {
      switchWorld(socket, target);
      return;
    }

    // Otherwise the player must hold an accepted invite to that owner's
    // village. Access is persistent once granted (no more one-shot tickets).
    if ((hasAcceptedVillage.get(player.playerId, target.ownerPlayerId)?.n ?? 0) > 0) {
      switchWorld(socket, target);
      return;
    }
    socket.emit("invite:error", { reason: "no_invite" });
  });

  // ── Invite / notification flow ───────────────────────────────────

  // The full account directory for the invite search panel, with an online
  // flag so the client can show who's around right now.
  socket.on("players:list", () => {
    const me = players.get(socket.id);
    const rows = selectAllAccounts.all();
    const list = rows
      .filter(r => r.account_id !== (me?.playerId ?? ""))
      .map(r => ({
        accountId: r.account_id,
        name: r.name,
        online: liveByAccount.has(r.account_id),
      }));
    socket.emit("players:list", { players: list });
  });

  // Send a persistent village invite to another account. Stored in the inbox;
  // delivered live (notify:new) if the recipient is online.
  socket.on("invite:send", ({ toAccountId }) => {
    const inviter = players.get(socket.id);
    if (!inviter) return;
    if (typeof toAccountId !== "string" || toAccountId === inviter.playerId) {
      socket.emit("invite:error", { reason: "invalid_target" });
      return;
    }
    if ((countPendingInviteFrom.get(toAccountId, inviter.playerId)?.n ?? 0) > 0) {
      socket.emit("invite:error", { reason: "already_invited" });
      return;
    }
    const now = Date.now();
    const message = `${inviter.name} invited you to their village`;
    insertNotification.run(toAccountId, "village_invite", inviter.playerId, inviter.name, message, now);

    // Push to the recipient live if they're connected.
    const toSocketId = socketIdForAccount(toAccountId);
    if (toSocketId) {
      const row = selectNotifications.get(toAccountId); // newest first → the one we just made
      if (row) {
        io.to(toSocketId).emit("notify:new", {
          item: toClientNotification(row),
          unread: unreadCount(toAccountId),
        });
      }
    }
    socket.emit("invite:sent", { toName: nameForAccount(toAccountId) ?? "player" });
  });

  // Inbox snapshot. Listing marks everything read (clears the badge).
  socket.on("notify:list", () => {
    const player = players.get(socket.id);
    if (!player) return;
    const items = selectNotifications.all(player.playerId).map(toClientNotification);
    markNotificationsRead.run(player.playerId);
    socket.emit("notify:list", { items, unread: 0 });
  });

  // Accept / decline a pending notification. Accepting a village_invite grants
  // persistent access to the inviter's village.
  socket.on("notify:respond", ({ id, accept }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const row = selectNotification.get(id);
    if (!row || row.recipient_id !== player.playerId) return;
    if (row.status !== "pending") return;
    setNotificationStatus.run(accept ? "accepted" : "declined", id);

    if (accept && row.type === "village_invite") {
      // Let the inviter know, if they're online.
      const inviterSocket = socketIdForAccount(row.from_id);
      if (inviterSocket) {
        const now = Date.now();
        const msg = `${player.name} accepted your village invite`;
        insertNotification.run(row.from_id, "village_invite", player.playerId, player.name, msg, now);
        const back = selectNotifications.get(row.from_id);
        if (back) {
          io.to(inviterSocket).emit("notify:new", {
            item: toClientNotification(back),
            unread: unreadCount(row.from_id),
          });
        }
      }
    }
  });

  socket.on("npc:interact", ({ npcId }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const m = mapFor(player.world);
    const npc = m.npcs.find(n => n.id === npcId);
    if (!npc || !npc.reward || npc.reward <= 0) return;
    // Server-side adjacency check — players must be on or next to the NPC
    // tile. Stops a malicious client from collecting rewards from anywhere.
    const dx = Math.abs(npc.cx - player.cx);
    const dy = Math.abs(npc.cy - player.cy);
    if (dx + dy > 1) return;
    const already = hasNpcReward.get(player.playerId, npc.id);
    if (already && already.n > 0) return;
    insertNpcReward.run(player.playerId, npc.id, Date.now());
    player.pixels += npc.reward;
    persistPlayerState(player);
    dirty.delete(socket.id);
    socket.emit("wallet:update", {
      pixels: player.pixels,
      delta: npc.reward,
      reason: npc.name,
    });
  });

  socket.on("shop:buy", ({ itemId }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const item = getShopItem(itemId);
    if (!item) {
      socket.emit("shop:result", { itemId, success: false, reason: "unknown_item" });
      return;
    }
    if (player.pixels < item.price) {
      socket.emit("shop:result", { itemId, success: false, reason: "not_enough_pixels" });
      return;
    }
    player.pixels -= item.price;
    incrementInventory.run(player.playerId, itemId, 1);
    persistPlayerState(player);
    dirty.delete(socket.id);
    socket.emit("wallet:update", {
      pixels: player.pixels,
      delta: -item.price,
      reason: item.name,
    });
    socket.emit("shop:result", { itemId, success: true });
    socket.emit("inventory:list", { items: inventoryItems(player.playerId) });
  });

  // ── Inventory + house furniture ──────────────────────────────────

  socket.on("inventory:get", () => {
    const player = players.get(socket.id);
    if (!player) return;
    socket.emit("inventory:list", { items: inventoryItems(player.playerId) });
  });

  // Place a placeable item from inventory as furniture in the shared house.
  socket.on("house:place", ({ itemId, cx, cy }) => {
    const player = players.get(socket.id);
    if (!player || player.world.kind !== "house") return;
    const item = getShopItem(itemId);
    if (!item || !item.placeable) return;
    // Must actually own one.
    if ((itemCount.get(player.playerId, itemId)?.count ?? 0) <= 0) return;
    // Tile must be a walkable, empty floor tile (not on a wall/door/another item).
    if (!isWalkable(player.world, cx, cy)) return;
    if ((houseObjectAtTile.get(cx, cy)?.n ?? 0) > 0) return;

    decrementInventory.run(player.playerId, itemId);
    const now = Date.now();
    const row = insertHouseObject.get(itemId, cx, cy, player.playerId, now);
    const object: HouseObject = { id: row!.id, itemId, cx, cy, placedBy: player.playerId };
    io.to(worldKey(player.world)).emit("house:object:added", { object });
    socket.emit("inventory:list", { items: inventoryItems(player.playerId) });
  });

  // Pick a placed item back up — returns it to the remover's inventory.
  socket.on("house:remove", ({ id }) => {
    const player = players.get(socket.id);
    if (!player || player.world.kind !== "house") return;
    const obj = selectHouseObject.get(id);
    if (!obj) return;
    // Only the player who placed it can pick it back up.
    if (obj.placed_by !== player.playerId) return;
    deleteHouseObject.run(id);
    incrementInventory.run(player.playerId, obj.item_id, 1);
    io.to(worldKey(player.world)).emit("house:object:removed", { id });
    socket.emit("inventory:list", { items: inventoryItems(player.playerId) });
  });

  socket.on("chat:send", ({ text }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (typeof text !== "string") return;
    // Trim, collapse control chars, and cap length so one client can't spam
    // huge payloads to everyone in the room.
    const clean = text.replace(/[\x00-\x1f]/g, " ").trim().slice(0, 160);
    if (!clean) return;
    // Muted players can't broadcast — tell only them so it isn't silent.
    if (isMuted(player.playerId)) {
      socket.emit("mod:notice", { text: "You are muted and can't send messages." });
      return;
    }
    // Simple rate limit: max ~3 messages/sec per socket.
    const now = Date.now();
    const last = chatLast.get(socket.id) ?? 0;
    if (now - last < 300) return;
    chatLast.set(socket.id, now);
    io.to(worldKey(player.world)).emit("chat:message", {
      id: socket.id,
      name: player.name,
      text: censorChat(clean), // mask blocked words before anyone sees them
    });
  });

  // ── Admin / moderation ───────────────────────────────────────────
  // Resolve the live socket of an account, if online, for live notices.
  const noticeTo = (accountId: string, text: string) => {
    const sid = socketIdForAccount(accountId);
    if (sid) io.to(sid).emit("mod:notice", { text });
  };

  // Build + send the admin-panel snapshot to a privileged caller.
  const sendAdminData = () => {
    const admins: AdminEntry[] = selectAdmins.all().map((r) => ({
      accountId: r.account_id,
      name: nameForAccount(r.account_id) ?? r.account_id,
      role: r.role === "admin" ? "admin" : "subadmin",
    }));
    const mutes: MuteEntry[] = selectMutes.all().map((r) => ({
      accountId: r.account_id,
      name: nameForAccount(r.account_id) ?? r.account_id,
      reason: r.reason ?? undefined,
    }));
    // Distinct online accounts (a player may have one live socket each).
    const seen = new Set<string>();
    const online: AdminPlayerEntry[] = [];
    for (const p of players.values()) {
      if (seen.has(p.playerId)) continue;
      seen.add(p.playerId);
      online.push({
        accountId: p.playerId,
        name: p.name,
        role: roleOf(p.playerId),
        muted: isMuted(p.playerId),
      });
    }
    online.sort((a, b) => a.name.localeCompare(b.name));
    socket.emit("admin:data", { admins, mutes, online });
  };

  socket.on("admin:list", () => {
    const me = players.get(socket.id);
    if (!me || roleOf(me.playerId) === null) return;
    sendAdminData();
  });

  socket.on("admin:mute", ({ accountId, reason }) => {
    const me = players.get(socket.id);
    if (!me || roleOf(me.playerId) === null) return; // admin or sub-admin
    if (typeof accountId !== "string" || !accountId) return;
    if (accountId === me.playerId) return; // can't mute yourself
    if (roleOf(accountId) !== null) return; // mods can't mute other mods
    upsertMute.run(accountId, typeof reason === "string" ? reason.slice(0, 120) : null, me.playerId, Date.now());
    noticeTo(accountId, "You have been muted by a moderator.");
    sendAdminData();
  });

  socket.on("admin:unmute", ({ accountId }) => {
    const me = players.get(socket.id);
    if (!me || roleOf(me.playerId) === null) return;
    if (typeof accountId !== "string" || !accountId) return;
    deleteMute.run(accountId);
    noticeTo(accountId, "You have been unmuted.");
    sendAdminData();
  });

  socket.on("admin:setRole", ({ accountId, role }) => {
    const me = players.get(socket.id);
    if (!me || roleOf(me.playerId) !== "admin") return; // only full admins
    if (typeof accountId !== "string" || !accountId || accountId === me.playerId) return;
    // Never let a sub-admin action touch a full admin (protects root).
    if (roleOf(accountId) === "admin") return;
    if (role === "subadmin") {
      upsertRole.run(accountId, "subadmin", me.playerId, Date.now());
      noticeTo(accountId, "You are now a sub-admin (moderator).");
    } else {
      deleteRole.run(accountId);
      noticeTo(accountId, "Your moderator role was removed.");
    }
    sendAdminData();
  });

  socket.on("emote:send", ({ emote }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (!ALLOWED_EMOTES.has(emote)) return;
    const now = Date.now();
    const last = emoteLast.get(socket.id) ?? 0;
    if (now - last < 500) return;
    emoteLast.set(socket.id, now);
    // Broadcast to the whole room *including* the sender so everyone (and the
    // sender) sees the emote bubble pop above the right avatar.
    io.to(worldKey(player.world)).emit("player:emote", { id: socket.id, emote });
  });

  // Push-to-talk voice: relay a short binary audio clip to everyone else in the
  // same world. Capped in size + rate so it can't be used to flood the room;
  // muted players can't talk, mirroring chat.
  socket.on("voice:clip", ({ data, mime }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (isMuted(player.playerId)) {
      socket.emit("mod:notice", { text: "You are muted and can't talk." });
      return;
    }
    if (typeof mime !== "string" || !mime.startsWith("audio/")) return;
    // socket.io delivers binary as a Buffer/ArrayBuffer view — both expose
    // byteLength (Buffer extends Uint8Array).
    const size = (data as { byteLength?: number })?.byteLength ?? 0;
    if (size <= 0 || size > MAX_VOICE_BYTES) return;
    const now = Date.now();
    if (now - (voiceLast.get(socket.id) ?? 0) < 400) return;
    voiceLast.set(socket.id, now);
    socket.to(worldKey(player.world)).emit("player:voice", { id: socket.id, data, mime });
  });

  socket.on("character:set", ({ char }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (!Number.isInteger(char) || char < 0 || char >= 5) return;
    player.char = char;
    auth.setChar(player.playerId, char);
    io.to(worldKey(player.world)).emit("player:appearance", { id: socket.id, char });
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) persistPlayerState(player);
    dirty.delete(socket.id);
    players.delete(socket.id);
    chatLast.delete(socket.id);
    emoteLast.delete(socket.id);
    voiceLast.delete(socket.id);
    // Only clear the live-session slot if it still points at us (a newer login
    // may have already taken it over).
    if (player && liveByAccount.get(player.playerId) === socket.id) {
      liveByAccount.delete(player.playerId);
    }
    if (player) {
      io.to(worldKey(player.world)).emit("player:leave", socket.id);
    }
    console.log(`[-] ${socket.id}`);
  });
});

const PORT = Number(process.env.PORT ?? 3001);
// Bind to 0.0.0.0 (not localhost) so the platform's router can reach the
// container — required by hosts like Railway, where binding to 127.0.0.1
// surfaces as "Application failed to respond".
migrateLegacyJson().then(() => {
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Game server listening on 0.0.0.0:${PORT}`);
  });
});
