import { io, Socket } from "socket.io-client";
import type { PlayerState } from "../entities/Player";

export type MovePayload = { cx: number; cy: number };

export interface ServerToClientEvents {
  /** Server sends us our assigned id + initial world state */
  init: (data: { id: string; players: PlayerState[] }) => void;
  /** Another player joined */
  "player:join": (state: PlayerState) => void;
  /** Another player moved */
  "player:move": (data: { id: string; cx: number; cy: number }) => void;
  /** A player disconnected */
  "player:leave": (id: string) => void;
}

export interface ClientToServerEvents {
  /** Local player moved to tile (cx, cy) */
  "player:move": (payload: MovePayload) => void;
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

class GameSocket {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null =
    null;
  private handlers = new Map<string, Function[]>();

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    this.socket.on("connect", () => {
      console.log("[Socket] connected:", this.socket!.id);
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("[Socket] disconnected:", reason);
    });

    // Forward typed events to registered handlers
    const forward = (event: string) => {
      (this.socket as any).on(event, (...args: any[]) => {
        this.handlers.get(event)?.forEach((fn) => fn(...args));
      });
    };

    forward("init");
    forward("player:join");
    forward("player:move");
    forward("player:leave");
  }

  on<K extends keyof ServerToClientEvents>(
    event: K,
    handler: ServerToClientEvents[K],
  ) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler as Function);
  }

  sendMove(cx: number, cy: number) {
    this.socket?.emit("player:move", { cx, cy });
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

// Export a singleton so scenes share one socket
export const gameSocket = new GameSocket();
