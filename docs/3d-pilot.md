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

- **Titan holo is static in the file.** In game its colour shifts with the viewing angle. The GLB's own texture holds one frozen angle; the holo mask and spectrum textures are carried alongside (the sticker material's `extras.holo`). The museum now uses those to draw the live effect (see "Later the same day").
- **Where the scratches sit is unverified.** The game offsets and rotates the wear texture by pattern seed in client code that cannot be read from the files. The old CS:GO draw order was used for seed 545. If CS2 differs, the 2% of wear is in different spots from the real item.
- **Sticker mask is per triangle,** not per pixel as in game. Edges of the allowed area follow mesh edges.
- **Charm was left out of the pilot** and added later the same day, with its colour still a guess (see "Later the same day").
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
| Custom paint | AWP Dragon Lore, M4A4 Howl, AK-47 Fire Serpent, AK-47 Panthera onca | Built |
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

### Second round: the other three custom-paint finishes

Same day. `work/pipeline/make_item.py <asset id>` now builds an exhibit from its asset id alone: it decodes the inspect link, finds the weapon model, materials, finish and stickers in the game files, and writes the GLB. Rebuilding the Fire Serpent through it gives the same model.

| Exhibit | File | Item data | Notes |
|---|---|---|---|
| AK-47 Panthera onca | `48532534134.glb`, 2.8 MB | Exact (float 0.0068, seed 912) | The finish brings its own normal map (the carved wood), which replaces the gun's. One sticker, name tag. |
| M4A4 Howl | `52697697818.glb`, 4.8 MB | Exact (float 0.0766, seed 531) | Five hand-placed stickers, four of them rotated holos, one scraped to 0.98 wear. Name tag, sticker-slab charm. |
| AWP Dragon Lore | `54410428513.glb`, 6.7 MB | Exact (float 0.0094, seed 215) | Four stickers: one in its default spot on the scope, three hand-placed in a stack on the stock, two of them overlapping. Name tag, sticker-slab charm. First built from guesses; see below. |

**The Dragon Lore was first built from guesses, then rebuilt from its real data.** Steam's public inventory does not list this item (checked 11 November; the same is true of the Safari Mesh, Knight, Hot Rod, Pandora's Box, Butterfly Doppler and Butterfly Fade), so the first build used float 0.035, seed 0 and the four stickers in their default slots. That put three of the four stickers in the wrong place. The real values came later the same day; see "The Dragon Lore's real data" below.

What this round added, and how sure it is:

- **Hand-placed stickers.** The inspect link stores a sticker's position as an offset from its slot's own position, in the model's sticker coordinates. Checked two ways: with that reading every sticker centre on the Howl and on the Case Hardened AK falls inside the model's allowed sticker regions, and with the other readings several fall outside. The **rotation direction is not verified** (it only affects the four slash-shaped holos on the Howl).
- **Sticker wear** is ported from the shader. The Howl's "Jackass" sticker at 0.98 wear comes out reading "ass", which is the craft the owner made, so placement and wear agree with the real item at least there.
- **Foil and gold stickers** use the shader's metallic path: metal reflectance fitted from the picture, plus the sticker's own embossed normal and roughness maps.
- **Wear level is still unverified.** The M4A4 and AWP wear maps are much brighter than the AK's, so the same float removes more paint on them. That is what the game data says, but it has not been compared with a screenshot.

In the museum all four models load with no errors. The Dragon Lore first bloomed: its pale finish and foil stickers were over-lit by the hall's ceiling point lights (`work/screens/dragonlore_lights_compare.png`). The owner approved lighting models from the environment only, and `attachModel` now does that.

### Later the same day: sticker colour, holo, name tags, charms

All at the owner's request, after looking at the models in the museum.

- **Metallic sticker colour was wrong and is fixed.** Foil and gold stickers came out nearly grey. The shader uses `1 - tintSaturate`, and that had been read the wrong way round, which threw away the picture's colour. Every sticker on the four guns has since been compared with Steam's own picture of it (`work/screens/sticker_colours_vs_steam_*.png`); hues agree. Steam's pictures are lit renders, so brightness and gloss are not comparable, only colour.
- **Holographic stickers are now live in the museum.** `js/museum.js` draws them with the game's lookup, `u = mask.g + V·N + V·L`, using the mask and spectrum textures in the GLB and the game's colour fitting. The foil shifts as the visitor moves or turns the gun. Two things are not the game's: the key-light direction `L` is a fixed direction chosen for the hall (the game's inspect light is not in the files), and the museum's lighting and bloom are its own. The frozen angle stored in the GLB, for other viewers, is now the one whose colour is closest to Steam's picture.
- **Name tags.** The plate is the game's `nametag_module` at each gun's `nametag` attachment, with the label drawn the way the game's recipe says (position, colour, "Arial Narrow"). Arial Narrow is not installed on this PC, so plain Arial squeezed to its width was used, and the recipe gives no font size, so the size is an estimate. Howl, Panthera onca and Dragon Lore have tags; the Fire Serpent has none.
- **Charms.** Each hangs from the attach point stored in the inspect link. The Howl's is the sticker slab holding its Team Dignitas holo. Three caveats: the slab is clear plastic in game and is drawn opaque; the slab's printed label is not reproduced; and the Fire Serpent's Semi-Precious is recoloured by template number (8311) in game code that is not in the files, so its hue was matched to Steam's picture of the charm and **may not be this one's real colour**. The Dragon Lore's is a slab too, holding a Team Dignitas | Katowice 2014 sticker, with the same caveats.

### The Dragon Lore's real data

The owner signed in to `steamcommunity.com` in the browser pane, and the signed-in view of the ordinary inventory (`/inventory/<steam id>/730/2`) lists the items the anonymous view leaves out, each with its float, seed, name tag and inspect data (asset property 6). The trade-protected list (context 16) held only the Butterfly Fade. The values for all seven hidden exhibits are saved in `work/build/steam_owner_view_2026-11-11.json`.

For the Dragon Lore: float 0.0094, seed 215, name tag "P250 | Sand Dune", a sticker-slab charm, and four stickers. The Crown foil sits in its default slot on the scope. The other three were placed by hand on the butt of the stock, one above the other, so the gun reads BIG / FLOPPY / DICK from top to bottom; the last two overlap, with the later one on top. That the three land in a tidy stack with the names lined up is good evidence the placement reading is right for this gun as well.

These values are now in `museum.config.json` as manual values for this item (the sync script's own mechanism for items Steam hides) and in `data/skins.json`, so `make_item.py 54410428513` rebuilds the same file with no options. The museum's detail panel shows the float, pattern and name tag as a result.

**Overlapping stickers needed a museum fix.** The game paints sticker layers in order, so a later sticker covers an earlier one. In the GLB each sticker is a see-through decal a hair further off the surface than the one before, which Blender draws correctly. three.js instead draws see-through meshes back to front by the centre of each mesh, then by creation order, so the overlap on the Dragon Lore came out the wrong way round and could have flipped with the viewing angle. `prepareModel` in `js/museum.js` now gives a model's stickers one shared sort centre and re-creates them in sticker order. Checked on the Dragon Lore in the museum against the Blender render (`work/screens/museum_dragonlore_real_stock.jpg`, `work/screens/dragonlore_real_stock_check_render.png`).

Still not checked against the game itself: nothing here has been compared with an in-game screenshot, including which of two overlapping stickers is on top (taken from the shader's layer order and the order of the stickers in the inspect data).

The four models total 19.7 MB (the Fire Serpent is now 5.5 MB with its charm, the Dragon Lore 6.7 MB) and the museum fetches all of them when the doors open.

### Museum change made alongside

At the owner's request during the pilot: framed models no longer sway, because the swing pushed the ends of the gun through the canvas. They now stay parallel to the canvas with a slow bob. When a visitor turns one by hand in the inspect view, it moves forward by its own reach so it cannot pass through the canvas.
