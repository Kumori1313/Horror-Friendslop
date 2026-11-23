# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Relay Room** (game ID `relay-room`, route `/relay-room/`) is a co-op browser horror game for Game Hub: two operators share one flashlight across a salvage contract of three seeded facilities, hauling salvage out of each facility while avoiding the Bell Diver, ringing a bell outside, and escaping through the exit rift to sell it against a quota. Stack: TypeScript, Three.js, Vite, `ws`, Supabase Realtime. `AGENTS.md` predates the code; its conventions still apply, but its claims that there are no build or test commands are out of date.

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
- `VITE_RELAY_TEST_SEED=<n> npm run build` pins the contract seed, and with it all three expedition facilities (ignored in `pages` mode). `RELAY_LAYOUT_SEED` does the same for the Node hub runtime.

Type-checking is the only static check. There is no linter or formatter.

## Architecture

### One simulation, three hosts

`src/server/simulation.ts` (`Simulation`) is the single authority for movement, collision, flashlight ownership, each operator's hotbar, throws, doors, salvage, and contract progress (`src/server/mission.ts`). Despite the `server/` directory, it runs in three places, so it and `generate-layout.ts` **must stay free of Node-only APIs**:

| Mode | Entry | Who runs `Simulation` | Transport |
| --- | --- | --- | --- |
| Standalone test room (`/`) | `RoomConnection` (`src/connection.ts`) | Node, via `attachRoom` in `src/server/socket.ts`, which the Vite plugin in `vite.config.ts` mounts on the dev and preview servers at `/live` | WebSocket |
| Solo (`?solo=1`) | `SoloSession` (`src/solo-session.ts`) | The browser, ticked from the render loop | none; checkpoints go to `sessionStorage` |
| Game Hub match (`/relay-room/`) | `lobby.ts` → `CreatorSession` (`src/creator-session.ts`) | The lobby **creator's browser** (host) | Supabase Realtime broadcast channels; the guest sends inputs and the host sends snapshots |

`src/server/hub-rooms.ts` plus `scripts/start-runtime.mjs` is an alternative Node runtime for hub rooms. It verifies membership via the hub's `room_action` RPC. The README describes creator-hosted Realtime as the current hub path.

All three sessions implement the same `Events` interface from `connection.ts` (`joined`, `snapshot`, `offline`). `src/main.ts` picks the session by URL and drives input, rendering, and HUD identically. Keep this seam: rendering and input should not know which host is authoritative.

Clients without a local simulation (the Game Hub guest and both standalone-room clients) predict their own operator with `src/prediction.ts`. It moves with `moveOperator`, the same function `Simulation.tick` uses, and matches each snapshot against its recent history to correct. Keep movement rules inside `moveOperator`/`heldLamp` so host and prediction cannot drift. Ramps, stairs and raised floors are solid underneath: their sides block the body, and stepping off an unrailed edge drops the operator to the floor below. `scene.ts` glides remote avatars and a remotely held lamp between snapshots.

### Shared protocol and state

`src/room.ts` defines the wire types (`Snapshot`, `Input`, `Action`, `ClientMessage`/`ServerMessage`, `Ticket`, `Admission`) and shared collision helpers (`clearAt`, `canTake`) used by both client prediction/prompts and the simulation. Actions carry a `seq` for de-duplication of stale or replayed actions, plus an optional `Command` (`slot` for `select`, `aim` with yaw, pitch and power for `throw`) that `command()` sanitizes. Each `Player` has `slots` (the four-slot hotbar: salvage ids or `lampSlot`) and `hand` (the selected slot); `Simulation.fillSlots` keeps them in step with what the operator actually carries. A carried flashlight is `stowed` (clipped to the chest, dimmer) when another slot is selected; `carriedLamp` places it for host and prediction alike. Snapshots are ordered by `round` + `update` (`newerSnapshot`). The full `Layout` is sent only on join or resume. Regular snapshots carry live state (players, lamp, `opened` doors, `mission`).

Seats are reserved for 20 s after disconnect (`grace`) and resumed with a `Ticket` stored in `sessionStorage`. Solo and creator-host checkpoints also restore from `sessionStorage` on reload.

### Layout generation

- `src/room-templates.ts` defines the room kit on a 4 m grid with two 4 m storeys. Templates declare a footprint, walkable `surfaces` (ramps and stairs use `rise`, plus `along: 'x'` when rotated), doorway `sockets` at cell-edge midpoints, props, a `pad` and a `loot` flag. `orient` rotates a template in 90° steps; a reversed ramp moves its base height to the far end. `assembleTemplates` builds walls with door holes, roofs, rails, props, bulkheads and openings, and rejects sockets misaligned in 3D. Corridor arms meet at float-inexact seams, so `surfaceAt` keeps a 1e-6 tolerance.
- `src/server/generate-layout.ts` grows a facility from Intake (fixed at x −4, z 0, so the spawns and lamp stay put). It builds each branch tentatively: an optional stairwell, 0–3 provisional `cross` corridor cells, then a destination, rolling back if it doesn't fit. It draws 12–15 destinations from a pool of 17, at least three of them loot rooms, then joins meeting doorways into loops. Intake keeps its single north bulkhead, the first link. `fitCorridors` replaces each cross with the straight, corner, tee or cross piece whose sockets match its links. Destinations are unique per seed; corridors and stairwells repeat. After 8 failed attempts it uses a cached fallback.
- `src/layout.ts` holds `generatorVersion` (bump it whenever a seed would produce a different layout; checkpoints, hub admission and `release.json` compare it), `anchor` (a room's pad: station, Diver drop, map marker), `roomAt`, `validLayout`, `socketGroups` (which doorways connect inside a template, by flood fill) and `walkable`/`collisionIndex` (0.25 m flood fill using the simulation's support and clearance rules). `stairwellLayout()` is the fixed `tour` walkthrough with no mission.
- `src/route.ts` plans axis-aligned walking legs with Dijkstra and a turn penalty. It tries clearance margins from 0.85 m down to 0. Ramps are entered only along their slope. Tests and the Game Hub acceptance test use it to walk with keyboard controls; `tests/walk.ts` drives the simulation along it.
- `src/salvage.ts` derives every facility's salvage from its layout seed: item kinds, values, and spawn spots on each template's open floor, reachable and clear of doorways. Clients compute the same list, so snapshots carry only `mission.haul`, the items that moved (carried, dropped or loaded). `expeditionSeed(contract, i)` gives each expedition's facility; expedition 0 is the contract seed itself.
- Contract rules: `src/mission.ts` holds the shared types, `assignment()` (what **Q** does: revive, ring the bell), `gone()` (escaped or dead) and `pace()` (the Diver's timings, faster once `mission.enraged`). `src/server/mission.ts` holds `newContract` (quota = 45% of the three facilities' salvage), `settle` (sells banked salvage with the compounding penalty `kept(gross, lost)` = gross × 0.8^lost for every operator who didn't escape), `endExpedition` (a sale, or a wipe when nobody escaped; Continue after a wipe starts `newContract(wipeSeed(seed))`), deaths when a rescue times out, and the rift timer. `Simulation.ring` opens the rift at `riftSpot(seed)` (places.ts picks reachable open ground far from the arrival) for `riftOpen` seconds; walking into it calls `escape`, which banks carried salvage and moves the operator home; a throw whose path passes through the rift column is banked where it enters (a thrown flashlight goes home). An expedition ends when the rift closes or nobody is left who could act. `Simulation.nextExpedition()` swaps `layout` at Continue; sessions announce the new layout (solo and host re-emit `joined`, the hub guest re-handshakes when `mission.contract.layout` changes, and `socket.ts` resends `joined`). Hosts checkpoint immediately after every action, so a refresh cannot repeat or undo a sale.
- Throws: `src/flight.ts` simulates a thrown item in fixed 1/120 s steps on the collision geometry (walls, props, rails, roofs, closed bulkheads, floor slabs), bouncing, sliding off props, and falling between storeys. The host runs `trajectory` once at launch and stores the rest spot plus a `Flight` (launch, elapsed `t`, duration `d`) on the haul entry or the lamp; clients replay the same launch through the same steps, so a throw costs no extra messages. The loop uses only arithmetic, never trigonometry, so every browser computes the same arc. Like `Simulation`, it must stay free of Node-only APIs.
- Places: `src/places.ts` defines where things are (`Place`: `home`, `outside`, `inside`; no place means inside). `home()` is the fixed home-dimension geometry with the rift, terminal and flashlight spot. `outdoors(seed)` derives the outdoor map from the expedition seed: ground cut around raised banks and their ramps (ground must not run under a ramp), boulders, cliffs, the fixed façade and its door. Both are ordinary `TemplateGeometry`, so movement, throws, `walkable` and `route` work on them. `Simulation.geometryAt(place)` picks the collision geometry; the facility's is built lazily. Walking into the home rift (`depart`) starts the expedition; `mission.arrival` closes once nobody is home. **R** (`open-door`) uses the façade door, Intake's outer door (`intakeDoor`), or a bulkhead. `moveTo` sets `Player.transit` so the client turns its view. A sale calls `returnHome`; `next` plans the next facility and sets stage `home`. Tests that exercise the facility pass `start: 'inside'` to `Simulation`; `tests/travel.ts` takes a crew from home to Intake.
- Collision depends on height: use `obstaclesAt(geometry, feetY, opened)`, or `Simulation.solids(p)`, never one flat list. Mission pads and strikes require the same storey (`sameStorey`).

### Rendering

`src/scene.ts` (`createScene`) owns the Three.js renderer and camera, runs dynamic resolution, and culls rooms each frame. `template-scene.ts` draws the assembled structure and props, tagging every box with its room. `src/materials.ts` generates the shared material library (ten canvas textures with per-surface tile size, metalness and roughness), the per-room `palettes`, `surfaceFor(kind, finish)`, `worldUV` (texture coordinates in metres along the face's main axis), and a dim PMREM reflection map that only brushed-steel props and salvage sample. `template-scene.ts` tags every box with a `Finish`: shell parts take the room's palette, props keep their colour over metal, rust, paint or wood. `facility-scene.ts` merges each room into its own mesh group, one draw per material, with vertex colours tinting the textures, and adds landmarks (signs over doorways, Intake jambs, floor markers), bulkhead panels, and salvage as one instanced mesh per item kind, culled with its room. `src/visibility.ts` is pure doorway culling: start in the camera's room and pass through doorways whose near-plane-clipped screen bounds overlap the window left by the doorways before them. Closed bulkheads and the 48 m far plane stop the search. `tests/visibility.test.ts` ray-casts from sampled poses to prove no visible room is culled; keep it passing when changing geometry or portals. Each client draws only its own place: `world-scene.ts` builds the home dimension (kept) and the outdoor map (disposed at home); `scene.ts` builds the facility only when the camera is inside and sets the sky, fog, lights and far plane per place. The developer map (`layout-map.ts`) draws the ground storey left and the upper storey right. Textures, characters, and synthesized audio are generated in code. Do not add binary assets without license notes. The untracked `audio/` directory is not yet wired in.

### Game Hub integration

`src/lobby.ts` and `src/guest.js` handle guest identity and lobbies against the shared Supabase project (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, validated by `scripts/security-policy.mjs`, which also injects the CSP meta). Catalog rows, migrations, Realtime channel policies, and the cross-game browser acceptance test (`npm run test:relay`) live in the sibling `../game-hub` checkout. Make those changes there. The lobby passes each seat's display name (`Crew.names`: the host is seat 1, the guest seat 2), which the HUD uses in place of "Operator n". See `game-development-guide.md` for the integration contract and README "Launch through Game Hub" / "Publish a release" for the local shared-origin setup (port 4175) and release steps. Releases are published from a separate Pages repo pinned to a `SOURCE_REVISION`.

## Project conventions

- `development-roadmap.md` is the phase plan, with pass criteria and status notes. When a phase item is ready or playtested, update its status there and the matching README playtest section.
- Source imports use explicit `.ts` extensions (`allowImportingTsExtensions`). Two-space indentation and ES modules. Much existing code is written compactly with minimal spacing, so match the style of the file you are editing.
- Tests use `node:test` + `node:assert/strict` and exercise `Simulation` directly (e.g. walking a player through a layout by setting inputs and calling `tick`) or start a real socket server on port 0 (`tests/network.test.ts`, `tests/room.test.ts`).
- Commit subjects are short and action-oriented ("Add browser-local solo shifts…"). For UI changes, PRs include screenshots. For integration changes, they include the game ID, route, player limits, and licenses.
