export interface PlayerState {
  id: string;
  cx: number;
  cy: number;
  name: string;
  // Character skin index (into the client's CHAR_BASES). Optional so the
  // lightweight player:move payload doesn't have to carry it.
  char?: number;
  // True if the account is Hack Club "verified".
  verified?: boolean;
}

// What "world" a player is currently in. The shared overworld is a single
// global room; a village is owned by exactly one persistent player id and
// only that owner (plus anyone they've invited) may enter it. The "house"
// is a single shared multiplayer interior reachable from the open world.
export type WorldRef =
  | { kind: "openworld" }
  | { kind: "house" }
  | { kind: "village"; ownerPlayerId: string };

export interface WorldState {
  world: WorldRef;
  seed: number;
  spawn: { cx: number; cy: number };
  players: PlayerState[];
}

// One entry in the searchable player directory shown by the invite panel.
// `online` is whether that account currently has a live socket.
export interface PlayerDirEntry {
  accountId: string;
  name: string;
  online: boolean;
}

// A stored, persistent notification (currently only village invites). Lives
// in the server's SQLite `notifications` table and survives reconnects.
export interface Notification {
  id: number;
  type: "village_invite";
  fromId: string;
  fromName: string;
  message?: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
}

// One stack in a player's inventory.
export interface InventoryEntry {
  itemId: string;
  count: number;
}

// A piece of furniture placed in the shared house. Position is in tile coords.
export interface HouseObject {
  id: number;
  itemId: string;
  cx: number;
  cy: number;
  placedBy: string; // account id of whoever placed it
}

// Anchor for the world day/night cycle. Clients extrapolate the current
// phase from (Date.now() - serverNow + tNow * dayLengthMs) mod dayLengthMs.
export interface DayCycle {
  // Current phase, 0..1. 0 = midnight, 0.5 = noon.
  tNow: number;
  dayLengthMs: number;
  // Server's Date.now() when tNow was sampled — lets the client compensate
  // for any wall-clock drift relative to the server.
  serverNow: number;
}

// Moderation role. `null` = a normal player. Sub-admins can mute/unmute;
// full admins can also promote/remove sub-admins.
export type ModRole = "admin" | "subadmin" | null;

// One row in the admin panel's people list.
export interface AdminEntry {
  accountId: string;
  name: string;
  role: Exclude<ModRole, null>;
}
export interface MuteEntry {
  accountId: string;
  name: string;
  reason?: string;
}
// An online player as seen by the admin panel (with their mod status).
export interface AdminPlayerEntry {
  accountId: string;
  name: string;
  role: ModRole;
  muted: boolean;
}

export interface ServerToClientEvents {
  init: (data: { id: string; accountId: string; name: string; char: number; verified: boolean; role: ModRole; world: WorldState; pixels: number; unread: number; dayCycle: DayCycle }) => void;
  // A short moderation message shown to one player (e.g. "You have been muted").
  "mod:notice": (data: { text: string }) => void;
  // Snapshot for the admin panel (in response to admin:list).
  "admin:data": (data: { admins: AdminEntry[]; mutes: MuteEntry[]; online: AdminPlayerEntry[] }) => void;
  "world:state": (data: WorldState) => void;
  "player:join": (state: PlayerState) => void;
  "player:move": (data: { id: string; cx: number; cy: number }) => void;
  "player:leave": (id: string) => void;
  // Account directory for the invite panel.
  "players:list": (data: { players: PlayerDirEntry[] }) => void;
  // Full inbox snapshot (in response to notify:list). `unread` is the count
  // remaining unread after this snapshot (always 0 — listing marks them read).
  "notify:list": (data: { items: Notification[]; unread: number }) => void;
  // A new notification arrived while online; carries the live unread count.
  "notify:new": (data: { item: Notification; unread: number }) => void;
  // An invite was sent successfully (ack for the sender).
  "invite:sent": (data: { toName: string }) => void;
  "invite:error": (data: { reason: string }) => void;
  // Wallet sync. `wallet:update` carries the new total + delta + an optional
  // human-readable reason so the client can flash a "+5 from Quill" toast.
  "wallet:update": (data: { pixels: number; delta: number; reason?: string }) => void;
  // Result of a shop:buy. success=false carries a reason code the client
  // can render ("not_enough_pixels", "unknown_item").
  "shop:result": (data: { itemId: string; success: boolean; reason?: string }) => void;
  // A chat line from a player in the same world (echoed back to the sender too
  // so everyone shares one ordered log).
  "chat:message": (data: ChatMessage) => void;
  // An emote (wave, etc.) triggered by a player in the same world.
  "player:emote": (data: { id: string; emote: string }) => void;
  // A push-to-talk voice clip from a player in the same world (binary audio).
  "player:voice": (data: { id: string; data: ArrayBuffer; mime: string }) => void;
  // Sent to a socket right before it's disconnected because the same account
  // logged in elsewhere (single-session enforcement).
  "auth:kicked": () => void;
  // A player changed their character skin; update their avatar in place.
  "player:appearance": (data: { id: string; char: number }) => void;
  // A world switch was refused (e.g. open world needs a verified account).
  "world:denied": (data: { reason: string }) => void;
  // Inventory snapshot (in response to inventory:get, or after a change).
  "inventory:list": (data: { items: InventoryEntry[] }) => void;
  // Current furniture in the shared house, sent on entering it.
  "house:objects": (data: { objects: HouseObject[] }) => void;
  // A piece of furniture was placed / removed in the shared house.
  "house:object:added": (data: { object: HouseObject }) => void;
  "house:object:removed": (data: { id: number }) => void;
}

// One line of world chat. `self` is filled in client-side, not sent.
export interface ChatMessage {
  id: string; // sender socket id
  name: string;
  text: string;
}

export interface ClientToServerEvents {
  "player:move": (payload: { cx: number; cy: number }) => void;
  "world:enter": (payload: WorldRef) => void;
  // Send a persistent village invite to another account.
  "invite:send": (payload: { toAccountId: string }) => void;
  // Ask the server for the account directory (responds with players:list).
  "players:list": () => void;
  // Ask for the inbox snapshot (responds with notify:list, marks all read).
  "notify:list": () => void;
  // Accept or decline a pending notification by id.
  "notify:respond": (payload: { id: number; accept: boolean }) => void;
  // Fired when the player opens a dialogue with an NPC. Server validates
  // the NPC exists in the player's current world and grants any one-shot
  // reward attached to that NPC.
  "npc:interact": (payload: { npcId: string }) => void;
  // Buy one of an item from the shop. Server validates pixels and emits
  // wallet:update + shop:result.
  "shop:buy": (payload: { itemId: string }) => void;
  // Send a chat line to everyone in the player's current world.
  "chat:send": (payload: { text: string }) => void;
  // Trigger an emote (e.g. "wave") broadcast to the player's current world.
  "emote:send": (payload: { emote: string }) => void;
  // Send a push-to-talk voice clip (binary audio) to the player's world.
  "voice:clip": (payload: { data: ArrayBuffer; mime: string }) => void;
  // Choose a character skin (index into CHAR_BASES). Persisted on the account.
  "character:set": (payload: { char: number }) => void;
  // Ask for the inventory snapshot (responds with inventory:list).
  "inventory:get": () => void;
  // Place a placeable item as furniture in the shared house.
  "house:place": (payload: { itemId: string; cx: number; cy: number }) => void;
  // Pick a placed item back up (returns it to your inventory).
  "house:remove": (payload: { id: number }) => void;

  // ── Admin / moderation (server validates the caller's role) ──────────
  // Request the admin-panel snapshot (responds with admin:data).
  "admin:list": () => void;
  // Mute / unmute an account from world chat (admin or sub-admin).
  "admin:mute": (payload: { accountId: string; reason?: string }) => void;
  "admin:unmute": (payload: { accountId: string }) => void;
  // Promote to sub-admin or demote back to a normal player (full admin only).
  "admin:setRole": (payload: { accountId: string; role: "subadmin" | "none" }) => void;
}

export type MovePayload = { cx: number; cy: number };
