export interface PlayerState {
  id: string;
  cx: number;
  cy: number;
  name: string;
}

export interface ServerToClientEvents {
  init: (data: { id: string; players: PlayerState[] }) => void;
  "player:join": (state: PlayerState) => void;
  "player:move": (data: { id: string; cx: number; cy: number }) => void;
  "player:leave": (id: string) => void;
}

export interface ClientToServerEvents {
  "player:move": (payload: { cx: number; cy: number }) => void;
}

export type MovePayload = { cx: number; cy: number };
