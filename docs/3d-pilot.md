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

## Findings

Windows PC, 11 November 2026. Result: `assets/models/47544527361.glb`, 4.7 MB. It loads in exhibit 21 facing the right way with no `modelRotation`, and no console errors.

**Not yet checked against the game.** There is no in-game inspect screenshot at `work/reference.png`: the session could not run the game and capture one. The only reference used is Steam's own render of the finish (`work/reference_steam_render.png`, no stickers). Everything below about "matches" means matches that render, or matches the game's data. An inspect screenshot of the real item is the one thing still needed to call this verified.

### What worked

- **Tools.** CS2 and Blender 5.3 (Steam install) were present. Source 2 Viewer was only the GUI build, which cannot export from the command line, so the official CLI build (20.1) was downloaded into `work/tools/`.
- **Mesh.** `weapon_rif_ak47.vmdl` holds two meshes, `body_hd` and `body_legacy`. Paint kit 180 (`cu_fireserpent_ak47_bravo`) has `use_legacy_model 1`, so `body_legacy` was exported: 12,889 vertices, magazine included, two UV sets.
- **Finish and wear.** Not approximated in Blender. The game's own compositing shader (`csgo_customweapon`) was pulled out of the shader archive, decompiled, and its custom-paint path ported line for line to numpy. Texture bindings, parameter values and colour spaces come from the shader's metadata, not guesses. At float 0.0752 about 2% of the painted area wears through, on exposed edges.
- **Stickers.** The four slots are stored in the legacy AK material (and repeated in the model's sticker markup). Each decal is cut from the gun's own triangles in the second UV set, the way `csgo_weapon` projects stickers, and sits 0.2 mm off the surface. Meshes are named `sticker_0` to `sticker_3`. Sticker colours go through the shader's albedo fitting.
- **StatTrak counter.** Not in the brief, but the item has one. The module is placed at the model's `stattrak_legacy` attachment and reads `004680`, leading zeros dimmed, using the shader's digit logic.

### What was faked or left out

- **Titan holo is static.** In game its colour shifts with the viewing angle. Here it is frozen at the angle where the foil is brightest. The holo mask and spectrum textures are carried in the GLB (the sticker material's `extras.holo`) so a view-dependent shader can be added on the web side.
- **Where the scratches sit is unverified.** The game offsets and rotates the wear texture by pattern seed in client code that cannot be read from the files. The old CS:GO draw order was used for seed 545. If CS2 differs, the 2% of wear is in different spots from the real item.
- **Sticker mask is per triangle,** not per pixel as in game. Edges of the allowed area follow mesh edges.
- **Charm is not included.** Semi-Precious changes colour with its pattern (8311) through a hue shift that was not recovered; a wrong-coloured charm seemed worse than none.
- **Small shading differences.** Valve darkens diffuse light on metals more steeply than glTF does, and gives stickers a faint raised edge. Neither is reproduced.

### How close it is

Against Steam's render: paint placement, the wood left bare, the unpainted metal and the colours all agree. Against the game itself: unknown until there is a screenshot.

In the museum the model first looked pale, with the stickers hard to read. That was the model light level, not the model: `attachModel` lit models at `envMapIntensity` 1.25 and bloom blew out the glossy stickers (roughness 0.1, the game's value). At 0.5 the same file shows saturated colour and readable stickers (`work/screens/lighting_compare.png`). The owner approved the change, so `attachModel` now uses 0.5.

### Time, size, scripting

- Under an hour for this first model. Most of that was one-off: the shader decompiler, the compositor and the GLB writer.
- 4.7 MB: colour 1.0, occlusion/roughness/metal 1.3, normal 0.8 (1024 px), stickers 0.6, geometry and StatTrak about 1.0.
- Every step is already a script, in `work/pipeline/` (git-ignored, so on this PC only). Blender is used only to render check images. What is still done by hand is writing the two JSON job files per item; a driver that reads `data/skins.json` and the inspect link would remove that.
- The pipeline scripts are a port of Valve's shader logic. They were kept out of the repository under the "only the `.glb`" rule; whether to publish them is the owner's call.

The compositor covers one of the game's nine paint styles. The collection splits like this:

| Paint style | Exhibits | Status |
|---|---|---|
| Custom paint | AWP Dragon Lore, M4A4 Howl, AK-47 Fire Serpent, AK-47 Panthera onca | Same path as this pilot |
| Anodized multicolour | Glock Dragon Tattoo, M4A1-S Knight, M4A1-S Hot Rod, P250 Steel Disruption, Flip Doppler, Butterfly Doppler, Butterfly Gamma Doppler | New shader path to port |
| Patina | AK-47 Case Hardened, USP-S Stainless, Gut Rust Coat | New shader path to port |
| Anodized airbrush | Desert Eagle Hypnotic, Karambit Fade, Butterfly Fade | New shader path to port |
| Spray | AWP Safari Mesh | New shader path to port |
| Gloves, pins | 2 gloves, 2 pins | Different kind of item, not attempted |

Matched by finish name, 11 of the 18 guns and knives use the legacy mesh like this one; the other 7 use the newer mesh, whose input textures are packed differently.

### Recommendation

Do the hero pieces next, not all 22 yet.

1. Get one inspect screenshot of the Fire Serpent and compare. That settles whether the approach is right, and whether the seed-driven wear placement matches.
2. Dragon Lore, Howl and Panthera onca use the same shader path, so they are cheap once a driver script exists.
3. Hold the Dopplers, Fades and Case Hardened until step 1 confirms the seed handling. On those the seed decides the whole look, so an unverified seed would make a confidently wrong model.
4. Gloves and pins: keep in-game pictures.

### Museum change made alongside

At the owner's request during the pilot: framed models no longer sway, because the swing pushed the ends of the gun through the canvas. They now stay parallel to the canvas with a slow bob. When a visitor turns one by hand in the inspect view, it moves forward by its own reach so it cannot pass through the canvas.
