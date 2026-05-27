import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

// ── Types ──────────────────────────────────────────────────────────
interface PlayerState {
  id: string;
  cx: number;
  cy: number;
  name: string;
}

interface ServerToClientEvents {
  init: (data: { id: string; players: PlayerState[] }) => void;
  "player:join": (state: PlayerState) => void;
  "player:move": (data: { id: string; cx: number; cy: number }) => void;
  "player:leave": (id: string) => void;
}

interface ClientToServerEvents {
  "player:move": (payload: { cx: number; cy: number }) => void;
}

// ── App setup ──────────────────────────────────────────────────────
const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

// In-memory world state
const players = new Map<string, PlayerState>();

// ── Socket events ──────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] Player connected: ${socket.id}`);

  const state: PlayerState = {
    id: socket.id,
    cx: 9,
    cy: 9,
    name: `Player_${socket.id.slice(0, 4)}`,
  };
  players.set(socket.id, state);

  // Send the new player their id + all existing players
  socket.emit("init", {
    id: socket.id,
    players: Array.from(players.values()),
  });

  // Notify everyone else that someone joined
  socket.broadcast.emit("player:join", state);

  // ── Movement ─────────────────────────────────────────────────────
  socket.on("player:move", ({ cx, cy }) => {
    const player = players.get(socket.id);
    if (!player) return;

    // Basic server-side bounds check
    if (cx < 0 || cy < 0 || cx >= 20 || cy >= 20) return;

    player.cx = cx;
    player.cy = cy;

    // Broadcast to everyone except the sender
    socket.broadcast.emit("player:move", { id: socket.id, cx, cy });
  });

  // ── Disconnect ────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("player:leave", socket.id);
    console.log(`[-] Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`🎮 Game server running on http://localhost:${PORT}`);
});
