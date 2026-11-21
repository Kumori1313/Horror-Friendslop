# Co-op Horror Game Development Roadmap

The first milestone is two friends launching from Game Hub, meeting in a room, and passing a flashlight. Keep that room small and fixed so a misplaced player or prop is easy to diagnose. Once the same test works over a real connection, introduce randomized floor plans and build a complete horror round around them.

Use TypeScript, Three.js, and Vite as the working stack. Start with two desktop browsers. Treat two to four players as a proposed launch target to confirm in playtests. This repository owns the game client. The sibling `game-hub` checkout owns guest identity, room admission, shared migrations, and cross-game tests. Follow the [Game Hub integration guide](game-development-guide.md).

## Phase 1 — Synchronize two players and one object

- Build one lit room with a doorway, first-person movement, collision, and a flashlight either player can pick up, carry, switch on, and drop. Document the install, run, build, and test commands.
- Start with a local TypeScript process and a temporary development room. Let clients send inputs to that process. Have it resolve competing pickups and publish the confirmed owner and position. Smooth remote movement between updates.
- Give the prototype a diagnostic view showing round ID, player positions, flashlight owner, latest update number, and round-trip time. Keep this room as a repeatable test scene as the game grows.

**Pass when** two independent browser sessions see each other walk through the doorway and pass the light. If both grab it at once, exactly one succeeds and both see the beam follow the winner.

## Phase 2 — Prove synchronization under poor connections

- Test on separate devices and across two internet connections. Repeat the handoff with added latency, a brief outage, a backgrounded tab, and a refresh while holding the light. Recover from a fresh snapshot and ignore stale updates from a previous round.
- Record responsiveness, how long the two views disagree, bandwidth per player, and recovery time. Exercise a lost pickup reply and ensure retrying cannot duplicate the item.
- Use those measurements to select the live transport and decide where the simulation runs. Document who validates shared actions, what happens if the host or runtime disappears, and how hosting and traffic fit the hub's $0/month budget. A local server proves the mechanics only.

**Pass when** two remote players finish the handoff under simulated delay, a reconnect restores the correct owner, and losing the runtime produces the documented recovery or clean round ending. Record a repeatable test and a viable deployment choice before integrating.

## Phase 3 — Launch the prototype from Game Hub

- Register the game in the hub catalog and room dispatcher, add its migration and adapter, and connect the game client to the existing Supabase guest and lobby flows. Verify membership before admitting a player to the live round.
- Build both sites and serve them on one local origin. Add hub integration tests for private-code entry, direct room links, refresh, rejected joins, leaving, and starting a fresh round.

**Pass when** two guests enter through the hub, join the same lobby, start the flashlight prototype, and return to the hub with their seats released. A guest outside the room cannot join its simulation.

**Passed on November 20, 2026.** The project owner confirmed the local Game Hub playtest worked. The automated browser test also verified private-code entry, flashlight ownership after refresh, rejection of an outside guest, and seat release before starting a fresh room.

## Phase 4 — Generate shared random layouts

- Author a small kit of rooms and corridors with matching doorways. Generate a connected route from entrance to objective to exit, then place branches and loops so players can split up and regroup. Vary the routes players take as well as the props they see.
- Give each run a seed and generator version. Have the simulation generate one layout and send the room placements, rotations, connections, and stable object IDs to every client. On reconnect, restore that layout alongside current door and item states.
- Check for overlapping rooms, blocked doorways, and unreachable objectives, accounting for player collision size. Bound generation attempts and supply a known playable layout if they fail. Save failing seeds for regression tests.

**Pass when** a repeatable batch of 1,000 seeds yields playable layouts or the documented fallback, selected seeds produce visibly different routes, and two clients agree on walls, doors, and objectives after a refresh. Track fallback frequency so a broken generator cannot quietly ship one map.

**Automated verification passed on November 20, 2026.** Version 1 produced 977 distinct route graphs across seeds 0–999, with zero fallbacks. Two Game Hub guests received identical floor plans. Refreshing the operator who opened the intake bulkhead restored its open state, the same layout, and the held flashlight.

**Two-device playtest passed on November 20, 2026.** Both players joined the same private match through Game Hub and saw the generated facility on their devices.

## Phase 5 — Finish one playable horror round

- Pick one original team objective. For example, one player could trace a fault through a dark building while another operates the breaker panel. Give the team a reason to separate and a reason to find each other again.
- Add one creature with a readable cue and a consistent response, such as investigating the sound of a tripped breaker. Synchronize its decisions, objective progress, player incapacitation, and the round result. Define how teammates recover a player and what ends a failed run.

**Pass when** a fresh group can learn the objective, encounter the threat, win or lose, and start another run on a new layout. Watch where friends coordinate, panic, or laugh before committing to more content.

**Implemented and verified locally on November 20, 2026.** One operator sends a test tone from Relay with the lit flashlight while the other answers at Intake. The Bell Diver knocks before dropping into a marked circle. A partner can revive a fallen operator within 75 seconds. Both operators must reach Exit to extract. The simulation tests cover rescue timeout and both operators falling. Two Game Hub browsers verified rescue after a refresh, successful extraction, and a fresh lobby.

**Two-device playtest passed.** The project owner confirmed that all the Phase 5 checks they ran worked as expected.

## Phase 6 — Expand and playtest

- Expand the room kit, objective variations, soundscape, creature behaviors, and original or appropriately licensed art around the interactions players enjoyed. Test navigation and creature pathfinding on the enlarged set of layouts.
- Playtest at the proposed maximum party size. Profile frame time, loading, and network traffic on the lowest-spec target machine. Tune lighting for readable landmarks and add controls for sensitivity, volume, captions for important sounds, and reduced camera motion.

**Pass when** new groups can complete repeated runs without coaching, distinguish important cues, and recover when a teammate leaves. Record supported browsers, player limits, and measured performance on the target hardware.

**Implemented locally for two operators.** Generator v2 adds the Switchboard and Chiller hall. Crews either run a line test from Intake or charge the Switchboard for a black start. After its first strike, the Bell Diver follows connected passages and scrapes the ceiling before knocking at its target. Both callouts use the existing rescue and extraction rules.

**Verified November 21, 2026.** Two independent Chromium sessions completed both callouts through Game Hub, including rescue after refresh, extraction, replay, and returning the remaining player to the lobby list after a departure. The 1,000-seed navigation check produced 993 distinct route graphs with zero fallbacks. Every tested bay had a connected route to Exit for the Bell Diver. The [playtest instructions](README.md#phase-6-playtest) cover both callouts and the device diagnostics. Physical Android frame times and observations from first-time crews are pending.

**Manual playtest passed.** The project owner successfully completed both Line Test and Black Start.

## Phase 7 — Release and maintain

- Run the hub suite against the release build, including existing games. Verify asset paths under the approved game route, source and asset licenses, and the live runtime's cost at the intended player count.
- Release compatible backend changes first, deploy the runtime and static client, smoke-test a full round on the shared origin, then enable public lobbies. Rehearse disabling new starts and returning affected players to the hub if a release fails.
- After launch, collect bug reports with the build, seed, generator version, party size, and reproduction steps. Turn failing layouts and desynchronization reports into repeatable tests before expanding the content pool.

**Release when** two independent guests can finish a generated round on the deployed build, reconnect, replay, and leave cleanly, and maintainers can reproduce a reported seed and disable a faulty release.
