# Relay Room

Two operators share one flashlight in a seeded industrial facility. Restore the exit circuit, survive the Bell Diver, and extract together. The standalone synchronization test uses a fixed maintenance room. A local TypeScript simulation owns movement, collision, and the light. Both browser windows send inputs and receive the same room state over WebSocket.

## Start a local test

Use Node.js 22.13 or newer and npm. From this repository, run:

```sh
npm ci
npm run dev
```

1. Open **http://127.0.0.1:5176/** in two desktop browser windows with WebGL 2 enabled. A normal and a private window work. Keep them side by side so one window can observe the other.
2. Click **Enter room** in each window. The header shows your operator number and the occupied seats. Both players start within reach of the flashlight on the floor by the yellow line.
3. In the first window, press **E** to pick it up and **F** to switch it off and on. Walk forward through the doorway. In the other window, watch the operator carry the light, then follow.
4. Stand together, drop the flashlight with **E**, then click the other window and press **E** to pick it up. Press **G** in both windows to compare the round ID, update number, positions, flashlight owner, and round-trip time. Each client measures its own delay.
5. For a simultaneous pickup on a single keyboard, run `npm test`. Two socket clients send competing requests and verify the same winner. The test also covers toggling, movement, handoff, a departing holder, and seat capacity.

| Control | Action |
| --- | --- |
| WASD | Move or strafe |
| Mouse or arrow keys | Look around |
| E | Pick up a nearby flashlight or drop the one you hold |
| F | Toggle the flashlight you hold |
| G | Show or hide room diagnostics |
| Escape | Release controls. Click the scene to resume. |

On a phone, tap **Enter room**, drag the lower-left pad to move, and swipe the room to look. Tap **Pick up** when the dropped light is within reach. Use **Light off/on** and **Drop** to test the handoff. Tap **Diagnostics** to see who holds it on each device.

A disconnected operator keeps their seat, position, and flashlight for 20 seconds after the server detects the disconnect. Refresh the same tab to resume. When the reservation expires, the seat is freed and its flashlight drops. The room resets when both seats expire. Stop the server with **Ctrl+C**.

## Build and verify

- `npm test` runs the simulation and two-client WebSocket tests on a temporary local port.
- `npm run test:network` repeats the delayed handoff and recovery scenarios and prints the measured action latency, view disagreement, recovery, and traffic.
- `npm run build` type-checks the project and generates the static client in `dist/`.
- `npm run preview` serves that build **and** the local simulation at **http://127.0.0.1:4176/**.

The dev and preview commands each host their own temporary room. Open the same URL in both windows. The [Phase 2 network playtest](network-playtest.md) covers this standalone prototype. In Game Hub matches, the lobby creator’s browser hosts the simulation.

## Launch through Game Hub

Game Hub launches **Relay Room** at `/relay-room/`. Two named guests can create a public or code-only room, start the simulation as host, and leave for `/game-hub/`. Either operator leaving an active round releases both platform seats. Start a fresh run by creating another room. The standalone test scene at `/` still runs with `npm run dev`.

Use both checkouts with the same local Supabase URL and publishable key in their ignored `.env.local` files. Apply the hub's local migrations and enable the `relay-room` catalog row for local play. Set `VITE_ENABLE_RELAY_ROOM=true` in the hub's `.env.local`. This machine's local configuration is already set up. See the hub's `docs/relay-room.md` for fresh setup.

```sh
# From Horror-Friendslop
npm ci
npm run build
cd ../game-hub
npm run build
npm run dev:relay
```

Open **http://127.0.0.1:4175/game-hub/** in two independent browser profiles. Create different guest names, open Relay Room, create a private lobby on one device, and join with its code on the other. Start the game, pass the flashlight, then choose **Leave to hub**. Port 4175 serves both sites. Supabase carries live traffic on port 54321. When testing over SSH, also forward the local Supabase API port. Run this on each remote device with your usual SSH destination:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 4175:127.0.0.1:4175 -L 54321:127.0.0.1:54321 YOUR_USER@PROJECT_HOST
```

In the hub checkout, `npm run test:relay` runs the browser acceptance test on port 4175 and starts its own server. Stop the manual preview first. Set `RELAY_SITE_DIR` if the game checkout has another location.

### Explore a generated facility

Start a **new Game Hub room** to get a new facility. Normal runs contain 12–15 rooms. The orange Switchboard and blue Chiller hall have distinct floor markers and equipment. Both operators spawn at Intake within reach of the flashlight. Explore the connected rooms and corridors, locate the **Relay station**, then find the **Exit bay**. Overhead signs name the room ahead. At a closed bulkhead, press **R** or tap **Open bulkhead** on a phone. The door opens for both players.

Open **Diagnostics** for the shared floor plan, player positions, seed, generator version, objective and exit IDs, and opened bulkheads. Amber links mark closed bulkheads. Refresh while holding the light to check that your room, door state, and flashlight are restored. The map also marks the Bell Diver’s current bay in red and a downed operator with a white cross.

Run `npm run test:layouts` to check seeds 0–999, graph variety, player clearance, authoritative door collision, and the fixed fallback. The generator tries at most eight candidates per seed. Batch validation writes any fallback or failing seeds to `test-results/layout-seeds.json`. To replay a reported seed with this generator version, run `VITE_RELAY_TEST_SEED=19 npm run build` in the **game** checkout and create a new room in the local hub. Rebuild without the override to restore random layouts. The plan is sent on admission and resume, with only live door and item state in the regular snapshots.

### Play the emergency callout

The briefing names the callout. In **Line test** the answering operator waits at Intake. In **Black start** they first charge the orange Switchboard pad (S) and answer the tone from there. Both callouts use the following controls.

1. One operator takes the flashlight with **E** or **Pick up**. The other operates the center pad named in the briefing. Use the floor plan in **Diagnostics** to find the Relay station (R) and Exit bay (X).
2. Stand on the Relay pad with the flashlight on and press **Q** to **Send test tone**. Stay there while the answering operator presses **Q** to **Answer relay**. On a phone, tap the named action.
3. The Bell Diver wakes above Relay. Knocks, a warning naming the bay, and a glowing floor circle give four seconds to get clear. It drops inside the circle. On subsequent passes it targets the bay nearest the conscious operator carrying the lit lamp. It follows connected ceiling passages, scraping overhead at each bay. Without a lit carrier it follows a conscious operator.
4. A struck operator drops the light. A teammate has 75 seconds to reach them and press **Q** or **Revive partner**. Both operators going down or a rescue timing out ends the shift.
5. Meet on the green center pad at Exit and select **Extract crew**. Both players see the shift report. **Return to lobbies** releases the seats so one player can create a fresh match and share its new code.

### Phase 6 playtest

The current playtest supports exactly two operators in WebGL 2 browsers. The browser acceptance run uses Chromium with desktop and touch controls. A physical Android phone hosted a match over cellular and stayed connected through a mid-game network switch.

Use **Settings** on either device (or press **O**) to adjust look sensitivity and game volume, toggle sound captions, or keep the camera level when downed. Preferences persist on that device. Knock warnings, the strike circle and rescue timers stay visible with sound muted.

For repeatable runs, use `VITE_RELAY_TEST_SEED=19 npm run build` for Line test or seed 20 for Black start. With no seed override, create fresh rooms to draw new layouts. Try each callout with the crew reading the briefing, swap jobs, and try leaving mid-round and forming a new lobby. Record confusing signs, missed warnings, and the seed.

On the least powerful device, open **Diagnostics** while moving. Record the device, browser version, seed, scene-ready time, frame p95 and RX/TX. Scene-ready time runs from starting the 3D client to drawing the first room snapshot. Frame p95 is the 95th percentile of visible frame intervals over approximately two seconds. RX/TX measures WebSocket message bytes per second for that client.

The November 21 local run used headless Chromium 159.0.8154.6 on an Intel Core i7-14650HX with two players. The table shows one diagnostics reading per callout from the 390 × 844 touch viewport just after the exit circuit engaged. Network figures exclude transport overhead.

| Callout and seed | Frame p95 | Scene ready | Received / sent |
| --- | ---: | ---: | ---: |
| Black start · 20 | 50.1 ms | 1.50 s | 17,630 / 2,496 B/s |
| Line test · 19 | 83.4 ms | 1.60 s | 18,019 / 2,319 B/s |

### Creator-hosted matches

The lobby creator runs the simulation and generates the floor plan. The guest sends controls through Supabase Realtime. Private channel policies restrict world updates to the creator and inputs to the other room member. Keep the host tab open and in the foreground, particularly on mobile. A brief interruption preserves both seats. A same-tab host refresh restores the last checkpoint. After 20 seconds without the partner, the remaining browser closes the round. Choosing **Leave to hub** closes it immediately.

An active pair sends up to ten snapshots and ten input updates per second. With one recipient per broadcast, that is roughly 144,000 counted messages per hour at peak, plus handshakes. Idle pairs send fewer. Game Hub shares the Free plan’s two million monthly messages and 100 messages per second. Monitor usage during public playtests. [Message accounting](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) · [Realtime limits](https://supabase.com/docs/guides/realtime/limits)

### Publish a release

The [Pages repository](https://github.com/Kumori1313/relay-room) builds the game commit pinned in `SOURCE_REVISION`. Its Actions variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Both must match Game Hub. `npm run build:pages` uses the same build entry point. The output includes the game license, bundled dependency notices, and `release.json` with the revision and generator version. The room kit, characters, textures, and synthesized audio are generated by game code.

1. Run the hub’s local release suite with the game, poker, and tic-tac-toe checkouts. Apply the compatible Game Hub migrations with the Relay Room catalog switch disabled.
2. Apply the private Realtime channel policies, then publish the reviewed source revision. Verify `/relay-room/release.json` on the hub origin.
3. With the hub listing still hidden, enable the two-player catalog row for a private smoke test. From the hub checkout run `E2E_BASE_URL=https://kumori1313.github.io RELAY_RELEASE_SMOKE=true npm run test:relay`. This signs in two anonymous guests, completes a private round, reconnects, extracts, replays, and leaves. Set the hub’s `VITE_ENABLE_RELAY_ROOM` Actions variable to `true` and rerun its Pages workflow after the smoke test passes. Verify **Open Relay Room** from the published hub.
4. To suspend play, set `public.game_catalog.playable` to `false` for `id='relay-room'`. The adapter denies new starts and clients check active membership and the catalog flag every 2.5 seconds. The client offers **Return to Game Hub** after admission ends. Set the hub listing variable to `false` and redeploy to hide its link. To restore an earlier client, revert `SOURCE_REVISION`, then repeat the private smoke test.

For a playtest report, copy the build, seed and generator version from **Diagnostics** into the [issue form](https://github.com/Kumori1313/Horror-Friendslop/issues/new?template=playtest.yml). Check out that revision and start a local run with the reported seed to reproduce the layout.
