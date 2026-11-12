# Skin Museum

A walk-through 3D gallery for CS2 skins. Static site, no build step: Three.js is vendored in `vendor/`, the skins live in `data/skins.json`, and every image is a local file in `assets/`.

## Run it locally

```bash
python3 -m http.server 4173
```

Then open http://localhost:4173. (It has to be served over HTTP; opening `index.html` straight from disk will not load the modules.)

## Controls

| | |
|---|---|
| `W` `A` `S` `D` | Walk |
| Mouse | Look (click to capture the pointer, `Esc` to release) |
| `Shift` | Walk faster |
| `E` | Inspect the display you are looking at, `E` again to step back |
| `←` `→` | Previous / next exhibit while inspecting |
| `M` | Toggle the map |

On phones and tablets: left pad to walk, drag to look, tap the prompt to inspect. Add `?nolock` to the URL to force drag-to-look on desktop (useful inside an iframe).

## Choosing the skins

The exhibit list is `museum.config.json`. Each entry is one item from the Steam inventory:

```json
{ "asset": "47544527361", "featured": true, "note": "Final Boss AK (Titan Holo Kato 14 Lineup)" }
```

| Key | What it does |
|---|---|
| `asset` | Steam asset id, the number at the end of an inventory link (`…/inventory/#730_2_47544527361`) |
| `featured` | Hero placement. The first featured item takes the end wall, the next two the angled walls beside it |
| `display` | Force `"wall"`, `"pedestal"` or `"hero"`. By default guns hang on the walls; knives, gloves and pins go in glass cases |
| `note` | Your own curator's note, shown in the detail panel |
| `image` | Path to an in-game picture, if it is not at `assets/ingame/<asset id>.<ext>` (see below) |
| `float`, `pattern`, `nameTag`, `inspect` | Manual values for items where Steam does not expose them |
| `class` | `classid/instanceid` fallback for items the public inventory hides (trade-protected). Filled in by `--showcase` |

After editing the config, rebuild the data and download any new images:

```bash
node scripts/sync-skins.mjs
```

Helpers:

```bash
node scripts/sync-skins.mjs --list ak-47
```

lists inventory items matching a search term with their asset ids, and

```bash
node scripts/sync-skins.mjs --showcase
```

resets the list to whatever is in the profile's Item Showcase (keeping `featured`, `note` and other settings for items that stay).

The hall grows and shrinks with the list: wall bays and glass cases are laid out automatically, and exhibit numbers follow the walk from the entrance to the centrepiece.

The title, subtitle and curator name on the entrance screen and the back wall also come from `museum.config.json`.

## In-game pictures

Steam only provides a stock render of each skin: no applied stickers, and not your pattern or wear. To show the real item, save a picture of it as `assets/ingame/<asset id>.png` (`.jpg` and `.webp` also work), then run:

```bash
node scripts/sync-skins.mjs --images
```

That mode makes no Steam requests; it only re-scans the folder. Large files get a web-sized copy in `assets/ingame/web/` (macOS, via `sips`).

- A picture with a transparent background floats in its display like the stock render.
- A normal screenshot is hung as a framed photograph, and the frame takes on its proportions.

Open `curator.html` (http://localhost:4173/curator.html) for a checklist of every exhibit with its file name and a button to copy its inspect link, for pasting into a screenshot tool.

A name tag, where the item has one, is engraved on its plaque automatically.

## 3D models

A display shows a real model instead of a picture when `assets/models/<asset id>.glb` exists (run the same `--images` command to register it). Models turn slowly in the glass cases, float parallel to the canvas in the wall frames, and can be dragged around while inspecting (a framed model moves forward as it turns so it never passes through the canvas). See `docs/3d-pilot.md` for the model requirements and the pilot plan.

## Hosting

Upload the whole folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel, S3). All paths are relative, so it works from a sub-path such as `username.github.io/skin-museum/`. Only these are needed at runtime:

```
index.html  curator.html  css/  js/  data/  assets/  vendor/
```

## Notes

- Float, pattern seed, name tag, sticker wear and the "Inspect in CS2" link come from the public inventory. Items under trade protection are not listed there, so they show name, wear tier, stickers and charm only until they unlock (re-run the sync then), or until you fill the values in by hand.
- Steam's item images are 512×384 and show the stock skin without applied stickers; see "In-game pictures" above for showing the real item.
- Fonts load from Google Fonts; everything else is self-contained.
