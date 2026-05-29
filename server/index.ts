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

// Fixed seed for the shared open world. Anything stable & distinct from
// the player-id-derived seeds is fine; spelling something out makes it
// easy to recognise in logs.
const OPENWORLD_SEED = 0xC0FFEE;

const INVITE_TTL_MS = 30_000;

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
}
const players = new Map<string, ServerPlayerState>();

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

  socket.leave(oldRoom);
  socket.to(oldRoom).emit("player:leave", socket.id);

  const nextMap = mapFor(next);
  state.world = next;
  state.cx = nextMap.spawnPoint.cx;
  state.cy = nextMap.spawnPoint.cy;

  socket.join(newRoom);
  socket.emit("world:state", worldStateFor(state));
  socket.to(newRoom).emit("player:join", {
    id: state.id, cx: state.cx, cy: state.cy, name: state.name,
  });
  console.log(`[~] ${socket.id} → ${newRoom}`);
}

io.on("connection", (socket) => {
  const playerId = socket.handshake.auth?.playerId;
  if (typeof playerId !== "string" || playerId.length === 0) {
    console.warn(`[!] ${socket.id} connected without playerId — disconnecting`);
    socket.disconnect();
    return;
  }

  // Everyone starts in their own village.
  const world: WorldRef = { kind: "village", ownerPlayerId: playerId };
  const map = mapFor(world);

  const state: ServerPlayerState = {
    id: socket.id,
    playerId,
    cx: map.spawnPoint.cx,
    cy: map.spawnPoint.cy,
    name: `Player_${socket.id.slice(0, 4)}`,
    world,
  };
  players.set(socket.id, state);
  const room = worldKey(world);
  socket.join(room);
  console.log(`[+] ${socket.id} (player ${playerId.slice(0, 8)}…) → ${room}`);

  socket.emit("init", { id: socket.id, world: worldStateFor(state) });
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

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
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
