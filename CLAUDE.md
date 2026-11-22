# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Relay Room** (game ID `relay-room`, route `/relay-room/`) is a co-op browser horror game for Game Hub: two operators share one flashlight in a seeded industrial facility, restore the exit circuit, avoid the Bell Diver, and extract. Stack: TypeScript, Three.js, Vite, `ws`, Supabase Realtime. `AGENTS.md` predates the code; its conventions still apply, but its claims that there are no build or test commands are out of date.

## Commands

Node ≥ 22.13. TypeScript runs directly through `--experimental-strip-types`, so tests have no compile step.

```sh
npm ci
npm run dev                 # http://127.0.0.1:5176/ — standalone room + local WebSocket sim (diagnostics enabled)
npm run dev:hub             # dev server under the /relay-room/ base
npm test                    # all tests (node:test)
npm run test:layouts        # 1,000-seed layout validation; writes failures to test-results/layout-seeds.json
npm run test:network        # delayed handoff/recovery scenarios with latency and traffic figures
npm run build               # tsc --noEmit + vite build → dist/ (player build)
npm run build:diagnostics   # build with the G-key diagnostics overlay, map, and outage simulator
npm run build:pages         # release build for GitHub Pages; requires an https Supabase URL in env
npm run preview             # serves dist/ + local sim at http://127.0.0.1:4176/
```

Run one test file: `node --experimental-strip-types --test tests/room-templates.test.ts`
Run one test by name: add `--test-name-pattern="walk from Intake"`.

Useful URLs and overrides:
- `?solo=1` runs a browser-local solo shift. `?solo=1&layout=stairwell` loads the fixed Phase 9 multi-floor walkthrough.
- `?delay=<ms>` (≤ 500) adds artificial latency to the standalone WebSocket client.
- `VITE_RELAY_TEST_SEED=<n> npm run build` pins the layout seed (ignored in `pages` mode). Odd seeds give Line test and even seeds Black start (e.g. 19 and 20). `RELAY_LAYOUT_SEED` does the same for the Node hub runtime.

Type-checking is the only static check. There is no linter or formatter.

## Architecture

### One simulation, three hosts

`src/server/simulation.ts` (`Simulation`) is the single authority for movement, collision, flashlight ownership, doors, and mission progress (`src/server/mission.ts`). Despite the `server/` directory, it runs in three places, so it and `generate-layout.ts` **must stay free of Node-only APIs**:

| Mode | Entry | Who runs `Simulation` | Transport |
| --- | --- | --- | --- |
| Standalone test room (`/`) | `RoomConnection` (`src/connection.ts`) | Node, via `attachRoom` in `src/server/socket.ts`, which the Vite plugin in `vite.config.ts` mounts on the dev and preview servers at `/live` | WebSocket |
| Solo (`?solo=1`) | `SoloSession` (`src/solo-session.ts`) | The browser, ticked from the render loop | none; checkpoints go to `sessionStorage` |
| Game Hub match (`/relay-room/`) | `lobby.ts` → `CreatorSession` (`src/creator-session.ts`) | The lobby **creator's browser** (host) | Supabase Realtime broadcast channels; the guest sends inputs and the host sends snapshots |

`src/server/hub-rooms.ts` plus `scripts/start-runtime.mjs` is an alternative Node runtime for hub rooms. It verifies membership via the hub's `room_action` RPC. The README describes creator-hosted Realtime as the current hub path.

All three sessions implement the same `Events` interface from `connection.ts` (`joined`, `snapshot`, `offline`). `src/main.ts` picks the session by URL and drives input, rendering, and HUD identically. Keep this seam: rendering and input should not know which host is authoritative.

### Shared protocol and state

`src/room.ts` defines the wire types (`Snapshot`, `Input`, `Action`, `ClientMessage`/`ServerMessage`, `Ticket`, `Admission`) and shared collision helpers (`clearAt`, `canTake`) used by both client prediction/prompts and the simulation. Actions carry a `seq` for de-duplication of stale or replayed actions. Snapshots are ordered by `round` + `update` (`newerSnapshot`). The full `Layout` is sent only on join or resume. Regular snapshots carry live state (players, lamp, `opened` doors, `mission`).

Seats are reserved for 20 s after disconnect (`grace`) and resumed with a `Ticket` stored in `sessionStorage`. Solo and creator-host checkpoints also restore from `sessionStorage` on reload.

### Layout generation

- `src/room-templates.ts` defines the room kit on a 4 m grid with two 4 m storeys. Templates declare a footprint, walkable `surfaces` (ramps and stairs use `rise`, plus `along: 'x'` when rotated), doorway `sockets` at cell-edge midpoints, props, a `pad` and a `loot` flag. `orient` rotates a template in 90° steps; a reversed ramp moves its base height to the far end. `assembleTemplates` builds walls with door holes, roofs, rails, props, bulkheads and openings, and rejects sockets misaligned in 3D. Corridor arms meet at float-inexact seams, so `surfaceAt` keeps a 1e-6 tolerance.
- `src/server/generate-layout.ts` grows a facility from Intake (fixed at x −4, z 0, so the spawns and lamp stay put). It builds each branch tentatively: an optional stairwell, 0–3 provisional `cross` corridor cells, then a destination, rolling back if it doesn't fit. It places Relay far from Intake and Exit far from Relay, then joins meeting doorways into loops. `fitCorridors` replaces each cross with the straight, corner, tee or cross piece whose sockets match its links. Destinations are unique per seed; corridors and stairwells repeat. The first link (Intake's north door) and the Exit's door are bulkheads. After 8 failed attempts it uses a cached fallback.
- `src/layout.ts` holds `generatorVersion` (bump it whenever a seed would produce a different layout; checkpoints, hub admission and `release.json` compare it), `anchor` (a room's pad: station, Diver drop, map marker), `roomAt`, `validLayout`, `socketGroups` (which doorways connect inside a template, by flood fill) and `walkable`/`collisionIndex` (0.25 m flood fill using the simulation's support and clearance rules). `stairwellLayout()` is the fixed `tour` walkthrough with no mission.
- `src/route.ts` plans axis-aligned walking legs with Dijkstra and a turn penalty. It tries clearance margins from 0.85 m down to 0. Ramps are entered only along their slope. Tests and the Game Hub acceptance test use it to walk with keyboard controls; `tests/walk.ts` drives the simulation along it.
- Collision depends on height: use `obstaclesAt(geometry, feetY, opened)`, or `Simulation.solids(p)`, never one flat list. Mission pads and strikes require the same storey (`sameStorey`).

### Rendering

`src/scene.ts` (`createScene`) owns the Three.js renderer and camera. `template-scene.ts` draws the assembled structure and props; `facility-scene.ts` adds landmarks (signs over doorways, Intake jambs, Exit lights, floor markers) and bulkhead panels. The developer map (`layout-map.ts`) draws the ground storey left and the upper storey right. Textures, characters, and synthesized audio are generated in code. Do not add binary assets without license notes. The untracked `audio/` directory is not yet wired in.

### Game Hub integration

`src/lobby.ts` and `src/guest.js` handle guest identity and lobbies against the shared Supabase project (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, validated by `scripts/security-policy.mjs`, which also injects the CSP meta). Catalog rows, migrations, Realtime channel policies, and the cross-game browser acceptance test (`npm run test:relay`) live in the sibling `../game-hub` checkout. Make those changes there. See `game-development-guide.md` for the integration contract and README "Launch through Game Hub" / "Publish a release" for the local shared-origin setup (port 4175) and release steps. Releases are published from a separate Pages repo pinned to a `SOURCE_REVISION`.

## Project conventions

- `development-roadmap.md` is the phase plan, with pass criteria and status notes. When a phase item is ready or playtested, update its status there and the matching README playtest section.
- Source imports use explicit `.ts` extensions (`allowImportingTsExtensions`). Two-space indentation and ES modules. Much existing code is written compactly with minimal spacing, so match the style of the file you are editing.
- Tests use `node:test` + `node:assert/strict` and exercise `Simulation` directly (e.g. walking a player through a layout by setting inputs and calling `tick`) or start a real socket server on port 0 (`tests/network.test.ts`, `tests/room.test.ts`).
- Commit subjects are short and action-oriented ("Add browser-local solo shifts…"). For UI changes, PRs include screenshots. For integration changes, they include the game ID, route, player limits, and licenses.
