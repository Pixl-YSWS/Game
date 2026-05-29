# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Client (Vite dev server on http://localhost:5173)
bun run dev

# Server (Socket.IO game server on http://localhost:3001), auto-reloads on change
bun run server

# Type-check
bun run build          # tsc && vite build

# No test suite currently
```

The client and server must run concurrently for multiplayer to work. Set `VITE_SERVER_URL` to override the default server URL (`http://localhost:3001`).

### Auth setup (required to play)

Login is mandatory — the socket server rejects any connection without a valid
Hack Club session, so the game can't be played logged-out. Set it up once:

1. Register an OAuth app at https://auth.hackclub.com (Developer Apps → "app me
   up!"). Add redirect URI `http://localhost:3001/auth/callback` and request
   scopes `openid profile email name slack_id`.
2. `cp .env.example .env` and fill in `HACKCLUB_CLIENT_ID` / `HACKCLUB_CLIENT_SECRET`
   (Bun auto-loads `.env`). `.env` is gitignored.
3. `bun run server` + `bun run dev`, open the client, click **Login with Hack Club**.

Flow: client → `GET /auth/login` → Hack Club consent → `GET /auth/callback`
(token exchange + `/api/v1/me`) → redirect to client with `#auth=<sessionToken>`.
The client stores the token in localStorage and sends it in the socket handshake;
`server/auth.ts` verifies it. Accounts + tokens live in the SQLite `accounts`
table (`server/data/`). Game state (seed, position, pixels) is keyed by the Hack
Club account id. One active session per account — a new login kicks the old one.

## Architecture

This is a **Phaser 4 + Socket.IO multiplayer top-down game** with a Vite/TypeScript frontend and a standalone Express/Socket.IO server.

### Scene pipeline

`BootScene` → loads all textures → starts `WorldScene` → launches `UIScene` as a parallel overlay.

- **BootScene** (`src/scenes/BootScene.ts`): Asset preloading only. Loads `tiles-town` and `tiles-battle` spritesheets from `public/assets/`.
- **WorldScene** (`src/scenes/WorldScene.ts`): Main scene. Builds the map via `IsoMap`, spawns the local `Player`, handles keyboard/mouse input, and owns the multiplayer connection lifecycle.
- **UIScene** (`src/scenes/UIScene.ts`): HUD overlay (connection status, tile position, legend). Receives a reference to `WorldScene` via `init()` data to read player state.

### Tile rendering

Despite the name `IsoUtils`/`cartToIso`, the renderer is **top-down orthographic** (not true isometric). Tiles are 16×16 px; the camera zoom (default 3×) handles display scaling.

- **`IsoMap`** (`src/world/IsoMap.ts`): Stamps `Phaser.GameObjects.Image` objects directly onto the scene for each tile in `GROUND_LAYER` and `DECO_LAYER`. Ground tiles always at depth 0; deco tiles at `row + 1`.
- **`MapData.ts`** (`src/data/MapData.ts`): Hardcoded 30×20 tile arrays for ground and deco layers. Tile indices index into the `tiles-town` spritesheet (12 cols wide, 16px tiles). `WALKABLE_GROUND` and `SOLID_DECO` are `Set<number>` used for collision in `Player.canMoveToTile`.
- **`IsoUtils.ts`** (`src/utils/IsoUtils.ts`): `cartToIso(cx, cy)` converts tile column/row to world pixel coordinates. `TILE_W` and `TILE_H` are both 16.

### Player & movement

`Player` (`src/entities/Player.ts`) is a `Phaser.GameObjects.Container` holding a shadow ellipse, colour rectangle (placeholder sprite), and name tag. Movement is tile-based with a 150 ms cooldown. `handleInput` implements wall-sliding: on a blocked diagonal it tries each axis independently. Depth is set to `cy + 1` so players sort correctly with deco objects.

### Multiplayer

`gameSocket` (`src/network/socket.ts`) is a singleton `GameSocket` wrapping a typed `socket.io-client` Socket. `WorldScene.connectMultiplayer()` registers all server event handlers.

Server (`server/index.ts`): Express + Socket.IO, in-memory `Map<socketId, PlayerState>`. On connect it emits `init` to the joiner and `player:join` to everyone else. Broadcasts `player:move` (excluding sender). On disconnect emits `player:leave` to all.

Socket events: `init`, `player:join`, `player:move`, `player:leave`.

### Map authoring

Tiled project files (`map1.tiled-project`, `.tiled-session`) and tileset JSONs (`maps/*.tsj`) are in the repo for map editing. Currently the game uses the hardcoded `MapData.ts` arrays — the Tiled files are reference/work-in-progress.
