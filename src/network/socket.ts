import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  MovePayload,
  WorldRef,
  MuteChannel,
  MapEdit,
  NpcEdit,
} from "../types/network";
import { getSessionToken } from "./playerIdentity";

export type { MovePayload };

export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "offline"
  | "unauthorized";
type StatusHandler = (status: ConnectionStatus, detail?: string) => void;

class GameSocket {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null =
    null;
  private handlers = new Map<string, Function[]>();
  private statusHandlers: StatusHandler[] = [];

  private chatQueue: string[] = [];
  private static readonly CHAT_QUEUE_MAX = 50;

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,

      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: { sessionToken: getSessionToken() },
    });

    this.socket.on("connect", () => {
      console.log("[Socket] connected:", this.socket!.id);
      this.emitStatus("connected");
      this.flushChatQueue();
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("[Socket] disconnected:", reason);
      this.emitStatus("disconnected", reason);
    });

    this.socket.on("connect_error", (err) => {
      console.warn("[Socket] connect_error:", err.message);

      if (err.message === "unauthorized") {
        this.emitStatus("unauthorized", err.message);
      } else {
        this.emitStatus("disconnected", err.message);
      }
    });

    this.socket.io.on("reconnect_failed", () => {
      console.error("[Socket] reconnect failed — server unreachable");
      this.emitStatus("offline");
    });

    this.socket.onAny((event: string, ...args: unknown[]) => {
      this.handlers.get(event)?.forEach((fn) => fn(...args));
    });
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.push(handler);
  }

  private emitStatus(status: ConnectionStatus, detail?: string) {
    this.statusHandlers.forEach((fn) => fn(status, detail));
  }

  on<K extends keyof ServerToClientEvents>(
    event: K,
    handler: ServerToClientEvents[K],
  ) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler as Function);
  }

  off<K extends keyof ServerToClientEvents>(
    event: K,
    handler: ServerToClientEvents[K],
  ) {
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

  sendChat(text: string): boolean {
    if (this.socket?.connected) {
      this.socket.emit("chat:send", { text });
      return true;
    }
    if (this.chatQueue.length < GameSocket.CHAT_QUEUE_MAX)
      this.chatQueue.push(text);
    return false;
  }

  private flushChatQueue() {
    if (!this.socket?.connected || this.chatQueue.length === 0) return;
    const pending = this.chatQueue;
    this.chatQueue = [];
    for (const text of pending) this.socket.emit("chat:send", { text });
  }

  sendEmote(emote: string) {
    this.socket?.emit("emote:send", { emote });
  }

  sendVoiceClip(data: ArrayBuffer, mime: string) {
    this.socket?.emit("voice:clip", { data, mime });
  }

  setCharacter(char: number) {
    this.socket?.emit("character:set", { char });
  }

  setSkin(skin: string) {
    this.socket?.emit("character:setSkin", { skin });
  }

  requestProjects() {
    this.socket?.emit("project:list");
  }
  createProject(payload: {
    name: string;
    description?: string;
    repoUrl?: string;
    demoUrl?: string;
    hackatimeProject?: string;
  }) {
    this.socket?.emit("project:create", payload);
  }
  updateProject(payload: {
    id: number;
    name: string;
    description?: string;
    repoUrl?: string;
    demoUrl?: string;
    hackatimeProject?: string;
  }) {
    this.socket?.emit("project:update", payload);
  }
  deleteProject(id: number) {
    this.socket?.emit("project:delete", { id });
  }
  setHackatimeKey(key: string) {
    this.socket?.emit("hackatime:setKey", { key });
  }
  requestHackatimeStats() {
    this.socket?.emit("hackatime:stats");
  }

  sendInvite(toAccountId: string) {
    this.socket?.emit("invite:send", { toAccountId });
  }

  requestPlayers() {
    this.socket?.emit("players:list");
  }

  requestNotifications() {
    this.socket?.emit("notify:list");
  }

  respondNotification(id: number, accept: boolean) {
    this.socket?.emit("notify:respond", { id, accept });
  }

  requestInventory() {
    this.socket?.emit("inventory:get");
  }

  placeHouseItem(itemId: string, cx: number, cy: number) {
    this.socket?.emit("house:place", { itemId, cx, cy });
  }

  removeHouseItem(id: number) {
    this.socket?.emit("house:remove", { id });
  }

  requestAdminData() {
    this.socket?.emit("admin:list");
  }
  adminMute(accountId: string, channel: MuteChannel = "both", reason?: string) {
    this.socket?.emit("admin:mute", { accountId, channel, reason });
  }
  adminUnmute(accountId: string, channel: MuteChannel = "both") {
    this.socket?.emit("admin:unmute", { accountId, channel });
  }
  adminSetRole(accountId: string, role: "subadmin" | "none") {
    this.socket?.emit("admin:setRole", { accountId, role });
  }

  mapEdit(payload: { tiles?: MapEdit[]; npcs?: NpcEdit[]; label?: string }) {
    this.socket?.emit("map:edit", payload);
  }
  requestMapHistory() {
    this.socket?.emit("map:history");
  }
  mapSetActive(id: number, active: boolean) {
    this.socket?.emit("map:setActive", { id, active });
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
