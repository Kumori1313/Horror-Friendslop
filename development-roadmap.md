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
- Release compatible backend changes first, publish the creator-hosted client, smoke-test a full round on the shared origin, then enable public lobbies. Rehearse disabling new starts and returning affected players to the hub if a release fails.
- After launch, collect bug reports with the build, seed, generator version, party size, and reproduction steps. Turn failing layouts and desynchronization reports into repeatable tests before expanding the content pool.

**Release when** two independent guests can finish a generated round on the deployed build, reconnect, replay, and leave cleanly, and maintainers can reproduce a reported seed and disable a faulty release.

**Creator-hosted release candidate.** Each lobby creator runs the simulation for two operators. The November 21 local Black Start test covered the private code, a two-second guest interruption, duplicate host tabs, host refresh, rescue, extraction, and replay. The touch-viewport guest reported 3,892 B/s received and 671 B/s sent during the exit circuit. [Hosting and release procedure](README.md#creator-hosted-matches)

**Release verification on November 21, 2026.** The deployed game revision was `7508e0d` with Game Hub `07b1ab9`. Two independent Chromium 159 guests completed Line Test on generator v2 seed `1434560355` through the published sites. They resumed after a guest interruption and a host refresh, revived the downed operator, extracted, then started a second private room with the other guest hosting. The local suite passed all 26 browser tests with poker `b94941f` and tic-tac-toe `2c3e51e`. It also verified that closing the creator’s tab ends the round after the reconnect window. A separate local rollback rehearsal stopped active play, returned both guests to the hub, and blocked new starts. The hosted mobile check used a touch viewport in Chromium. Frame times and network latency on physical devices remain unmeasured.

**Phase 7 complete.** A fresh guest clicked **Open Relay Room** on the public Game Hub and arrived in the game with the same guest identity. [Game Hub](https://kumori1313.github.io/game-hub/) · [Playtest feedback](https://github.com/Kumori1313/Horror-Friendslop/issues/new?template=playtest.yml)

**Android playtest passed.** The project owner played in a private lobby and hosted a live match from an Android phone on cellular data. The phone stayed connected as host when the owner switched networks mid-game, and play continued in the same match.

## Post-launch playtest roadmap

Phases 8–15 build on feedback from the public two-player release. Use the existing creator-hosted private lobby for each playtest. Repeat changes that affect movement, sound, or shared state with a desktop guest and a physical Android host.

Each phase adds geometry, entities, or traffic. Hold a performance budget throughout: record the developer build's frame p95, scene-ready time, and RX/TX on the physical Android host in that phase's heaviest scene, and compare them with the previous release. Keep simulation timers in real seconds even when frames are slow; the creator host catches up in fixed 1/30 s steps. Fix a regression in the phase that caused it.

## Phase 8 — Explore without a minimap or mission walkthrough

- Remove the floor plan, enemy markers, Diagnostics button, G shortcut, network counters, and simulated outage control from the player build. Keep the seed viewer and outage tools in the developer build. Offer a copyable build and seed on the results screen for bug reports.
- Remove the written mission briefing and step-by-step orders. Keep control bindings, touch actions, settings, and connection or health status. Give players landmarks they can recognize on the return trip, such as a distinctive intake door or a lit stair landing.

**Pass when** a first-time pair can explore, describe where they split up, and regroup using the environment. Check keyboard and touch layouts for routes that still reveal the floor plan or developer console.

**Released on November 21, 2026.** Build `4a07263` uses numbered bay signs, amber-banded Intake doorways, and three green lights over Exit. Two private-lobby browsers completed Line Test locally and Black Start on the published site. The desktop and touch views passed checks for the absent map and orders, reconnect, rescue, extraction, matching shift references, and replay. The desktop player also copied the reference to the clipboard. A separate developer build passed the floor plan and simulated outage checks. The remaining playtest is to observe a first-time pair split up and regroup by describing landmarks.

**Solo playtest mode.** One operator can enter a fresh generated facility from **Play solo**. The lit flashlight powers the exit circuit directly at Relay. Black Start also requires charging the Switchboard. The existing Bell Diver encounter, shift report, and seed apply to solo runs. Use solo to iterate on layouts and navigation, and two independent devices to verify shared state.

**Solo release verified.** On the published build `0010fce`, one operator completed Line Test on seed `695203597`, refreshed the extraction report, and started a new shift. The run opened no multiplayer socket. A separate emulated phone test verified touch pickup, flashlight toggling, same-tab refresh, and leaving the shift.

## Phase 9 — Generate larger, multi-floor facilities

- Replace the flat grid and fixed rectangular bays with room templates that declare their footprint, height, walkable surfaces, and door or stair connections. Start with a small loot closet, a bent service tunnel, a large machinery hall, and a stairwell with landings on two floors. Support rooms above one another and sightlines between levels.
  - **Ready for solo review.** The fixed stairwell walkthrough connects Intake, both landings, the machinery hall, the upper closet, and the service tunnel beneath it. Automated movement tests traverse the loop in both directions and check that the closet floor blocks flashlight pickup from below. [Local walkthrough instructions](README.md#phase-9-stairwell-playtest)
- Expand beyond the current 12–15 rooms. Build a pool of distinct destinations larger than a single facility needs. Draw each distinct room type at most once per seed. Reuse modular corridor pieces to connect them. Vary the choice of rooms, their sizes, and the branches worth exploring.
- Ground players on ramps, stairs, and upper floors. Include elevation in host snapshots and checkpoints. Use actual door and stair connections for navigation, enemy movement, and hearing distance. Two rooms stacked above one another can be far apart by that measure.
  - **Ready for review (generator v3).** Every facility now comes from room templates on a 4 m grid with two storeys. Each seed draws 13–16 unique destinations from a pool of 15 optional rooms, joined by straight, corner, tee and cross corridor pieces and one to three stairwells. Some routes loop back on themselves. Player height travels in snapshots and checkpoints. Station pads and strikes check the storey. The Bell Diver follows doors and stairs to the room an operator stands in. Its scraping fades over three connections. The 1,000-seed check walks every facility's real geometry from the spawn to every room. The Game Hub acceptance test walks planned routes through doors and stairs. A two-browser walk above and below each other remains.

- Draw only what the operator can see. Build each room as its own merged mesh instead of colour batches that span the facility. Each frame, render the current room plus rooms visible through on-screen doorways, a few doorways deep. Hide rooms beyond the fog and pull the camera's far plane in to match. Scale render resolution down when frame time rises and back up when there is headroom.
  - **Ready for device measurement.** Each room is one merged mesh group. Each frame draws the camera's room plus rooms whose doorways remain on screen. Doorways are clipped to the camera and narrowed through each doorway in turn, and a closed bulkhead or the 48 m fog limit stops the search. Avatars and the Bell Diver are hidden with their rooms. Resolution steps down by 15% at a time, to half, when the moving average of frame time stays above 26 ms, and returns after a growing quiet spell. A ray-cast test from 147 camera poses on eight seeds found no visible room left out; on average 10% of rooms are drawn. In headless software rendering on seed 19, frame p95 fell from 83 to 17 ms at the spawn, 50 to 33 ms in the first corridor, and 67 to 50 ms looking back into Intake. Diagnostics now shows render scale, rooms drawn and draw calls. Measure on the physical Android host next.

**Pass when** the 1,000-seed layout check covers floor transitions, unique room selection, clearance, overlaps, and a reachable route from every loot room to extraction. In two browsers, walk above and below one another, refresh on a landing, and meet at the same exit. Play several seeds and name the places that made each route different. On the physical Android host, the largest generated facility must hold a frame p95 at or below the Phase 6 recordings, with doorway culling enabled.

## Phase 10 — Replace the relay assignment with a salvage quota

- Prototype a crew contract spanning several expeditions. Both players can explore, carry salvage back to extraction, and choose between another haul and leaving. Sell recovered items for money. Show the target, credited earnings, and expeditions remaining on a terminal at base. Meeting quota wins the contract. Missing it by the deadline loses it.
- Retire the requirement for one operator to wait at Intake or the Switchboard. Let players learn the loop by picking up an object, loading it, and seeing its sale value on the terminal. Make enough loot reachable for the quota to be achievable across the contract.
- Render salvage with shared, instanced meshes, hidden with its room by the doorway culling. Send loot as changes to ownership and position rather than the full item list in every snapshot.
- Let a surviving player deliberately extract while a partner is down. Prototype a **20% deduction from that expedition’s recovered value** for abandoning the partner. For example, 100 in recovered salvage credits 80 if one player leaves their downed partner, or 100 if they rescue and extract them. Show the deduction on the receipt. A brief disconnect or a tap on **Leave to hub** must never count as paid extraction.

**Pass when** both players take part in the haul, a fresh crew can discover how to sell it without coaching, and tests cover quota success, a missed deadline, a crew wipe, rescue, and solo extraction with the penalty. Refreshing during settlement must credit the same sale exactly once.

## Phase 11 — Make the Bell Diver a ceiling threat

- Put a visible creature on the ceiling of the room it occupies. Give players time to look up and flee through a doorway. Remove the named attack warning, countdown beeps, and strike circle. The encounter should turn on noticing the creature and leaving its room.
- Move one connected room per step. Chase a player only while their shortest path from the Diver is at most two room connections. Recheck after each step and break pursuit when they leave that range.
- For each move, have the host randomly choose `audio/chain_1.wav` or `audio/chain_2.wav`. Use this as the Diver’s only sound. Only listeners **exactly one room connection from the destination** hear it. An optional caption follows the same hearing rule and describes the chain sound without naming a room. Record each clip’s Freesound source, creator, and license alongside the shipped asset.
- Decode each clip once and reuse the buffer for every move. Precompute room-to-room connection counts for each layout so pursuit and hearing checks cost a table lookup. Skip rendering and animating the Diver while its room is culled.

**Pass when** a test layout puts listeners at zero, one, and two connections from the destination and only the one-connection listener hears the chosen clip, once per move. Test pursuit at two and three connections, including a stairwell. In a playtest, one operator should be able to spot the Diver overhead and call the other out of the room.

## Phase 12 — Give light, loot, and equipment a cost

- Author genuinely dark tunnels and unpowered rooms. Keep some lit landmarks for orientation. Give the flashlight a finite battery that drains while switched on. Preserve the charge when players drop it, trade it, change floors, or reconnect.
- Keep darkness cheap. Light landmarks with emissive materials instead of real-time lights, and keep the flashlight's beam as the only shadow-casting light, if any. Check that dark rooms do not raise frame time on the Android host.
- Add useful field finds alongside saleable salvage, starting with spare cells. Stock the base shop with equipment bought from crew earnings, such as a replacement light or a defensive tool for the smaller enemies in Phase 13. For the first economy test, purchases reduce the shared wallet while the quota tracks credited salvage sales. Show both figures at the shop.

**Pass when** two players can see the difference between lit and unlit routes on desktop and phone, exhaust a light, and recover using a found cell or purchased equipment. Simultaneous pickups, purchases, and refreshes must preserve one owner, one battery charge, and one debit.

## Phase 13 — Expand the enemy roster and give players health

- Introduce health that lasts across multiple hits as the roster grows. Show damage, remaining health, incapacitation, and revival consistently on both devices. Tune damage and recovery so an encounter can leave someone hurt but still able to help their partner.
- Add enemies in batches with different behaviors and responses. Prototype a small scavenger players can drive off with a short-range tool and a larger roaming threat players must evade. Playtest each on its own before combining it with the Diver. Expand the roster around encounters crews can recognize and react to differently.
- Scale with the roster. Route every enemy over the cached room graph. Render and animate only enemies in visible rooms, while the host keeps simulating all of them. Quantize positions and send only enemy changes in snapshots. Keep traffic within the Realtime message budget noted in the README.

**Pass when** players can survive a hit, use the defensive item against a smaller enemy, and distinguish at least three encounters through movement, silhouette, or sound. Snapshot bytes per second with three active enemies stay within the measured budget. Test two enemies reaching one player together, revival after a refresh, and extraction with a downed partner.

## Phase 14 — Animate the crew, equipment, and creatures

- Animate idle, walk, stair travel, carrying, tool use, downed, and revive states. Give doors, pickups, flashlight use, and salvage loading visible transitions. Start creature animation in its encounter phase, then finish ceiling traversal, attacks, retreats, and hit reactions across the roster.
- Drive animations from confirmed gameplay events so a guest sees what the host resolved. Reconnecting mid-action should restore the current pose. Retain reduced-motion controls and measure frame times on the physical Android host in a dark, multi-floor encounter.
- Share skeletons and animation clips between characters of the same kind. Skip animation updates for culled characters, and update distant ones at a lower rate. Use simpler meshes for characters seen across a large hall.

**Pass when** one player can tell what their partner picked up, whether a tool connected, and when a revive finished by watching the action. Run a full public-site contract with two fresh players, record their seed and device performance, and use their observations to tune the next release.

## Phase 15 — Vote on what follows the crew into the next expedition

After each expedition’s salvage sale, hold an intermission at the base terminal if the contract continues. Prototype two crew votes per intermission. One determines which threat gets worse. The other grants an advantage to both players. Each choice takes effect on the next expedition and lasts through the rest of that contract. A fresh contract starts with the baseline roster, abilities, and terrain.

- **Threat vote.** Offer a new enemy species or an upgrade to one already active. Keep one individual of each chosen species per facility. For example, the crew might admit a scavenger or give the existing roaming enemy a follow-up lunge and higher damage. Once all species are active, offer distinct upgrades to the existing roster.
- **Crew vote.** Offer benefits that change how the pair approaches the next haul. A salvage premium increases the sale value used for both wallet and quota credit, with any abandonment deduction applied afterward. A double jump lets both players cross a broken catwalk while carrying loot. Show the actual benefit on each ballot and retire a one-time ability from future offers once acquired.
- **Terrain progression.** Introduce a basic jump on keyboard and touch. As expeditions advance, generate larger chambers with broken walkways, floor seams, and gaps that require consecutive jumps. Validate required loot and extraction routes against the crew’s current movement abilities. Keep larger chambers inside the doorway culling and the frame budget, and keep layout generation fast enough not to delay the next expedition. A crew that chose money can still make the crossing, while a crew that chose mobility can take a shorter route or reach a valuable cache.
- **Two-player voting.** Show both ballots and selections to both players. For the prototype, alternate which seat breaks a split vote each intermission and identify that seat before voting. The host checkpoints the offers and votes for the expedition so refreshing or switching networks restores the same decision and each winner applies once.

**Pass when** two crews play several expeditions on matched seeds, one favoring earnings and the other mobility. Both should face riskier crossings and more dangerous encounters in later rounds, and each should be able to point to a moment when its chosen buff helped. Compare falls, downs, salvage delivered, and extractions by round to tune the net difficulty increase. Exercise a split vote, reconnect during the ballot, and start a fresh contract to verify the reset.
