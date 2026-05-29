export interface PlayerState {
  id: string;
  cx: number;
  cy: number;
  name: string;
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

export interface ServerToClientEvents {
  init: (data: { id: string; world: WorldState }) => void;
  "world:state": (data: WorldState) => void;
  "player:join": (state: PlayerState) => void;
  "player:move": (data: { id: string; cx: number; cy: number }) => void;
  "player:leave": (id: string) => void;
  "invite:received": (info: InviteInfo) => void;
  "invite:cancelled": (data: { fromSocketId: string }) => void;
  "invite:error": (data: { reason: string }) => void;
}

export interface ClientToServerEvents {
  "player:move": (payload: { cx: number; cy: number }) => void;
  "world:enter": (payload: WorldRef) => void;
  "invite:send": (payload: { toSocketId: string }) => void;
  "invite:accept": (payload: { fromSocketId: string }) => void;
  "invite:decline": (payload: { fromSocketId: string }) => void;
}

export type MovePayload = { cx: number; cy: number };
