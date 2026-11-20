# Relay Room

The co-op horror prototype has a fixed maintenance room with two operator seats and one working flashlight. A local TypeScript simulation owns movement, collision, and the light. Both browser windows send inputs and receive the same room state over WebSocket.

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

The dev and preview commands each host their own temporary room. Open the same URL in both windows. Serving only the contents of `dist/` on GitHub Pages provides the client assets. Live play also requires a simulation endpoint. Use the [Phase 2 network playtest](network-playtest.md) for two-device testing, measurements, and runtime selection. Game Hub admission belongs to [Phase 3](development-roadmap.md).

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

Open **http://127.0.0.1:4175/game-hub/** in two independent browser profiles. Create different guest names, open Relay Room, create a private lobby on one device, and join with its code on the other. Start the game, pass the flashlight, then choose **Leave to hub**. The hub, game, and WebSocket share port 4175. When testing over SSH, also forward the local Supabase API port. Run this on each remote device with your usual SSH destination:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 4175:127.0.0.1:4175 -L 54321:127.0.0.1:54321 YOUR_USER@PROJECT_HOST
```

In the hub checkout, `npm run test:relay` runs the browser acceptance test on port 4175 and starts its own server. Stop the manual preview first. Set `RELAY_SITE_DIR` if the game checkout has another location.

### Hosted runtime

The client and hub must share a trusted origin for guest session handoff. For GitHub Pages, publish the client at the catalog's exact `/relay-room/` path and set `VITE_RELAY_RUNTIME_ORIGIN` at build time to the WSS origin of your trusted runtime. The default uses `/relay-room/live` on the client's own origin. The client sends its current guest access token to this runtime during WebSocket admission. Keep the runtime under the same administrative control as the hub.

Run `npm run start:runtime` on the chosen host with the same Supabase settings and `RELAY_CLIENT_ORIGIN` set to the trusted client origin, such as `https://kumori1313.github.io`. A TLS reverse proxy must forward WebSocket upgrades on `/relay-room/live` to loopback port 4180 (override with `PORT`). The runtime uses a publishable key and the caller's guarded room snapshot to verify the game, active round and seat. It rechecks membership every four seconds. Each lobby and round has its own in-memory simulation. The Phase 3 local verification uses the shared-origin server.
