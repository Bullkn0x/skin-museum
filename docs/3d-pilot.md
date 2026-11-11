# 3D pilot: one real gun in the museum

Hand-off brief for the session on the Windows PC (which has CS2, Source 2 Viewer and Blender). Written on the Mac, where the museum-side support was built and tested with a stand-in model.

## Goal

Produce one file, `assets/models/47544527361.glb`: the owner's **StatTrak™ AK-47 | Fire Serpent** as a real-time model that looks like the actual item in game. Then judge honestly whether the same process is worth repeating for the other 21 exhibits.

The pilot succeeds if the model, viewed in the museum, holds up next to an in-game inspect screenshot of the same gun. It is fine to report that it does not.

## The item

Decoded from its inspect link, so these are the real values:

| | |
|---|---|
| Weapon | AK-47 (defindex 7) |
| Finish | Fire Serpent, paint index 180 |
| Pattern seed | 545 |
| Float | 0.075249 (Minimal Wear) |
| StatTrak | yes, 4,680 kills |
| Stickers | slot 0 Vox Eminor \| Katowice 2014 (id 79) · slot 1 HellRaisers \| Katowice 2014 (id 57) · slot 2 Fnatic \| Katowice 2014 (id 55) · slot 3 Titan (Holo) \| Katowice 2014 (id 76). All in default positions, unscraped |
| Charm | Semi-Precious (id 29), pattern 8311, offset 7.332 / 0.795 / 1.514 |

Full inspect link: see `data/skins.json` (`inspect` on the skin with `id` 47544527361).

## What the museum expects

Already built and working. A display switches from its flat picture to a model when the file exists.

- **File:** binary glTF 2.0 at `assets/models/<asset id>.glb`. Meshopt compression is supported; Draco and KTX2 are not.
- **Orientation:** Y up, the play side (the gun's left side, the one you see in first person) facing +Z, muzzle toward -X. If the export faces another way, do not re-export: set `"modelRotation": [x, y, z]` (degrees) on the item in `museum.config.json`.
- **Scale and origin:** anything. The museum centres the model and scales it to fit.
- **Materials:** standard metallic-roughness PBR. The museum lights models with an environment map.
- **Stickers:** keep them as separate meshes named `sticker_0` … `sticker_3` rather than baking them into the gun's texture. That keeps them sharp and lets the web side give the holo its own shader later.
- **Budget:** aim for under 8 MB, with 2K textures at most.

To see it in the museum:

```
node scripts/sync-skins.mjs --images
python -m http.server 4173
```

Open `http://localhost:4173/?nolock`, walk to the right-hand angled wall at the far end (exhibit 21), press `E`, and drag to turn the gun.

## Suggested route

This is a plan, not a recipe. It was written without access to the game files, so verify each step against what is actually on disk.

1. **Find the tools.** Locate the CS2 install (`...\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk`), Source 2 Viewer (check whether its command-line build is present and read its `--help`), and Blender (`blender --version`).
2. **Export the AK-47.** Export the weapon model to glTF with its materials and textures. The Fire Serpent is a 2013 finish; check its paint kit entry in `scripts/items/items_game.txt` for a legacy-model flag and export the matching mesh, or the artwork will not line up with the UVs.
3. **Find the finish.** Look up paint kit 180 in `items_game.txt` for its texture and its wear range, and extract that texture.
4. **Compose the skin.** In Blender, lay the finish over the base material and apply wear for float 0.075. Compare against an in-game screenshot rather than trusting the maths.
5. **Stickers.** Find where the AK-47's four default sticker positions are defined, extract the four sticker textures, and place each as a thin decal mesh just above the surface.
6. **Export.** One GLB, textures embedded, checked in the museum.
7. **Charm.** Optional. Skip it if it threatens the rest.

## Rules

- Keep every extracted game file and Blender project under `work/`, which is git-ignored. Only the final `.glb` goes in the repository: it is public, and it deploys to the live site on every push to `main`.
- The models and textures belong to Valve. The owner has decided to try this for a personal fan site; keep the published output to the finished model.
- Do not touch the other exhibits or restyle the museum as part of this.

## Report back

Add a "Findings" section to the end of this file before committing:

- What worked, what did not, and what was faked.
- How close it is to the in-game look. Put a reference screenshot at `work/reference.png` and say where the model differs.
- Time spent, final file size, and which steps could be scripted for the remaining items.
- A recommendation: carry on to all 22, do the hero pieces only, or fall back to in-game pictures.
