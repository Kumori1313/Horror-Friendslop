# Relay Room

Two operators share one flashlight across a salvage contract. Each expedition is a fresh, seeded industrial facility on an outdoor map: collect salvage, survive the Bell Diver, ring the bell outside, and get the salvage and yourselves through the exit rift to sell it. Meet the quota before the last expedition. The standalone synchronization test uses a fixed maintenance room. A local TypeScript simulation owns movement, collision, and the light. Both browser windows send inputs and receive the same room state over WebSocket.

## Play solo

Open **Relay Room** from Game Hub and choose **Play solo**, or open the [solo playtest](https://kumori1313.github.io/relay-room/?solo=1) directly. The shift runs in your browser and pauses when you release controls or switch tabs. Refresh the same tab to resume. **Leave solo** ends the shift, and **New solo shift** on the results screen generates another facility.

A solo contract follows the same rules as the crew contract below, with no partner to revive: a strike ends it. **New solo shift** on the results screen starts a fresh contract.

### Phase 9 stairwell playtest

Run `npm run dev` and open the [local stairwell walkthrough](http://127.0.0.1:5176/?solo=1&layout=stairwell). The layout is fixed so you can repeat the same route in either direction. Walk straight from Intake up the stairs, then turn right onto the catwalk. Look down into the machinery hall before crossing to the loot closet. Double back to the break in the railing and take the ramp down. The lower doorway beneath the closet leads into a bent tunnel that returns to Intake. Choose **Leave solo** when finished.

Phase 9 passed on November 22, 2026. Two hub browsers walked above and below each other, refreshed on a landing, and extracted together. On a Pixel 8a running Vanadium 157 with JavaScript JIT blocked, the largest facility (seed `187`) held a frame p95 of 16.9 ms, one 60 Hz frame, at full resolution. The last pre-generator build read the same. Use `npm run build:diagnostics` and press **G** to read the frame time, render scale, and rooms drawn on your own device.

## Start a local test

Use Node.js 22.13 or newer and npm. From this repository, run:

```sh
npm ci
npm run dev
```

1. Open **http://127.0.0.1:5176/** in two desktop browser windows with WebGL 2 enabled. A normal and a private window work. Keep them side by side so one window can observe the other.
2. Click **Enter room** in each window. The header shows your operator number and the occupied seats. Both players start within reach of the flashlight on the floor by the yellow line.
3. In the first window, press **E** to pick it up and **F** to switch it off and on. Walk forward through the doorway. In the other window, watch the operator carry the light, then follow.
4. Stand together, drop the flashlight with **X**, then click the other window and press **E** to pick it up. Press **G** in both windows to compare the round ID, update number, positions, flashlight owner, and round-trip time. Each client measures its own delay.
5. For a simultaneous pickup on a single keyboard, run `npm test`. Two socket clients send competing requests and verify the same winner. The test also covers toggling, movement, handoff, a departing holder, and seat capacity.

| Control | Action |
| --- | --- |
| WASD | Move or strafe |
| Mouse or arrow keys | Look around |
| E | Pick up the nearest item: salvage or the flashlight |
| 1–4 or scroll wheel | Select a hotbar slot |
| X | Drop the selected item at your feet |
| Hold T or hold the left mouse button | Throw the selected item; hold longer to throw harder |
| F | Switch the flashlight you carry off and on |
| Q | Ring the bell outside, or revive a downed partner |
| G | Show or hide room diagnostics in developer builds |
| Escape | Release controls. Click the scene to resume. |

**Fullscreen** in the header switches fullscreen on and off. On a phone, tap **Enter room**; the game goes fullscreen on that tap (or the next tap that resumes play), unless **Fullscreen on touch screens** is off in Settings. Browsers only allow fullscreen from a tap, and iPhone Safari doesn't allow it for pages. Drag the lower-left pad to move, and swipe the room to look. Tap **Pick up** beside salvage or the flashlight, tap a hotbar slot to select it, and use **Drop** or hold **Hold to throw**. Use **Light off/on** and **Drop** to test the handoff. Tap **Diagnostics** to see who holds it on each device.

A disconnected operator keeps their seat, position, and flashlight for 20 seconds after the server detects the disconnect. Refresh the same tab to resume. When the reservation expires, the seat is freed and its flashlight drops. The room resets when both seats expire. Stop the server with **Ctrl+C**.

## Build and verify

- `npm test` runs the simulation and two-client WebSocket tests on a temporary local port.
- `npm run test:network` repeats the delayed handoff and recovery scenarios and prints the measured action latency, view disagreement, recovery, and traffic.
- `npm run build` type-checks the project and generates the static client in `dist/`.
- `npm run build:diagnostics` builds a local developer client with the G shortcut, map, measurements, and outage simulator. The dev server also includes these tools. Use `npm run build` for a player playtest.
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

Start a **new Game Hub room** to get a new facility. Each facility spans two storeys and draws 13–16 destinations, each a different kind of room, from a pool of 17 optional rooms, with at least three loot rooms. Corridors and up to three stairwells join them, and some routes loop back on themselves. The Machinery hall's ramp also joins the two storeys. Every room has a coloured floor marker and its own equipment. Both operators spawn at Intake within reach of the flashlight. Explore the connected rooms and corridors for salvage, then find your way back to Intake. Overhead signs name the room beyond each doorway, except where the doorway opens onto a corridor. At a closed bulkhead, press **R** or tap **Open bulkhead** on a phone. The door opens for both players.

The amber-banded doorway marks Intake. Three green lights above a doorway mark Exit. For developer checks, run `npm run build:diagnostics` in the game checkout and open **Diagnostics** for the shared floor plan, player positions, seed, generator version, objective and exit IDs, and opened bulkheads. The plan shows the ground storey on the left and the upper storey on the right. Amber squares mark closed bulkheads. The **Render** line shows the current resolution scale, how many rooms are drawn out of the total, and the draw calls in the last frame. The game draws only the rooms you can see through doorways, and lowers the resolution while frames run slow. Refresh while holding the light to check that your room, door state, and flashlight are restored. The map also marks where the Bell Diver hangs in red, filled while it counts down to a drop, and a downed operator with a white cross.

Run `npm run test:layouts` to check seeds 0–999. The check covers both storeys and the stairs between them, unique destinations, overlapping rooms and clearance. It also walks every seed's real floor geometry from the spawn to every room, which covers the route from each loot room to the exit, then walks planned routes to each station on a few seeds. It also checks door collision and the fixed fallback. The generator tries at most eight candidates per seed. Batch validation writes any fallback or failing seeds to `test-results/layout-seeds.json`. To replay a reported seed with this generator version, run `VITE_RELAY_TEST_SEED=19 npm run build` in the **game** checkout and create a new room in the local hub. Rebuild without the override to restore random layouts. The plan is sent on admission and resume, with only live door and item state in the regular snapshots.

### Work the salvage contract

A contract runs three expeditions, each in a new facility generated from the contract seed. The quota is 45% of all the salvage the three facilities hold, so a crew that hauls steadily can meet it. The terminal in the home dimension shows the quota, credited earnings, the expedition number, and the last sale.

1. The contract starts in the home dimension. Take the flashlight with **E** or **Pick up**, then walk into the rift. It drops you on the outdoor map, 160 m of rolling hills, ditches and boulders under cliffs, on any side of the facility in the middle, and it closes once everyone is through. Slopes steeper than 35° can't be climbed, though you can walk down them; ditches have a level floor you can follow to where they fade out. The main door, in the building's south face under a lit canopy with the bell in front, leads to Intake; press **R**, or tap **Enter facility**, at it. Operators have 100 health, shown bottom left; hits take some, recovery creeps back to half after a while, and at none you are down until your partner revives you. Inside, **Gnawers** skitter after loose salvage and anyone carrying it: a bite hurts and tears a piece of salvage from you, in hand or in your bag. A baton hit, a lit flare or a thrown item drives one off, and it drops what it took. Outside, a **Lurker** waits in each river's deep water: it hears footsteps along the bank, comes to investigate where it last heard them, hauls itself partly out of the water and reaches a long arm up to 9 m to grab anyone near the bank, then drags them in to drown. Mash **Space** to slow it; a partner's baton, a thrown item or a lit flare makes it let go. The fords are out of its reach. As the expedition drags on, **stalkers** come out of the hills: the first about three minutes in (inside or out), more over time, and one at once when the bell rings. A stalker hunts by sight, so get behind cover; when it hunches and shrieks it is about to charge, and stepping aside as it sets off dodges it. A charge knocks you flat and takes half your health. A baton hit or a thrown item stuns it, and it keeps away from a lit flare. **Space** (or **Jump** on touch) jumps about 0.6 m, enough for crates, sills and short gaps. Falls do no harm, but the facility's pits are bottomless: fall into one and you die. A river winds across the map in a deep bed: its water is over your head, and falling in away from a ford gives you about 4 s of breath (the HUD counts it down) before you drown, along with what you carry. Its two or three fords are about waist deep, slow to wade, and the only places to climb out; one to three dilapidated bridges cross it too, with missing planks to fall through, whole missing rows to jump, and mostly broken railings. The river flows downhill, cutting a gorge where the land rises, and pools around its fords. Anything thrown or dropped into deep water sinks and is lost, the flashlight included; in a ford it rests on the bottom. Ruins and wrecked machinery (cranes, tanks, trucks, pipes, containers, pylons, silos, barrels, sheds, cars) give cover all over the map, and worn gravel trails lead from the arrival to every door. One or two fire exits, banded in green on other faces, lead into rooms deep inside, behind a **Fire exit** door. **R** at Intake's **Exit** door or a fire exit door leads back out of that door. Operators can split up: home, outdoors, and inside each keep their own things, and a refresh resumes where you were. Both can explore. Loot rooms such as the Parts store, Loot closet, Locker room, Cold store, Foreman's office, and Workshop always hold salvage. No room holds more than two items: a loot room holds two 30% of the time, and any other room is empty 65% of the time, holds one 30% of the time, and two only 5%.
2. Press **E**, or tap **Pick up**, beside an item to put it in your hotbar. The hotbar has four slots, and the flashlight takes one of them. Select a slot with **1–4**, the scroll wheel, or a tap, and the item shows in your hands and your partner's view. With salvage selected, the flashlight clips to your chest: still lit, but dimmer, shorter, and pointing where your body faces. Press **X** to drop the selected item, or hold **T** or the left mouse button and release to throw it. A throw arcs, bounces off walls and floors, slides to rest, falls off galleries and down stairwells, and stops at closed bulkheads. Heavy items (coils, battery cells, toolboxes) throw shorter. A thrown flashlight stays lit.
3. The first item lifted wakes the Bell Diver in the room farthest away. It clings to the ceiling: a dark bell with hanging tines and two faint red glints. There is no warning on screen. Large rooms are split into zones no more than 8 m across, and it strikes only its own zone. Once you share its zone and storey, it waits three seconds, then falls on its chain for one second, striking everyone still in that zone when it lands. Leaving during the wait resets it; once it falls, it lands regardless, then climbs back up its chain. It drags itself across the ceiling and through the wiring over the doorways, lower body trailing, one room every two seconds, chasing the nearest operator up to two room connections away, and otherwise wanders to a neighbouring room every eight seconds. Its chains are its only sound: every move rattles quietly for operators up to two room connections from the room it enters, that room included, and is silent farther away. Call out what you hear, and look up. Throw any item, the flashlight included, into it to stun it for six seconds: a clang rings out, its glints go dark, and it can neither drop nor move. A hit during its fall stops the fall, and it climbs back up. The item drops to the floor beneath it.
4. Facilities are dark. Intake always has power and about half the other rooms do, each lit by a cone of light under its ceiling lamp; corridors, stairwells, the service tunnel and unpowered rooms show only their doorway signs until the flashlight finds them. Outdoors darkens over the first ten minutes of an expedition. The flashlight's battery lasts six minutes switched on, half as fast clipped on, and carries over between expeditions; its hotbar slot shows the charge. It dims below a fifth, flickers below a tenth, and switches off when flat. Between expeditions, press **Q** at the home terminal to open the supply terminal. The crew's wallet is what it has been credited minus what it has spent; spending doesn't touch the quota. It sells spare cells (40), flares (20), a replacement flashlight (80, only when the flashlight was left behind) and a stun baton (100), laid out in front of the terminal to pick up with **E**. Gear comes home only if it's already there or carried by someone who escapes; anything left behind is lost, the flashlight included. A flare lights when thrown or dropped and burns red for a minute. The stun baton swings on the throw control and stuns the Bell Diver for six seconds if its bell is within reach: falling, on the floor, climbing back, or under a very low ceiling. Spare cells, glowing faintly green, are bought, never found: select one while carrying the flashlight and press **F** or tap **Load cell** to refill it. Cells are worth nothing at the rift.
5. A struck operator drops the light and keeps their salvage. A teammate has 75 seconds to reach them and press **Q** or **Revive partner**; after that the operator dies, dropping what they carried where they fell. The body stays there, and until the expedition ends the dead operator watches through their partner's eyes. In Game Hub, alerts and the status bar name operators by the names chosen in the lobby.
6. To leave, anyone rings the bell in front of the façade with **Q**, once per expedition. A rift opens somewhere else outdoors, marked by a pillar of light you can see from anywhere, and stays open for three minutes. The bell also enrages the Bell Diver for the rest of the expedition: it waits 1.75 seconds and falls in 0.75, moves a room every 1.4 seconds, and chases from three connections away. You can still go back inside for more.
7. Throw salvage into the rift, or carry it in: walking into the rift takes you home with everything you hold. The expedition ends when the rift closes, or as soon as nobody is left outside who could still act. As long as one operator escaped, the crew keeps everything that went in, less a fifth for each operator who didn't make it, compounding: the crew keeps x × 0.80^d. What they carried is lost. If nobody escapes, the crew is wiped and **Continue** starts a fresh contract with nothing credited. A tap on **Leave to hub** never pays out.
8. The receipt waits at home and lists each item and any deduction. **Continue** readies the next facility; walk into the home rift to go. Meeting the quota wins the contract at once, and missing it after the third expedition loses it. **Return to lobbies** releases the seats at any receipt.

### Phase 6 playtest

The Phase 6 co-op playtest supports two operators in WebGL 2 browsers. The browser acceptance run uses Chromium with desktop and touch controls. A physical Android phone hosted a match over cellular and stayed connected through a mid-game network switch.

Use **Settings** on either device (or press **O**) to adjust look sensitivity and game volume, toggle sound captions, or keep the camera level when downed. Preferences persist on that device. Rescue timers stay visible with sound muted. With captions on, the Diver's chains show as a caption for whoever hears them.

For repeatable runs, use `VITE_RELAY_TEST_SEED=19 npm run build`, which pins the contract seed and so all three facilities. With no seed override, create fresh rooms to draw new contracts. Try different hauling plans, and try leaving mid-contract and forming a new lobby. Record confusing signs, missed warnings, and the seed.

Using the developer build on the least powerful device, open **Diagnostics** while moving. Record the device, browser version, seed, scene-ready time, frame p95 and RX/TX. Scene-ready time runs from starting the 3D client to drawing the first room snapshot. Frame p95 is the 95th percentile of visible frame intervals over approximately two seconds. RX/TX measures WebSocket message bytes per second for that client.

The November 21 local run used headless Chromium 159.0.8154.6 on an Intel Core i7-14650HX with two players. The table shows one diagnostics reading per callout from the 390 × 844 touch viewport just after the exit circuit engaged. Network figures exclude transport overhead.

| Callout and seed | Frame p95 | Scene ready | Received / sent |
| --- | ---: | ---: | ---: |
| Black start · 20 | 50.1 ms | 1.50 s | 17,630 / 2,496 B/s |
| Line test · 19 | 83.4 ms | 1.60 s | 18,019 / 2,319 B/s |

### Creator-hosted matches

The lobby creator runs the simulation and generates the floor plan. The guest sends controls through Supabase Realtime. The guest moves its own operator immediately with the same movement rules and settles onto the creator's position as each update arrives, so walking does not wait for the round trip. The other operator glides between updates instead of jumping. Private channel policies restrict world updates to the creator and inputs to the other room member. Keep the host tab open and in the foreground, particularly on mobile. A brief interruption preserves both seats. A same-tab host refresh restores the last checkpoint. After 20 seconds without the partner, the remaining browser closes the round. Choosing **Leave to hub** closes it immediately.

An active pair sends up to ten snapshots and ten input updates per second. With one recipient per broadcast, that is roughly 144,000 counted messages per hour at peak, plus handshakes. Idle pairs send fewer. Game Hub shares the Free plan’s two million monthly messages and 100 messages per second. Monitor usage during public playtests. [Message accounting](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) · [Realtime limits](https://supabase.com/docs/guides/realtime/limits)

### Publish a release

The [Pages repository](https://github.com/Kumori1313/relay-room) builds the game commit pinned in `SOURCE_REVISION`. Its Actions variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Both must match Game Hub. `npm run build:pages` uses the same build entry point. The output includes the game license, bundled dependency notices, and `release.json` with the revision and generator version. The room kit, characters, textures, and synthesized audio are generated by game code.

1. Run the hub’s local release suite with the game, poker, and tic-tac-toe checkouts. Apply the compatible Game Hub migrations with the Relay Room catalog switch disabled.
2. Apply the private Realtime channel policies, then publish the reviewed source revision. Verify `/relay-room/release.json` on the hub origin.
3. With the hub listing still hidden, enable the two-player catalog row for a private smoke test. From the hub checkout run `E2E_BASE_URL=https://kumori1313.github.io RELAY_RELEASE_SMOKE=true npm run test:relay`. This signs in two anonymous guests, collects and loads salvage, extracts, refreshes during settlement, starts the next expedition, extracts again, replays, and leaves. Set the hub’s `VITE_ENABLE_RELAY_ROOM` Actions variable to `true` and rerun its Pages workflow after the smoke test passes. Verify **Open Relay Room** from the published hub.
4. To suspend play, set `public.game_catalog.playable` to `false` for `id='relay-room'`. The adapter denies new starts and clients check active membership and the catalog flag every 2.5 seconds. The client offers **Return to Game Hub** after admission ends. Set the hub listing variable to `false` and redeploy to hide its link. To restore an earlier client, revert `SOURCE_REVISION`, then repeat the private smoke test.

For a playtest report, select **Copy reference** on the shift report and paste the build, generator version, and seed into the [issue form](https://github.com/Kumori1313/Horror-Friendslop/issues/new?template=playtest.yml). Check out that revision and start a local run with the reported seed to reproduce the layout.
