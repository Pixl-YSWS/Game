import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import type { PlayerState, ServerToClientEvents, ClientToServerEvents } from "../src/types/network.ts";

const MAP_COLS = 30;
const MAP_ROWS = 20;

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

const players = new Map<string, PlayerState>();

io.on("connection", (socket) => {
  console.log(`[+] Player connected: ${socket.id}`);

  const state: PlayerState = {
    id: socket.id,
    cx: 9,
    cy: 9,
    name: `Player_${socket.id.slice(0, 4)}`,
  };
  players.set(socket.id, state);

  socket.emit("init", { id: socket.id, players: Array.from(players.values()) });
  socket.broadcast.emit("player:join", state);

  socket.on("player:move", ({ cx, cy }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (cx < 0 || cy < 0 || cx >= MAP_COLS || cy >= MAP_ROWS) return;
    player.cx = cx;
    player.cy = cy;
    socket.broadcast.emit("player:move", { id: socket.id, cx, cy });
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("player:leave", socket.id);
    console.log(`[-] Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`Game server running on http://localhost:${PORT}`);
});
