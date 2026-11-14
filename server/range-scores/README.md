# Range scores

The shared leaderboard for the museum's shooting range.

## What this is

The museum is a set of files on GitHub Pages. It can show things, but it cannot remember anything, so it has nowhere to keep a leaderboard. This folder holds a very small program (Cloudflare calls it a "Worker") that runs on Cloudflare's free plan and keeps the scores in a small database there.

The museum talks to it three times: when a round starts, when a signed-in visitor saves a score, and when the leaderboard is shown. Visitors sign in with Twitch so a score carries a real name and picture.

The same Worker can also keep the museum's sub wall: the channel's current subscribers and its bits board. That part is optional and has its own section, [Sub wall](#sub-wall), further down.

| File | What it is |
|---|---|
| `worker.js` | The program itself |
| `schema.sql` | The tables it needs |
| `wrangler.toml` | Its settings |
| `test.mjs` | A self-check you can run on your own computer |

Two more files belong to this feature but live with the site: `auth.html` (the page Twitch sends the sign-in window back to) and `js/range/` (the code that talks to Twitch and to this Worker).

## What it stores

One row per person who saves a score:

- their Twitch user id (a number), their Twitch name, and the address of their profile picture
- their best round: score, kills, headshots, long-range kills, shots, hits, the weapon, and when

All of that is either already public on their Twitch profile or is the score itself.

It also keeps the random number of each round that was saved, for one day, so the same round cannot be saved twice. Those numbers are not linked to anyone.

It does **not** store an email address, and it does **not** store a visitor's Twitch sign-in pass (the "token"). The pass arrives with a score, is used on the spot to ask Twitch "who is this?", and is then forgotten. It is never written to the database, to a log, or into an answer. No extra Twitch permissions are asked of visitors: the sign-in only tells the museum who the visitor is.

The sub wall is the one exception, and it concerns only the channel's owner: if you connect your channel, the Worker keeps what Twitch gives it for that connection. See [What is published and what is not](#what-is-published-and-what-is-not).

## Setting it up

You need Node.js (you have it if `node --version` prints a number), a Twitch account with two-factor sign-in turned on (Twitch requires that before it lets you register an application), and about fifteen minutes.

### 1. Register the application at Twitch

1. Open https://dev.twitch.tv/console, log in, and choose **Register Your Application**.
2. **Name**: anything you like, for example `Skin Museum Range`. Twitch refuses names that are taken or that contain the word "Twitch".
3. **OAuth Redirect URLs**: add these two, exactly as written, including `auth.html`:
   - `https://bullkn0x.github.io/skin-museum/auth.html` (the published site; change it if your site lives at another address)
   - `http://localhost:4175/auth.html` and `http://localhost:4174/auth.html` (for testing on your own computer: the two ports the previews use)
4. **Category**: Website Integration.
5. **Client Type**: Public is fine for the scores alone: the site never uses a client secret. If you also want the [sub wall](#sub-wall), choose Confidential instead, because the sub wall needs a client secret and Twitch only gives one to a Confidential application.
6. Create it, open **Manage**, and copy the **Client ID**. It is not a secret.

### 2. Put the score keeper on Cloudflare

Open a terminal in this folder (`cd server/range-scores`) and run the commands from here.

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. Connect the command line to it. A browser window opens; allow it.
   ```
   npx wrangler login
   ```
3. Create the database.
   ```
   npx wrangler d1 create range-scores
   ```
   It prints a `database_id`. Paste it into `wrangler.toml` in place of `PASTE-THE-DATABASE-ID-HERE`. If it offers to add the database to the settings file for you, say no: the entry is already there.
4. Create the tables.
   ```
   npx wrangler d1 execute range-scores --remote --file=schema.sql
   ```
5. In `wrangler.toml`, paste the Twitch Client ID in place of `PASTE-THE-TWITCH-CLIENT-ID-HERE`, and check that `ALLOWED_ORIGINS` names your site. Only the part up to the first slash counts, so `https://bullkn0x.github.io` covers the whole museum.
6. Set the two secrets. Each should be a long random string; this prints one:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Run it twice, then give one string to each of these when they ask:
   ```
   npx wrangler secret put TICKET_SECRET
   npx wrangler secret put ADMIN_KEY
   ```
   If it says there is no Worker with that name yet and asks whether to create one, say yes. Keep a copy of the `ADMIN_KEY` somewhere safe (a password manager): you need it to delete an entry. You never need the `TICKET_SECRET` again.
7. Publish it.
   ```
   npx wrangler deploy
   ```
   It prints the Worker's address, something like `https://range-scores.your-name.workers.dev`. The first time, it may ask you to pick the `your-name` part.
8. Check it. Open that address with `/top` on the end in a browser. You should see `{"entries":[]}`.

Never write the two secrets into a file in this repository. Everything in this folder is published along with the site, which is fine as long as the secrets stay out of it.

### 3. Tell the museum

Add this to `data/club.json`, with your two values:

```json
"range": {
  "twitchClientId": "the Client ID from step 1",
  "scoreApi": "https://range-scores.your-name.workers.dev"
}
```

Then publish the site as usual. `auth.html` in the site's top folder has to be published with it, or the Twitch window will have nowhere to come back to.

If you leave both values empty, the range still works: each device simply remembers its own best score and there is no shared leaderboard.

### Testing on your own computer

Twitch only sends people back to the addresses you registered, and the Worker only answers the sites on its list. Both are set up for ports 4175 and 4174, so serve the site on one of them:

```
python scripts/serve.py 4175 .
```

If you use another port, add it in both places: the redirect URLs at Twitch, and `ALLOWED_ORIGINS` in `wrangler.toml` (then run `npx wrangler deploy` again).

## Removing an entry

Entries are removed by Twitch user id, which is a number, not the name. To see the ids of the top twenty:

```
npx wrangler d1 execute range-scores --remote --command "SELECT user_id, login, name, score FROM scores ORDER BY score DESC LIMIT 20"
```

Then delete the one you want (put in your Worker's address, the id, and your admin key):

```
curl.exe -X DELETE "https://range-scores.your-name.workers.dev/entry/123456789" -H "Authorization: Bearer YOUR-ADMIN-KEY"
```

It answers `{"removed":"123456789"}`. On a Mac or Linux the command is `curl` instead of `curl.exe`.

This removes the row; it does not ban the person. They can play again and save a new score.

To empty the whole board, for example after testing:

```
npx wrangler d1 execute range-scores --remote --command "DELETE FROM scores"
```

## Sub wall

A wall in the museum that shows who subscribes to the channel right now, grouped by tier, and the channel's all-time bits board.

Twitch tells those two things only to the channel's owner. So you connect your channel to this Worker once. From then on the Worker asks Twitch every five minutes on your behalf and keeps a short public list at `/subs`, which is what the museum reads.

None of this is needed for the scores. If you never connect the channel, `/subs` answers with an empty wall and the five-minute timer finds nothing to do.

### Setting up the sub wall

Do [Setting it up](#setting-it-up) first. Then, with a terminal open in this folder:

1. **Get a client secret for the Twitch application.** At https://dev.twitch.tv/console open the application's **Manage** page, press **New Secret** and copy what it shows. Treat it like a password.
   A secret only exists for an application whose Client Type is Confidential. If yours was registered as Public and the page offers no secret, register a new application as Confidential with the same redirect URLs, then put its Client ID in `wrangler.toml` and in `data/club.json`. Visitors who were signed in will be asked to sign in once more.
2. **Add one more OAuth Redirect URL** to the application: your Worker's address with `/connect/callback` on the end, for example
   `https://range-scores.your-name.workers.dev/connect/callback`
   It has to match exactly: `https`, no slash at the end.
3. **Create the new tables.** This is the same command as before. It is safe to run again and leaves the scores alone.
   ```
   npx wrangler d1 execute range-scores --remote --file=schema.sql
   ```
4. **Give the Worker the secret.** Paste it when asked. Never write it into a file in this repository.
   ```
   npx wrangler secret put TWITCH_CLIENT_SECRET
   ```
5. **Check the settings** in `wrangler.toml` (the table below). `BROADCASTER_LOGIN` has to be your channel.
6. **Publish.**
   ```
   npx wrangler deploy
   ```
7. **Connect the channel.** In a browser where you are logged in to Twitch as the channel's own account, open your Worker's address with `/connect` on the end. Twitch asks whether the application may see the channel's subscribers and its bits information. Say yes, and you land on a page that reads "The channel bullkn0xcs is connected. 12 subs were found."
8. **Check it.** Open the Worker's address with `/subs` on the end.

You connect once. After that the timer keeps the wall up to date by itself.

| Setting | Where it lives | What it is |
|---|---|---|
| `TWITCH_CLIENT_ID` | `wrangler.toml` | The application's Client ID. The same one the scores use. |
| `TWITCH_CLIENT_SECRET` | secret (`npx wrangler secret put`) | The application's Client Secret. Only the sub wall uses it. |
| `BROADCASTER_LOGIN` | `wrangler.toml` | The channel, written as in its address: `bullkn0xcs` for twitch.tv/bullkn0xcs. Capital letters do not matter. Only this Twitch account can connect the wall. |
| `SUBS_HIDE` | `wrangler.toml`, optional | Accounts that must never appear among the subscribers or on the bits board, as logins separated by commas: `nightbot,some_viewer`. For bots, and for anyone who asks to be left off. |
| `SUBS_GIFTED` | `wrangler.toml`, optional | `"0"` leaves out people whose sub was a gift from someone else. Anything else, or nothing, shows them like every other subscriber. |
| `TICKET_SECRET` | secret, already set for the scores | Also signs the link that `/connect` sends to Twitch and back, so nothing new to do. |

After changing a setting in `wrangler.toml`, run `npx wrangler deploy` again. The wall follows at the next refresh, within five minutes.

Anyone can open `/connect`, but that gets a stranger nowhere: Twitch tells the Worker whose account said yes, and unless it is `BROADCASTER_LOGIN` the Worker answers "Only the Twitch account bullkn0xcs can connect this wall" and stores nothing.

### What `/subs` answers

```json
{
  "updated": "2026-11-13T22:00:00Z",
  "channel": "bullkn0xcs",
  "subs": [
    { "id": "123", "name": "NovaKat", "tier": 3, "avatar": "https://...", "since": "2026-11-01T00:00:00Z" }
  ],
  "bits": {
    "period": "all",
    "leaders": [
      { "id": "9", "name": "ghostpepper77", "avatar": "https://...", "rank": 1, "score": 48200 }
    ]
  }
}
```

- `updated` is when the list was last brought up to date. It is `null` until the first time, and the two lists are empty.
- `subs` is in the order people were first seen, earliest first.
- `tier` is 1, 2 or 3.
- `since` is when **this Worker** first saw that person at that tier. Twitch's list does not say when a sub started, so everyone who is subscribed on the day you connect gets that day. Someone who changes tier gets a new date at the new tier. Someone who stops and later comes back starts over.
- `avatar` is empty (`""`) when Twitch has no picture to give, for example for an account that was closed.
- `bits.leaders` is the top ten of all time, as Twitch ranks them. `score` is the number of bits.
- Names are text chosen by the people themselves. The museum must show them as plain text, never as HTML.

Only the museum's own pages (the sites in `ALLOWED_ORIGINS`) can read `/subs` from a browser, the same as the leaderboard. Browsers may keep an answer for 30 seconds, so a new sub shows up within about five and a half minutes.

### What is published and what is not

Who subscribes to a channel is something only its owner can normally see. The wall makes part of it public, so here is exactly which part.

Published at `/subs`, for each current subscriber: their Twitch user id (a number), the name as they write it, the tier, the address of their profile picture, and the date described above. For each of the ten bits leaders: user id, name, picture, rank and number of bits. And the channel's login.

Not published, and not kept either: whether a sub was a gift, who paid for a gift, the name of the plan, subscriber counts or points, anyone's email address. The Worker reads what Twitch sends, keeps the few things listed above, and drops the rest.

Not on the wall at all: the channel's own account (Twitch lists it as a subscriber of itself), anyone in `SUBS_HIDE`, and gifted subs if `SUBS_GIFTED` is `"0"`. `SUBS_HIDE` covers the bits board as well: someone hidden is left off it and the places below move up.

Kept but never published: one "refresh token". It is what Twitch hands over when you connect, and what the Worker shows Twitch every five minutes to be let in again. It sits in the database on your Cloudflare account (table `sub_grant`), not in any file, and is only ever sent to Twitch. It is not written to a log or into an answer. It carries only the two permissions asked for at `/connect`: reading the channel's subscribers and reading its bits information. The short-lived pass it is traded for is used for one refresh and then forgotten.

### Disconnecting

At Twitch, open **Settings**, then **Connections**, find the application under the other connections and choose **Disconnect**. That cancels the refresh token for good.

At its next refresh the Worker is refused, makes a note of it, and stops asking Twitch. The wall keeps showing the last list it had. To empty the wall as well:

```
npx wrangler d1 execute range-scores --remote --command "DELETE FROM sub_snapshot; DELETE FROM sub_wall; DELETE FROM sub_grant"
```

To connect again later, open `/connect` again. You also have to do that after anything else that makes Twitch cancel the connection, such as changing your Twitch password.

Deleting the tables' contents as above also forgets every `since` date. People still subscribed when you reconnect get the day of the reconnection.

### If the wall stops changing

Look at `updated` in `/subs`. If it is more than ten minutes or so in the past, the refreshes are not getting through.

- Run `npx wrangler tail` and wait for the next five-minute mark. A failed refresh says why, on a line starting `sub wall not refreshed:`.
- If Twitch has refused the connection, that is said once and then the Worker goes quiet. This shows whether that happened (a number under `refused_at` means yes); the cure is to open `/connect` again:
  ```
  npx wrangler d1 execute range-scores --remote --command "SELECT broadcaster_id, refused_at, at FROM sub_grant"
  ```
- If Twitch is merely having trouble, nothing is lost: when the subscriber list cannot be read all the way through, the Worker changes nothing and tries again five minutes later. If only the bits board or the pictures fail, the subscribers are still brought up to date and the board or pictures stay as they were.

### Limits

- The wall is built for a channel with up to a couple of thousand subscribers. Each refresh asks Twitch once per hundred subscribers for the list and once per hundred for the pictures, and Cloudflare's free plan caps how many such calls one run may make (believed to be 50; not checked). Past that the refresh fails as a whole and the wall simply stays as it was.
- The list is cut off after 200 pages (20,000 subscribers). In that case people are added but nobody is removed, since the Worker cannot tell who is missing.
- If Twitch ever answered with a complete but wrongly empty list, everyone would be taken off and would get a new `since` date when they reappeared. The Worker cannot tell that case from everybody really having left.

### What was not tried against real Twitch

All of the sub wall was written from Twitch's documentation and checked only against the stand-in in `test.mjs`. Nothing here has talked to Twitch or been run on Cloudflare yet. The first real `/connect` is the first real test. In particular, these are untried:

- The whole connect trip: Twitch's permission page, the way back to `/connect/callback`, and trading the code for tokens.
- That an application registered as Public has no client secret and has to be replaced by a Confidential one, and that a Confidential one still works for the visitors' sign-in on the site.
- How Twitch ends the subscriber list. The Worker stops when Twitch names no next page, and also when a page comes back empty.
- That Twitch answers a cancelled connection with 400 or 401. Those two are what the Worker takes to mean "connect again"; anything else is treated as passing trouble and retried.
- Whether Twitch hands out a new refresh token at each refresh. The Worker stores a new one whenever it gets one.
- That Twitch writes the tiers as `1000`, `2000` and `3000` for every kind of sub, Prime included. A tier the Worker does not recognise is shown as tier 1.
- The exact wording of the bits board, and that `period=all` with `count=10` gives the all-time top ten.
- The database steps that use SQLite's JSON functions, on Cloudflare's D1. The test runs them on Node's own SQLite.
- The five-minute timer, and the free plan's limits mentioned above.

## Changing something later

- After editing `worker.js` or `wrangler.toml`, run `npx wrangler deploy` again.
- After a change to `schema.sql`, run the `npx wrangler d1 execute range-scores --remote --file=schema.sql` line again. It only adds what is missing.
- To change a secret, run its `npx wrangler secret put ...` line again.
- To watch requests arrive while you test, run `npx wrangler tail`.
- The self-check needs nothing installed besides Node 22 or newer. From the top folder of the repository:
  ```
  node server/range-scores/test.mjs
  ```

## The honest limit

The game runs in the visitor's browser, and a browser can be made to say anything. The Worker cannot watch the round; it can only check that what it is told is believable. It checks that:

- the round was opened here first, with a signed ticket that cannot be made up
- at least 175 seconds and at most 20 minutes passed between opening the round and saving it
- each round is saved only once
- the Twitch sign-in is real and was made for this site
- the numbers are possible (no more headshots than kills, no more hits than shots, and so on, with a ceiling of 600 kills)
- the score is worked out on the server from those numbers, not taken from the page

That stops casual tampering: editing a number in the browser's tools, replaying a request, or sending a score without waiting out a round. It does not stop a determined cheat who writes a script that waits three minutes and sends numbers that look real. The highest score the server will ever accept is 105,000. If an entry looks impossible, delete it.

One more thing to know: the weapon name on an entry is text sent by the player's browser. The museum must show it as plain text, never as HTML.
