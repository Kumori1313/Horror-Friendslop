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
