# Model credits

Relay Room's models were made for this game and are released with
the rest of it under the MIT License (see `LICENSE` in the repository,
Copyright (c) 2026 Cloudy). Each was built from scratch in Blender by Codex,
an AI coding agent, at the project owner's request. They contain no textures,
images, scans or third-party models: every shape, material and animation was
made for Relay Room. The editable Blender sources live in the repository under
`art/creatures/` and `art/salvage/`.

| Shipped file | Source | Contents | License |
| --- | --- | --- | --- |
| `brass-valve.glb` | `art/salvage/brass-valve/brass-valve.blend` | Brass valve pickup with a five-spoke handwheel, flanged ports and vertex-colored patina. | MIT |
| `gnawer.glb` | `art/creatures/gnawer/gnawer.blend` | A low-slung carrion beetle with stained wing cases, serrated mandibles and six articulated legs. Its pigment is vertex-painted and non-emissive. Includes `Idle`, `Scuttle`, `Seek`, `Chase`, `Bite`, `Haul` and `Flee`. | MIT |
| `lurker.glb` | `art/creatures/lurker/lurker.blend` | The river Lurker: a skinned hull with a swim rig, a reach shaft and a grapnel claw (shape keys `Splay`, `Clasp`); animations `Swim_Patrol`, `Swim_Pursuit` and `Grab`. Exported with the Khronos glTF Blender I/O add-on 5.3.43. | MIT |
| `stalker.glb` | `art/creatures/stalker/stalker.blend` | The Stalker with five hinged face plates and a skinned mantle. Includes `Walk`, `Track`, `Drop`, `Charge`, `Recover` and `Stagger`. | MIT |

Turning off **Settings → Detailed creature models** uses placeholder shapes for
creatures and skips their model downloads.
