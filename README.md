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
| `image` | Path to your own render or screenshot, used instead of the 512×384 Steam icon |
| `float`, `pattern`, `nameTag` | Manual values for items where Steam does not expose them |
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

## Hosting

Upload the whole folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel, S3). All paths are relative, so it works from a sub-path such as `username.github.io/skin-museum/`. Only these are needed at runtime:

```
index.html  css/  js/  data/  assets/  vendor/
```

## Notes

- Float, pattern seed, name tag, sticker wear and the "Inspect in CS2" link come from the public inventory. Items under trade protection are not listed there, so they show name, wear tier, stickers and charm only until they unlock (re-run the sync then), or until you fill the values in by hand.
- Steam's item images are 512×384 and show the stock skin without applied stickers. For hero pieces, a high-resolution screenshot of the actual craft via the `image` key looks much better.
- Fonts load from Google Fonts; everything else is self-contained.
