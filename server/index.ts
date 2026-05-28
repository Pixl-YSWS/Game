import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { promises as fs } from "fs";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import type { PlayerState, ServerToClientEvents, ClientToServerEvents } from "../src/types/network.ts";
import { generateMap } from "../src/world/MapGen.ts";

const MAP_COLS = 30;
const MAP_ROWS = 20;

// ── Seed persistence (SQLite) ────────────────────────────────────
// `players` table: one row per persistent player. Looking a player up
// by their (browser-local) playerId returns the seed of the village
// procedurally generated for them on first visit.
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

// One-time migration: if the old players.json is still around, fold any
// missing entries into the table and leave the file alone as a backup.
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

// ── HTTP / Socket.IO ─────────────────────────────────────────────
const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

interface ServerPlayerState extends PlayerState { seed: number }
const players = new Map<string, ServerPlayerState>();

io.on("connection", (socket) => {
  const playerId = socket.handshake.auth?.playerId;
  if (typeof playerId !== "string" || playerId.length === 0) {
    console.warn(`[!] ${socket.id} connected without playerId — disconnecting`);
    socket.disconnect();
    return;
  }

  const seed = getOrCreateSeed(playerId);
  // Spawn on the road intersection of the player's own village
  const map = generateMap(seed);
  console.log(`[+] ${socket.id} (player ${playerId.slice(0, 8)}…) seed=${seed}`);

  const state: ServerPlayerState = {
    id: socket.id,
    cx: map.spawnPoint.cx,
    cy: map.spawnPoint.cy,
    name: `Player_${socket.id.slice(0, 4)}`,
    seed,
  };
  players.set(socket.id, state);

  // Each seed is its own "world" — broadcasts only go to sockets in it.
  const room = `world:${seed}`;
  socket.join(room);

  const peers = [...players.values()]
    .filter(p => p.seed === seed && p.id !== socket.id)
    .map(({ seed: _, ...rest }) => rest);

  socket.emit("init", { id: socket.id, players: peers, seed });
  socket.to(room).emit("player:join", {
    id: state.id, cx: state.cx, cy: state.cy, name: state.name,
  });

  socket.on("player:move", ({ cx, cy }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (cx < 0 || cy < 0 || cx >= MAP_COLS || cy >= MAP_ROWS) return;
    player.cx = cx;
    player.cy = cy;
    socket.to(room).emit("player:move", { id: socket.id, cx, cy });
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.to(room).emit("player:leave", socket.id);
    console.log(`[-] ${socket.id}`);
  });
});

const PORT = process.env.PORT ?? 3001;
migrateLegacyJson().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Game server on http://localhost:${PORT}`);
  });
});
