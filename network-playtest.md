# Phase 2 network playtest

Two operators share one simulation on the project computer. Each window's **G** panel reports the round, operator positions, owner, measured RTT, received/sent JSON bytes per second, and the duration of its last reconnect. A zero recovery reading means the page has not measured a reconnect yet. Use a WebGL 2 browser on each device. On a phone, tap **Enter room**, drag the left pad to walk, and swipe the scene to look. The **Pick up**, **Drop**, and light switch buttons control the flashlight.

## Play across two connections

1. On the project computer run `npm ci`, `npm run build`, and `npm run preview` from this repository. Leave the preview running on port 4176. Stop older preview instances first if they use that port.
2. Put the first device on home internet and the second on another internet connection, such as a phone hotspot. Each remote device needs its own authorized SSH access to the project computer. On each device run the following, substituting the SSH destination you normally use. A browser on the project computer itself can open the URL directly.

   ```sh
   ssh -N -o ExitOnForwardFailure=yes -L 4176:127.0.0.1:4176 user@project-computer
   ```

3. Open `http://127.0.0.1:4176/?delay=60` on the first device and `http://127.0.0.1:4176/?delay=140` on the second. To repeat with natural network latency alone, close both tabs after the trial, wait 20 seconds for the seats to expire, then open `http://127.0.0.1:4176/` on both. The value adds milliseconds to each direction on that client, on top of its actual connection latency.
4. Click **Enter room**. Walk through the doorway and pass the flashlight in both directions. Agree on the round ID, holder, and beam state after each action. Watch for a sustained mismatch or movement continuing after a player stops.
5. While holding the light, release the mouse with **Escape** and open diagnostics with **G** (on touchscreens, tap **Diagnostics**), and click **Simulate 2 s outage**. The observer should see the operator reconnecting and holding the light. The returning player should see the same seat, lamp, and position. Click the scene to resume. Repeat with a tab switch, a refresh while holding, and a short real network interruption. Retain the same tab and SSH tunnel, or restore the tunnel if it closed.
6. Close the holder's tab and wait for the 20-second reservation to expire. The observer should see the lamp drop. Finally stop the runtime with Ctrl+C, start it again, and verify both clients report that the previous round ended. Use **Join again** to enter a new round.

Record the two connection types, injected delay, measured RTT, RX/TX during movement, observed ownership, and recovery duration on each device. For a WAN measurement of the visible handoff gap, film both screens together if the laptops are side by side on different networks and count frames between ownership changes. A recording at 60 fps resolves about 17 ms. The automated check below measures snapshot arrival with a common monotonic clock.

## Desktop and Android playtest result

The tester observed the other player moving in real time and could see when that player disconnected during the two-second outage simulation. The desktop and Android players successfully passed the flashlight and saw its light switch on and off.

**Phase 2 passed.** The phone's operator held the flashlight before the simulated two-second outage and remained its owner after reconnecting. This completes the physical-device handoff and recovery checks. The automated suite also verified that restarting the runtime ends the previous round.

## Repeat the automated experiment

Run `npm run test:network`. Two clients use the game's connection code against a disposable WebSocket runtime. The test times eight alternating take/drop actions, stops movement input, interrupts a holder, discards a committed pickup reply before resuming and retrying it, and restarts a runtime on the same port. A shorter seat expiry keeps the automated run quick.

One loopback run with 60/140 ms synthetic delay each way produced the following results. These figures describe application messages on this machine. The two-internet-connection trial is a separate acceptance check.

| Measurement | Result |
| --- | --- |
| Measured RTT for each client | 121 / 281 ms |
| Action sent to holder's confirmed snapshot | 125–299 ms |
| Gap between the two clients observing each handoff | 80–81 ms |
| Recovery including a simulated 500 ms outage | 628 ms |
| Active player payload during the two-player run | 10.5 kB/s received, 3.5 kB/s sent |

The browser outage control measures from the intentional socket break to the first fresh snapshot. On an unannounced network failure, detection time precedes that measurement. Transport, encryption, and tunnel overhead add traffic beyond the JSON counters.

## Transport and hosting decision

Retain one authoritative TypeScript process over WebSocket for the two-player prototype. Each player can recover from a snapshot, and competing interactions resolve in one place. The server validates round, seat, range, ownership, and action sequence. After a reply is lost, a reconnect reads the committed state and last processed sequence. The server ignores repeated or older actions. Movement expires after 350 ms without input.

Host the playtest on the existing SSH-accessible project computer. Both browsers can leave independently of that process. A disconnected operator has a 20-second reservation. A missing runtime ends its in-memory round on restart. At the measured rates, a two-player hour uses about 76 MB of outbound JSON and 25 MB inbound at the host, before overhead. Existing hardware and an existing internet allowance can cover this test with $0 in added hosting fees. Confirm uptime, transfer allowance, and real-network results before selecting this host for public play.

For Game Hub integration, the corresponding deployment would serve the static game on the hub's origin and route authenticated browser connections over WSS to the authoritative process. Public reachability, TLS, and hub-backed admission are prerequisites for that deployment. The Phase 2 SSH playtest uses loopback and the shared test room.
