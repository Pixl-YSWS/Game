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
} from "../src/types/network.ts";
import { generateMap } from "../src/world/MapGen.ts";
import { makeHouseInterior } from "../src/world/HouseMap.ts";
import { getShopItem } from "../src/shop/catalog.ts";

// Fixed seed for the shared open world. Anything stable & distinct from
// the player-id-derived seeds is fine; spelling something out makes it
// easy to recognise in logs.
const OPENWORLD_SEED = 0xC0FFEE;

const INVITE_TTL_MS = 30_000;

// 8 minutes of real time per full day/night cycle. Tweak to taste.
const DAY_LENGTH_MS = 8 * 60 * 1000;
// Anchor point so cycle is consistent across all clients in this session.
// `tNow=0` corresponds to midnight at SERVER_BOOT.
const SERVER_BOOT = Date.now();
function currentDayT(): number {
  return ((Date.now() - SERVER_BOOT) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
}

// ── Seed persistence (SQLite) ────────────────────────────────────
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");
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
    m = world.kind === "house" ? makeHouseInterior() : generateMap(worldSeed(world));
    mapCache.set(key, m);
  }
  return m;
}

// ── HTTP / Socket.IO ─────────────────────────────────────────────
const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

interface ServerPlayerState extends PlayerState {
  playerId: string;
  world: WorldRef;
  pixels: number;
}
const players = new Map<string, ServerPlayerState>();

// Socket ids whose state has changed but isn't persisted yet. Flushed in
// batches every FLUSH_INTERVAL_MS so we don't write SQLite on every tile
// step (a player walking is ~8 steps/sec).
const dirty = new Set<string>();
const FLUSH_INTERVAL_MS = 2000;

function markDirty(socketId: string) {
  dirty.add(socketId);
}

function persistPlayerState(state: ServerPlayerState) {
  const now = Date.now();
  const worldStr = serializeWorld(state.world);
  // Position is keyed by world so the previous slot for OTHER worlds is
  // preserved — visiting open world doesn't clobber the village position.
  upsertPosition.run(state.playerId, worldStr, state.cx, state.cy, now);
  updateSummary.run(worldStr, state.pixels, now, state.playerId);
}

setInterval(() => {
  if (dirty.size === 0) return;
  for (const sid of dirty) {
    const state = players.get(sid);
    if (state) persistPlayerState(state);
  }
  dirty.clear();
}, FLUSH_INTERVAL_MS);

// invites[recipientSocketId] = Map<inviterSocketId, expiresAt>
// One-shot tickets: accepting consumes it; declines/disconnect/expiry clear it.
const invites = new Map<string, Map<string, number>>();

function clearInvite(toSocket: string, fromSocket: string) {
  const m = invites.get(toSocket);
  if (!m) return;
  m.delete(fromSocket);
  if (m.size === 0) invites.delete(toSocket);
}

function consumeInvite(toSocket: string, fromSocket: string): boolean {
  const m = invites.get(toSocket);
  if (!m) return false;
  const expires = m.get(fromSocket);
  if (!expires) return false;
  m.delete(fromSocket);
  if (m.size === 0) invites.delete(toSocket);
  return expires > Date.now();
}

function peersInWorld(world: WorldRef, exceptSocketId?: string): PlayerState[] {
  const target = worldKey(world);
  return [...players.values()]
    .filter(p => worldKey(p.world) === target && p.id !== exceptSocketId)
    .map(({ id, cx, cy, name }) => ({ id, cx, cy, name }));
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
  const remembered = getRememberedPosition(state.playerId, next);
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
  socket.to(newRoom).emit("player:join", {
    id: state.id, cx: state.cx, cy: state.cy, name: state.name,
  });
  // World switches are the natural rollback points — persist the NEW
  // world's record too so a crash mid-session never strands a player.
  persistPlayerState(state);
  dirty.delete(socket.id);
  console.log(`[~] ${socket.id} → ${newRoom}  @(${state.cx},${state.cy})`);
}

io.on("connection", (socket) => {
  const playerId = socket.handshake.auth?.playerId;
  if (typeof playerId !== "string" || playerId.length === 0) {
    console.warn(`[!] ${socket.id} connected without playerId — disconnecting`);
    socket.disconnect();
    return;
  }

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
    isWalkable(saved.position.world, saved.position.cx, saved.position.cy)
  ) {
    world = saved.position.world;
    cx = saved.position.cx;
    cy = saved.position.cy;
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
    name: `Player_${socket.id.slice(0, 4)}`,
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
    world: worldStateFor(state),
    pixels: state.pixels,
    dayCycle: {
      tNow: currentDayT(),
      dayLengthMs: DAY_LENGTH_MS,
      serverNow: Date.now(),
    },
  });
  socket.to(room).emit("player:join", {
    id: state.id, cx: state.cx, cy: state.cy, name: state.name,
  });

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
      switchWorld(socket, target);
      return;
    }

    // Entering own village always allowed.
    if (target.ownerPlayerId === player.playerId) {
      switchWorld(socket, target);
      return;
    }

    // Otherwise, must have a consumable invite from a socket whose
    // current player is the village owner.
    const inviteMap = invites.get(socket.id);
    if (inviteMap) {
      for (const [fromSocketId, expires] of inviteMap.entries()) {
        if (expires < Date.now()) continue;
        const inviter = players.get(fromSocketId);
        if (!inviter) continue;
        if (inviter.playerId === target.ownerPlayerId) {
          clearInvite(socket.id, fromSocketId);
          switchWorld(socket, target);
          return;
        }
      }
    }
    socket.emit("invite:error", { reason: "no_invite" });
  });

  socket.on("invite:send", ({ toSocketId }) => {
    if (toSocketId === socket.id) return;
    const target = players.get(toSocketId);
    const inviter = players.get(socket.id);
    if (!target || !inviter) return;

    // Only allow inviting players you can actually see (same world).
    if (worldKey(target.world) !== worldKey(inviter.world)) {
      socket.emit("invite:error", { reason: "not_in_same_world" });
      return;
    }

    let bucket = invites.get(toSocketId);
    if (!bucket) {
      bucket = new Map();
      invites.set(toSocketId, bucket);
    }
    bucket.set(socket.id, Date.now() + INVITE_TTL_MS);
    io.to(toSocketId).emit("invite:received", {
      fromSocketId: socket.id,
      fromName: inviter.name,
    });
  });

  socket.on("invite:accept", ({ fromSocketId }) => {
    if (!consumeInvite(socket.id, fromSocketId)) {
      socket.emit("invite:error", { reason: "invite_expired" });
      return;
    }
    const inviter = players.get(fromSocketId);
    if (!inviter) {
      socket.emit("invite:error", { reason: "inviter_offline" });
      return;
    }
    const village: WorldRef = { kind: "village", ownerPlayerId: inviter.playerId };
    // Bring the inviter home so the two actually end up together.
    const inviterSocket = io.sockets.sockets.get(fromSocketId);
    if (inviterSocket) switchWorld(inviterSocket, village);
    switchWorld(socket, village);
  });

  socket.on("invite:decline", ({ fromSocketId }) => {
    clearInvite(socket.id, fromSocketId);
    io.to(fromSocketId).emit("invite:cancelled", { fromSocketId: socket.id });
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
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) persistPlayerState(player);
    dirty.delete(socket.id);
    players.delete(socket.id);
    invites.delete(socket.id);
    // Cancel any invites this socket sent out.
    for (const [toId, bucket] of invites) {
      if (bucket.delete(socket.id)) {
        io.to(toId).emit("invite:cancelled", { fromSocketId: socket.id });
        if (bucket.size === 0) invites.delete(toId);
      }
    }
    if (player) {
      io.to(worldKey(player.world)).emit("player:leave", socket.id);
    }
    console.log(`[-] ${socket.id}`);
  });
});

const PORT = process.env.PORT ?? 3001;
migrateLegacyJson().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Game server on http://localhost:${PORT}`);
  });
});
