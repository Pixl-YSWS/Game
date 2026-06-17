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

# Maps are now hand-maintained (no generator). Edit src/data/MapData.ts (TOWN_MAP,
# open world) or src/data/villageMaps.ts (VILLAGE, baked) directly.

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

Optional env vars: `ADMIN_SECRET` (required to use the admin CLI), `ADMIN_EMAILS` (comma-separated emails that get root admin on first login), `DATA_DIR` (SQLite path for prod/Railway), `ALLOW_GUEST`, `OPENWORLD_VERIFIED_ONLY`. Hackatime OAuth needs `HACKATIME_CLIENT_ID` / `HACKATIME_CLIENT_SECRET` (register an app at https://hackatime.hackclub.com/oauth/applications with redirect URI `<server>/hackatime/callback` and scope `read`); `HACKATIME_REDIRECT_URI`, `HACKATIME_API_BASE`, `HACKATIME_SCOPES` are optional overrides.

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
- **`MapData.ts`** (`src/data/MapData.ts`): Exports `TOWN_MAP` (a `MapDef`) — the single hand-authored map used as the base preset. Hand-edited (`WALKABLE_GROUND` / `SOLID_DECO` control collision).
- **`villageMaps.ts`** (`src/data/villageMaps.ts`): Exports `VILLAGE`, the hand-maintained baked village map (`main_hub` + `home_town`). Collision is `groundLayer` (walkableGround) + `decoLayer` (solidDeco=99); the `baked` block is the verbatim multi-tileset render. Edit collision/doors directly — there is no generator.

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

### Projects & Hackatime (YSWS)

Players ship "projects" (YSWS submissions) via the **Pip** NPC (a `panel: "projects"` villager added in `MapGen.ts`; `WorldScene.interactWithNpc` routes it to `ProjectsScene`). Projects (owner, name, description, repo/demo URLs, optional `hackatime_project` mapping) and the YSWS user identity behind them live in **Postgres via Drizzle** (`server/db.ts`) — _not_ SQLite — because Hack Club's YSWS tooling expects an Airtable-shaped backend. Every accessor in `server/db.ts` returns the Airtable response envelope (`{ records: [{ id, fields }] }` via the `DBResponse`/`airtableReplication` types), so callers (and any future Airtable replication) see a consistent shape. Connection is `DATABASE_URL` (plain Postgres or Neon — SSL auto-enabled for `*.neon.tech`); tables auto-create on boot via `ensureSchema()`, or use `bunx drizzle-kit push` (`drizzle.config.ts`). When `DATABASE_URL` is unset the accessors **fail soft** (return `ok:false`) so the rest of the game still runs. All other game state stays on synchronous SQLite. Projects are managed over `project:list/create/update/delete` (all server-validated, now async). User identity (`account_id`, name, email, slack id, hackatime token) is mirrored into the Postgres `users` table fire-and-forget from `auth.ts` on login — the SQLite `accounts` table remains the live session store. `ProjectsScene` (`src/scenes/ProjectsScene.ts`) is a single modal with three modes — list, create/edit form (DOM inputs), and a Hackatime connect panel.

Hackatime (Hack Club's coding-time tracker) is connected per-player via **its own OAuth 2.0** (`server/hackatimeAuth.ts`, mounted at `/hackatime`). The client opens `/hackatime/connect?token=<session>` in a popup; the server verifies the game session, redirects to Hackatime's consent screen, exchanges the code at `/oauth/token`, and stores the resulting access token on the account (`accounts.hackatime_key` — the column now holds an OAuth Bearer token, not a pasted key). The popup's success page `postMessage`s the game, which refreshes stats. `server/hackatime.ts` reads `/api/v1/authenticated/projects` with the token (cached 60s, fails soft); `sendProjectList` merges each project's tracked seconds in by its mapped Hackatime project name. Socket events: `hackatime:setKey` (empty string disconnects) / `hackatime:stats`.

### Custom character skins

Beyond the 5 preset skins (`CHAR_BASES`), players can draw a 16×16 avatar in `SkinEditorScene` (launched from the "Draw your own" button in `CharacterScene`). The skin is encoded by a compact, Phaser-free codec (`src/world/skin.ts` — also imported by the server for validation), rendered to a Phaser texture by `src/world/skinTexture.ts` (client only), persisted on the account (`accounts.custom_skin`), and broadcast via `player:appearance` (which now carries an optional `skin`). A custom skin overrides the `char` preset; picking a preset clears it. `Player.setAppearance(char, skin?)` is the single entry point for applying either.

### Audio

- **`MusicEngine`** (`src/audio/MusicEngine.ts`): Procedural ambient music synthesised with the Web Audio API. No audio files needed. Scale shifts major (day) → minor (night) with the day/night phase.
- **`VoiceChat`** (`src/audio/VoiceChat.ts`): Toggle open-mic voice chat. Records 1.5s self-contained audio segments (fresh `MediaRecorder` each cycle for cross-browser compatibility) and sends them via `voice:clip`; server relays as `player:voice`.

### Admin CLI (`server/admin-cli.ts`)

Offline moderation tool that directly edits the SQLite DB. Requires `ADMIN_SECRET` env var. Commands: `accounts [filter]`, `whois <id>`, `admins`, `mutes`, `add-admin`, `add-subadmin`, `remove-role`, `mute`, `unmute`, `give`, `setpixels`.

### Map authoring

Maps are hand-maintained — there is **no** map-generation script (the old `sync-map`/`sync-maps` pipeline was removed). Edit the map source files directly:

- `src/data/MapData.ts` — `TOWN_MAP` (open world). Tune collision via `WALKABLE_GROUND` / `SOLID_DECO`.
- `src/data/villageMaps.ts` — `VILLAGE` (baked village). Set `decoLayer[row][col]` to `99` to block a tile or `-1` to clear it; add a door by pushing `{ cx, cy }` to `doors` and clearing that cell.

The Tiled project files and `maps/*.json` remain in the repo as historical reference only; nothing reads them at build time.
