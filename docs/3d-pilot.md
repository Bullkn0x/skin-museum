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

### Third round: the other paint styles and the knives

12 November 2026, in the night-club worktree. Fourteen more exhibits now have a model, 18 of 22 in all (60.6 MB): Glock-18 Dragon Tattoo, AK-47 Case Hardened, AWP Safari Mesh, M4A1-S Knight, M4A1-S Hot Rod, USP-S Stainless, Desert Eagle Hypnotic, P250 Steel Disruption, Karambit Fade, Flip Knife Doppler, Gut Knife Rust Coat, and the three Butterfly Knives (Doppler, Gamma Doppler, Fade). The two pairs of gloves and the two pins still show pictures: they are not weapons, and need a different route.

What was added to the pipeline (`work/pipeline/`, still git-ignored):

- **`composite2.py`**: the four mask-driven paint styles, each transcribed from its own decompiled shader variant: spray, anodized multicolour, anodized airbrush and patina, plus the separate variants the newer AWP and Desert Eagle meshes use, and patina with a roughness texture. The decompiled sources are in `work/extract/glsl/customweapon_styles/`.
- **Knives**: one mesh each, no stickers; `make_item.py` now takes a knife's own model rather than its prefab's.
- **What a pattern seed does is no longer a guess.** CS2 dropped the seed ranges from `items_game.txt`; they are in each finish's composite recipe, `weapons/paints/legacy/<finish>.vcompmat`, and the order of the random rolls is in `_shared_paint_generic.vcompmat`: pattern offset x, y; pattern rotation; wear scale (1.6 to 1.8); wear offset x, y; wear rotation; grunge scale; grunge offset x, y; grunge rotation. `make_item.py` reads both.
- Helpers: `build_all.py` (every exhibit, hidden items from the owner's saved view), `install_models.py` (copies GLBs in and lists them in `data/skins.json` without contacting Steam), `check_render.py` (renders beside Steam's picture), `seed_check.py` (the same finish with other seeds).

How the seed handling was checked, since on these finishes the seed decides the look:

- **Fade.** Rolling every seed from 0 to 1000 puts seed 412 at the very end of the rotation range (-64.995 of -55 to -65) and 763 at the other. Those are the seeds collectors rank highest and lowest for fade.
- **Case Hardened.** Nine seeds collectors list as AK-47 "blue gems" (661, 321, 387, 151, 955, 670, 179, 760, 809) were built: all nine come out with a blue top cover on the side that faces the player. Of five ordinary seeds (1, 2, 3, 4, 500), one or two do.

Still not checked against the game: nothing has been compared with an in-game screenshot. Known differences:

- **Pearlescence is not reproduced.** The two Butterfly Dopplers (and the Flip Doppler) shift colour with the viewing angle in game; the models hold one colour.
- **Metallic finishes read paler in the museum than in game.** Anodized and patina finishes are bare coloured metal, so what you see is the room reflected in them, and the museum's studio light is bright all round. The material values are the game's; the check renders under a darker studio look right.
- **The first four models were rebuilt with the same roll order** (Fire Serpent, Howl, Dragon Lore, Panthera onca). They had been built with CS:GO's older order and wear at scale 1.0. The amount of wear is unchanged (Fire Serpent 2.0% to 2.3%, the others within half a point); what moved is where the scratches sit and how large they are. Rebuilding Panthera onca before the change gave the same file byte for byte, so nothing else differs. Before and after renders show the same stickers, charms, name tags and counter.
- Sticker rotation direction, name tag font size and charm colour are the same guesses as before. The M4A1-S Hot Rod's charm is modelled; the Safari Mesh's name tag is on the gun.
- Knives come out of the game standing on end. `modelRotation` in `museum.config.json` lays them at an angle, as in Steam's pictures.
- The page now fetches models four at a time, the three centrepieces first, and retries a download that fails. With eighteen requests opened at once the local preview server refused one now and then, which left that exhibit as a picture.
- For the six items Steam hides, float, seed and name tag were read from the owner's saved view. They are still not in `museum.config.json`, so their plaques do not show them and `make_item.py` needs `build_all.py` to pass them in.

### Fourth round: the gloves and the pins

All 22 exhibits now have a model (77 MB of GLB in all; the two pairs of gloves are 7 to 8 MB each, the pins under 1 MB).

**Pins** (Cobblestone, Overpass). The item's definition names a display model, `models/inventory_items/collectible_pin_<name>.vmdl`: one small mesh, its face and rim, with a colour map, a metal mask and a normal map. `make_pin.py` turns it to face the visitor and adds a plain metal back, which the game's mesh does not have and a turning case shows.

- The material is a guess in two places. The mask called "metal" is not plain metalness: on the Cobblestone pin it covers the raised outlines and the stag, on the Overpass pin the enamel fills (in the old Source shader it tinted highlights with the surface colour). At full strength it dulled the colours, so it is used at 0.3. And the old shader kept no roughness map, so roughness is set by hand: 0.34 on enamel, 0.40 on metal.
- Lit only by the environment, like every model here, the pins' pale enamel reads greyer than in Steam's pictures.

**Gloves** (Sport Gloves, Pandora's Box and Hedge Maze). The game paints gloves with a shader of their own, `csgo_customglove.vfx`, driven by `gloves/paints/_shared_paint_generic.vcompmat`. `composite_glove.py` is a transcription of its decompiled pixel shader (`work/extract/glsl/customglove/`): four textile layers picked by a mask, each with its detail, detail normal, damage normal and grunge maps; eight colours picked by the mask's alpha; a pattern whose channels pick between four of those colours and which is printed on with a raised edge; then wear, which bleaches, frays and dirties by the item's float. It writes what the game writes, for each hand: colour, normal with roughness, metalness with a cloth mask, and occlusion, at 2048 by 2048.

- **The two hands are painted separately**, as in the game. The left takes the paint seed; the right takes a second seed the engine supplies, which is not in the game files. It is taken here as seed + 1, a guess: it decides where the repeating print and the dirt sit on the right hand. The seed rolls pattern offset, pattern rotation (fixed at 30 degrees for both finishes), grunge offset and grunge rotation.
- **The pose is this pipeline's.** The game only ever shows gloves on a pair of arms. The hands are the first-person glove meshes as they stand in the model file, set together as a pair: the left glove in front showing its back, the right behind and to the side showing its palm. First built with the fingers pointing down and to the right, as Steam's picture reads; the owner asked for fingers up, so the pair now stands fingers up, leaning a little (`ROLL_DEG` in `make_glove.py`).
- There is no arm inside the cuffs, so the material is two-sided and the inside of the cuff shows the outside's fabric.
- The game shades these as cloth. That is approximated with one sheen value per hand (`KHR_materials_sheen`), not the per-texel cloth mask the shader writes.
- Only the plain form of the shader is ported: no anisotropic gloss (the fur gloves), no backwards-compatibility form, pattern modes 0 and 1.
- Checked against Steam's pictures of both pairs: colours, the mesh on the back of the hand, the stripes, the print on the palm all agree. Not checked against the game itself.

**A change to the page for deep models.** A cased piece has a flat glow sprite behind it that faces the visitor. Left at the centre of the case, it washed out whatever part of a deep model fell behind it (the rear glove). `js/main.js` now keeps the sprite on the far side of the model each frame, in every venue.

### Fifth round: smaller pistols, and the equip demo

**Pistols in their frames.** A frame fits every model to its own size, so a pistol came out as large as the rifle beside it. `js/main.js` now holds framed pistols at 0.8 of that fit (`FRAME_FILL`); `js/museum.js` is untouched.

**Equip demo** (`?equip`, see the README). The question was whether a piece can be taken off the wall and carried and inspected as in the game. It can, with the game's own animations:

- **The game's first-person animations are readable.** Since its animation rework the game keeps them as AnimGraph 2 files: clips (`animation/anims/viewmodel/<kind>/<weapon>/*.vnmclip`), skeletons (`animation/skeletons/characters/viewmodel.vnmskel` for the arms, `animation/skeletons/weapons/<weapon>.vnmskel`) and graphs that name which clips a weapon uses (`animation/graphs/viewmodel/viewmodel_gun.vnmgraph+<weapon>`, `viewmodel_inspects.vnmgraph+<weapon>`, `viewmodel_knife*`). The format is the open-source Esoterica engine's: one pose per frame of 16-bit words, rotations as the three smallest quaternion components at 15 bits, translations quantised over a per-track range. `work/pipeline/nmclip.py` decodes it (checked: every quaternion comes out unit length, static tracks equal the skeleton's reference pose, an idle pistol sits 17 inches ahead, 2.8 right and 2.3 below the eye).
- **The rig.** `make_viewmodel.py` writes the arm skeleton (56 bones, in metres, turned to a camera's axes), the game's arm mesh with its stock gloves or with a pair of the collection's gloves in their own paint (skin weights from the game's models), and per weapon type its draw, idle and inspect clips on the arm bones and on the weapon's own bones (which hang from the arms' `wpn` bone, as the game attaches them). A `mount` node says where the museum's GLB of that weapon sits on the weapon's bone, so the model in the hands is the one on the wall, stickers, charm, counter and all.
- **Moving parts.** The museum's GLB is one rigid piece. `parts/<asset>.json` records, for every vertex, which weapon bone the game's model binds it to (found by matching each GLB vertex to the model vertex it came from: all matched exactly). The page binds the held copy to the weapon's bones with that, so slides, bolts, magazines, hammers and a butterfly knife's handles move with the clips. A sticker, charm or counter rides whole on the part it is nearest to.
- **Twelve weapon types, eighteen exhibits:** Glock-18, USP-S, Desert Eagle, P250, AK-47, M4A4, M4A1-S, AWP, Karambit, Flip, Gut and Butterfly knives. Pins cannot be held. Gloves are worn: Pandora's Box, Hedge Maze, or the stock pair.

What is not the game's, or not there:

- The weapon's lag behind the view and the walking bob are this page's own numbers. The game adds its own in code.
- The forearm's two twist bones have no track in the clips (the game's rig drives them). The page turns them by one third and two thirds of the hand's roll, a guess that keeps the wrist from pinching.
- Each vertex follows one bone (the one with the most weight). That is exact for rigid parts; a soft part such as a sling would not bend.
- The view uses the game's default preset (viewmodel_fov 60, offset 1 1 -1) and offers its other two. Whether the game applies the offset exactly this way on top of the new animations was not checked against the game.
- Arms are the default bare arms (skin tone 133), not an agent's sleeves. Skin is shaded as a plain surface, without the game's subsurface look.
- The game runs these clips through a graph that blends them and loops the middle of an inspect while the key is held. Here a clip plays from start to end with a short cross-fade.
- No sounds (the clips carry the cue names and times, so they could be added), no firing, no reloading.
- Not compared with the game side by side.

### Sixth round: firing, reloading and the F/R cut

The owner asked for the game's F and R play (start an inspect, cut it with a reload, cut that with an inspect) and for the guns to fire. Both are in the equip demo.

- **More of the game's clips.** Each gun's graph also names `shoot1_*`, `reload_*` and, for pistols, `shoot_empty_*`, `reload_empty_*` and `idle_slide_back_*` (the last round leaves the slide back). Knives have `light_miss1/2_*`, `heavy_miss1_*` and a `_hit` twin of each. All are in `anims/<weapon>.glb` now.
- **The clips carry the rules.** An event's start and length are shares of its clip, not seconds (checked against the known timing of the AK's reload sounds). `WPN_RELOAD_ADD_AMMO` is the moment a reload fills the magazine (1.1 s into the AK's 2.43 s). `WPN_BLOCK_INSPECT` is how long a shot or a swing holds `F` off. `WPN_INSPECT_INTRO`, `_LOOP` and `_OUTRO` split every inspect; the loop stretch is the part the game repeats while `F` is held, and for most inspects it ends in the pose it began in (within a fifth of a degree on the Glock, AK, AWP, M4A4 and butterfly knife; seven of the twelve weapon types were measured). Where it does not (both Desert Eagle inspects, by 10 to 20 degrees), the page holds the stretch's last pose instead of running it round.
- **The game's numbers for each gun** are in `scripts/weapons.vdata`: magazine, reserve, cycle time, automatic or not, spread and the standing, firing and moving inaccuracy, recovery time, damage, the recoil's angle, strength, their variances and seed, and where the muzzle is in the first-person view (`m_vecMuzzlePos0`, and `1` with a silencer fitted: a dot placed there sits on the barrel's tip for every gun tried). They go into `manifest.json` per weapon, with the spray worked out per shot.
- **What F and R do here.** `F` starts the inspect from its beginning, also during an inspect (the next variant where a weapon has two) and during a reload. `R` starts a reload when the magazine is not full, cutting an inspect off; the reload then runs to its end by the clock whatever the hands show, so `R` pressed again before that does nothing. A shot cuts either. This is how the old game behaved. The game's own graph has a second reload action (`action_reload_silent`, with clips twice as long) whose purpose was not worked out, so CS2 may differ in the detail.

What is not the game's:

- **The spray.** The per-shot angle and strength are generated from the game's numbers and seed by the rule known from CS:GO, and the kick builds and dies away by CS:GO's rule with CS:GO's console values. Whether CS2 still does exactly this was not checked against the game. For a silenced weapon the same seed is used as unsilenced (a guess).
- **Semi-automatic fire** is one round per click. Reserve rounds never run out. An empty magazine reloads by itself.
- The flash, the streak and the mark a round leaves are drawn by the page. A round stops at whatever is solid and drawn; glass, light beams and glows let it through. Exhibits take no marks. A knife's reach (48 and 32 units) and the wait after a swing are CS:GO's.
- No sounds (every cue's name and time is in the files), no scope, no silencer on or off, no shell casings or dropped magazine.

### Seventh round: the armory hallway and the shooting range

Built in the clubs after the owner approved the plan. What the game's files gave, and what is the page's own:

- **The bots are the game's agents.** Six default ones (SAS, FBI, a SEAL, Phoenix, Elite Crew, Balkan) with the game's own third-person clips: standing with a rifle, sidestepping, running, and seven deaths. The third-person clips are in the same format as the first-person ones (`animation/anims/world/`, skeleton `worldmodel.vnmskel`), and all agents share one skeleton, so one set of clips plays on every model. `work/pipeline/make_agents.py` builds them into `assets/range/`.
- **The damage is the game's.** Each gun's damage, range fall-off and headshot figure come from `scripts/weapons.vdata`. A bot has 100 health and no armour.
- **The scope is the game's.** The AWP's two angles of view (40 and 10 degrees across a 4:3 picture), its steadiness and kick while scoped, that the weapon is hidden and that a shot drops the scope, are all in the same file.
- **The page's own:** where a round counts as striking a bot (a ball for the head fitted to each head mesh, three for the trunk and three for the legs, hung on the skeleton; not the game's hit boxes), that legs take three quarters, how bots behave (step out, stand, step back; or run between covers) and how the pace builds, the scoring, the scope's ring, the rooms.
- **Cover is laid out as a funnel**, the nearest against the walls and the farthest in the middle. The first layout, cover spread evenly over the lanes as on the plan shown to the owner, hid half the far bots behind nearer cover from the middle of the counter; a search over layouts found this one, where every bot is in view from there.
- **Scores.** The site cannot keep any, so a small Cloudflare Worker does (`server/range-scores/`): it hands out a signed ticket when a round starts, takes a score only with a Twitch sign-in it has checked with Twitch itself, not sooner than a round lasts, once per ticket, and works the score out from the counts. Its test runs the real SQL on Node's SQLite. Not yet deployed or tried against Twitch: that needs the owner's accounts. A browser game's score can still be faked by someone determined.

### Eighth round: the game's sounds

- **Where they are.** The sound files are `sounds/**/*.vsnd` in the game's pak; Source 2 Viewer writes each as the WAV (or MP3) it holds. Which file an event plays is in `soundevents/game_sounds_weapons.vsndevts`, `..._player` and `..._ui`: per event a list of takes (`vsnd_files_track_01`), `volume`, `pitch`, `pitch_random_min/max`, `delay` and `instance_limit` (a rifle's shot is limited to one, so each shot cuts the tail of the last). How loud each group plays is in `scripts/soundmixers.txt` (`Default_Mix`: Weapons 0.6, Foley, UI and the shooter's hit feedback 1.0), and the final mix (`sounds/graphs/__main__.vmix`) ends in a limiter ("FinalMixGlue": threshold -6 dB, knee 3.125 dB, 40 to 1, attack 4 ms, release 458 ms).
- **Which are used.** Every sound cue in the first-person clips of the collection's twelve weapon types, each gun's shot (the silenced one for the USP-S and M4A1-S), the AWP's zoom, the shooter's feedback for a hit, a headshot and a kill, the count-in beep and the end-of-round sound: 130 events, 168 files. `work/pipeline/make_sounds.py` trims and stores them as MP3 (1.3 MB) with those numbers in a manifest.
- **How they are played.** `js/sounds.js`: an event picks one of its takes at random, at the game's pitch and volume times its group's level, through a limiter with the game's settings (a browser's stops at 20 to 1), then turned down as a whole to sit with the venue's music (that last level is the page's). A clip's cues are played as the clip passes them, so cutting a reload with an inspect cuts its sounds too.
- **Not the game's:** no distance or room effect (everything sounds as close as it is in the hands), no distant layer of a shot, no sound from where a round lands, no footsteps or voices from the bots. The game's own "count done" beep turned out to be a silent file, so the count-in ends on the same beep it counts with.
- **Checked** by metering the page's output, not by ear (I cannot hear it): silence before and after, a signal for a shot, a reload, a burst, a knife and a silenced shot, in the order of loudness the game's numbers give. A knife's swish is very quiet by the game's own number (0.03).

**The local server.** While trying the range the owner's browser showed the club without its new door: plain `python -m http.server` sends no caching rule, and the browser had reused a copy of the club's code saved before the door existed. `scripts/serve.py` answers `Cache-Control: no-cache` so that cannot happen, and queues far more waiting connections than python's usual five (with nothing taken from a saved copy a page asks for dozens of files at once, and on Windows an overflowing queue refuses the browser outright).

### Ninth round: the spray checked, a crosshair, blood, people, and the light show

**Are the sprays real?** Yes, for the two rifles checked, and the check found one thing to fix.

- The reference is the compensation tables players have measured in the game and passed around for years (how far to move the mouse after each shot of an AK-47 or an M4A4 to hold the aim still). The spray's own step is the mirror of each.
- The sideways part matched at once: all 24 of the AK's sideways steps of any size in the right direction, correlation 0.998. That part is the game's seed run through the ported random number generator, so it is either exactly right or nothing like it.
- The climb did not: the first step came out at 1 against a measured 7, the next two too big. The cause was the step of time. The kick loses a fixed 18 degrees a second as well as a share, and how much that bites depends on how often it is applied. The page applied it every frame (240 times a second); the game applies it 64 times a second. Stepped at 64, the first step is 7 and the whole climb follows the measured one.
- So `js/equip-demo.js` now works the kick and the trigger out in 64 ticks a second, and counts the pause that restarts a spray in whole ticks (an AK's rounds fall six and seven ticks apart, a hair inside the limit; a clock running between ticks called that a pause now and then and repeated a step).
- In the running page afterwards: AK-47, 24 of 24 sideways steps in the right direction, error 0.7 mouse counts on steps of up to 45 sideways and about 3 on the climb; M4A4, 21 of 21, error 1.0 to 1.3 and 2.4 to 3. The measured tables are whole numbers, so about one count of that is theirs.
- Not checked: the pistols and the AWP (same rule, nothing to compare with here); the M4A1-S agrees in direction on every step but runs about a fifth short in the middle of the spray, and whether the silenced mode uses the same seed is still a guess.
- The game's own files have pictures of the sprays (the Recoil sticker set, `panorama/images/econ/stickers/recoil/`), but they are small hand-drawn scribbles and no use as a measure.

**Crosshair.** `js/crosshair.js` draws the game's static crosshair from the game's own settings, scaled as the game scales them, and reads the code the game shares crosshairs with (a number in base 57 over 18 bytes, the first the sum of the rest). The layout of those bytes is from what is publicly known of it and has not been checked against the game with a real code. Moving styles are drawn at rest.

**Blood.** The game's blood impact is a handful of sprite films (a spray, a trail, a mist) and splatters for walls and floor. `work/pipeline/make_club.py` exports them and reads the particle files for how many of each a hit throws, their size, life, speed, fall and how they grow. Which of the game's three strengths of impact a hit plays, and which way each kind flies, is decided in the game's code: the page plays the medium one, the sprays out of the far side and the mist back toward the shooter.

**People.** Sir Bloody Miami Darryl (found by name in the item list: `tm_professional_varf`) and the unarmed clips are from the end-of-match celebrations and the main menu; they use the same skeleton as the range's clips. There is no clip of working a desk.

**People moving to the music.** The first version moved each whole figure down by the kick's level. That level leaps to full in one frame, so every beat was a 2 cm drop in a single frame and a slow drift back: the owner saw it as a micro stutter in time with the kick, and their recording showed it frame for frame (a jump every 14 frames at 30 a second, 125 beats a minute). Now the kick's level only says how much to move; the movement itself is one smooth curve a beat long, read off the beat clock (eased, since that clock is hurried or held for a moment to stay on the kick). Only the hips go down: each leg is solved again to reach the ankle the animation gave it, and the DJ's arms to reach his hands. Measured in the page: the largest step between two frames fell from 20.3 mm to 3.2 mm at 110 frames a second, and the feet stay within a thousandth of a millimetre of where the animation put them. The mixer only writes a bone when its value changes, so the bend is undone before each animation step, or a bone the clip holds still would be bent twice over.

**The light show.** Read on a fixed scale, loud dance music held every band near the top (the bass band averaged 0.88 of full, the overall level sat at exactly 1). Each band is now read against its own loudest recent level and mixed with the kick, so the bars rest at a third to a half and reach the top on kicks only. The beat clock used to be set back when it re-synced, which made the floor's patterns stutter; it now runs a little slow or fast instead and never goes backwards. The tempo comes from how the kick's rises repeat over seven seconds rather than from single gaps (it holds 125.6 beats a minute on the first track where the old reading swung between 107 and 170).

**The dance floor's black flicker.** Not caught: two minutes of frame-by-frame capture of every pattern found no pixel going dark for a frame or two. What was found and changed: the backward clock steps above; four patterns that rested their unlit tiles at 0.10 to 0.22 of full (raised to 0.26 to 0.40, since a tile that dark reads as a tile going out); and a guard so a reflection that is not a number cannot blacken a tile and be smeared by the glow pass. If it still happens, which pattern is on at the time would narrow it down.

### Round ten: the sub wall (2026-11-13)

The owner asked for their Twitch subscribers on the stream room's walls, a plaque each, grander by tier, in a section per tier, changing as people subscribe and lapse, with a bits leaderboard. It is the site's first live data. The design was drawn first (two artboards on the club's concept canvas) and approved before any of it was built.

**What Twitch gives** (its documentation, read that day): the list of a channel's subscribers, to the channel's own key only (`channel:read:subscriptions`), with each one's name, tier and whether the sub was a gift. Not how long they have subscribed. A bits leaderboard of up to a hundred, for all time or a day, week, month or year (`bits:read`). So a static page cannot fetch either; the owner's server does, on a timer, and publishes names, pictures and tiers only.

**How the wall is drawn** (`js/club/subwall.js`). Each tier has one picture (2048 pixels square) cut into tiles, a plaque's face painted on a tile with canvas calls, and every face shown through one small shader that adds what moves. Plaques are separate meshes so each can fly, fade and slide on its own; the free places are one instanced mesh of outlines. With 36 sample plaques up, and with 105 during a page turn, a frame stayed at the display's 8.3 ms.

**Checked in the page**: an arrival flies in from 0.7 m off the wall at one and a half times its size and is flat on the wall within two seconds; when the oldest Tier 1 leaves, the next plaque's place changes from the second to the first and it slides the 0.42 m; a change of tier takes a plaque down in one section and flies one in at the other; 200 Tier 1 names make three pages that turn after 20 seconds. Both club looks.

**Not checked**: the server against real Twitch (it needs the owner's Twitch app and Cloudflare account), and so real subscriber pictures, which are loaded from Twitch's picture server and must allow use on a canvas; if they do not, plaques keep their coloured initial.

**This page's own, not Twitch's**: every plaque design, the order (first seen on the wall), the NEW tag lasting a day, the page turn, and counting someone who was given a sub as a sub.

**The live list (2026-11-14).** The owner's own site, Knox Nation (a Lovable project at `kn0xnation.com`, spelled with a zero), already had a database, server code and the channel's Twitch account connected, so the feed went there instead of onto a new server: `GET https://kn0xnation.com/api/public/sub-wall`, added through Lovable in a draft, accepted and published with the owner's yes. `data/club.json` points the wall at it (`subs.url`). First answer: 99 subscribers (86 at Tier 1, 10 at Tier 2, 3 at Tier 3), every one with a picture. Because of the 86, the Tier 1 wall went from the 80 places drawn to 100 (two more rows), and a section that does need pages now splits them evenly. Checked from the page: the feed answers, the wall puts up 86, 10 and 3 plaques, and five of the real pictures load with permission to be painted. Not seen: the wall with the real pictures on it, because the preview pane was hidden while this was done and a hidden pane draws no frames. Stepping frames by hand with made-up clock times to get round that broke the page's state (a clock that runs backwards when real frames resume); do not test that way. The bits board is empty: the Twitch connection in Lovable has no permission to read bits. `server/range-scores` still holds the same feed as a stand-alone Cloudflare Worker; it is not used.

### Round eleven: the CSFIT room (2026-11-14)

The owner asked for the unfinished room to become a gym in the making, CSFIT's, with agents at work in it (one packing a giveaway case, one fixing one to the wall, one curling in front of a mirror), still under construction and seen from the tape. Three drawings went on the club's concept canvas first and were approved. `js/club/csfit.js` builds it from the plan drawing's own measurements (metres from the left wall and from the far wall).

**The workers.** The game has standing and crouching clips and nothing for these jobs. Each agent plays one clip (`stand_1`, `stand_2`, the range's `crouch_idle`) and the page places both arms every frame with a two-bone solve toward a point that moves: up an arc from the elbow for the curl, in and out of the case for the packer, the ends of the held case for the fitter. The hand keeps the turn it has against the forearm. As with the dancers, the bones are put back before each animation step, because three's mixer only writes a bone whose value has changed.

**What the numbers said, and what was moved for them.** With everything where the plan had it, the packer's elbows stayed at 176 degrees: the game's crouch keeps the shoulders 1.08 m up, the left knee forward and the right knee down, and a case on the floor straight ahead was 20 cm beyond both hands. The open case now stands on a crate at his right knee (elbows 118 to 175 degrees). The fitter's left hand was 8 cm short of the case; he stands 10 cm nearer the wall and the case is 10 cm higher, and both hands are on it to the millimetre. The scaffold stands 0.55 m off the wall, not against it as drawn, because the cases stick out 0.42 m. The lifter's elbows go from 163 to 42 degrees and back; no arm moves more than 4 degrees between two frames.

**The mirror.** three's Reflector. Its picture is taken by a camera looking back at the door, so at first it drew the whole club: 1,535 things a frame against 320 without it, 10 ms more. The size of the picture made no difference. Leaving out everything that lies wholly in the hall (and the hall's floor, a mirror itself) brought that to 737 things and about 2 ms (5.8 ms a frame at the doorway with the mirror, 3.9 ms with plain glass, on a 1024 by 768 picture).

**The sign's size.** The drawings showed letters about 0.8 m tall and a sign 6.4 m wide. The logo's own shape does not allow both: at 6.4 m wide, with its dumbbell mark, its letters are 1.4 m tall. The width was kept.

**Guessed**: where each letter and the mark sit in the logo picture, the logo's lean, and where the case sits in each case picture (all read off the pictures as pasted into the conversation); the size of a case (0.62 by 0.36 by 0.42 m, two to a pallet's width); which agent does which job.

**Checked** in a second preview tab stepped by hand, both looks, no errors in the console: the view from the tape, each worker close up, the reflection, the cost of the mirror, and (with three test pictures made for the purpose and deleted again) that a logo, a banner and a case picture in `assets/csfit/` are picked up and that the letters are cut from the logo with its black made clear.

**Not checked**: the owner's real pictures; the room on a display that paints by itself (the tab was in the background, where the browser does not run the page's own loop); how it looks from the balcony across the hall or from the dance floor, from where the top of the far wall can be seen.

**Found on the way** (not changed): stepping the page with a clock that runs ahead of the real one makes the page's own next frame see time run backwards, and the light show's levels then grow without limit (the picture goes white). A frame's time step is capped above but not below. It cannot happen to a visitor.

**The cases and the sign become solids (2026-11-14).** The owner asked for the cases to be "more detailed like they are actually 3d versions of the picture i sent", and the same for the logo on the wall. Until then a case was two boxes with the picture of a case on its front, and a letter was a flat picture with a dark slab behind it. Both are now built in `js/club/csfit-models.js`; where they stand, the workers and which letters are lit did not change.

- *The case.* Fifty-two bevelled blocks, ten round bars and two triangles, merged into two shapes (body: 2,180 triangles; lid: 1,356) that all nine cases share. The vendored three has no rounded box, so a block is a rectangle with its corners clipped, pushed out with a bevel (`slab`). Every block gets the same scuff picture laid flat on each of its sides, lighter toward the picture's border, which is what puts dust on every edge; each also carries its own shade. The plastic is a matt material on purpose: with a shine, the work light's glare on the cases outweighed their own colour and they came out khaki whatever black they were given. The outer size is unchanged (0.62 by 0.36 by 0.42 m), so the fitter's hands, the brackets and the pallet fit as before. The clasps were first drawn hanging 6 cm over the label; they now stay above it.
- *The letters.* An outline pushed out into a solid with a bevel (`solidOf`), leaning as the logo leans, 15 cm deep, on steel stand-offs 6 cm off the wall, with a halo on the wall behind each lit one. The front's picture lies on the outline's own square, so whatever the outline is, the picture fits it. With `logo.png` in the folder the outline is followed round the letter in the picture (`traceOutline`: the biggest bright piece, its edge walked pixel by pixel, then straightened to a few dozen corners) and the cut picture is the front; without it the outline is this page's drawing of the logo's letterforms and the front is painted (cracked ice, cyan at the C to violet at the F, a bright rim). The club's bloom spreads anything bright: a wide rim and a face brighter than white washed the colour out to pale lavender, so the rim is narrow and the face is at about its own colour.
- **Cost**: 8.7 ms a frame at the doorway before, 8.6 after (medians of 60 frames with `gl.finish`, mirror reflecting, in the preview pane); with every case and letter hidden, 8.1, so the solids cost about half a millisecond. Single runs of 60 frames ranged from 7.7 to 9.3 ms, with one at 10.9.
- **Checked** in a second preview tab stepped by hand, both looks, no errors in the console: the doorway view, each kind of case close up, the open case, the two on the wall, the one in the fitter's hands, the sign from the front, from the side and along the wall, the mark on the bench. With pictures made in the page and handed over through `__csfit.art` and `__csfit.redraw()` (nothing was put in the folder): a logo in another typeface was cut, traced and built into solids with its own picture on the fronts, a stray streak beside the letters was ignored, and a case picture's label landed on the front panel edge to edge, the right way up.
- **Not checked**: the owner's real pictures (the test logo was drawn to the positions `LOGO` and `LETTERS` assume, so the test says nothing about whether those positions are right); how the solids look on a display that paints by itself; the view from the balcony across the hall and from the dance floor.
- **Guessed**: every measurement of the case's parts, the letterforms, what the emblem on each lid shows (a knife on blue, three stripes on green, the name on violet), and where the label sits in each case picture.

**The range's board goes online (2026-11-14).** The owner asked for the leaderboard to go live, with a prompt to sign in with Twitch after a round "if they dont have an active session ported into the museum", and a skin for the month's winner. It lives in Knox Nation, added through Lovable in a draft and published with the owner's yes at each step (the builder stopped to have its plan approved, which only the owner could answer). The museum collects a "museum pass" rather than signing anyone in itself (`js/range/pass.js`): Knox Nation leaves it under a number only the museum page knows, and the page asks for it once a second while its sign-in window is open, so nothing depends on the two windows being able to talk after a trip through Twitch. Two faults found in review were fixed before publishing: viewers whose Twitch display name is not plain Latin letters were turned away, and a signed-in viewer's pass could be left for a number someone else had chosen (it is now only left silently when the museum itself opened the window). Checked against the live site without signing in: the board answers for the month, a round ticket is handed out, a score handed in at once or with a forged ticket is refused, a site not on the list is refused, and the museum page reads all of it. Not checked: a real sign-in and a saved round, which need the owner's own Twitch account and three minutes of play.
