# Skin Museum

A walk-through 3D gallery for CS2 skins. Static site, no build step: Three.js is vendored in `vendor/`, the skins live in `data/skins.json`, and every image is a local file in `assets/`.

## Run it locally

```bash
python3 scripts/serve.py 4173
```

Then open http://localhost:4173. (It has to be served over HTTP; opening `index.html` straight from disk will not load the modules.)

`scripts/serve.py` is python's own little server with one difference: it tells the browser to check back before reusing a saved copy of a file. With plain `python3 -m http.server` a browser can go on showing old code for hours after a file has changed, and a reload does not help.

## Controls

| | |
|---|---|
| `W` `A` `S` `D` | Walk |
| Mouse | Look (click to capture the pointer, `Esc` to release) |
| `Shift` | Walk faster |
| `Space` | Jump |
| `E` | Inspect the display you are looking at, `E` again to step back |
| `←` `→` | Previous / next exhibit while inspecting |
| `M` | Toggle the map |
| `J` | Night clubs only: music on / mute |
| `E` on a seat | Night clubs only: sit down in the stream room. `E` again to stand up, `Esc` to free the mouse for the player and the chat, `↑` `↓` for the stream's volume |

On phones and tablets: left pad to walk, drag to look, the Jump button to jump, tap the prompt to inspect. Add `?nolock` to the URL to force drag-to-look on desktop (useful inside an iframe).

## Venues

The entrance screen offers three venues for the same collection. The museum is the default; the other two are night clubs.

| Venue | Address | |
|---|---|---|
| The Museum | `index.html` | Stone, brass and quiet light |
| Velvet | `index.html?theme=velvet` | Marble, crimson velvet and gold, a mirror ball, a starlit dance floor |
| Neon Grid | `index.html?theme=neon` | An LED dance floor, lasers, exhibits on LED screens and as holograms |

Both clubs share one hall (`js/club/`): a dance floor in the middle, wall bays down both sides, cases along the edges of the dance floor, a DJ booth at the far end with a staircase on each side, and an upstairs VIP gallery behind red velvet ropes. A rig of moving lights follows the music, or a steady beat when nothing is playing. The lights draw beams and pools on the floor but do not light the exhibits, so models look the same in every venue.

`data/club.json` arranges the clubs:

```json
{
  "vip": { "centre": "54410428513", "left": "52697697818", "right": "47544527361" },
  "floorDisplays": ["47367519750", "54462560137"],
  "stream": { "channel": "bullkn0xcs", "chat": true },
  "music": { "volume": 0.7, "order": "playlist", "autoplay": true,
             "tracks": [{ "title": "dashstar*", "artist": "Knock2", "src": "assets/music/knock2-dashstar.mp3" }] }
}
```

| Key | What it does |
|---|---|
| `vip` | The three pieces upstairs, by asset id: `centre` hangs on the end wall over the DJ, `left` and `right` on the side balconies. Leave it out to use the first three `featured` items |
| `floorDisplays` | Up to six items shown on podiums out on the dance floor. The rest of the cased items stand along its edges |
| `music.tracks` | The jukebox's playlist: `{ "title": "…", "artist": "…", "src": "assets/music/track.mp3" }`. The first one is selected when the club opens |
| `music.order` | `"playlist"`, `"shuffle"` or `"loop"` (repeat one) |
| `music.volume`, `music.autoplay` | Starting volume from 0 to 1, and whether the first track starts when the visitor enters |
| `stream` | `{ "channel": "your-twitch-name", "chat": true }`: the channel shown in the stream room. Leave `chat` out or set it to `false` for the picture alone |
| `subs` | `{ "url": "https://knoxnation.com/api/public/sub-wall", "hide": ["a_name"] }`: the address the stream room's sub wall reads its list from (see below), and any names to leave off it. `false` leaves the walls bare |

### The stream room

At the top of the stairs a doorway in each side wall leads off the hall. The one on the left is the stream room (`js/club/rooms.js`, `js/club/stream.js`): a short corridor into a small cinema with four raked rows of seats, a 9.6 by 5.4 metre screen, and the channel's chat beside it. Over the door, on the hall's side, the room's name and an ON AIR light that is lit while the channel is live. The doorway on the right is taped off: it looks into CSFIT, a gym that is still being built (see [The room behind the tape](#the-room-behind-the-tape-csfit)).

- **Whether the channel is live** comes from Twitch, with no account or key. The page asks Twitch for the channel's preview picture every 45 seconds: a live channel answers with a recent frame, an offline one with a stock picture. Once a visitor comes upstairs, Twitch's own player is loaded out of sight and reports the moment the channel starts or stops.
- **The music stays in the hall.** Down the corridor it sinks and loses its highs, and in the room it is the muffled thump of a club through a wall. It fades out altogether once a visitor sits down to a stream that is live.
- **Walking about**, the screen shows that latest frame with a LIVE badge (it is a still, refreshed as Twitch refreshes it, every few minutes), or a card saying the channel is offline.
- **To watch**, press `E` on a seat, or `E` while looking at the screen. The view turns square to the wall, the lens closes in until the picture and the chat fill the page, and Twitch's own player and chat are laid exactly over the screen. The club's music fades out and the stream's sound comes up. `E` stands you up again. Twitch will not play in a picture smaller than 400 by 300 pixels, so in a small window the picture takes the whole page and the chat is left out.
- **Why the view locks**: Twitch only plays in a player that is flat on the page at its own size, fully opaque, with nothing over it. Any tilt or scaling pauses it within seconds (measured on 2026-11-12). So the live picture cannot be drawn in perspective on a wall you walk past; it can only be laid flat over a wall you face squarely.
- **Where it works**: Twitch serves its player only to pages on `https`, or on `localhost` for previews (not `127.0.0.1`), and the page tells Twitch its own address, so a new domain needs no change here.
- **Trying it while you are offline**: add `&stream=` and the name of any channel that is live, for example `index.html?theme=neon&stream=some_live_channel`.

Visitors' browsers contact Twitch when a club opens (for the preview picture) and again when they go upstairs (for the player).

### The sub wall and the bits board

The stream room's side walls hold the channel's subscribers, a plaque each with their picture and name, in a section for each tier, and the bits leaderboard (`js/club/subwall.js`). As you face the screen:

| Section | Where | A plaque | Places |
|---|---|---|---|
| Tier 1 | Left wall, beside the seats | A name plate, 0.6 by 0.19 m | 100 |
| Tier 2 | Right wall, beside the seats | A framed plaque, 0.9 by 0.45 m, with a band of light that sweeps it | 18 |
| Tier 3 | Right wall, beside the screen | A gold-framed panel 1.15 by 1.6 m on a lit shelf, with colours that slide as you pass, a turning ring and rising sparks | 6 |
| Bits | Left wall, beside the screen | The ten who have cheered the most, 3.4 by 4.4 m | 10 |

- **It changes while you stand there.** A new sub's plaque flies in and locks on with a flash, and is tagged NEW for a day. When a sub ends the plaque fades and the ones after it slide along to close the gap. Changing tier is both at once. Plaques are in the order they first went up, oldest first.
- **More subs than places**: that section shows a page at a time and turns it every 20 seconds. **Fewer**: the free places stay as faint outlines.
- **Where the list comes from** (`js/club/subfeed.js`): Twitch shows a channel's subscribers only to the channel itself, so the page cannot ask Twitch. The owner's Knox Nation site, which already has the channel's Twitch account connected, asks at most every five minutes and publishes a list of names, pictures and tiers, nothing else, at `/api/public/sub-wall`. Put that address in `subs.url`. The page reads it once a minute while a visitor is in or by the room. (`server/range-scores` holds the same feed as a stand-alone server, for a site with nothing behind it; `subs.api` points at one of those. It is not needed alongside Knox Nation.)
- **Before the server exists**: on your own machine (`localhost`) the wall shows `data/subs.sample.json`, made-up names with someone arriving, leaving or cheering every half minute, and every section says SAMPLE NAMES. A published page with no server shows empty places and never the made-up names. `?subs=demo` forces the sample anywhere and `?subs=off` empties the wall.
- **What Twitch does not tell**: how long someone has been subscribed is not in its list, so a Tier 3 plaque says when it first went up on the wall. Whether a sub was a gift is in the list; by default someone who was given a sub has a plaque like anyone else (the server's `SUBS_GIFTED` setting changes that).
- A subscriber's picture is loaded from Twitch's own picture server by each visitor's browser. Until it arrives, or if it cannot be used, the plaque shows two colours and an initial.

### The room behind the tape: CSFIT

Through the taped-off doorway on the right at the top of the stairs is a gym taking shape (`js/club/csfit.js`). Visitors look in from the tape; they cannot walk in. From the door:

- **Dead ahead, the sign.** Five letters 1.4 m tall on the far wall. C, S and F are lit and flicker now and then as if being wired; I and T are up but dark, their wires hanging; a dashed outline marks where the dumbbell mark will go, which is still in its wrap on the trestle bench.
- **Left of it, the mirror.** Two panels are up and a third leans beside them in its film. An agent stands in front, curling a dumbbell in each hand, one arm after the other; you see his back and, in the glass, his front. Beside him a half-filled dumbbell rack and a carton, on the only part of the floor that has its rubber down.
- **On the left wall, the case wall.** Six brackets, two giveaway cases already up, and an agent on the scaffold holding a third to its place.
- **In the middle, the packing.** An agent crouches at an open case on a crate, pressing the foam in, beside a pallet of five finished cases with their seams lit blue, green and violet.
- **Around them**: a squat rack with its fourth upright still on the floor, a bench in its wrap, a stack of plates, a rolled mat, the sticker banner leaning under a smaller COMING SOON, and the builders' own things (ladder, plasterboard, paint, the dust sheet over the first machine, the work light). The board over the door says CSFIT, COMING SOON.

**The three agents** are the game's own (Balkan lifting, FBI packing, Phoenix fitting), standing or crouching in the game's own clips. The game has no animation of lifting, packing or fitting, so the page places their arms each frame: two bones solved to put the hand where the work is (`place` in `csfit.js`, with `swing` from `npcs.js`). The dumbbells follow the hands, and the fitter's hands follow the case.

**The mirror** is a real reflection, so it means drawing the room a second time. It is only made while a visitor is upstairs, within a few steps of the doorway and facing in; from anywhere else the glass is a plain dark sheet. Everything that lies wholly in the hall is left out of the mirror's picture (it would show as a sliver through the reflected doorway), which took its cost from about 10 ms a frame to about 2.

**The cases and the sign are solids** (`js/club/csfit-models.js`), made after your pictures of them rather than pictures stuck on boxes:

- **A case** is a moulded crate in two shapes, body and lid, shared by all nine in the room: corner blocks and feet, a carry handle recessed in each end, ribs and bolts, a lid with cut-back edges, a raised panel with a small emblem, two bands over the top and down the front, two clasps across the seam and the small triangle marks. The strip of light in the seam runs all the way round in the case's colour. The plastic is matt black, scuffed, paler toward every edge. The open case's lid is the same lid, swung back on its hinge. Only the label on the front and the emblem on the lid are flat pictures.
- **A letter of the sign** is its outline pushed out 15 cm with a bevelled edge, standing 6 cm off the wall on steel mounts. Its front is cracked ice in the logo's colours with a bright rim; its sides are dark. The dumbbell mark on the trestle bench is the same kind of solid under its wrap.

**Your own pictures.** The room uses these five files if they are in `assets/csfit/`, and draws stand-ins in the same colours until they are:

| File | Used for |
|---|---|
| `logo.png` | The sign: each letter is cut from it (black becomes clear), its edge is followed round to give the solid its shape, and the cut picture becomes its front |
| `banner.png` | The sticker banner (2.4 m by 0.8 m, so three times as wide as tall) |
| `case-blue.png`, `case-green.png`, `case-violet.png` | The label on the front of each kind of case: only the front panel is cut from the picture, the rest of the case is the solid |

Without a file, the letters are the page's own drawing of the logo's letterforms and each label is painted by the page (the name, its mark, the line under it, the hazard stripes). To try a picture without putting a file in the folder, open the page with `?debug` and run `__csfit.art['logo.png'] = anImage; __csfit.redraw()` in the console.

Where each letter sits in the logo, how far it leans, where the case sits in each case picture (numbers at the top of `csfit.js`: `LOGO`, `LETTERS`, `KINDS[...].crop`) and where the label sits on the case in that picture (`LABEL_IN_PICTURE` in `csfit-models.js`) were read off the pictures as they were shown, not measured from the files: expect to adjust them once the files are in. `assets/csfit/manifest.json` lists the five names. Like the other asset folders, `assets/csfit/` is not committed; committing it publishes the pictures.

### Music

The jukebox stands by the entrance: walk up and press `E` to play, skip and set the volume. Its music comes from two places:

- **The playlist** in `data/club.json`. Put each audio file in `assets/music/` under the name its `src` gives and list it under `music.tracks`; the first track is selected when the club opens and starts when the visitor steps in. `assets/music/` is git-ignored, so the files stay on this computer and the published site lists the tracks without being able to play them. Taking that line out of `.gitignore` and committing a file publishes it for anyone to download, so only do that with music you have the right to share.
- **A link** straight to an audio file or an internet radio stream, added at the jukebox. Links are remembered on that device. Pages from streaming services (Spotify, YouTube, SoundCloud) are not audio files and will not play.

The lights, the dance floor and the screens behind the wall pieces read the music as it plays: the spectrum drives the bars, and each kick drives the flashes and keeps the light show's beat clock in step.

The music plays from two speaker stacks hung over the far end of the dance floor: it is louder and drier near them, softer and more echoing by the entrance or upstairs, and it moves between your ears as you turn. Use headphones to hear it best. A link whose host does not allow cross-origin use still plays, but without the room sound.

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

## Carrying a piece

A piece can be taken off its display and carried in first person, as in the game. It is on in the two clubs, where the shooting range needs it (`?noequip` switches it off), and on request in the museum (`index.html?equip`). It needs `assets/viewmodel/`, which is built from the game's files and is not committed; without that folder nothing changes.

| | |
|---|---|
| `F` at a gun or knife | Take it off its display (it leaves the frame). `F` at another swaps; `F` at its own empty display hangs it back |
| `F` anywhere else | Inspect it in your hands, with the game's own inspect animation. Pressed again it starts over; held, it stays in the stretch the game marks to repeat |
| Left click | Fire (hold, on an automatic). With a knife: slash, and right click stabs. Needs the mouse captured |
| `R` | Reload a magazine that is not full. `F` during the reload cuts to the inspect while the reload finishes unseen; a shot or `R` cuts an inspect short |
| `G` | Put it back from wherever you are |
| `F` at a pair of gloves | Put them on (their case empties); `F` again takes them off |
| `H`, `V` | Cycle the gloves; cycle the game's three first-person view presets |

- **From the game:** the first-person arms and skeleton, the glove meshes (wearing the collection's own painted pairs), each weapon type's draw, idle, inspect, shoot, reload and knife-attack animations with their cues (when a reload adds its rounds, how long a shot holds `F` off, which stretch of an inspect repeats), which part of a weapon each vertex belongs to, so slides, bolts, magazines and a butterfly knife's handles move, and each gun's numbers from `scripts/weapons.vdata`: magazine, rate of fire, spread, where the muzzle is, and the angle and strength of every shot's kick. `work/pipeline/make_viewmodel.py --install <checkout>` builds all of it into `assets/viewmodel/` (20 MB, not committed).
- **This page's own:** the weapon's slight lag behind the view, the bob while walking, the forearm twist, the blends between clips, the muzzle flash, the streak and the fading mark a round leaves (exhibits take no marks), and the rule by which a kick builds and settles (CS:GO's, with CS:GO's console values; not compared with CS2). Rounds in reserve never run out, and inside the club's shooting range the magazine never runs down either, so nothing needs reloading there (the counter shows &infin;; in the hall and the armory hallway rounds are counted as before). No silencer on or off, no shell casings, no touch controls.
- **Sounds:** the game's own, in `assets/sounds/` (1.7 MB, built by `work/pipeline/make_sounds.py --install <checkout>`, not committed): each gun's shot, the scope, and every cue the clips carry (a magazine out and in, a bolt, a draw, an inspect, a knife through the air), with the volume and pitch the game's sound lists give each, the level its default mix gives each group, and a limiter set like the one on its final mix. The game's distance and room effects are not reproduced. `js/sounds.js` plays them; without the folder everything is silent.
- **Crosshair:** while a piece is in the hands a crosshair replaces the dot, drawn as the game draws its static one (size, thickness, gap, dot, outline, T shape, colour; one unit is the picture's height over 480, as in the game). It is chosen at the panel on the end wall of the armory hallway: seven presets, sliders, or a code pasted from the game (`CSGO-xxxxx-...`). Until a visitor chooses, it is a plain green plus whose bars meet in the middle (size 4, thickness 1, gap -5, outlined); the game's own default is there as "Classic". Kept on the device. `js/crosshair.js`.
- **Spray:** each gun's kick is the game's own angle, strength and seed, worked out 64 times a second as the game does. Checked against sprays measured in the game: see `docs/3d-pilot.md`.
- Right click with the AWP looks through its scope (two magnifications, the game's own angles and steadiness); a shot drops it for the bolt and it comes back up.
- The code is `js/equip-demo.js`; `js/main.js` calls it through a few small hooks. Deleting the file, the hooks and `assets/viewmodel/` removes it.

## People and the DJ booth (clubs only)

- **The DJ** is the agent Sir Bloody Miami Darryl, behind two turntables and a mixer (`js/club/dj.js`: built from simple shapes; the records turn while music plays and the mixer's meters follow it). Three guests stand in front of the booth and two about the room (`js/club/npcs.js`). All are the game's agents with the game's own animations (`assets/club/`, 9 MB, built by `work/pipeline/make_club.py --install <checkout>`, not committed); without the folder the club has no people in it.
- The game has no animation of someone working a desk. The DJ's pose is its main-menu idle of a man holding a machine gun at the hip, with the gun left out, so the hands rest over the gear with fingers curled.
- **Moving to the music** is this page's own, laid over the game's animations: the hips sink and rise once a beat (up to 2.6 cm for a guest, 1.1 cm for the DJ; `BOB` in `js/club/npcs.js`, 0 turns it off). The legs are bent again each frame so the feet stay where the animation put them, and the DJ's arms so his hands stay on the gear. It fades out over a few seconds when the kick stops or the music is off.
- **The light show** follows the kick drum: each band of the music is read against its own loudest recent level, and the bars rest low and jump on the kick (`js/club/audio.js`). The tempo is found from how the kick's hits repeat over the last seven seconds.

## The shooting range (clubs only)

A door in the dead end of the left aisle, under the VIP gallery, leads to an armory hallway and on to a range behind the hall.

- **Hallway:** every gun of the collection hangs on a rack. `E` at one takes it (it leaves its frame in the hall too) or hangs it back.
- **Range:** `E` at the console by the door starts a round. For three minutes the game's agents step out from cover 9, 16 and 24 metres away, sidestep, or run between covers, faster as the round goes on. They do not shoot back. One gun a round; leaving the range or changing gun stops it.
- **Damage:** a bot has 100 health and takes what the gun deals in the game: its damage, less over distance, times the gun's headshot figure to the head, three quarters to the legs.
- **Score:** 100 a kill, 50 more for a headshot, 25 more for the far row.
- **Leaderboard:** a board for each calendar month (UTC), one entry per Twitch account, its best round of that month. The top score at the end of the month wins a prize; the board and the end-of-round card say so (`"prize"` in `data/club.json` is the wording, "a skin" by default). The owner's Knox Nation site keeps it (`"range": { "site": "https://kn0xnation.com" }`): `POST /api/public/range/round` opens a round, `POST /api/public/range/score` hands one in, `GET /api/public/range/top` is the board. Every device also keeps its own best round, and with no `site` set that is all there is.
- **Signing in** (`js/range/pass.js`): when a round ends, someone already signed in has it saved without pressing anything. Anyone else gets one button, "Sign in with Twitch to save". It opens a small Knox Nation window: a visitor signed in there already is carried across and the window closes by itself; otherwise they sign in with Twitch in it. Knox Nation then leaves a pass for the museum to collect: a signed note of which Twitch account this is, good for twelve hours and only for range scores, kept for the tab. The museum never sees a Knox Nation or Twitch login.
- **What the server checks, and what it cannot:** a round has to be opened first, cannot be handed in sooner than a real round lasts or twice, the numbers have to add up, and the score is worked out on the server. The game still runs in the visitor's browser, so a determined cheat can make up a believable round: look the month's winner over before a prize goes out.
- `server/range-scores/` is the same board (for all time, not by month) as a stand-alone Cloudflare Worker with a Twitch sign-in of the museum's own (`"twitchClientId"`, `"scoreApi"`, `js/range/twitch.js`, `auth.html`). It is not used while `site` is set.
- **Blood:** a bot that is hit throws the game's own blood sprites, and the wall or cover behind it and the floor where it falls take the game's splatters (`assets/club/blood/`, with the numbers of the game's medium blood impact). `js/range/blood.js`.
- **Bots:** `assets/range/` (15 MB, built from the game's files by `work/pipeline/make_agents.py --install <checkout>`, not committed). Without it the bots are plain stand-in figures and the game plays the same.
- The rooms are `js/club/range.js`, the game `js/range/game.js`, sign-in and scores `js/range/twitch.js` and `js/range/scores.js`, and `auth.html` is the page Twitch sends its sign-in window back to. The count-in beeps and what the shooter hears on a hit, a headshot and a kill are the game's. Not for touch screens.

## Hosting

Upload the whole folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel, S3). All paths are relative, so it works from a sub-path such as `username.github.io/skin-museum/`. Only these are needed at runtime:

```
index.html  curator.html  css/  js/  data/  assets/  vendor/
```

## Notes

- Float, pattern seed, name tag, sticker wear and the "Inspect in CS2" link come from the public inventory. Items under trade protection are not listed there, so they show name, wear tier, stickers and charm only until they unlock (re-run the sync then), or until you fill the values in by hand.
- Steam's item images are 512×384 and show the stock skin without applied stickers; see "In-game pictures" above for showing the real item.
- Fonts load from Google Fonts; everything else is self-contained.
