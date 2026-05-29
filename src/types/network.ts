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

export interface InviteInfo {
  fromSocketId: string;
  fromName: string;
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

export interface ServerToClientEvents {
  init: (data: { id: string; accountId: string; name: string; char: number; verified: boolean; world: WorldState; pixels: number; dayCycle: DayCycle }) => void;
  "world:state": (data: WorldState) => void;
  "player:join": (state: PlayerState) => void;
  "player:move": (data: { id: string; cx: number; cy: number }) => void;
  "player:leave": (id: string) => void;
  "invite:received": (info: InviteInfo) => void;
  "invite:cancelled": (data: { fromSocketId: string }) => void;
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
  // Sent to a socket right before it's disconnected because the same account
  // logged in elsewhere (single-session enforcement).
  "auth:kicked": () => void;
  // A player changed their character skin; update their avatar in place.
  "player:appearance": (data: { id: string; char: number }) => void;
  // A world switch was refused (e.g. open world needs a verified account).
  "world:denied": (data: { reason: string }) => void;
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
  "invite:send": (payload: { toSocketId: string }) => void;
  "invite:accept": (payload: { fromSocketId: string }) => void;
  "invite:decline": (payload: { fromSocketId: string }) => void;
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
  // Choose a character skin (index into CHAR_BASES). Persisted on the account.
  "character:set": (payload: { char: number }) => void;
}

export type MovePayload = { cx: number; cy: number };
