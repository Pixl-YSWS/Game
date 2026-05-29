import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  MovePayload,
  WorldRef,
} from "../types/network";
import { getOrCreatePlayerId } from "./playerIdentity";

export type { MovePayload };

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

class GameSocket {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private handlers = new Map<string, Function[]>();

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      auth: { playerId: getOrCreatePlayerId() },
    });

    this.socket.on("connect", () => {
      console.log("[Socket] connected:", this.socket!.id);
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("[Socket] disconnected:", reason);
    });

    this.socket.onAny((event: string, ...args: unknown[]) => {
      this.handlers.get(event)?.forEach((fn) => fn(...args));
    });
  }

  on<K extends keyof ServerToClientEvents>(event: K, handler: ServerToClientEvents[K]) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler as Function);
  }

  clearHandlers() {
    this.handlers.clear();
  }

  sendMove(cx: number, cy: number) {
    this.socket?.emit("player:move", { cx, cy });
  }

  enterWorld(world: WorldRef) {
    this.socket?.emit("world:enter", world);
  }

  sendInvite(toSocketId: string) {
    this.socket?.emit("invite:send", { toSocketId });
  }

  acceptInvite(fromSocketId: string) {
    this.socket?.emit("invite:accept", { fromSocketId });
  }

  declineInvite(fromSocketId: string) {
    this.socket?.emit("invite:decline", { fromSocketId });
  }

  get id(): string | undefined {
    return this.socket?.id;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  disconnect() {
    this.socket?.disconnect();
  }
}

export const gameSocket = new GameSocket();
