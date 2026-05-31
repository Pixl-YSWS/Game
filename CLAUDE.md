# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Client (Vite dev server on http://localhost:5173)
bun run dev

# Server (Socket.IO game server on http://localhost:3001), auto-reloads on change
bun run server

# Type-check / production build
bun run build          # tsc && vite build

# Sync Tiled map export → MapData.ts (run after editing maps/map1.json)
bun run sync-map

# Offline admin CLI (requires ADMIN_SECRET in env)
bun server/admin-cli.ts <password> <command> [args]
# e.g. bun server/admin-cli.ts mysecret accounts
#      bun server/admin-cli.ts mysecret give <accountId> 50
# No test suite currently
```

The client and server must run concurrently for multiplayer to work. Set `VITE_SERVER_URL` to override the default server URL (`http://localhost:3001`).

### Auth setup (required to play)

Login is mandatory — the socket server rejects any connection without a valid Hack Club session, so the game can't be played logged-out. Set it up once:

1. Register an OAuth app at https://auth.hackclub.com (Developer Apps → "app me up!"). Add redirect URI `http://localhost:3001/auth/callback` and request scopes `openid profile email name slack_id`.
2. `cp .env.example .env` and fill in `HACKCLUB_CLIENT_ID` / `HACKCLUB_CLIENT_SECRET` (Bun auto-loads `.env`). `.env` is gitignored.
3. `bun run server` + `bun run dev`, open the client, click **Login with Hack Club**.

Flow: client → `GET /auth/login` → Hack Club consent → `GET /auth/callback` (token exchange + `/api/v1/me`) → redirect to client with `#auth=<sessionToken>`. The client stores the token in localStorage and sends it in the socket handshake; `server/auth.ts` verifies it. Accounts + tokens live in the SQLite `accounts` table (`server/data/players.db`). Game state (seed, position, pixels) is keyed by the Hack Club account id. One active session per account — a new login kicks the old one.

Optional env vars: `ADMIN_SECRET` (required to use the admin CLI), `ADMIN_EMAILS` (comma-separated emails that get root admin on first login), `DATA_DIR` (SQLite path for prod/Railway), `ALLOW_GUEST`, `OPENWORLD_VERIFIED_ONLY`.

## Architecture

This is a **Phaser 4 + Socket.IO multiplayer top-down game** with a Vite/TypeScript frontend and a standalone Express/Socket.IO server.

### Scene pipeline

`BootScene` → `MainMenuScene` or `LoginScene` → `WorldScene` + `UIScene` (parallel overlay). Modal scenes (`PauseScene`, `SettingsScene`, `CharacterScene`, `ShopScene`, `InventoryScene`, `InboxScene`, `InvitePanelScene`, `AdminScene`) run on top of `WorldScene` via `scene.launch()` / `scene.bringToTop()`. `InteriorScene` replaces `WorldScene` as the active world when entering a building.

- **BootScene** (`src/scenes/BootScene.ts`): Asset preloading only. Loads spritesheets (`tiles-town`, `ui-adv` atlas, `emotes` atlas, character sprites) from `public/assets/`.
- **WorldScene** (`src/scenes/WorldScene.ts`): Main scene. Builds the map via `IsoMap`, spawns the local `Player` and `Npc`s, handles keyboard/mobile input, day/night lighting, chat, emotes, voice, and owns the multiplayer connection lifecycle.
- **UIScene** (`src/scenes/UIScene.ts`): HUD overlay. Receives a `WorldScene` reference via `init()` data.
- **AdminScene** (`src/scenes/AdminScene.ts`): Moderation panel — mute/unmute players, promote/demote sub-admins. Visible only to staff (`role` returned in `init`).

### Tile rendering

Despite the name `IsoUtils`/`cartToIso`, the renderer is **top-down orthographic** (not true isometric). Tiles are 16×16 px; the camera zoom (default 3×) handles display scaling.

- **`IsoMap`** (`src/world/IsoMap.ts`): Stamps `Phaser.GameObjects.Image` objects directly onto the scene for each tile in a `MapDef`'s `groundLayer` and `decoLayer`. Ground tiles at depth 0; deco tiles at `row + 1`.
- **`IsoUtils.ts`** (`src/utils/IsoUtils.ts`): `cartToIso(cx, cy)` converts tile column/row to world pixel coordinates. `TILE_W` and `TILE_H` are both 16.
- **`MapData.ts`** (`src/data/MapData.ts`): Exports `TOWN_MAP` (a `MapDef`) — the single hand-authored map used as the base preset. Regenerate from Tiled via `bun run sync-map`. `WALKABLE_GROUND` and `SOLID_DECO` are preserved across syncs.

### Procedural world generation

Every player's private village is generated from a seed with `generateMap(seed)` (`src/world/MapGen.ts`). The shared open world uses the fixed seed `0xC0FFEE`. `MapGen` takes a `VillagePreset` from `src/world/presets.ts` (which strips houses from `TOWN_MAP` and declares slot bounding boxes), then stamps randomly-chosen house templates into the slots, connects them to the path network, places NPCs, and optionally adds a world-switch portal.

- **`presets.ts`** (`src/world/presets.ts`): `TOWN_PRESET` is derived from `TOWN_MAP` with houses stripped out and `HouseSlot[]` defined.
- **`HouseMap.ts`** (`src/world/HouseMap.ts`): Builds the shared interior `MapDef` for `WorldRef = { kind: "house" }`.

### World system (`WorldRef`)

Players exist in exactly one world at a time, identified by `WorldRef` (`src/types/network.ts`):
- `{ kind: "openworld" }` — shared, seed `0xC0FFEE`, optionally verified-only.
- `{ kind: "village"; ownerPlayerId }` — per-player private village seeded from the owner's account id hash.
- `{ kind: "house" }` — single shared multiplayer interior.

World switches are requested via `world:enter` socket event; the server validates access and emits `world:state` with the new seed and player list. Walking onto a door tile triggers entry; the portal tile switches between open world and the player's village.

### Player & movement

`Player` (`src/entities/Player.ts`) is a `Phaser.GameObjects.Container` holding a shadow ellipse, a character sprite (from `CHAR_BASES`, index stored in the account), and a name tag. Movement is tile-based with a 150 ms cooldown, supporting 8-directional (diagonal) movement. `handleInput` implements wall-sliding: on a blocked diagonal it tries each axis independently. Depth is `cy + 1` so players sort correctly with deco objects. `Npc` (`src/entities/Npc.ts`) shares the same Container structure but is server-placed and non-moving.

### Multiplayer

`gameSocket` (`src/network/socket.ts`) is a singleton `GameSocket` wrapping a typed `socket.io-client` Socket. `WorldScene.connectMultiplayer()` registers all server event handlers.

Server (`server/index.ts`): Express + Socket.IO. Persistent state in SQLite (`server/data/players.db`): `accounts` (in `server/auth.ts` — holds the session token + 30-day sliding expiry), plus `players`, `player_positions`, `inventory`, `npc_rewards`, `house_objects`, `notifications`, `admins`, `mutes`. In-memory `Map<socketId, PlayerState>` for live presence only. On connect, emits `init` (includes `WorldState`, pixel balance, unread count, `DayCycle`). On disconnect emits `player:leave`.

Key socket events (see `src/types/network.ts` for full typed interface): `init`, `world:state`, `world:enter`, `player:join/move/leave/emote/voice/appearance`, `chat:send/message`, `shop:buy/result`, `wallet:update`, `inventory:get/list`, `house:place/remove/objects/object:added/object:removed`, `notify:list/new/respond`, `invite:send/sent`, `admin:list/mute/unmute/setRole`, `npc:interact`.

### UI system

`src/ui/theme.ts` is the single source of truth for fonts (`FONT`, `FONT_NARROW`, `FONT_TITLE`, `FONT_CHAT`), colours (`COLORS`), and cursors (`CURSORS`). The entire HUD is skinned from the Kenney "UI pack — adventure" atlas (`UI_ATLAS = "ui-adv"`); use `uiFrame(name)` to resolve logical names like `"ui-panel"` to atlas frame strings. `src/ui/UIKit.ts` has shared factory functions (`panel()`, `closeButton()`, `fitModal()`, etc.) used by all modal scenes.

### Economy & shop

Players earn "pixels" (in-game currency). `src/shop/catalog.ts` exports `SHOP_CATALOG` (shared by client and server so prices can't be spoofed). Items with `placeable: true` can be placed as furniture in the shared house via `house:place` / `house:remove`. Pixel balances live in the SQLite `pixels` table; `wallet:update` syncs the client.

### Audio

- **`MusicEngine`** (`src/audio/MusicEngine.ts`): Procedural ambient music synthesised with the Web Audio API. No audio files needed. Scale shifts major (day) → minor (night) with the day/night phase.
- **`VoiceChat`** (`src/audio/VoiceChat.ts`): Toggle open-mic voice chat. Records 1.5s self-contained audio segments (fresh `MediaRecorder` each cycle for cross-browser compatibility) and sends them via `voice:clip`; server relays as `player:voice`.

### Admin CLI (`server/admin-cli.ts`)

Offline moderation tool that directly edits the SQLite DB. Requires `ADMIN_SECRET` env var. Commands: `accounts [filter]`, `whois <id>`, `admins`, `mutes`, `add-admin`, `add-subadmin`, `remove-role`, `mute`, `unmute`, `give`, `setpixels`.

### Map authoring

Tiled project files (`map1.tiled-project`, `.tiled-session`) and tileset JSONs (`maps/*.tsj`) are in the repo for map editing. After exporting from Tiled to `maps/map1.json`, run `bun run sync-map` to regenerate `src/data/MapData.ts`. `WALKABLE_GROUND`, `SOLID_DECO`, and `spawnPoint` are preserved from the existing file across syncs.
