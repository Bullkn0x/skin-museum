// Score keeper for the museum's shooting range. The site itself is only files on GitHub Pages
// and cannot remember anything, so this small Cloudflare Worker keeps the leaderboard: one best
// score per Twitch account, in a D1 database.
//
// The game runs in the visitor's browser, so nothing it sends can be fully trusted. The checks
// here stop casual tampering: a round has to be opened here first, it cannot be handed in sooner
// than a real round lasts or more than once, the numbers have to add up, and the score is worked
// out here instead of being taken from the page. Someone determined can still cheat; the owner
// can remove their entry.
//
// It also keeps the museum's sub wall: the channel's current subscribers and its bits board.
// Twitch only tells those to the channel's owner, so the owner connects the channel here once
// and this Worker then asks Twitch on a timer and hands the museum a short public list. That
// part starts at "The sub wall" further down.

const MIN_ROUND_MS = 175 * 1000;            // anything handed in sooner did not come from a full round
const MAX_ROUND_MS = 20 * 60 * 1000;        // time to sign in after the round, but not to come back tomorrow
const KEEP_USED_MS = 24 * 60 * 60 * 1000;   // tickets stop working after twenty minutes, so a day of memory is plenty

const CONNECT_STATE_MS = 10 * 60 * 1000;    // how long the owner has to say yes on Twitch's page
const SUBS_A_PAGE = 100;                    // the most Twitch gives in one answer
const MAX_SUB_PAGES = 200;                  // a list longer than this (20,000 subs) is treated as unfinished
const WALL_SCOPES = 'channel:read:subscriptions bits:read';
const WALL_CACHE = 'public, max-age=30';

// Every call to Twitch goes through here, so the test can swap in a stand-in.
export const net = { fetch: (...a) => fetch(...a) };

// Thrown from anywhere below to stop and answer with a plain message.
class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function refuse(status, message) { throw new Refusal(status, message); }

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const known = origin !== null && siteOrigins(env).includes(origin);
    let res;
    try {
      // A request that names no site did not come from a web page (the owner's command line, for
      // one), so the browser rules below have nothing to say about it. The /connect addresses
      // are opened in a browser tab, on the way to Twitch's page and back from it. They have
      // their own checks, and should a browser name Twitch as the site there, that is no reason
      // to turn the owner away.
      const inOwnTab = /^\/connect(\/|$)/.test(new URL(request.url).pathname);
      if (origin !== null && !known && !inOwnTab) refuse(403, 'This site may not use the score server.');
      res = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env);
    } catch (err) {
      if (err instanceof Refusal) res = json({ error: err.message }, err.status);
      else {
        console.error('range-scores failed:', err && err.message);
        res = json({ error: 'The score server hit a problem. Try again in a moment.' }, 500);
      }
    }
    res.headers.set('Vary', 'Origin');
    if (known) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.headers.set('Access-Control-Max-Age', '86400');
    }
    return res;
  },

  // The timer set in wrangler.toml: bring the sub wall up to date. Nobody is waiting for an
  // answer, so a problem is only noted in the log (npx wrangler tail) and the next run tries again.
  async scheduled(event, env) {
    try {
      const done = await refreshSubWall(env);
      if (!done.ok && !done.quiet) console.warn('sub wall not refreshed:', done.why);
    } catch (err) {
      console.error('sub wall refresh failed:', err && err.message);
    }
  },
};

function route(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const method = request.method;
  const wrong = () => refuse(405, 'This address does not take that kind of request.');
  if (path === '/round') return method === 'POST' ? openRound(env) : wrong();
  if (path === '/score') return method === 'POST' ? saveScore(request, env) : wrong();
  if (path === '/top') return method === 'GET' ? topScores(request, env) : wrong();
  if (path.startsWith('/entry/')) return method === 'DELETE' ? removeEntry(request, env, path.slice('/entry/'.length)) : wrong();
  if (path === '/subs') return method === 'GET' ? subWall(env) : wrong();
  if (path === '/connect') return method === 'GET' ? inTab(() => connectStart(request, env)) : wrong();
  if (path === '/connect/callback') return method === 'GET' ? inTab(() => connectFinish(request, env)) : wrong();
  return refuse(404, 'There is nothing at this address.');
}

// The owner lists the sites that may use this Worker. A full page address is accepted as well
// (https://name.github.io/museum/): a browser only ever sends the part before the first slash.
function siteOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((entry) => {
    try { return new URL(entry.trim()).origin; } catch { return ''; }
  }).filter(Boolean);
}

function setting(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value) refuse(500, 'The score server is not fully set up yet.');
  return value;
}

function bearer(request) {
  const found = /^Bearer\s+(\S{1,400})$/i.exec(request.headers.get('Authorization') || '');
  return found ? found[1] : '';
}

// A ticket is a note saying "a round was opened at this moment", signed with a secret only this
// Worker knows. Nothing is stored when one is handed out; the signature is what proves it is ours.
// The sub wall uses the same kind of note when the owner connects the channel. Those carry a
// "use" so that neither kind can stand in for the other: anyone can ask for a round ticket.

const enc = new TextEncoder();
const toB64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function signingKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeTicket(secret, now, use) {
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const note = toB64url(enc.encode(JSON.stringify(use ? { id, t: now, use } : { id, t: now })));
  const seal = await crypto.subtle.sign('HMAC', await signingKey(secret), enc.encode(note));
  return note + '.' + toB64url(new Uint8Array(seal));
}

// Gives back { id, t } for a ticket this Worker signed for that use (none, for a round), or
// null for anything else.
async function readTicket(secret, ticket, use) {
  if (typeof ticket !== 'string' || ticket.length > 400) return null;
  const [note, seal, more] = ticket.split('.');
  if (!note || !seal || more !== undefined) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await signingKey(secret), fromB64url(seal), enc.encode(note)))) return null;
    const { id, t, use: madeFor } = JSON.parse(new TextDecoder().decode(fromB64url(note)));
    return /^[0-9a-f]{32}$/.test(id) && Number.isSafeInteger(t) && madeFor === use ? { id, t } : null;
  } catch {
    return null;   // not even shaped like a ticket
  }
}

async function openRound(env) {
  return json({ ticket: await makeTicket(setting(env, 'TICKET_SECRET'), Date.now()) });
}

async function saveScore(request, env) {
  const now = Date.now();
  const body = await readBody(request);

  const ticket = await readTicket(setting(env, 'TICKET_SECRET'), body.ticket);
  if (!ticket) refuse(403, 'That round ticket is not valid.');
  const age = now - ticket.t;
  if (age < MIN_ROUND_MS) refuse(400, 'That round is not over yet, so it cannot be saved.');
  if (age > MAX_ROUND_MS) refuse(400, 'That round was too long ago to save. Play another one.');
  const used = await env.DB.prepare('SELECT id FROM used_tickets WHERE id = ?').bind(ticket.id).first();
  if (used) refuse(409, 'That round has already been saved.');

  const token = bearer(request);
  if (!token) refuse(401, 'Sign in with Twitch to save a score.');
  const run = readRun(body);
  const who = await twitchUser(token, env);
  const score = 100 * run.kills + 50 * run.headshots + 25 * run.far;

  // The ticket is only spent now, after everything else has passed, so a player whose sign-in
  // had run out can sign in again and still save the round. "OR IGNORE" settles the case of the
  // same ticket arriving twice at once: only one of the two gets a row back.
  const [, spent] = await env.DB.batch([
    env.DB.prepare('DELETE FROM used_tickets WHERE at < ?').bind(now - KEEP_USED_MS),
    env.DB.prepare('INSERT OR IGNORE INTO used_tickets (id, at) VALUES (?, ?) RETURNING id').bind(ticket.id, now),
  ]);
  if (!spent.results.length) refuse(409, 'That round has already been saved.');

  // One row per Twitch account. The round's numbers only go in when they beat what is stored;
  // the name and picture are refreshed either way, since people change them.
  const [written, , kept] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO scores (user_id, login, name, avatar, score, kills, headshots, far, shots, hits, weapon, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         score = excluded.score, kills = excluded.kills, headshots = excluded.headshots, far = excluded.far,
         shots = excluded.shots, hits = excluded.hits, weapon = excluded.weapon, at = excluded.at
       WHERE excluded.score > scores.score
       RETURNING score`
    ).bind(who.id, who.login, who.name, who.avatar, score, run.kills, run.headshots, run.far, run.shots, run.hits, run.weapon, now),
    env.DB.prepare('UPDATE scores SET login = ?, name = ?, avatar = ? WHERE user_id = ?').bind(who.login, who.name, who.avatar, who.id),
    env.DB.prepare('SELECT score, at FROM scores WHERE user_id = ?').bind(who.id),
  ]);
  const best = kept.results[0];

  // place on the board: everyone with more points, or the same points reached earlier, is ahead
  const ahead = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE score > ? OR (score = ? AND (at < ? OR (at = ? AND user_id < ?)))'
  ).bind(best.score, best.score, best.at, best.at, who.id).first('n');

  return json({ score, best: best.score, rank: ahead + 1, improved: written.results.length > 0 });
}

async function topScores(request, env) {
  const asked = parseInt(new URL(request.url).searchParams.get('limit'), 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(asked) ? asked : 10));
  const { results } = await env.DB.prepare(
    'SELECT login, name, avatar, score, kills, headshots, weapon, at FROM scores ORDER BY score DESC, at ASC, user_id ASC LIMIT ?'
  ).bind(limit).all();
  const entries = results.map((row, i) => ({
    rank: i + 1, name: row.name, login: row.login, avatar: row.avatar,
    score: row.score, kills: row.kills, headshots: row.headshots, weapon: row.weapon, at: row.at,
  }));
  return json({ entries }, 200, { 'Cache-Control': 'max-age=15' });
}

// For the owner: take a cheater's row off the board.
async function removeEntry(request, env, id) {
  const key = bearer(request);
  if (!env.ADMIN_KEY || !key || !(await same(key, String(env.ADMIN_KEY)))) refuse(401, 'The admin key is missing or wrong.');
  if (!/^\d{1,20}$/.test(id)) refuse(400, 'That is not a Twitch user id. It is the number, not the name.');
  const gone = await env.DB.prepare('DELETE FROM scores WHERE user_id = ? RETURNING user_id').bind(id).first();
  if (!gone) refuse(404, 'There is no entry for that Twitch user id.');
  return json({ removed: id });
}

async function readBody(request) {
  let body = null;
  try {
    const text = await request.text();
    if (text.length <= 2000) body = JSON.parse(text);
  } catch { /* answered just below */ }
  if (!body || typeof body !== 'object' || Array.isArray(body)) refuse(400, 'The request could not be read.');
  return body;
}

// The round's numbers have to be whole, within what a round allows, and agree with each other:
// no more headshots than kills, no more hits than shots, and at least one hit for every kill.
function readRun(body) {
  const run = {};
  for (const key of ['kills', 'headshots', 'far', 'shots', 'hits']) {
    if (!Number.isSafeInteger(body[key]) || body[key] < 0) refuse(400, 'Those round numbers do not look right.');
    run[key] = body[key];
  }
  const { kills, headshots, far, shots, hits } = run;
  if (kills > 600 || shots > 6000 || headshots > kills || far > kills || hits > shots || hits < kills) {
    refuse(400, 'Those round numbers do not add up.');
  }
  if (typeof body.weapon !== 'string' || body.weapon.length > 80) refuse(400, 'The weapon name is missing or too long.');
  run.weapon = body.weapon.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return run;
}

// Ask Twitch who the pass belongs to. The pass is only ever sent to Twitch: it is not stored,
// logged or repeated in an answer.
async function twitchUser(token, env) {
  const clientId = setting(env, 'TWITCH_CLIENT_ID');

  const check = await askTwitch('https://id.twitch.tv/oauth2/validate', { Authorization: 'OAuth ' + token });
  if (check.status === 401) refuse(401, 'Your Twitch sign-in has run out. Sign in again.');
  if (!check.ok || !check.data) refuse(502, 'Twitch did not answer. Try again in a moment.');
  // a pass handed out to some other site's visitors must not work here
  if (check.data.client_id !== clientId) refuse(403, 'That Twitch sign-in was made for a different site.');
  if (!check.data.user_id || !check.data.login) refuse(401, 'That Twitch sign-in does not belong to a person.');
  const id = String(check.data.user_id);

  const asked = await askTwitch('https://api.twitch.tv/helix/users', { Authorization: 'Bearer ' + token, 'Client-Id': clientId });
  if (asked.status === 401) refuse(401, 'Your Twitch sign-in has run out. Sign in again.');
  const profile = asked.ok && asked.data && Array.isArray(asked.data.data) ? asked.data.data[0] : null;
  if (!profile || String(profile.id) !== id) refuse(502, 'Twitch did not answer. Try again in a moment.');

  const login = String(check.data.login).slice(0, 60);
  const avatar = typeof profile.profile_image_url === 'string' && profile.profile_image_url.startsWith('https://') ? profile.profile_image_url.slice(0, 400) : '';
  return { id, login, name: String(profile.display_name || login).slice(0, 60), avatar };
}

// With a third argument the question is sent as a filled-in form, which is how Twitch's sign-in
// desk wants to be asked for a pass.
async function askTwitch(url, headers, form) {
  const how = form
    ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }
    : { headers };
  let res;
  try { res = await net.fetch(url, how); } catch { refuse(502, 'Could not reach Twitch. Try again in a moment.'); }
  let data = null;
  try { data = await res.json(); } catch { /* not the answer we expected: treated as no answer */ }
  return { ok: res.ok, status: res.status, data };
}

// The same for the sub wall's timer, where nobody is waiting to be told: a call that could not
// get through is simply one that did not work.
async function tryTwitch(url, headers, form) {
  try {
    return await askTwitch(url, headers, form);
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, status: 0, data: null };
    throw err;
  }
}

// Compares two strings without giving away, through how long it takes, how much of a guess was right.
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))));
  let differ = 0;
  for (let i = 0; i < x.length; i++) differ |= x[i] ^ y[i];
  return differ === 0;
}

// The sub wall.
//
// /subs is what the museum reads. /connect and /connect/callback are for the owner, once, to
// let this Worker ask Twitch about the channel. refreshSubWall is the work the timer does.
//
// What Twitch gives the owner in return (a "refresh token") is kept in the database and is only
// ever sent back to Twitch. The short-lived pass it is traded for is used for one run and then
// forgotten. Neither is logged or repeated in an answer.

const channelLogin = (env) => String(env.BROADCASTER_LOGIN || '').trim().toLowerCase();
const callbackAddress = (request) => new URL(request.url).origin + '/connect/callback';
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const shown = (text) => String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
const twitchId = (value) => (/^\d{1,20}$/.test(String(value ?? '')) ? String(value) : '');

const GRANT_GONE = 'Twitch no longer accepts the channel\'s connection. Open /connect again.';

function emptyWall(env) {
  return { updated: null, channel: channelLogin(env), subs: [], bits: { period: 'all', leaders: [] } };
}

// The last list that was finished, exactly as it was written down. Before the first one there
// is an empty wall, not an error.
async function subWall(env) {
  const body = await env.DB.prepare('SELECT body FROM sub_snapshot WHERE id = 1').first('body');
  if (!body) return json(emptyWall(env), 200, { 'Cache-Control': WALL_CACHE });
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': WALL_CACHE } });
}

// The same list for the refresh to build on, checked first: it is only trusted to have the
// shape this file gave it.
async function lastWall(env) {
  const body = await env.DB.prepare('SELECT body FROM sub_snapshot WHERE id = 1').first('body');
  let kept = null;
  try { kept = JSON.parse(body); } catch { /* treated as no list */ }
  const fine = kept && Array.isArray(kept.subs) && kept.bits && Array.isArray(kept.bits.leaders);
  return fine ? kept : emptyWall(env);
}

// The two /connect addresses are opened by the owner in a browser tab, not by the museum's
// code, so a refusal there is written to be read: plain text instead of JSON.
async function inTab(work) {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    return new Response(err.message + '\n', { status: err.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}

function page(text) {
  const safe = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Sub wall</title><p>${safe}</p></html>\n`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

// Connecting, step one: send the owner to Twitch's own page, which asks whether this
// application may read the channel's subscribers and bits board. The "state" goes there and
// comes back with them. It is a ticket marked for this use and good for ten minutes, so the way
// back only opens for a visit that started here a moment ago.
async function connectStart(request, env) {
  setting(env, 'TWITCH_CLIENT_SECRET');   // no point in the trip if the way back cannot work
  setting(env, 'BROADCASTER_LOGIN');
  const ask = new URLSearchParams({
    response_type: 'code',
    client_id: setting(env, 'TWITCH_CLIENT_ID'),
    redirect_uri: callbackAddress(request),
    scope: WALL_SCOPES,
    state: await makeTicket(setting(env, 'TICKET_SECRET'), Date.now(), 'connect'),
    force_verify: 'true',                   // Twitch shows which account is signed in and lets the owner switch, instead of passing a wrong one straight through
  });
  return new Response(null, { status: 302, headers: { Location: 'https://id.twitch.tv/oauth2/authorize?' + ask, 'Cache-Control': 'no-store' } });
}

// Connecting, step two: Twitch sends the owner back here with a one-time code. It is traded
// for a pass, Twitch is asked whose pass that is, and unless it is the channel named in
// BROADCASTER_LOGIN everything is dropped on the spot. Anyone can open /connect; only the
// channel's owner gets past this point.
async function connectFinish(request, env) {
  const asked = new URL(request.url).searchParams;
  const clientId = setting(env, 'TWITCH_CLIENT_ID');
  const clientSecret = setting(env, 'TWITCH_CLIENT_SECRET');
  setting(env, 'BROADCASTER_LOGIN');
  const channel = channelLogin(env);

  const state = await readTicket(setting(env, 'TICKET_SECRET'), asked.get('state'), 'connect');
  if (!state || Math.abs(Date.now() - state.t) > CONNECT_STATE_MS) refuse(403, 'This link is not valid, or it has run out. Start again at /connect.');
  if (asked.get('error')) refuse(400, 'Twitch was not given permission, so nothing was connected.');
  const code = asked.get('code') || '';
  if (!code || code.length > 400) refuse(400, 'Twitch did not send a sign-in code. Start again at /connect.');

  const grant = await askTwitch('https://id.twitch.tv/oauth2/token', {}, {
    client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: callbackAddress(request),
  });
  const pass = grant.ok && grant.data && typeof grant.data.access_token === 'string' ? grant.data.access_token : '';
  const refresh = pass && typeof grant.data.refresh_token === 'string' ? grant.data.refresh_token : '';
  if (!pass || !refresh) {
    refuse(grant.status === 400 ? 400 : 502,
      `Twitch did not accept the sign-in (it answered ${grant.status}). Start again at /connect. If it keeps happening, check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.`);
  }

  const check = await askTwitch('https://id.twitch.tv/oauth2/validate', { Authorization: 'OAuth ' + pass });
  if (!check.ok || !check.data) refuse(502, 'Twitch did not answer. Start again at /connect.');
  const id = twitchId(check.data.user_id);
  if (check.data.client_id !== clientId || !id || String(check.data.login || '').toLowerCase() !== channel) {
    refuse(403, `Only the Twitch account ${channel} can connect this wall. You are signed in to Twitch as someone else, so nothing was saved.`);
  }

  await env.DB.prepare(
    `INSERT INTO sub_grant (id, broadcaster_id, refresh_token, refused_at, at) VALUES (1, ?, ?, NULL, ?)
     ON CONFLICT (id) DO UPDATE SET
       broadcaster_id = excluded.broadcaster_id, refresh_token = excluded.refresh_token, refused_at = NULL, at = excluded.at`
  ).bind(id, refresh, Date.now()).run();

  const done = await refreshSubWall(env, pass);
  return page(done.ok
    ? `The channel ${channel} is connected. ${done.subs === 1 ? '1 sub was' : done.subs + ' subs were'} found. You can close this tab.`
    : `The channel ${channel} is connected, but the first look at its subs did not work. ${done.why} It is tried again every five minutes. You can close this tab.`);
}

// Brings the wall up to date: who subscribes, the bits board, everyone's picture. The timer
// runs it every five minutes. Connecting runs it once as well and hands in the pass it was just
// given, which saves asking for another. It answers { ok: true, subs } or { ok: false, why }
// instead of stopping with an error, so one bad run never gets in the way of the next.
export async function refreshSubWall(env, pass) {
  const clientId = env.TWITCH_CLIENT_ID, clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, quiet: true, why: 'The sub wall is not set up.' };
  const now = Date.now();
  const grant = await env.DB.prepare('SELECT broadcaster_id, refresh_token, refused_at FROM sub_grant WHERE id = 1').first();
  if (!grant) return { ok: false, quiet: true, why: 'The channel is not connected.' };

  if (!pass) {
    // Once Twitch has refused the connection it stays refused until the owner connects again,
    // so there is no use in asking every five minutes.
    if (grant.refused_at) return { ok: false, quiet: true, why: GRANT_GONE };
    const fresh = await tryTwitch('https://id.twitch.tv/oauth2/token', {}, {
      grant_type: 'refresh_token', refresh_token: grant.refresh_token, client_id: clientId, client_secret: clientSecret,
    });
    // "AND refresh_token = ?" here and below: if the owner connected again while this run was
    // under way, the row now holds a newer token and this run's news is about the old one.
    if (fresh.status === 400 || fresh.status === 401) {
      await env.DB.prepare('UPDATE sub_grant SET refused_at = ? WHERE id = 1 AND refresh_token = ?').bind(now, grant.refresh_token).run();
      return { ok: false, why: GRANT_GONE };
    }
    pass = fresh.ok && fresh.data && typeof fresh.data.access_token === 'string' ? fresh.data.access_token : '';
    if (!pass) return { ok: false, why: 'Twitch did not hand out a pass.' };
    // Twitch may swap the refresh token for a new one at any time. The newest is the one to
    // keep, and it is written down before anything else can go wrong.
    const next = fresh.data.refresh_token;
    if (typeof next === 'string' && next && next !== grant.refresh_token) {
      await env.DB.prepare('UPDATE sub_grant SET refresh_token = ?, at = ? WHERE id = 1 AND refresh_token = ?').bind(next, now, grant.refresh_token).run();
    }
  }
  const headers = { Authorization: 'Bearer ' + pass, 'Client-Id': clientId };

  // Without the whole list there is no telling who has left, so nothing at all is changed.
  const listed = await listSubs(grant.broadcaster_id, headers);
  if (!listed) return { ok: false, why: 'Twitch did not give the whole list of subs, so the wall was left as it was.' };
  const subs = wallSubs(listed.rows, env, grant.broadcaster_id);

  // The bits board and the pictures are extras: when Twitch does not answer, the wall keeps
  // the ones it had.
  const before = await lastWall(env);
  const leaders = (await bitsLeaders(headers, env)) || before.bits.leaders.filter((who) => who && twitchId(who.id));
  const had = new Map([...before.subs, ...before.bits.leaders].filter(Boolean).map((who) => [who.id, typeof who.avatar === 'string' ? who.avatar : '']));
  const found = await avatarsOf([...new Set([...subs, ...leaders].map((who) => who.id))], headers);
  const avatar = (id) => found.get(id) ?? had.get(id) ?? '';

  // One step for the table of who is on the wall: everyone in the list goes in (see
  // KEEP_ON_WALL for what happens to someone already there), then whoever is not in the list
  // goes out, then the table is read back in the order the wall shows it. The list travels as
  // one piece of JSON so that a big channel costs no more database calls than a small one.
  const steps = [];
  for (let i = 0; i < subs.length; i += 500) steps.push(env.DB.prepare(KEEP_ON_WALL).bind(now, JSON.stringify(subs.slice(i, i + 500))));
  if (listed.whole) {
    steps.push(env.DB.prepare('DELETE FROM sub_wall WHERE user_id NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(subs.map((sub) => sub.id))));
  }
  steps.push(env.DB.prepare('SELECT user_id, tier, name, first_seen FROM sub_wall ORDER BY first_seen ASC, LENGTH(user_id) ASC, user_id ASC'));
  const onWall = (await env.DB.batch(steps)).pop().results;

  // Only what is listed here is published. Whether a sub was a gift, who paid for it and
  // everything else Twitch sent stays behind.
  const wall = {
    updated: stamp(now),
    channel: channelLogin(env),
    subs: onWall.map((row) => ({ id: row.user_id, name: row.name, tier: row.tier, avatar: avatar(row.user_id), since: stamp(row.first_seen) })),
    bits: {
      period: 'all',
      leaders: leaders.map((who) => ({ id: who.id, name: shown(who.name), avatar: avatar(who.id), rank: who.rank, score: who.score })),
    },
  };
  await env.DB.prepare(
    'INSERT INTO sub_snapshot (id, body, at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body, at = excluded.at'
  ).bind(JSON.stringify(wall), now).run();
  return { ok: true, subs: wall.subs.length };
}

// Someone new gets today as the day they were first seen. Someone already on the wall keeps
// their day and has their name brought up to date. Someone whose tier changed counts as new at
// the new tier. ("WHERE true" is only there because SQLite cannot otherwise tell where the
// SELECT ends and the ON CONFLICT begins.)
const KEEP_ON_WALL = `
  INSERT INTO sub_wall (user_id, tier, name, first_seen)
  SELECT json_extract(value, '$.id'), json_extract(value, '$.tier'), json_extract(value, '$.name'), ?
  FROM json_each(?) WHERE true
  ON CONFLICT (user_id) DO UPDATE SET
    name = excluded.name,
    first_seen = CASE WHEN sub_wall.tier = excluded.tier THEN sub_wall.first_seen ELSE excluded.first_seen END,
    tier = excluded.tier`;

// Twitch hands the list over a page at a time, each page saying where the next one starts.
// Gives back { rows, whole }, or null if any page could not be had. "whole" is false only when
// the list was still going after MAX_SUB_PAGES pages.
async function listSubs(broadcasterId, headers) {
  const rows = [];
  let cursor = '';
  for (let page = 0; page < MAX_SUB_PAGES; page++) {
    const ask = new URLSearchParams({ broadcaster_id: broadcasterId, first: String(SUBS_A_PAGE) });
    if (cursor) ask.set('after', cursor);
    const got = await tryTwitch('https://api.twitch.tv/helix/subscriptions?' + ask, headers);
    if (!got.ok || !got.data || !Array.isArray(got.data.data)) return null;
    rows.push(...got.data.data);
    const next = got.data.pagination && got.data.pagination.cursor;
    // the end: no next page named, or (Twitch has been known to do this) one more page that is empty
    if (typeof next !== 'string' || !next || next === cursor || !got.data.data.length) return { rows, whole: true };
    cursor = next;
  }
  return { rows, whole: false };
}

// Twitch's rows turned into the three things the wall keeps about a sub, minus the people who
// should not be on it: the channel itself (Twitch lists it as its own subscriber), anyone the
// owner has hidden, and, if the owner asked for that, people whose sub was a gift.
const hiddenLogins = (env) => new Set(String(env.SUBS_HIDE || '').split(',').map((login) => login.trim().toLowerCase()).filter(Boolean));

function wallSubs(rows, env, broadcasterId) {
  const hidden = hiddenLogins(env);
  const noGifts = String(env.SUBS_GIFTED ?? '').trim() === '0';
  const subs = new Map();
  for (const row of rows) {
    const id = row && twitchId(row.user_id);
    if (!id || id === broadcasterId || subs.has(id)) continue;
    if (hidden.has(String(row.user_login || '').toLowerCase())) continue;
    if (noGifts && row.is_gift === true) continue;
    const tier = Number(row.tier) / 1000;   // Twitch writes the tiers as "1000", "2000" and "3000"
    subs.set(id, { id, tier: tier === 2 || tier === 3 ? tier : 1, name: shown(row.user_name || row.user_login) });
  }
  return [...subs.values()];
}

// The ten people who have cheered the most bits, ever, without anyone the owner has hidden
// (someone who asks to be left off the wall is left off the board beside it too: a few more are
// asked for so that ten are still left). Null if Twitch did not answer.
async function bitsLeaders(headers, env) {
  const hidden = hiddenLogins(env);
  const got = await tryTwitch(`https://api.twitch.tv/helix/bits/leaderboard?count=${10 + Math.min(20, hidden.size)}&period=all`, headers);
  if (!got.ok || !got.data || !Array.isArray(got.data.data)) return null;
  const shownRows = got.data.data.filter((row) => row && twitchId(row.user_id) && !hidden.has(String(row.user_login || '').toLowerCase()));
  return shownRows.slice(0, 10).map((row, i) => ({
    id: twitchId(row.user_id),
    name: shown(row.user_name || row.user_login),
    rank: i + 1,                             // their place among those shown (Twitch's own numbering would skip anyone hidden)
    score: Number.isSafeInteger(row.score) ? row.score : 0,
  }));
}

// Profile pictures, asked for a hundred people at a time (the most Twitch takes in one
// question). Someone Twitch leaves out of its answer gets an empty picture. People in a
// question that failed are left out of what comes back, so the caller can keep what it had.
async function avatarsOf(ids, headers) {
  const found = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const group = ids.slice(i, i + 100);
    const got = await tryTwitch('https://api.twitch.tv/helix/users?' + group.map((id) => 'id=' + id).join('&'), headers);
    if (!got.ok || !got.data || !Array.isArray(got.data.data)) continue;
    for (const id of group) found.set(id, '');
    for (const user of got.data.data) {
      const id = user && twitchId(user.id);
      const picture = id && user.profile_image_url;
      if (found.has(id) && typeof picture === 'string' && picture.startsWith('https://')) found.set(id, picture.slice(0, 400));
    }
  }
  return found;
}
