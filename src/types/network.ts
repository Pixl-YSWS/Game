export interface PlayerState {
  id: string;
  cx: number;
  cy: number;
  name: string;

  char?: number;

  skin?: string;

  verified?: boolean;
}

export type WorldRef =
  | { kind: "openworld" }
  | { kind: "house" }
  | { kind: "village"; ownerPlayerId: string };

export interface MapEdit {
  layer: "ground" | "deco";
  cx: number;
  cy: number;
  tile: number;
}

// An admin NPC operation. `add` spawns a new villager; `move` relocates any
// NPC (generated or added) by id; `remove` deletes one by id.
export interface NpcEdit {
  op: "add" | "move" | "remove";
  id: string;
  cx: number;
  cy: number;
  name?: string;
  dialogue?: string[];
}

// One saved batch of admin edits to a world. Stored server-side so changes
// persist and can be individually reverted.
export interface MapRevision {
  id: number;
  authorId: string;
  authorName: string;
  label?: string;
  tiles: MapEdit[];
  npcs: NpcEdit[];
  active: boolean;
  createdAt: number;
}

// History row sent to the editor UI — the heavy edit payloads are summarised
// by counts.
export interface MapRevisionMeta {
  id: number;
  authorName: string;
  label?: string;
  tileCount: number;
  npcCount: number;
  active: boolean;
  createdAt: number;
}

export interface WorldState {
  world: WorldRef;
  seed: number;
  spawn: { cx: number; cy: number };
  players: PlayerState[];

  // Persisted admin tile-edits applied on top of the seed-generated map.
  overrides?: MapEdit[];
  // Persisted admin NPC edits applied (in order) on top of the base NPC list.
  npcEdits?: NpcEdit[];
}

export interface PlayerDirEntry {
  accountId: string;
  name: string;
  online: boolean;
}

export interface Notification {
  id: number;
  type: "village_invite";
  fromId: string;
  fromName: string;
  message?: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
}

export interface InventoryEntry {
  itemId: string;
  count: number;
}

export interface HouseObject {
  id: number;
  itemId: string;
  cx: number;
  cy: number;
  placedBy: string;
}

export interface Project {
  id: number;
  name: string;
  description?: string;
  repoUrl?: string;
  demoUrl?: string;
  hackatimeProjects?: string[];
  createdAt: number;
  updatedAt: number;

  seconds?: number;
}

export interface HackatimeProjectStat {
  name: string;
  seconds: number;
  text: string;
}
export interface HackatimeStats {
  connected: boolean;
  totalSeconds: number;
  humanReadableTotal: string;
  projects: HackatimeProjectStat[];

  error?: string;
}

export interface DayCycle {
  tNow: number;
  dayLengthMs: number;

  serverNow: number;
}

export type ModRole = "admin" | "subadmin" | null;

export interface AdminEntry {
  accountId: string;
  name: string;
  role: Exclude<ModRole, null>;
}
export interface MuteEntry {
  accountId: string;
  name: string;
  reason?: string;
  chat: boolean;
  voice: boolean;
}

export interface AdminPlayerEntry {
  accountId: string;
  name: string;
  role: ModRole;
  chatMuted: boolean;
  voiceMuted: boolean;
}

export type MuteChannel = "chat" | "voice" | "both";

export interface ServerToClientEvents {
  init: (data: {
    id: string;
    accountId: string;
    name: string;
    char: number;
    skin?: string;
    verified: boolean;
    role: ModRole;
    world: WorldState;
    pixels: number;
    unread: number;
    dayCycle: DayCycle;
  }) => void;

  "mod:notice": (data: { text: string }) => void;

  "admin:data": (data: {
    admins: AdminEntry[];
    mutes: MuteEntry[];
    online: AdminPlayerEntry[];
  }) => void;
  "world:state": (data: WorldState) => void;

  // Live broadcast to everyone in a world when its persisted edits change
  // (an admin saved or reverted a revision).
  "map:overrides": (data: {
    world: WorldRef;
    overrides: MapEdit[];
    npcEdits: NpcEdit[];
  }) => void;

  // Sent to the admin map editor in response to map:history.
  "map:history": (data: {
    world: WorldRef;
    editable: boolean;
    revisions: MapRevisionMeta[];
  }) => void;
  "player:join": (state: PlayerState) => void;
  "player:move": (data: { id: string; cx: number; cy: number }) => void;
  "player:leave": (id: string) => void;

  "players:list": (data: { players: PlayerDirEntry[] }) => void;

  "notify:list": (data: { items: Notification[]; unread: number }) => void;

  "notify:new": (data: { item: Notification; unread: number }) => void;

  "invite:sent": (data: { toName: string }) => void;
  "invite:error": (data: { reason: string }) => void;

  "wallet:update": (data: {
    pixels: number;
    delta: number;
    reason?: string;
  }) => void;

  "shop:result": (data: {
    itemId: string;
    success: boolean;
    reason?: string;
  }) => void;

  "chat:message": (data: ChatMessage) => void;

  "player:emote": (data: { id: string; emote: string }) => void;

  "player:voice": (data: {
    id: string;
    data: ArrayBuffer;
    mime: string;
  }) => void;

  "auth:kicked": () => void;

  "player:appearance": (data: {
    id: string;
    char: number;
    skin?: string;
  }) => void;

  "world:denied": (data: { reason: string }) => void;

  "inventory:list": (data: { items: InventoryEntry[] }) => void;

  "house:objects": (data: { objects: HouseObject[] }) => void;

  "house:object:added": (data: { object: HouseObject }) => void;
  "house:object:removed": (data: { id: number }) => void;

  "project:list": (data: {
    items: Project[];
    hackatimeConnected: boolean;
  }) => void;

  "project:result": (data: {
    ok: boolean;
    reason?: string;
    id?: number;
  }) => void;

  "hackatime:stats": (data: HackatimeStats) => void;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
}

export interface ClientToServerEvents {
  "player:move": (payload: { cx: number; cy: number }) => void;
  "world:enter": (payload: WorldRef) => void;

  /** Entering/leaving a private house interior — hides the player from
   *  everyone else in their current world while inside. */
  "interior:set": (payload: { inside: boolean }) => void;

  "invite:send": (payload: { toAccountId: string }) => void;

  "players:list": () => void;

  "notify:list": () => void;

  "notify:respond": (payload: { id: number; accept: boolean }) => void;

  "npc:interact": (payload: { npcId: string }) => void;

  "shop:buy": (payload: { itemId: string }) => void;

  "chat:send": (payload: { text: string }) => void;

  "emote:send": (payload: { emote: string }) => void;

  "voice:clip": (payload: { data: ArrayBuffer; mime: string }) => void;

  "character:set": (payload: { char: number }) => void;

  "character:setSkin": (payload: { skin: string }) => void;

  "project:list": () => void;

  "project:create": (payload: {
    name: string;
    description?: string;
    repoUrl?: string;
    demoUrl?: string;
    hackatimeProjects?: string[];
  }) => void;

  "project:update": (payload: {
    id: number;
    name: string;
    description?: string;
    repoUrl?: string;
    demoUrl?: string;
    hackatimeProjects?: string[];
  }) => void;

  "project:delete": (payload: { id: number }) => void;

  "hackatime:setKey": (payload: { key: string }) => void;

  "hackatime:stats": () => void;

  "inventory:get": () => void;

  "house:place": (payload: { itemId: string; cx: number; cy: number }) => void;

  "house:remove": (payload: { id: number }) => void;

  "admin:list": () => void;

  "admin:mute": (payload: {
    accountId: string;
    channel?: MuteChannel;
    reason?: string;
  }) => void;
  "admin:unmute": (payload: {
    accountId: string;
    channel?: MuteChannel;
  }) => void;

  "admin:setRole": (payload: {
    accountId: string;
    role: "subadmin" | "none";
  }) => void;

  // Admin map editor (full admins only). Edits apply to the admin's CURRENT
  // world; the server determines the target from live presence.
  "map:edit": (payload: {
    tiles?: MapEdit[];
    npcs?: NpcEdit[];
    label?: string;
  }) => void;
  "map:history": () => void;
  "map:setActive": (payload: { id: number; active: boolean }) => void;
}

export type MovePayload = { cx: number; cy: number };
