// MOST WRITTEN BY CLAUDE
// I AM NOT TOO GOOD AT MAKING SERVER ;(

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
  Project,
} from "../src/types/network.ts";
import { generateMap, generateVillage } from "../src/world/MapGen.ts";
import { makeHouseInterior } from "../src/world/HouseMap.ts";
import { getShopItem } from "../src/shop/catalog.ts";
import { setupAuth, type Account } from "./auth.ts";
import {
  fetchHackatimeStats,
  invalidateHackatime,
  secondsByProject,
} from "./hackatime.ts";
import { setupHackatimeAuth } from "./hackatimeAuth.ts";
import { isValidSkin } from "../src/world/cozyChar.ts";
import { censorChat } from "./moderation.ts";
import type {
  ModRole,
  AdminEntry,
  MuteEntry,
  AdminPlayerEntry,
} from "../src/types/network.ts";

const OPENWORLD_SEED = 0xc0ffee;

interface NotificationRow {
  id: number;
  type: string;
  from_id: string;
  from_name: string;
  message: string | null;
  status: string;
  created_at: number;
}

const DAY_LENGTH_MS = 8 * 60 * 1000;

const SERVER_BOOT = Date.now();
function currentDayT(): number {
  return ((Date.now() - SERVER_BOOT) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
}

const DATA_DIR =
  process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "data");
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

function addColumnIfMissing(sql: string) {
  try {
    db.run(sql);
  } catch (e: any) {
    if (!/duplicate column name/i.test(String(e?.message))) throw e;
  }
}
addColumnIfMissing("ALTER TABLE players ADD COLUMN last_world TEXT");
addColumnIfMissing("ALTER TABLE players ADD COLUMN last_cx   INTEGER");
addColumnIfMissing("ALTER TABLE players ADD COLUMN last_cy   INTEGER");
addColumnIfMissing(
  "ALTER TABLE players ADD COLUMN pixels    INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing("ALTER TABLE players ADD COLUMN updated_at INTEGER");

db.run(`
  CREATE TABLE IF NOT EXISTS npc_rewards (
    player_id  TEXT NOT NULL,
    npc_id     TEXT NOT NULL,
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, npc_id)
  )
`);

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
const insertHouseObject = db.query<
  { id: number },
  [string, number, number, string, number]
>(
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
  return selectInventory
    .all(playerId)
    .map((r) => ({ itemId: r.item_id, count: r.count }));
}
function houseObjectsList(): HouseObject[] {
  return selectHouseObjects.all().map((r) => ({
    id: r.id,
    itemId: r.item_id,
    cx: r.cx,
    cy: r.cy,
    placedBy: r.placed_by,
  }));
}

db.run(`
  CREATE TABLE IF NOT EXISTS projects (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id          TEXT NOT NULL,
    name              TEXT NOT NULL,
    description       TEXT,
    repo_url          TEXT,
    demo_url          TEXT,
    hackatime_project TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)");

interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  repo_url: string | null;
  demo_url: string | null;
  hackatime_project: string | null;
  created_at: number;
  updated_at: number;
}
const selectProjects = db.query<ProjectRow, [string]>(
  "SELECT id, name, description, repo_url, demo_url, hackatime_project, created_at, updated_at " +
    "FROM projects WHERE owner_id = ? ORDER BY created_at DESC",
);
const countProjects = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?",
);
const insertProject = db.query<
  { id: number },
  [
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    number,
    number,
  ]
>(
  "INSERT INTO projects (owner_id, name, description, repo_url, demo_url, hackatime_project, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
);
const selectProjectOwner = db.query<{ owner_id: string }, [number]>(
  "SELECT owner_id FROM projects WHERE id = ?",
);
const updateProject = db.query<
  unknown,
  [
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    number,
    number,
  ]
>(
  "UPDATE projects SET name = ?, description = ?, repo_url = ?, demo_url = ?, hackatime_project = ?, updated_at = ? WHERE id = ?",
);
const deleteProject = db.query<unknown, [number]>(
  "DELETE FROM projects WHERE id = ?",
);

const MAX_PROJECTS = 50;

function projectFromRow(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    repoUrl: r.repo_url ?? undefined,
    demoUrl: r.demo_url ?? undefined,
    hackatimeProject: r.hackatime_project ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

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
const upsertPosition = db.query<
  unknown,
  [string, string, number, number, number]
>(
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
db.run(
  "CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id)",
);

const insertNotification = db.query<
  unknown,
  [string, string, string, string, string | null, number]
>(
  "INSERT INTO notifications (recipient_id, type, from_id, from_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const selectNotifications = db.query<NotificationRow, [string]>(
  "SELECT id, type, from_id, from_name, message, status, created_at FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 50",
);
const selectNotification = db.query<
  NotificationRow & { recipient_id: string },
  [number]
>(
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

const countPendingInviteFrom = db.query<{ n: number }, [string, string]>(
  "SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND from_id = ? AND type = 'village_invite' AND status = 'pending'",
);

const selectAcceptedVillages = db.query<
  { from_id: string; from_name: string },
  [string]
>(
  "SELECT DISTINCT from_id, from_name FROM notifications WHERE recipient_id = ? AND type = 'village_invite' AND status = 'accepted'",
);
const hasAcceptedVillage = db.query<{ n: number }, [string, string]>(
  "SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND from_id = ? AND type = 'village_invite' AND status = 'accepted'",
);

const auth = setupAuth(db);

const selectAllAccounts = db.query<{ account_id: string; name: string }, []>(
  "SELECT account_id, name FROM accounts ORDER BY name COLLATE NOCASE",
);
const selectAccountName = db.query<{ name: string }, [string]>(
  "SELECT name FROM accounts WHERE account_id = ?",
);

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
    chat       INTEGER NOT NULL DEFAULT 1,
    voice      INTEGER NOT NULL DEFAULT 1,
    reason     TEXT,
    muted_by   TEXT,
    created_at INTEGER NOT NULL
  )
`);

{
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(mutes)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("chat"))
    db.run("ALTER TABLE mutes ADD COLUMN chat INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes("voice"))
    db.run("ALTER TABLE mutes ADD COLUMN voice INTEGER NOT NULL DEFAULT 1");
}
const selectRole = db.query<{ role: string }, [string]>(
  "SELECT role FROM admins WHERE account_id = ?",
);
const upsertRole = db.query<unknown, [string, string, string, number]>(
  "INSERT INTO admins (account_id, role, added_by, created_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(account_id) DO UPDATE SET role = excluded.role",
);
const deleteRole = db.query<unknown, [string]>(
  "DELETE FROM admins WHERE account_id = ?",
);
const selectAdmins = db.query<{ account_id: string; role: string }, []>(
  "SELECT account_id, role FROM admins ORDER BY role, account_id",
);
const selectMute = db.query<
  { chat: number; voice: number; reason: string | null },
  [string]
>("SELECT chat, voice, reason FROM mutes WHERE account_id = ?");
const upsertMute = db.query<
  unknown,
  [string, number, number, string | null, string, number]
>(
  "INSERT INTO mutes (account_id, chat, voice, reason, muted_by, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(account_id) DO UPDATE SET chat = excluded.chat, voice = excluded.voice, reason = excluded.reason, muted_by = excluded.muted_by",
);
const deleteMute = db.query<unknown, [string]>(
  "DELETE FROM mutes WHERE account_id = ?",
);
const selectMutes = db.query<
  { account_id: string; chat: number; voice: number; reason: string | null },
  []
>("SELECT account_id, chat, voice, reason FROM mutes ORDER BY created_at DESC");

function roleOf(accountId: string): ModRole {
  const r = selectRole.get(accountId)?.role;
  return r === "admin" || r === "subadmin" ? r : null;
}
function isChatMuted(accountId: string): boolean {
  return (selectMute.get(accountId)?.chat ?? 0) === 1;
}
function isVoiceMuted(accountId: string): boolean {
  return (selectMute.get(accountId)?.voice ?? 0) === 1;
}

function ensureRootAdmin(account: Account) {
  if (!account.email) return;
  if (!ROOT_ADMIN_EMAILS.has(account.email.toLowerCase())) return;
  if (roleOf(account.accountId) !== "admin") {
    upsertRole.run(account.accountId, "admin", "root", Date.now());
    console.log(
      `[admin] root admin granted to ${account.name} (${account.accountId})`,
    );
  }
}

function unreadCount(playerId: string): number {
  return countUnread.get(playerId)?.n ?? 0;
}

function nameForAccount(accountId: string): string | undefined {
  return selectAccountName.get(accountId)?.name;
}

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
    const ins = db.query(
      "INSERT OR IGNORE INTO players (player_id, seed, created_at) VALUES (?, ?, ?)",
    );
    let n = 0;
    for (const [pid, seed] of Object.entries(old)) {
      const r = ins.run(pid, seed, Date.now());
      if (r.changes > 0) n++;
    }
    if (n > 0) console.log(`[seeds] migrated ${n} player(s) from players.json`);
  } catch (e: any) {
    if (e.code !== "ENOENT")
      console.error("[seeds] legacy migration failed:", e);
  }
}

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

const mapCache = new Map<WorldKey, ReturnType<typeof generateMap>>();
function mapFor(world: WorldRef) {
  const key = worldKey(world);
  let m = mapCache.get(key);
  if (!m) {
    m =
      world.kind === "house"
        ? makeHouseInterior()
        : world.kind === "village"
          ? generateVillage()
          : generateMap(worldSeed(world), { houses: false });
    mapCache.set(key, m);
  }
  return m;
}

const app = express();
app.use(cors());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "pixl-game-server" });
});

app.use("/auth", auth.router);

app.use("/hackatime", setupHackatimeAuth(auth));

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
    .map((v) => ({ ownerId: v.from_id, name: v.from_name }));
  res.json({ ok: true, villages });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

io.use((socket, next) => {
  const token = (socket.handshake.auth as { sessionToken?: string })
    ?.sessionToken;
  const account = typeof token === "string" ? auth.verifySession(token) : null;
  if (!account) {
    next(new Error("unauthorized"));
    return;
  }
  (socket.data as { account: Account }).account = account;
  next();
});

interface ServerPlayerState extends Omit<PlayerState, "skin"> {
  playerId: string;
  world: WorldRef;
  pixels: number;
  char: number;

  skin: string | null;
  verified: boolean;
}
const players = new Map<string, ServerPlayerState>();

const liveByAccount = new Map<string, string>();

const OPENWORLD_REQUIRES_VERIFIED =
  process.env.OPENWORLD_VERIFIED_ONLY === "true";
function canEnterOpenworld(p: {
  verified: boolean;
  playerId: string;
}): boolean {
  if (!OPENWORLD_REQUIRES_VERIFIED) return true;
  if (p.playerId.startsWith("guest_")) return true;
  return p.verified;
}

const dirty = new Set<string>();
const FLUSH_INTERVAL_MS = 2000;

function markDirty(socketId: string) {
  dirty.add(socketId);
}

function persistPlayerState(state: ServerPlayerState) {
  try {
    const now = Date.now();
    const worldStr = serializeWorld(state.world);

    upsertPosition.run(state.playerId, worldStr, state.cx, state.cy, now);
    updateSummary.run(worldStr, state.pixels, now, state.playerId);
  } catch (e) {
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

const chatLast = new Map<string, number>();
const emoteLast = new Map<string, number>();

const voiceLast = new Map<string, number>();
const MAX_VOICE_BYTES = 800_000;

const ALLOWED_EMOTES = new Set([
  "happy",
  "laugh",
  "heart",
  "sad",
  "angry",
  "love",
  "cry",
  "idea",
  "music",
  "sleep",
  "star",
  "question",
  "alert",
  "exclaim",
  "dizzy",
]);

function socketIdForAccount(accountId: string): string | undefined {
  return liveByAccount.get(accountId);
}

function peersInWorld(world: WorldRef, exceptSocketId?: string): PlayerState[] {
  const target = worldKey(world);
  return [...players.values()]
    .filter((p) => worldKey(p.world) === target && p.id !== exceptSocketId)
    .map(({ id, cx, cy, name, char, skin, verified }) => ({
      id,
      cx,
      cy,
      name,
      char,
      skin: skin ?? undefined,
      verified,
    }));
}

function worldStateFor(state: ServerPlayerState): WorldState {
  mapFor(state.world);
  return {
    world: state.world,
    seed: worldSeed(state.world),
    spawn: { cx: state.cx, cy: state.cy },
    players: peersInWorld(state.world, state.id),
  };
}

function switchWorld(
  socket: import("socket.io").Socket<
    ClientToServerEvents,
    ServerToClientEvents
  >,
  next: WorldRef,
) {
  const state = players.get(socket.id);
  if (!state) return;
  const oldRoom = worldKey(state.world);
  const newRoom = worldKey(next);
  if (oldRoom === newRoom) return;

  persistPlayerState(state);

  socket.leave(oldRoom);
  socket.to(oldRoom).emit("player:leave", socket.id);

  state.world = next;

  const remembered =
    next.kind === "house" ? null : getRememberedPosition(state.playerId, next);
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
  if (next.kind === "house")
    socket.emit("house:objects", { objects: houseObjectsList() });
  socket.to(newRoom).emit("player:join", {
    id: state.id,
    cx: state.cx,
    cy: state.cy,
    name: state.name,
    char: state.char,
    skin: state.skin ?? undefined,
    verified: state.verified,
  });

  persistPlayerState(state);
  dirty.delete(socket.id);
  console.log(`[~] ${socket.id} → ${newRoom}  @(${state.cx},${state.cy})`);
}

io.on("connection", (socket) => {
  const account = (socket.data as { account: Account }).account;
  const playerId = account.accountId;

  ensureRootAdmin(account);

  const prevSocketId = liveByAccount.get(playerId);
  if (prevSocketId && prevSocketId !== socket.id) {
    const prevSock = io.sockets.sockets.get(prevSocketId);
    if (prevSock) {
      prevSock.emit("auth:kicked");
      prevSock.disconnect(true);
    }
  }
  liveByAccount.set(playerId, socket.id);

  const saved = loadPlayerState(playerId);
  let world: WorldRef;
  let cx: number;
  let cy: number;
  if (
    saved?.position &&
    (saved.position.world.kind !== "village" ||
      saved.position.world.ownerPlayerId === playerId) &&
    (saved.position.world.kind !== "openworld" ||
      canEnterOpenworld({ verified: account.verified, playerId })) &&
    isWalkable(saved.position.world, saved.position.cx, saved.position.cy)
  ) {
    world = saved.position.world;
    if (world.kind === "house") {
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
    skin: account.skin,
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
    skin: state.skin ?? undefined,
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
    id: state.id,
    cx: state.cx,
    cy: state.cy,
    name: state.name,
    char: state.char,
    skin: state.skin ?? undefined,
    verified: state.verified,
  });
  if (world.kind === "house")
    socket.emit("house:objects", { objects: houseObjectsList() });

  socket.on("player:move", ({ cx, cy }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const m = mapFor(player.world);
    if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return;
    player.cx = cx;
    player.cy = cy;
    markDirty(socket.id);
    socket
      .to(worldKey(player.world))
      .emit("player:move", { id: socket.id, cx, cy });
  });

  socket.on("world:enter", (target) => {
    const player = players.get(socket.id);
    if (!player) return;

    if (target.kind === "openworld" || target.kind === "house") {
      if (target.kind === "openworld" && !canEnterOpenworld(player)) {
        socket.emit("world:denied", {
          reason:
            "The open world is for verified Hack Clubbers. Verify your account at auth.hackclub.com.",
        });
        return;
      }
      switchWorld(socket, target);
      return;
    }

    if (target.ownerPlayerId === player.playerId) {
      switchWorld(socket, target);
      return;
    }

    if (
      (hasAcceptedVillage.get(player.playerId, target.ownerPlayerId)?.n ?? 0) >
      0
    ) {
      switchWorld(socket, target);
      return;
    }
    socket.emit("invite:error", { reason: "no_invite" });
  });

  socket.on("players:list", () => {
    const me = players.get(socket.id);
    const rows = selectAllAccounts.all();
    const list = rows
      .filter((r) => r.account_id !== (me?.playerId ?? ""))
      .map((r) => ({
        accountId: r.account_id,
        name: r.name,
        online: liveByAccount.has(r.account_id),
      }));
    socket.emit("players:list", { players: list });
  });

  socket.on("invite:send", ({ toAccountId }) => {
    const inviter = players.get(socket.id);
    if (!inviter) return;
    if (typeof toAccountId !== "string" || toAccountId === inviter.playerId) {
      socket.emit("invite:error", { reason: "invalid_target" });
      return;
    }
    if (
      (countPendingInviteFrom.get(toAccountId, inviter.playerId)?.n ?? 0) > 0
    ) {
      socket.emit("invite:error", { reason: "already_invited" });
      return;
    }
    const now = Date.now();
    const message = `${inviter.name} invited you to their village`;
    insertNotification.run(
      toAccountId,
      "village_invite",
      inviter.playerId,
      inviter.name,
      message,
      now,
    );

    const toSocketId = socketIdForAccount(toAccountId);
    if (toSocketId) {
      const row = selectNotifications.get(toAccountId);
      if (row) {
        io.to(toSocketId).emit("notify:new", {
          item: toClientNotification(row),
          unread: unreadCount(toAccountId),
        });
      }
    }
    socket.emit("invite:sent", {
      toName: nameForAccount(toAccountId) ?? "player",
    });
  });

  socket.on("notify:list", () => {
    const player = players.get(socket.id);
    if (!player) return;
    const items = selectNotifications
      .all(player.playerId)
      .map(toClientNotification);
    markNotificationsRead.run(player.playerId);
    socket.emit("notify:list", { items, unread: 0 });
  });

  socket.on("notify:respond", ({ id, accept }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const row = selectNotification.get(id);
    if (!row || row.recipient_id !== player.playerId) return;
    if (row.status !== "pending") return;
    setNotificationStatus.run(accept ? "accepted" : "declined", id);

    if (accept && row.type === "village_invite") {
      const inviterSocket = socketIdForAccount(row.from_id);
      if (inviterSocket) {
        const now = Date.now();
        const msg = `${player.name} accepted your village invite`;
        insertNotification.run(
          row.from_id,
          "village_invite",
          player.playerId,
          player.name,
          msg,
          now,
        );
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
    const npc = m.npcs.find((n) => n.id === npcId);
    if (!npc || !npc.reward || npc.reward <= 0) return;

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
      socket.emit("shop:result", {
        itemId,
        success: false,
        reason: "unknown_item",
      });
      return;
    }
    if (player.pixels < item.price) {
      socket.emit("shop:result", {
        itemId,
        success: false,
        reason: "not_enough_pixels",
      });
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

  socket.on("inventory:get", () => {
    const player = players.get(socket.id);
    if (!player) return;
    socket.emit("inventory:list", { items: inventoryItems(player.playerId) });
  });

  socket.on("house:place", ({ itemId, cx, cy }) => {
    const player = players.get(socket.id);
    if (!player || player.world.kind !== "house") return;
    const item = getShopItem(itemId);
    if (!item || !item.placeable) return;

    if ((itemCount.get(player.playerId, itemId)?.count ?? 0) <= 0) return;

    if (!isWalkable(player.world, cx, cy)) return;
    if ((houseObjectAtTile.get(cx, cy)?.n ?? 0) > 0) return;

    decrementInventory.run(player.playerId, itemId);
    const now = Date.now();
    const row = insertHouseObject.get(itemId, cx, cy, player.playerId, now);
    const object: HouseObject = {
      id: row!.id,
      itemId,
      cx,
      cy,
      placedBy: player.playerId,
    };
    io.to(worldKey(player.world)).emit("house:object:added", { object });
    socket.emit("inventory:list", { items: inventoryItems(player.playerId) });
  });

  socket.on("house:remove", ({ id }) => {
    const player = players.get(socket.id);
    if (!player || player.world.kind !== "house") return;
    const obj = selectHouseObject.get(id);
    if (!obj) return;

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

    const clean = text
      .replace(/[\x00-\x1f]/g, " ")
      .trim()
      .slice(0, 160);
    if (!clean) return;

    if (isChatMuted(player.playerId)) {
      socket.emit("mod:notice", {
        text: "You are muted and can't send messages.",
      });
      return;
    }

    const now = Date.now();
    const last = chatLast.get(socket.id) ?? 0;
    if (now - last < 300) return;
    chatLast.set(socket.id, now);
    io.to(worldKey(player.world)).emit("chat:message", {
      id: socket.id,
      name: player.name,
      text: censorChat(clean),
    });
  });

  const noticeTo = (accountId: string, text: string) => {
    const sid = socketIdForAccount(accountId);
    if (sid) io.to(sid).emit("mod:notice", { text });
  };

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
      chat: r.chat === 1,
      voice: r.voice === 1,
    }));

    const seen = new Set<string>();
    const online: AdminPlayerEntry[] = [];
    for (const p of players.values()) {
      if (seen.has(p.playerId)) continue;
      seen.add(p.playerId);
      online.push({
        accountId: p.playerId,
        name: p.name,
        role: roleOf(p.playerId),
        chatMuted: isChatMuted(p.playerId),
        voiceMuted: isVoiceMuted(p.playerId),
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

  socket.on("admin:mute", ({ accountId, channel, reason }) => {
    const me = players.get(socket.id);
    if (!me || roleOf(me.playerId) === null) return;
    if (typeof accountId !== "string" || !accountId) return;
    if (accountId === me.playerId) return;
    if (roleOf(accountId) !== null) return;
    const ch = channel === "chat" || channel === "voice" ? channel : "both";

    const cur = selectMute.get(accountId);
    const chat = ch === "voice" ? cur?.chat === 1 : true;
    const voice = ch === "chat" ? cur?.voice === 1 : true;
    const note =
      typeof reason === "string" ? reason.slice(0, 120) : (cur?.reason ?? null);
    upsertMute.run(
      accountId,
      chat ? 1 : 0,
      voice ? 1 : 0,
      note,
      me.playerId,
      Date.now(),
    );
    noticeTo(
      accountId,
      ch === "chat"
        ? "A moderator muted you in chat."
        : ch === "voice"
          ? "A moderator muted your mic."
          : "You have been muted by a moderator.",
    );
    sendAdminData();
  });

  socket.on("admin:unmute", ({ accountId, channel }) => {
    const me = players.get(socket.id);
    if (!me || roleOf(me.playerId) === null) return;
    if (typeof accountId !== "string" || !accountId) return;
    const cur = selectMute.get(accountId);
    if (!cur) return;
    const ch = channel === "chat" || channel === "voice" ? channel : "both";
    const chat = ch === "voice" ? cur.chat === 1 : false;
    const voice = ch === "chat" ? cur.voice === 1 : false;
    if (!chat && !voice) deleteMute.run(accountId);
    else
      upsertMute.run(
        accountId,
        chat ? 1 : 0,
        voice ? 1 : 0,
        cur.reason,
        me.playerId,
        Date.now(),
      );
    noticeTo(
      accountId,
      ch === "chat"
        ? "A moderator unmuted you in chat."
        : ch === "voice"
          ? "A moderator unmuted your mic."
          : "You have been unmuted.",
    );
    sendAdminData();
  });

  socket.on("admin:setRole", ({ accountId, role }) => {
    const me = players.get(socket.id);
    if (!me || roleOf(me.playerId) !== "admin") return;
    if (
      typeof accountId !== "string" ||
      !accountId ||
      accountId === me.playerId
    )
      return;

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

    io.to(worldKey(player.world)).emit("player:emote", {
      id: socket.id,
      emote,
    });
  });

  socket.on("voice:clip", ({ data, mime }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (isVoiceMuted(player.playerId)) {
      socket.emit("mod:notice", {
        text: "Your mic is muted and you can't talk.",
      });
      return;
    }
    if (typeof mime !== "string" || !mime.startsWith("audio/")) return;

    const size = (data as { byteLength?: number })?.byteLength ?? 0;
    if (size <= 0 || size > MAX_VOICE_BYTES) return;
    const now = Date.now();
    if (now - (voiceLast.get(socket.id) ?? 0) < 400) return;
    voiceLast.set(socket.id, now);
    socket
      .to(worldKey(player.world))
      .emit("player:voice", { id: socket.id, data, mime });
  });

  socket.on("character:set", ({ char }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (!Number.isInteger(char) || char < 0 || char >= 5) return;
    player.char = char;

    player.skin = null;
    auth.setChar(player.playerId, char);
    io.to(worldKey(player.world)).emit("player:appearance", {
      id: socket.id,
      char,
    });
  });

  socket.on("character:setSkin", ({ skin }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (!isValidSkin(skin)) return;
    player.skin = skin;
    auth.setSkin(player.playerId, skin);
    io.to(worldKey(player.world)).emit("player:appearance", {
      id: socket.id,
      char: player.char,
      skin,
    });
  });

  const cleanText = (v: unknown, max: number): string =>
    typeof v === "string"
      ? v
          .replace(/[\x00-\x1f]/g, " ")
          .trim()
          .slice(0, max)
      : "";

  const cleanUrl = (v: unknown): string | null => {
    const s = cleanText(v, 300);
    if (!s) return null;
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:" ? s : null;
    } catch {
      return null;
    }
  };

  const sendProjectList = async (player: ServerPlayerState) => {
    const rows = selectProjects.all(player.playerId);
    const items: Project[] = rows.map(projectFromRow);
    const key = auth.getHackatimeKey(player.playerId);
    let connected = false;
    if (key) {
      const stats = await fetchHackatimeStats(key);
      connected = stats.connected;
      if (stats.connected) {
        const byName = secondsByProject(stats);
        for (const it of items) {
          if (it.hackatimeProject)
            it.seconds = byName.get(it.hackatimeProject) ?? 0;
        }
      }
    }
    socket.emit("project:list", { items, hackatimeConnected: connected });
  };

  socket.on("project:list", () => {
    const player = players.get(socket.id);
    if (!player) return;
    void sendProjectList(player);
  });

  socket.on("project:create", (payload) => {
    const player = players.get(socket.id);
    if (!player) return;
    const name = cleanText(payload?.name, 60);
    if (!name) {
      socket.emit("project:result", { ok: false, reason: "name_required" });
      return;
    }
    if ((countProjects.get(player.playerId)?.n ?? 0) >= MAX_PROJECTS) {
      socket.emit("project:result", { ok: false, reason: "too_many" });
      return;
    }
    const now = Date.now();
    const row = insertProject.get(
      player.playerId,
      name,
      cleanText(payload?.description, 500) || null,
      cleanUrl(payload?.repoUrl),
      cleanUrl(payload?.demoUrl),
      cleanText(payload?.hackatimeProject, 100) || null,
      now,
      now,
    );
    socket.emit("project:result", { ok: true, id: row?.id });
    void sendProjectList(player);
  });

  socket.on("project:update", (payload) => {
    const player = players.get(socket.id);
    if (!player) return;
    const id = payload?.id;
    if (!Number.isInteger(id)) return;
    const owner = selectProjectOwner.get(id)?.owner_id;
    if (owner !== player.playerId) {
      socket.emit("project:result", { ok: false, reason: "not_found" });
      return;
    }
    const name = cleanText(payload?.name, 60);
    if (!name) {
      socket.emit("project:result", { ok: false, reason: "name_required" });
      return;
    }
    updateProject.run(
      name,
      cleanText(payload?.description, 500) || null,
      cleanUrl(payload?.repoUrl),
      cleanUrl(payload?.demoUrl),
      cleanText(payload?.hackatimeProject, 100) || null,
      Date.now(),
      id,
    );
    socket.emit("project:result", { ok: true, id });
    void sendProjectList(player);
  });

  socket.on("project:delete", ({ id }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (!Number.isInteger(id)) return;
    const owner = selectProjectOwner.get(id)?.owner_id;
    if (owner !== player.playerId) return;
    deleteProject.run(id);
    socket.emit("project:result", { ok: true, id });
    void sendProjectList(player);
  });

  socket.on("hackatime:setKey", ({ key }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const clean = typeof key === "string" ? key.trim().slice(0, 200) : "";
    const prev = auth.getHackatimeKey(player.playerId);
    invalidateHackatime(prev);
    invalidateHackatime(clean);
    auth.setHackatimeKey(player.playerId, clean);

    void fetchHackatimeStats(clean || null).then((stats) => {
      socket.emit("hackatime:stats", stats);

      const p = players.get(socket.id);
      if (p) void sendProjectList(p);
    });
  });

  socket.on("hackatime:stats", () => {
    const player = players.get(socket.id);
    if (!player) return;
    const key = auth.getHackatimeKey(player.playerId);
    void fetchHackatimeStats(key).then((stats) =>
      socket.emit("hackatime:stats", stats),
    );
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) persistPlayerState(player);
    dirty.delete(socket.id);
    players.delete(socket.id);
    chatLast.delete(socket.id);
    emoteLast.delete(socket.id);
    voiceLast.delete(socket.id);

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

migrateLegacyJson().then(() => {
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Game server listening on 0.0.0.0:${PORT}`);
  });
});
