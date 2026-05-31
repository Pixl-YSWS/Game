import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  MovePayload,
  WorldRef,
} from "../types/network";
import { getSessionToken } from "./playerIdentity";

export type { MovePayload };

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

// Lifecycle of the underlying socket connection, surfaced to the UI so a
// dead server shows a visible error instead of hanging on "Loading…".
export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "offline"
  | "unauthorized";
type StatusHandler = (status: ConnectionStatus, detail?: string) => void;

class GameSocket {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private handlers = new Map<string, Function[]>();
  private statusHandlers: StatusHandler[] = [];

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      auth: { sessionToken: getSessionToken() },
    });

    this.socket.on("connect", () => {
      console.log("[Socket] connected:", this.socket!.id);
      this.emitStatus("connected");
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("[Socket] disconnected:", reason);
      this.emitStatus("disconnected", reason);
    });

    // Fires once per failed attempt (e.g. server is down / refusing).
    this.socket.on("connect_error", (err) => {
      console.warn("[Socket] connect_error:", err.message);
      // The auth middleware rejects with this exact message — surface it so
      // the client can bounce the player back to the login screen.
      if (err.message === "unauthorized") {
        this.emitStatus("unauthorized", err.message);
      } else {
        this.emitStatus("error", err.message);
      }
    });

    // Fires after `reconnectionAttempts` failures — the server is unreachable.
    this.socket.io.on("reconnect_failed", () => {
      console.error("[Socket] reconnect failed — server unreachable");
      this.emitStatus("offline");
    });

    this.socket.onAny((event: string, ...args: unknown[]) => {
      this.handlers.get(event)?.forEach((fn) => fn(...args));
    });
  }

  // Subscribe to connection lifecycle changes. Returns nothing; use
  // clearHandlers() (called on scene shutdown) to remove all subscriptions.
  onStatus(handler: StatusHandler) {
    this.statusHandlers.push(handler);
  }

  private emitStatus(status: ConnectionStatus, detail?: string) {
    this.statusHandlers.forEach((fn) => fn(status, detail));
  }

  on<K extends keyof ServerToClientEvents>(event: K, handler: ServerToClientEvents[K]) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler as Function);
  }

  off<K extends keyof ServerToClientEvents>(event: K, handler: ServerToClientEvents[K]) {
    const list = this.handlers.get(event);
    if (!list) return;
    const i = list.indexOf(handler as Function);
    if (i >= 0) list.splice(i, 1);
  }

  clearHandlers() {
    this.handlers.clear();
    this.statusHandlers.length = 0;
  }

  sendMove(cx: number, cy: number) {
    this.socket?.emit("player:move", { cx, cy });
  }

  enterWorld(world: WorldRef) {
    this.socket?.emit("world:enter", world);
  }

  npcInteract(npcId: string) {
    this.socket?.emit("npc:interact", { npcId });
  }

  shopBuy(itemId: string) {
    this.socket?.emit("shop:buy", { itemId });
  }

  sendChat(text: string) {
    this.socket?.emit("chat:send", { text });
  }

  sendEmote(emote: string) {
    this.socket?.emit("emote:send", { emote });
  }

  setCharacter(char: number) {
    this.socket?.emit("character:set", { char });
  }

  // Send a persistent village invite to an account.
  sendInvite(toAccountId: string) {
    this.socket?.emit("invite:send", { toAccountId });
  }

  // Ask for the searchable account directory (reply on "players:list").
  requestPlayers() {
    this.socket?.emit("players:list");
  }

  // Ask for the inbox snapshot (reply on "notify:list"; marks all read).
  requestNotifications() {
    this.socket?.emit("notify:list");
  }

  // Accept / decline a pending notification by id.
  respondNotification(id: number, accept: boolean) {
    this.socket?.emit("notify:respond", { id, accept });
  }

  // Ask for the inventory snapshot (reply on "inventory:list").
  requestInventory() {
    this.socket?.emit("inventory:get");
  }

  // Place a placeable item as furniture in the shared house.
  placeHouseItem(itemId: string, cx: number, cy: number) {
    this.socket?.emit("house:place", { itemId, cx, cy });
  }

  // Pick a placed item back up (returns it to your inventory).
  removeHouseItem(id: number) {
    this.socket?.emit("house:remove", { id });
  }

  // ── Admin / moderation ──────────────────────────────────────────
  requestAdminData() {
    this.socket?.emit("admin:list");
  }
  adminMute(accountId: string, reason?: string) {
    this.socket?.emit("admin:mute", { accountId, reason });
  }
  adminUnmute(accountId: string) {
    this.socket?.emit("admin:unmute", { accountId });
  }
  adminSetRole(accountId: string, role: "subadmin" | "none") {
    this.socket?.emit("admin:setRole", { accountId, role });
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
