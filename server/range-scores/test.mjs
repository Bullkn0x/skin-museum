// Checks the score keeper without Cloudflare or Twitch. Run it with:
//   node server/range-scores/test.mjs
//
// The worker's own code runs as it is. The database is a stand-in built on Node's own SQLite
// (Node 22 or newer), loaded with schema.sql, so every query is run for real. The calls to
// Twitch are swapped for a fake that knows a few made-up people and one made-up channel with
// its subscribers. Time is a clock the test moves. Nothing here ever reaches the real Twitch.

import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { net, refreshSubWall } from './worker.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const SITE = 'https://museum.example';
const WORKER = 'https://scores.example';
const CLIENT = 'the-museums-client-id';
const SECRET = 'a-test-secret-nobody-else-knows-0123456789';
const ADMIN = 'the-owners-admin-key';
const APP_SECRET = 'the-twitch-applications-client-secret';

// A stand-in for Cloudflare's D1, with only the calls the worker uses.

class FakeStatement {
  constructor(db, sql, values) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new FakeStatement(this.db, this.sql, values); }
  exec() {
    // D1 refuses a missing value instead of quietly storing nothing; do the same here
    for (const v of this.values) if (v === undefined) throw new TypeError('undefined is not a value D1 accepts');
    const st = this.db.prepare(this.sql);
    const givesRows = typeof st.columns === 'function' ? st.columns().length > 0 : /^\s*(select|with)\b|\breturning\b/i.test(this.sql);
    if (givesRows) return { success: true, results: st.all(...this.values).map((row) => ({ ...row })), meta: {} };
    const { changes, lastInsertRowid } = st.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) } };
  }
  async all() { return this.exec(); }
  async run() { return this.exec(); }
  async first(column) {
    const row = this.exec().results[0];
    if (!row) return null;
    return column ? row[column] : row;
  }
}

class FakeD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(SCHEMA); }
  prepare(sql) { return new FakeStatement(this.db, sql, []); }
  // like D1, a batch is all or nothing
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const out = statements.map((s) => s.exec());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  rows(sql, ...values) { return this.db.prepare(sql).all(...values).map((row) => ({ ...row })); }
}

// A stand-in for Twitch: it knows these people by their sign-in pass and nobody else.

const people = {
  'pass-of-ana': { client: CLIENT, id: '1001', login: 'ana', name: 'Ana', avatar: 'https://static-cdn.jtvnw.net/ana.png' },
  'pass-of-ben': { client: CLIENT, id: '1002', login: 'ben', name: 'Ben', avatar: 'https://static-cdn.jtvnw.net/ben.png' },
  'pass-of-cho': { client: CLIENT, id: '1003', login: 'cho', name: 'Cho', avatar: 'https://static-cdn.jtvnw.net/cho.png' },
  'pass-from-another-site': { client: 'someone-elses-client-id', id: '2001', login: 'mallory', name: 'Mallory', avatar: 'https://static-cdn.jtvnw.net/m.png' },
  'pass-of-no-person': { client: CLIENT, id: '', login: '', name: '', avatar: '' },
};
const twitch = { down: false, slow: false, calls: [], forms: [], unexpected: [] };

// The channel side of the stand-in, for the sub wall: the channel's owner, someone who is not
// the owner, and what Twitch would say about the channel. Every sub wall test starts from an
// empty channel (see wallEnv further down) and fills in what it needs.

const OWNER = { id: '7000', login: 'bullkn0xcs', name: 'BullKn0xCS' };
const STRANGER = { id: '7001', login: 'someone_else', name: 'Someone_Else' };
const SCOPES = ['bits:read', 'channel:read:subscriptions'];
const avatarOf = (id) => `https://static-cdn.jtvnw.net/user-${id}.png`;

const channel = {};
function freshChannel() {
  Object.assign(channel, {
    subs: [],                // the subscriber list, as Twitch words it
    leaders: [],             // the bits board, as Twitch words it
    unknown: new Set(),      // ids the user lookup leaves out of its answer
    codes: new Map(),        // one-time sign-in code -> the account that said yes
    passes: new Map(),       // short-lived pass -> account
    refreshers: new Map(),   // refresh token -> account
    rotate: false,           // hand out a new refresh token every time one is used
    tokenStatus: 0,          // make the sign-in desk answer everything with this status
    failSubsPage: 0,         // make this page of the subscriber list fail (1 is the first)
    brokenSubs: false,       // answer the subscriber list with something that is not a list
    cursorAlways: false,     // name a next page even on the last one; the page after is empty
    endless: false,          // a subscriber list that never ends
    failBits: false,
    failUsers: false,
    subsAsked: [],           // each question about the subscriber list
    userBatches: [],         // how many people each picture lookup asked about
  });
}
freshChannel();

const handedOut = [];   // every code, pass and refresh token the stand-in ever made up
function make(kind, who) {
  const value = `${kind}-${handedOut.length + 1}-for-${who.login}`;
  handedOut.push(value);
  return value;
}

const sub = (id, name, tier = '1000', more = {}) => ({
  broadcaster_id: OWNER.id, broadcaster_login: OWNER.login, broadcaster_name: OWNER.name,
  gifter_id: '', gifter_login: '', gifter_name: '', is_gift: false,
  plan_name: 'Channel Subscription (bullkn0xcs)', tier,
  user_id: id, user_name: name, user_login: name.toLowerCase(), ...more,
});
const gifted = { is_gift: true, gifter_id: '39990001', gifter_login: 'generous_gus', gifter_name: 'Generous_Gus' };
const leader = (id, name, rank, score) => ({ user_id: id, user_login: name.toLowerCase(), user_name: name, rank, score });
const cursorAt = (n) => 'eyJ+/=' + n;   // has the characters that go wrong when an address is put together carelessly

function channelSide(url, init, headers) {
  const at = new URL(url);
  const where = at.origin + at.pathname;
  const bad = (status, message) => Response.json({ status, message }, { status });

  if (where === 'https://id.twitch.tv/oauth2/token') {
    const form = new URLSearchParams(String(init.body));
    twitch.forms.push(Object.fromEntries(form));
    if (init.method !== 'POST' || !/^application\/x-www-form-urlencoded/.test(headers.get('Content-Type') || '')) return bad(400, 'missing form');
    if (channel.tokenStatus) return bad(channel.tokenStatus, 'the sign-in desk is having a day');
    if (form.get('client_id') !== CLIENT) return bad(400, 'invalid client');
    if (form.get('client_secret') !== APP_SECRET) return bad(403, 'invalid client secret');
    let who, refresh;
    if (form.get('grant_type') === 'authorization_code') {
      who = channel.codes.get(form.get('code'));
      channel.codes.delete(form.get('code'));   // a code works once
      if (!who || form.get('redirect_uri') !== WORKER + '/connect/callback') return bad(400, 'Invalid authorization code');
      refresh = make('refresh', who);
    } else if (form.get('grant_type') === 'refresh_token') {
      refresh = form.get('refresh_token');
      who = channel.refreshers.get(refresh);
      if (!who) return bad(400, 'Invalid refresh token');
      if (channel.rotate) {
        channel.refreshers.delete(refresh);
        refresh = make('refresh', who);
      }
    } else {
      return bad(400, 'unsupported grant type');
    }
    const access = make('access', who);
    channel.passes.set(access, who);
    channel.refreshers.set(refresh, who);
    return Response.json({ access_token: access, refresh_token: refresh, expires_in: 14000, scope: SCOPES, token_type: 'bearer' });
  }

  const who = channel.passes.get((/^Bearer (.+)$/.exec(headers.get('Authorization') || '') || [])[1]);
  const mayAsk = who && headers.get('Client-Id') === CLIENT;

  if (where === 'https://api.twitch.tv/helix/subscriptions') {
    const q = at.searchParams;
    channel.subsAsked.push({ first: q.get('first'), after: q.get('after') });
    // Twitch only tells a channel's own pass who subscribes to it
    if (!mayAsk || q.get('broadcaster_id') !== who.id) return bad(401, 'Invalid OAuth token');
    if (channel.subsAsked.length === channel.failSubsPage) return bad(500, 'Internal Server Error');
    if (channel.brokenSubs) return Response.json({ data: 'not a list' });
    const first = Number(q.get('first') || 20);
    const from = q.get('after') === null ? 0 : Number((/^eyJ\+\/=(\d+)$/.exec(q.get('after')) || [])[1]);
    if (!Number.isInteger(from) || first > 100) return bad(400, 'Bad Request');
    if (channel.endless) return Response.json({ data: [sub(String(80000 + from), 'Endless' + from)], pagination: { cursor: cursorAt(from + 1) } });
    const more = channel.cursorAlways || from + first < channel.subs.length;
    return Response.json({
      data: channel.subs.slice(from, from + first),
      pagination: more ? { cursor: cursorAt(from + first) } : {},
      total: channel.subs.length, points: channel.subs.length,
    });
  }
  if (where === 'https://api.twitch.tv/helix/bits/leaderboard') {
    if (!mayAsk) return bad(401, 'Invalid OAuth token');
    if (!/^\?count=([12]\d|30)&period=all$/.test(at.search)) return bad(400, 'Bad Request');
    if (channel.failBits) return bad(500, 'Internal Server Error');
    const few = channel.leaders.slice(0, Number(at.searchParams.get('count')));      // as Twitch does: no more than were asked for
    return Response.json({ data: few, date_range: { started_at: '', ended_at: '' }, total: few.length });
  }
  if (where === 'https://api.twitch.tv/helix/users' && at.search) {
    const ids = at.searchParams.getAll('id');
    channel.userBatches.push(ids.length);
    if (!mayAsk) return bad(401, 'Invalid OAuth token');
    if (ids.length > 100) return bad(400, 'The maximum number of ids is 100');
    if (channel.failUsers) return bad(500, 'Internal Server Error');
    return Response.json({
      data: ids.filter((id) => !channel.unknown.has(id)).map((id) => ({ id, login: 'user' + id, display_name: 'User' + id, profile_image_url: avatarOf(id) })),
    });
  }
  return null;
}

net.fetch = async (url, init = {}) => {
  const headers = new Headers(init.headers);
  twitch.calls.push({ url: String(url), auth: headers.get('Authorization'), clientId: headers.get('Client-Id') });
  if (twitch.down) throw new TypeError('fetch failed');
  if (twitch.slow) await new Promise((done) => setTimeout(done, 5));
  const no = () => Response.json({ status: 401, message: 'invalid access token' }, { status: 401 });
  if (url === 'https://id.twitch.tv/oauth2/validate') {
    const pass = (/^OAuth (.+)$/.exec(headers.get('Authorization') || '') || [])[1];
    const account = channel.passes.get(pass);
    if (account) return Response.json({ client_id: CLIENT, login: account.login, user_id: account.id, scopes: SCOPES, expires_in: 14000 });
    const p = people[pass];
    if (!p) return no();
    const answer = { client_id: p.client, scopes: [], expires_in: 5000000 };
    if (p.id) Object.assign(answer, { login: p.login, user_id: p.id });
    return Response.json(answer);
  }
  if (url === 'https://api.twitch.tv/helix/users') {
    const p = people[(/^Bearer (.+)$/.exec(headers.get('Authorization') || '') || [])[1]];
    if (!p || headers.get('Client-Id') !== p.client) return no();
    return Response.json({ data: [{ id: p.id, login: p.login, display_name: p.name, profile_image_url: p.avatar }] });
  }
  const answer = channelSide(String(url), init, headers);
  if (answer) return answer;
  // the worker treats a call that throws as "Twitch could not be reached", so this is also
  // written down and checked at the very end
  twitch.unexpected.push(String(url));
  throw new Error('the worker called an address the test did not expect: ' + url);
};

// The worker reads the time with Date.now(), so the test owns the clock.
let clock = 1800000000000;
Date.now = () => clock;
const wait = (ms) => { clock += ms; };
const SECOND = 1000, MINUTE = 60 * SECOND;

function freshEnv(extra = {}) {
  return { DB: new FakeD1(), TWITCH_CLIENT_ID: CLIENT, TICKET_SECRET: SECRET, ALLOWED_ORIGINS: `${SITE}/museum/, http://localhost:4174`, ADMIN_KEY: ADMIN, ...extra };
}

const answers = [];   // every answer the worker gave, to check at the end that no secret leaked

async function call(env, method, path, { origin = SITE, token, body, raw } = {}) {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const init = { method, headers };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.body = JSON.stringify(body); headers.set('Content-Type', 'application/json'); }
  const res = await worker.fetch(new Request(WORKER + path, init), env);
  const text = await res.text();
  answers.push(text + ' ' + JSON.stringify([...res.headers]));
  // the two /connect addresses answer a person in a browser tab, in words instead of JSON
  const isJson = (res.headers.get('Content-Type') || '').startsWith('application/json');
  return { status: res.status, headers: res.headers, text, data: text && isJson ? JSON.parse(text) : null };
}

// A ticket made the way the worker makes them, but dated in the past: this is how the test
// "waits" three minutes. Built with Node's own crypto, so it also checks the format.
function ticketAged(ms, { secret = SECRET, id = randomBytes(16).toString('hex') } = {}) {
  const note = Buffer.from(JSON.stringify({ id, t: clock - ms })).toString('base64url');
  return note + '.' + createHmac('sha256', secret).update(note).digest('base64url');
}

const round = (over = {}) => ({ ticket: ticketAged(3 * MINUTE), kills: 40, headshots: 15, far: 6, shots: 300, hits: 120, weapon: 'AK-47 | Fire Serpent', ...over });

// What the sub wall tests share.

// The same kind of note, marked the way /connect marks the "state" it sends to Twitch and back.
function stateAged(ms, { secret = SECRET } = {}) {
  const note = Buffer.from(JSON.stringify({ id: randomBytes(16).toString('hex'), t: clock - ms, use: 'connect' })).toString('base64url');
  return note + '.' + createHmac('sha256', secret).update(note).digest('base64url');
}

function wallEnv(extra = {}) {
  freshChannel();
  return freshEnv({ TWITCH_CLIENT_SECRET: APP_SECRET, BROADCASTER_LOGIN: OWNER.login, ...extra });
}

// Someone says yes on Twitch's page and is sent back to the worker with a one-time code.
async function comeBack(env, who, state) {
  const code = make('code', who);
  channel.codes.set(code, who);
  channel.subsAsked = [];
  channel.userBatches = [];
  return call(env, 'GET', '/connect/callback?' + new URLSearchParams(state === undefined ? { code } : { code, state }), { origin: null });
}

// The whole trip: open /connect, go where it sends you, come back.
async function connectAs(env, who = OWNER) {
  const start = await call(env, 'GET', '/connect', { origin: null });
  return comeBack(env, who, new URL(start.headers.get('Location')).searchParams.get('state'));
}

// One run of the five-minute timer. What it writes to the log is kept, to check at the end
// that no secret went there either.
const logged = [];
async function tick(env) {
  channel.subsAsked = [];
  channel.userBatches = [];
  const { warn, error } = console;
  console.warn = console.error = (...parts) => logged.push(parts.join(' '));
  try {
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: clock }, env, { waitUntil() {} });
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

const wall = async (env) => (await call(env, 'GET', '/subs')).data;
const wallText = async (env) => (await call(env, 'GET', '/subs')).text;
const wallRows = (env) => env.DB.rows('SELECT * FROM sub_wall ORDER BY user_id');
const grantOf = (env) => env.DB.rows('SELECT * FROM sub_grant')[0];
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const EMPTY_WALL = { updated: null, channel: 'bullkn0xcs', subs: [], bits: { period: 'all', leaders: [] } };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a good round from start to finish: ticket, score, leaderboard', async () => {
  const env = freshEnv();
  const opened = await call(env, 'POST', '/round');
  assert.equal(opened.status, 200);
  const [note, seal, more] = opened.data.ticket.split('.');
  assert.equal(more, undefined);
  const inside = JSON.parse(Buffer.from(note, 'base64url').toString());
  assert.match(inside.id, /^[0-9a-f]{32}$/);
  assert.equal(inside.t, clock);
  assert.equal(seal, createHmac('sha256', SECRET).update(note).digest('base64url'));

  wait(3 * MINUTE);   // the round is played
  const saved = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket: opened.data.ticket }) });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, { score: 100 * 40 + 50 * 15 + 25 * 6, best: 4900, rank: 1, improved: true });

  const top = await call(env, 'GET', '/top');
  assert.equal(top.status, 200);
  assert.equal(top.headers.get('Cache-Control'), 'max-age=15');
  assert.deepEqual(top.data, { entries: [{
    rank: 1, name: 'Ana', login: 'ana', avatar: 'https://static-cdn.jtvnw.net/ana.png',
    score: 4900, kills: 40, headshots: 15, weapon: 'AK-47 | Fire Serpent', at: clock,
  }] });

  // Twitch was asked the way its documentation says
  const [check, profile] = twitch.calls.slice(-2);
  assert.deepEqual(check, { url: 'https://id.twitch.tv/oauth2/validate', auth: 'OAuth pass-of-ana', clientId: null });
  assert.deepEqual(profile, { url: 'https://api.twitch.tv/helix/users', auth: 'Bearer pass-of-ana', clientId: CLIENT });
});

test('the score is worked out by the server, whatever the page claims', async () => {
  const env = freshEnv();
  const saved = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ score: 999999, kills: 1, headshots: 1, far: 0, shots: 1, hits: 1 }) });
  assert.equal(saved.data.score, 150);
  assert.equal((await call(env, 'GET', '/top')).data.entries[0].score, 150);
});

test('a ticket that is too young is refused', async () => {
  const env = freshEnv();
  const opened = await call(env, 'POST', '/round');
  const atOnce = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket: opened.data.ticket }) });
  assert.equal(atOnce.status, 400);
  const justShort = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket: ticketAged(174 * SECOND) }) });
  assert.equal(justShort.status, 400);
  assert.match(justShort.data.error, /not over yet/);
  assert.equal((await call(env, 'GET', '/top')).data.entries.length, 0);
  const justEnough = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket: ticketAged(175 * SECOND) }) });
  assert.equal(justEnough.status, 200);
});

test('a ticket that is too old is refused', async () => {
  const env = freshEnv();
  const late = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket: ticketAged(20 * MINUTE + SECOND) }) });
  assert.equal(late.status, 400);
  assert.match(late.data.error, /too long ago/);
  const inTime = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket: ticketAged(20 * MINUTE) }) });
  assert.equal(inTime.status, 200);
});

test('a ticket cannot be used twice', async () => {
  const env = freshEnv();
  const ticket = ticketAged(3 * MINUTE);
  assert.equal((await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket, kills: 10, headshots: 0, far: 0 }) })).status, 200);
  const asked = twitch.calls.length;
  const again = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket, kills: 100, hits: 100 }) });
  assert.equal(again.status, 409);
  assert.equal(twitch.calls.length, asked);   // turned away before Twitch is bothered
  const other = await call(env, 'POST', '/score', { token: 'pass-of-ben', body: round({ ticket }) });
  assert.equal(other.status, 409);
  const top = await call(env, 'GET', '/top');
  assert.deepEqual(top.data.entries.map((e) => [e.login, e.score]), [['ana', 1000]]);
});

test('the same ticket handed in twice at the same moment only counts once', async () => {
  const env = freshEnv();
  const ticket = ticketAged(3 * MINUTE);
  // with Twitch taking a moment, both requests are past the first "already used?" look before either is saved
  twitch.slow = true;
  let both;
  try {
    both = await Promise.all([
      call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket }) }),
      call(env, 'POST', '/score', { token: 'pass-of-ben', body: round({ ticket }) }),
    ]);
  } finally {
    twitch.slow = false;
  }
  assert.deepEqual(both.map((res) => res.status).sort(), [200, 409]);
  assert.equal((await call(env, 'GET', '/top')).data.entries.length, 1);
});

test('a ticket with a forged or damaged signature is refused', async () => {
  const env = freshEnv();
  const forged = [
    ticketAged(3 * MINUTE, { secret: 'a-guess-at-the-secret' }),
    // a real signature moved onto a note with an earlier time
    Buffer.from(JSON.stringify({ id: 'ab'.repeat(16), t: clock - 3 * MINUTE })).toString('base64url') + '.' + ticketAged(0).split('.')[1],
    ticketAged(3 * MINUTE).split('.')[0],
    ticketAged(3 * MINUTE) + '.extra',
    'not a ticket', '', '.', 42, null, undefined,
  ];
  for (const ticket of forged) {
    const res = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket }) });
    assert.equal(res.status, 403, `ticket ${JSON.stringify(ticket)}`);
  }
  assert.equal((await call(env, 'GET', '/top')).data.entries.length, 0);
});

test('a sign-in made for another site (another client id) is refused', async () => {
  const env = freshEnv();
  const res = await call(env, 'POST', '/score', { token: 'pass-from-another-site', body: round() });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /different site/);
  assert.equal((await call(env, 'GET', '/top')).data.entries.length, 0);
});

test('a missing, unknown or person-less sign-in is refused, and the round can still be saved after signing in again', async () => {
  const env = freshEnv();
  const body = round();
  assert.equal((await call(env, 'POST', '/score', { body })).status, 401);
  assert.equal((await call(env, 'POST', '/score', { token: 'a-pass-twitch-never-issued', body })).status, 401);
  assert.equal((await call(env, 'POST', '/score', { token: 'pass-of-no-person', body })).status, 401);
  assert.equal((await call(env, 'GET', '/top')).data.entries.length, 0);
  assert.equal((await call(env, 'POST', '/score', { token: 'pass-of-ana', body })).status, 200);
});

test('numbers that cannot be right are refused', async () => {
  const env = freshEnv();
  const bad = {
    'negative kills': { kills: -1 },
    'half a kill': { kills: 1.5 },
    'kills as text': { kills: '40' },
    'missing shots': { shots: undefined },
    'kills not a number': { kills: NaN },
    'more than 600 kills': { kills: 601, shots: 6000, hits: 601 },
    'more headshots than kills': { headshots: 41 },
    'more far kills than kills': { far: 41 },
    'more hits than shots': { hits: 301 },
    'more than 6000 shots': { shots: 6001 },
    'fewer hits than kills': { hits: 39 },
    'weapon not text': { weapon: 7 },
    'weapon missing': { weapon: undefined },
    'weapon too long': { weapon: 'x'.repeat(81) },
  };
  const ticket = ticketAged(3 * MINUTE);
  for (const [what, change] of Object.entries(bad)) {
    const res = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket, ...change }) });
    assert.equal(res.status, 400, what);
    assert.equal(typeof res.data.error, 'string', what);
  }
  for (const raw of ['', 'not json', '[1, 2]', '"text"', '{"ticket":"' + 'x'.repeat(3000) + '"}']) {
    assert.equal((await call(env, 'POST', '/score', { token: 'pass-of-ana', raw })).status, 400, `body ${raw.slice(0, 20)}`);
  }
  assert.equal((await call(env, 'GET', '/top')).data.entries.length, 0);
  // the limits themselves are allowed, and a refused try did not use the ticket up
  const most = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket, kills: 600, headshots: 600, far: 600, shots: 6000, hits: 600, weapon: 'x'.repeat(80) }) });
  assert.equal(most.status, 200);
  assert.equal(most.data.score, 105000);
});

test('a lower score does not replace a higher one, but the name and picture are refreshed', async () => {
  const env = freshEnv();
  const first = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round() });
  assert.equal(first.data.best, 4900);
  const firstAt = clock;

  wait(5 * MINUTE);
  people['pass-of-ana'].name = 'Ana_Renamed';
  people['pass-of-ana'].avatar = 'https://static-cdn.jtvnw.net/ana-new.png';
  const lower = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ kills: 5, headshots: 1, far: 0, weapon: 'Glock-18 | Fade' }) });
  assert.equal(lower.status, 200);
  assert.deepEqual(lower.data, { score: 550, best: 4900, rank: 1, improved: false });
  let [entry] = (await call(env, 'GET', '/top')).data.entries;
  assert.deepEqual(entry, {
    rank: 1, name: 'Ana_Renamed', login: 'ana', avatar: 'https://static-cdn.jtvnw.net/ana-new.png',
    score: 4900, kills: 40, headshots: 15, weapon: 'AK-47 | Fire Serpent', at: firstAt,
  });

  // an equal score is not an improvement either: the earlier one keeps its place
  wait(5 * MINUTE);
  assert.equal((await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round() })).data.improved, false);
  assert.equal((await call(env, 'GET', '/top')).data.entries[0].at, firstAt);

  wait(5 * MINUTE);
  const higher = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ kills: 50, weapon: 'AWP | Dragon Lore' }) });
  assert.deepEqual(higher.data, { score: 5900, best: 5900, rank: 1, improved: true });
  [entry] = (await call(env, 'GET', '/top')).data.entries;
  assert.deepEqual([entry.score, entry.kills, entry.weapon, entry.at], [5900, 50, 'AWP | Dragon Lore', clock]);
  assert.equal(env.DB.rows('SELECT COUNT(*) AS n FROM scores')[0].n, 1);
  people['pass-of-ana'].name = 'Ana';
  people['pass-of-ana'].avatar = 'https://static-cdn.jtvnw.net/ana.png';
});

test('the board is ordered by score, then by who got there first, and ranks agree with it', async () => {
  const env = freshEnv();
  const ben = await call(env, 'POST', '/score', { token: 'pass-of-ben', body: round({ kills: 30 }) });
  wait(MINUTE);
  const cho = await call(env, 'POST', '/score', { token: 'pass-of-cho', body: round({ kills: 30 }) });
  wait(MINUTE);
  const ana = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ kills: 20 }) });
  assert.deepEqual([ben.data.rank, cho.data.rank, ana.data.rank], [1, 2, 3]);
  let top = await call(env, 'GET', '/top');
  assert.deepEqual(top.data.entries.map((e) => [e.rank, e.login]), [[1, 'ben'], [2, 'cho'], [3, 'ana']]);

  wait(MINUTE);
  const anaAgain = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ kills: 30 }) });
  assert.equal(anaAgain.data.rank, 3);   // same points as the other two, but later
  wait(MINUTE);
  const anaWins = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ kills: 31 }) });
  assert.equal(anaWins.data.rank, 1);
  top = await call(env, 'GET', '/top?limit=2');
  assert.deepEqual(top.data.entries.map((e) => [e.rank, e.login]), [[1, 'ana'], [2, 'ben']]);
});

test('the board gives ten entries unless asked, and never more than fifty', async () => {
  const env = freshEnv();
  const insert = env.DB.db.prepare('INSERT INTO scores VALUES (?, ?, ?, ?, ?, 1, 0, 0, 1, 1, ?, ?)');
  for (let i = 1; i <= 60; i++) insert.run(String(5000 + i), 'p' + i, 'P' + i, '', i * 100, 'USP-S', clock + i);
  const sizes = {};
  for (const q of ['', '?limit=3', '?limit=50', '?limit=500', '?limit=0', '?limit=-4', '?limit=lots']) {
    sizes[q] = (await call(env, 'GET', '/top' + q)).data.entries.length;
  }
  assert.deepEqual(sizes, { '': 10, '?limit=3': 3, '?limit=50': 50, '?limit=500': 50, '?limit=0': 1, '?limit=-4': 1, '?limit=lots': 10 });
  assert.equal((await call(env, 'GET', '/top?limit=3')).data.entries[0].score, 6000);
});

test('the owner can delete an entry with the admin key, and nobody else can', async () => {
  const env = freshEnv();
  await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round() });
  await call(env, 'POST', '/score', { token: 'pass-of-ben', body: round({ kills: 30 }) });

  assert.equal((await call(env, 'DELETE', '/entry/1001', { origin: null })).status, 401);
  assert.equal((await call(env, 'DELETE', '/entry/1001', { origin: null, token: 'a-wrong-key' })).status, 401);
  assert.equal((await call(env, 'DELETE', '/entry/1001', { origin: null, token: 'pass-of-ana' })).status, 401);
  assert.equal((await call(env, 'GET', '/top')).data.entries.length, 2);

  const gone = await call(env, 'DELETE', '/entry/1001', { origin: null, token: ADMIN });
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.data, { removed: '1001' });
  assert.deepEqual((await call(env, 'GET', '/top')).data.entries.map((e) => [e.rank, e.login]), [[1, 'ben']]);

  assert.equal((await call(env, 'DELETE', '/entry/1001', { origin: null, token: ADMIN })).status, 404);
  assert.equal((await call(env, 'DELETE', '/entry/ben', { origin: null, token: ADMIN })).status, 400);
  // with no admin key set up, nothing opens the door: not even an empty key
  const unset = freshEnv({ ADMIN_KEY: undefined });
  assert.equal((await call(unset, 'DELETE', '/entry/1001', { origin: null, token: 'undefined' })).status, 401);
  assert.equal((await call(unset, 'DELETE', '/entry/1001', { origin: null })).status, 401);
});

test('browsers on a site that is not on the list are turned away', async () => {
  const env = freshEnv();
  await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round() });
  for (const origin of ['https://evil.example', 'https://museum.example.evil.example', 'http://museum.example', 'null']) {
    const tries = [
      await call(env, 'OPTIONS', '/score', { origin }),
      await call(env, 'GET', '/top', { origin }),
      await call(env, 'POST', '/round', { origin }),
      await call(env, 'POST', '/score', { origin, token: 'pass-of-ben', body: round() }),
    ];
    for (const res of tries) {
      assert.equal(res.status, 403, origin);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, origin);
      assert.equal(res.data.ticket, undefined);
      assert.equal(res.data.entries, undefined);
    }
  }
  assert.deepEqual((await call(env, 'GET', '/top')).data.entries.map((e) => e.login), ['ana']);
});

test('browsers on a listed site get the headers they need, on answers and on refusals', async () => {
  const env = freshEnv();
  for (const origin of [SITE, 'http://localhost:4174']) {
    const pre = await call(env, 'OPTIONS', '/score', { origin });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), origin);
    assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
    assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
    assert.equal((await call(env, 'GET', '/top', { origin })).headers.get('Access-Control-Allow-Origin'), origin);
    const refused = await call(env, 'POST', '/score', { origin, body: round() });
    assert.equal(refused.status, 401);
    assert.equal(refused.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(refused.headers.get('Vary'), 'Origin');
  }
  // no site named at all (the owner's command line): allowed, with no browser headers
  const plain = await call(env, 'GET', '/top', { origin: null });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('Access-Control-Allow-Origin'), null);
});

test('when Twitch cannot be reached the round is not lost', async () => {
  const env = freshEnv();
  const body = round();
  twitch.down = true;
  try {
    const res = await call(env, 'POST', '/score', { token: 'pass-of-ana', body });
    assert.equal(res.status, 502);
    assert.match(res.data.error, /Twitch/);
  } finally {
    twitch.down = false;
  }
  assert.equal((await call(env, 'POST', '/score', { token: 'pass-of-ana', body })).status, 200);
});

test('used tickets are forgotten after a day', async () => {
  const env = freshEnv();
  await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round() });
  wait(23 * 60 * MINUTE);
  await call(env, 'POST', '/score', { token: 'pass-of-ben', body: round() });
  assert.equal(env.DB.rows('SELECT COUNT(*) AS n FROM used_tickets')[0].n, 2);
  wait(2 * 60 * MINUTE);
  await call(env, 'POST', '/score', { token: 'pass-of-cho', body: round() });
  assert.equal(env.DB.rows('SELECT COUNT(*) AS n FROM used_tickets')[0].n, 2);   // ana's is gone, ben's and cho's remain
});

test('unknown addresses, wrong kinds of request and a half set-up server answer plainly', async () => {
  const env = freshEnv();
  const cases = [
    [await call(env, 'GET', '/'), 404],
    [await call(env, 'GET', '/scores'), 404],
    [await call(env, 'GET', '/round'), 405],
    [await call(env, 'GET', '/score'), 405],
    [await call(env, 'POST', '/top'), 405],
    [await call(env, 'GET', '/entry/1001'), 405],
    [await call(freshEnv({ TICKET_SECRET: '' }), 'POST', '/round'), 500],
    [await call(freshEnv({ TICKET_SECRET: undefined }), 'POST', '/score', { token: 'pass-of-ana', body: round() }), 500],
    [await call(freshEnv({ TWITCH_CLIENT_ID: '' }), 'POST', '/score', { token: 'pass-of-ana', body: round() }), 500],
  ];
  for (const [res, status] of cases) {
    assert.equal(res.status, status);
    assert.equal(typeof res.data.error, 'string');
    assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
  }
  // a database that was never given its tables is a plain 500, not a crash
  const broken = freshEnv();
  broken.DB.db.exec('DROP TABLE scores');
  const quiet = console.error;
  console.error = () => {};
  try { assert.equal((await call(broken, 'GET', '/top')).status, 500); } finally { console.error = quiet; }
});

// The sub wall.

test('/subs before the channel is connected is an empty wall, not an error', async () => {
  const env = wallEnv();
  const res = await call(env, 'GET', '/subs');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=30');
  assert.deepEqual(res.data, EMPTY_WALL);
  // a server that only keeps scores has no channel to name
  assert.deepEqual((await call(freshEnv(), 'GET', '/subs')).data, { ...EMPTY_WALL, channel: '' });
  assert.equal((await call(env, 'POST', '/subs')).status, 405);

  // the timer has nothing to do yet, and does not bother Twitch to find that out
  const asked = twitch.calls.length;
  await tick(env);
  await tick(freshEnv());
  assert.equal(twitch.calls.length, asked);
  assert.deepEqual(await wall(env), EMPTY_WALL);
  assert.deepEqual(await refreshSubWall(env), { ok: false, quiet: true, why: 'The channel is not connected.' });
});

test('/subs follows the same browser rules as the leaderboard', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  await connectAs(env);
  for (const origin of [SITE, 'http://localhost:4174']) {
    const res = await call(env, 'GET', '/subs', { origin });
    assert.equal(res.status, 200);
    assert.equal(res.data.subs.length, 1);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(res.headers.get('Vary'), 'Origin');
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=30');
    const pre = await call(env, 'OPTIONS', '/subs', { origin });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), origin);
    assert.match(pre.headers.get('Access-Control-Allow-Methods'), /GET/);
  }
  for (const origin of ['https://evil.example', 'https://museum.example.evil.example', 'null']) {
    const res = await call(env, 'GET', '/subs', { origin });
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, origin);
    assert.equal(res.data.subs, undefined);
  }
  // no site named at all: allowed, with no browser headers
  const plain = await call(env, 'GET', '/subs', { origin: null });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(plain.headers.get('Vary'), 'Origin');
});

test('/connect sends the owner to Twitch with the right request and a signed, dated state', async () => {
  const env = wallEnv();
  const asked = twitch.calls.length;
  const res = await call(env, 'GET', '/connect', { origin: null });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const to = new URL(res.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://id.twitch.tv/oauth2/authorize');
  const { state, ...rest } = Object.fromEntries(to.searchParams);
  assert.deepEqual(rest, {
    response_type: 'code', client_id: CLIENT, redirect_uri: WORKER + '/connect/callback', scope: 'channel:read:subscriptions bits:read',
    force_verify: 'true',      // so Twitch shows which account is signed in before it sends anyone back
  });
  const [note, seal, more] = state.split('.');
  assert.equal(more, undefined);
  assert.equal(seal, createHmac('sha256', SECRET).update(note).digest('base64url'));
  const inside = JSON.parse(Buffer.from(note, 'base64url').toString());
  assert.deepEqual([inside.t, inside.use], [clock, 'connect']);
  // the client secret stays behind, Twitch is not called, and nothing is written down
  assert.ok(!res.headers.get('Location').includes(APP_SECRET));
  assert.equal(twitch.calls.length, asked);
  assert.equal(grantOf(env), undefined);

  assert.equal((await call(env, 'POST', '/connect', { origin: null })).status, 405);
  for (const missing of ['TWITCH_CLIENT_SECRET', 'BROADCASTER_LOGIN', 'TICKET_SECRET', 'TWITCH_CLIENT_ID']) {
    const half = await call(wallEnv({ [missing]: '' }), 'GET', '/connect', { origin: null });
    assert.equal(half.status, 500, missing);
    assert.equal(half.headers.get('Location'), null, missing);
  }
});

test('connecting stores the channel, runs a first refresh and says how many subs were found', async () => {
  const env = wallEnv({ BROADCASTER_LOGIN: ' BullKn0xCS ' });   // however the owner happens to write it
  channel.subs = [sub(OWNER.id, OWNER.name, '3000'), sub('3001', 'NovaKat', '3000'), sub('3002', 'Pixel')];
  const asked = twitch.calls.length;
  const done = await connectAs(env);
  assert.equal(done.status, 200);
  assert.match(done.headers.get('Content-Type'), /^text\/html/);
  assert.equal(done.headers.get('Cache-Control'), 'no-store');
  assert.match(done.text, /bullkn0xcs is connected/);
  assert.match(done.text, /2 subs were found/);

  // Twitch was asked the way its documentation says
  const code = handedOut.findLast((value) => value.startsWith('code-'));
  const pass = handedOut.findLast((value) => value.startsWith('access-'));
  assert.deepEqual(twitch.forms.at(-1), {
    client_id: CLIENT, client_secret: APP_SECRET, code, grant_type: 'authorization_code', redirect_uri: WORKER + '/connect/callback',
  });
  assert.deepEqual(twitch.calls.slice(asked), [
    { url: 'https://id.twitch.tv/oauth2/token', auth: null, clientId: null },
    { url: 'https://id.twitch.tv/oauth2/validate', auth: 'OAuth ' + pass, clientId: null },
    { url: `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${OWNER.id}&first=100`, auth: 'Bearer ' + pass, clientId: CLIENT },
    { url: 'https://api.twitch.tv/helix/bits/leaderboard?count=10&period=all', auth: 'Bearer ' + pass, clientId: CLIENT },
    { url: 'https://api.twitch.tv/helix/users?id=3001&id=3002', auth: 'Bearer ' + pass, clientId: CLIENT },
  ]);

  const grant = grantOf(env);
  assert.equal(grant.broadcaster_id, OWNER.id);
  assert.equal(channel.refreshers.get(grant.refresh_token), OWNER);
  assert.deepEqual([grant.refused_at, grant.at], [null, clock]);
  const now = await wall(env);
  assert.equal(now.channel, 'bullkn0xcs');
  assert.deepEqual(now.subs.map((s) => s.name), ['NovaKat', 'Pixel']);
  // the short-lived pass is used and forgotten: it is nowhere in the database
  for (const table of ['sub_grant', 'sub_wall', 'sub_snapshot']) {
    assert.ok(!JSON.stringify(env.DB.rows(`SELECT * FROM ${table}`)).includes('access-'), table);
  }

  // the code worked once; coming back with it a second time gets nowhere and changes nothing
  const again = await call(env, 'GET', '/connect/callback?' + new URLSearchParams({ code, state: stateAged(0) }), { origin: null });
  assert.equal(again.status, 400);
  assert.equal(grantOf(env).refresh_token, grant.refresh_token);

  // one sub is "1 sub"; and a first look that fails still leaves the channel connected
  const one = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  assert.match((await connectAs(one)).text, /1 sub was found/);
  const shaky = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  channel.failSubsPage = 1;
  const half = await connectAs(shaky);
  assert.equal(half.status, 200);
  assert.match(half.text, /is connected, but the first look/);
  assert.equal(channel.refreshers.get(grantOf(shaky).refresh_token), OWNER);
  assert.deepEqual(await wall(shaky), EMPTY_WALL);
  channel.failSubsPage = 0;
  wait(5 * MINUTE);
  await tick(shaky);
  assert.deepEqual((await wall(shaky)).subs.map((s) => s.name), ['NovaKat']);
});

test('a /connect state that is forged, borrowed or out of date is refused before Twitch is asked anything', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  const real = stateAged(0);
  const forged = {
    'no state at all': undefined,
    'an empty state': '',
    'signed with a guess at the secret': stateAged(0, { secret: 'a-guess-at-the-secret' }),
    'a round ticket made the same way': ticketAged(0),
    'a round ticket anyone can get from /round': (await call(env, 'POST', '/round')).data.ticket,
    'a real seal moved onto a newer time': stateAged(-MINUTE).split('.')[0] + '.' + real.split('.')[1],
    'cut short': real.split('.')[0],
    'with something added': real + '.extra',
    'older than ten minutes': stateAged(10 * MINUTE + SECOND),
    'dated well into the future': stateAged(-(10 * MINUTE + SECOND)),
    'not a state': 'not a state',
  };
  for (const [what, state] of Object.entries(forged)) {
    const asked = twitch.calls.length;
    const res = await comeBack(env, OWNER, state);
    assert.equal(res.status, 403, what);
    assert.match(res.headers.get('Content-Type'), /^text\/plain/, what);
    assert.match(res.text, /Start again at \/connect/, what);
    assert.equal(twitch.calls.length, asked, what);
  }
  // a state that was real when /connect handed it out, used after the owner dawdled on Twitch's page
  const start = await call(env, 'GET', '/connect', { origin: null });
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  wait(10 * MINUTE + SECOND);
  assert.equal((await comeBack(env, OWNER, state)).status, 403);
  assert.equal(grantOf(env), undefined);
  assert.deepEqual(await wall(env), EMPTY_WALL);

  // just inside the ten minutes it works
  assert.equal((await comeBack(env, OWNER, stateAged(10 * MINUTE))).status, 200);
  assert.equal(grantOf(env).broadcaster_id, OWNER.id);

  // the list of sites is for the museum's pages. Should a browser name Twitch as the site on
  // the way back, the owner is still let in, and a forged state is still kept out; no site
  // outside the list is given the headers that would let its pages read an answer
  const code = make('code', OWNER);
  channel.codes.set(code, OWNER);
  const viaTwitch = { origin: 'https://id.twitch.tv' };
  const back = await call(env, 'GET', '/connect/callback?' + new URLSearchParams({ code, state: stateAged(0) }), viaTwitch);
  assert.equal(back.status, 200);
  assert.equal(back.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await call(env, 'GET', '/connect/callback?' + new URLSearchParams({ code: 'x', state: ticketAged(0) }), viaTwitch)).status, 403);
  assert.equal((await call(env, 'GET', '/connect', viaTwitch)).status, 302);
  assert.equal((await call(env, 'GET', '/connected', viaTwitch)).status, 403);
  assert.equal((await call(env, 'GET', '/subs', viaTwitch)).status, 403);

  // and the other way round: a state is not a round ticket
  const asRound = await call(env, 'POST', '/score', { token: 'pass-of-ana', body: round({ ticket: stateAged(3 * MINUTE) }) });
  assert.equal(asRound.status, 403);
});

test('only the channel named in BROADCASTER_LOGIN can connect; anyone else is turned away and nothing is stored', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  const asked = twitch.calls.length;
  const res = await connectAs(env, STRANGER);
  assert.equal(res.status, 403);
  assert.match(res.headers.get('Content-Type'), /^text\/plain/);
  assert.match(res.text, /Only the Twitch account bullkn0xcs/);
  for (const table of ['sub_grant', 'sub_wall', 'sub_snapshot']) assert.deepEqual(env.DB.rows(`SELECT * FROM ${table}`), [], table);
  assert.deepEqual(await wall(env), EMPTY_WALL);
  // the stranger's pass was shown to Twitch's "whose is this?" desk and to nothing else
  assert.deepEqual(twitch.calls.slice(asked).map((c) => c.url), ['https://id.twitch.tv/oauth2/token', 'https://id.twitch.tv/oauth2/validate']);
  await tick(env);
  assert.deepEqual(await wall(env), EMPTY_WALL);

  // a stranger cannot push the real owner out either
  assert.equal((await connectAs(env)).status, 200);
  const kept = grantOf(env).refresh_token;
  assert.equal((await connectAs(env, STRANGER)).status, 403);
  assert.equal(grantOf(env).refresh_token, kept);
  assert.equal(grantOf(env).broadcaster_id, OWNER.id);

  // other ways of coming back empty-handed: a made-up code, saying no on Twitch's page, no code
  const other = wallEnv();
  const state = encodeURIComponent(stateAged(0));
  const tries = {
    [`/connect/callback?code=a-code-twitch-never-issued&state=${state}`]: 400,
    [`/connect/callback?error=access_denied&error_description=The+user+denied+you+access&state=${state}`]: 400,
    [`/connect/callback?state=${state}`]: 400,
  };
  for (const [path, status] of Object.entries(tries)) {
    const back = await call(other, 'GET', path, { origin: null });
    assert.equal(back.status, status, path);
    assert.match(back.headers.get('Content-Type'), /^text\/plain/, path);
  }
  // a wrong client secret, or Twitch being away, is not the visitor's doing
  const wrongSecret = wallEnv({ TWITCH_CLIENT_SECRET: 'not-the-secret-twitch-has' });
  assert.equal((await connectAs(wrongSecret)).status, 502);
  twitch.down = true;
  try { assert.equal((await connectAs(other)).status, 502); } finally { twitch.down = false; }
  assert.equal(grantOf(other), undefined);
  assert.equal(grantOf(wrongSecret), undefined);
});

test('the subscriber list is read page by page, and pictures are asked for a hundred people at a time', async () => {
  const env = wallEnv();
  await connectAs(env);   // nobody subscribes yet
  assert.equal((await wall(env)).subs.length, 0);
  const pass = () => 'Bearer ' + handedOut.findLast((value) => value.startsWith('access-'));

  // 152 rows at Twitch: the channel itself, 150 people, and one of them listed twice
  channel.subs = [sub(OWNER.id, OWNER.name, '3000'), ...Array.from({ length: 150 }, (_, i) => sub(String(4000 + i), 'Viewer' + i)), sub('4000', 'Viewer0')];
  channel.leaders = [leader('9001', 'ghostpepper77', 1, 48200), leader('4003', 'Viewer3', 2, 900)];
  channel.unknown.add('4007');
  wait(5 * MINUTE);
  const asked = twitch.calls.length;
  await tick(env);

  assert.deepEqual(channel.subsAsked, [{ first: '100', after: null }, { first: '100', after: cursorAt(100) }]);
  const calls = twitch.calls.slice(asked);
  assert.deepEqual(calls.map((c) => c.url.split('?')[0]), [
    'https://id.twitch.tv/oauth2/token',
    'https://api.twitch.tv/helix/subscriptions', 'https://api.twitch.tv/helix/subscriptions',
    'https://api.twitch.tv/helix/bits/leaderboard',
    'https://api.twitch.tv/helix/users', 'https://api.twitch.tv/helix/users',
  ]);
  for (const c of calls.slice(1)) assert.deepEqual([c.auth, c.clientId], [pass(), CLIENT], c.url);
  assert.equal(calls[1].url, `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${OWNER.id}&first=100`);

  const now = await wall(env);
  assert.equal(now.subs.length, 150);
  assert.deepEqual(now.subs.map((s) => s.id), Array.from({ length: 150 }, (_, i) => String(4000 + i)));
  // 150 subs and the one bits leader who is not a sub: 151 people, so two questions
  assert.deepEqual(channel.userBatches, [100, 51]);
  assert.equal(now.subs[0].avatar, avatarOf('4000'));
  assert.equal(now.subs[149].avatar, avatarOf('4149'));
  assert.equal(now.subs[7].avatar, '');   // Twitch said nothing about this one
  assert.deepEqual(now.bits.leaders.map((l) => l.avatar), [avatarOf('9001'), avatarOf('4003')]);

  // Twitch sometimes names a next page on the last one; the empty page after it is the end,
  // and the list still counts as whole (so the 148 who left are taken off)
  channel.subs = [sub('4001', 'Viewer1'), sub('4002', 'Viewer2')];
  channel.cursorAlways = true;
  wait(5 * MINUTE);
  await tick(env);
  assert.deepEqual(channel.subsAsked, [{ first: '100', after: null }, { first: '100', after: cursorAt(100) }]);
  assert.deepEqual((await wall(env)).subs.map((s) => s.id), ['4001', '4002']);
});

test('a subscriber list with no end is cut off, and nobody is taken off the wall on its word', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  await connectAs(env);
  wait(5 * MINUTE);
  channel.endless = true;
  await tick(env);
  assert.equal(channel.subsAsked.length, 200);
  assert.deepEqual(channel.userBatches, [100, 100]);
  const now = await wall(env);
  assert.equal(now.subs.length, 201);
  assert.deepEqual([now.subs[0].name, now.subs[0].avatar], ['NovaKat', avatarOf('3001')]);
});

test('tiers are 1, 2 and 3, and only the agreed details of a sub are published', async () => {
  const env = wallEnv();
  channel.subs = [
    sub('3003', 'Mint', '1000', gifted),
    sub('3001', 'NovaKat', '3000'),
    sub('3002', 'Pixel', '2000'),
    sub('950', 'OldTimer', 1000),               // a number where Twitch writes text
    sub('3004', 'FromTheFuture', '4000'),       // a tier this file has never heard of is shown as the lowest
  ];
  channel.leaders = [leader('9001', 'ghostpepper77', 1, 48200), leader('3001', 'NovaKat', 2, 1500)];
  await connectAs(env);
  const since = iso(clock);
  assert.match(since, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  // everyone was first seen at the same moment, so the order is by id, as numbers: 950 before 3001
  assert.deepEqual(await wall(env), {
    updated: since,
    channel: 'bullkn0xcs',
    subs: [
      { id: '950', name: 'OldTimer', tier: 1, avatar: avatarOf('950'), since },
      { id: '3001', name: 'NovaKat', tier: 3, avatar: avatarOf('3001'), since },
      { id: '3002', name: 'Pixel', tier: 2, avatar: avatarOf('3002'), since },
      { id: '3003', name: 'Mint', tier: 1, avatar: avatarOf('3003'), since },
      { id: '3004', name: 'FromTheFuture', tier: 1, avatar: avatarOf('3004'), since },
    ],
    bits: { period: 'all', leaders: [
      { id: '9001', name: 'ghostpepper77', avatar: avatarOf('9001'), rank: 1, score: 48200 },
      { id: '3001', name: 'NovaKat', avatar: avatarOf('3001'), rank: 2, score: 1500 },
    ] },
  });
  // nothing about gifts, who paid, the plan or anyone's login, in the answer or in the tables behind it
  const kept = (await wallText(env)) + JSON.stringify([wallRows(env), env.DB.rows('SELECT * FROM sub_snapshot')]);
  for (const word of ['gift', 'Generous_Gus', 'generous_gus', '39990001', 'plan', 'Channel Subscription', 'login', 'novakat']) {
    assert.ok(!kept.includes(word), word);
  }
});

test('the channel itself is left off, and so is anyone in SUBS_HIDE', async () => {
  const list = () => [sub(OWNER.id, OWNER.name, '3000'), sub('3001', 'NovaKat'), sub('3002', 'StreamBot'), sub('3003', 'Mint'), sub('3004', 'Pixel')];
  const names = async (vars) => {
    const env = wallEnv(vars);
    channel.subs = list();
    await connectAs(env);
    return (await wall(env)).subs.map((s) => s.name);
  };
  assert.deepEqual(await names({}), ['NovaKat', 'StreamBot', 'Mint', 'Pixel']);
  assert.deepEqual(await names({ SUBS_HIDE: '' }), ['NovaKat', 'StreamBot', 'Mint', 'Pixel']);
  assert.deepEqual(await names({ SUBS_HIDE: 'streambot' }), ['NovaKat', 'Mint', 'Pixel']);
  assert.deepEqual(await names({ SUBS_HIDE: ' StreamBot , MINT,, nobody_here ' }), ['NovaKat', 'Pixel']);

  // hiding someone who is already up takes them down at the next refresh
  const env = wallEnv();
  channel.subs = list();
  await connectAs(env);
  env.SUBS_HIDE = 'pixel';
  wait(5 * MINUTE);
  await tick(env);
  assert.deepEqual((await wall(env)).subs.map((s) => s.name), ['NovaKat', 'StreamBot', 'Mint']);
  assert.deepEqual(wallRows(env).map((row) => row.name), ['NovaKat', 'StreamBot', 'Mint']);
});

test('someone in SUBS_HIDE is left off the bits board too, and the board still fills its ten places', async () => {
  const env = wallEnv({ SUBS_HIDE: 'cheer3, Cheer7' });
  channel.subs = [sub('3001', 'NovaKat')];
  channel.leaders = Array.from({ length: 14 }, (_, i) => leader(String(9001 + i), 'Cheer' + (i + 1), i + 1, 5000 - i * 100));
  await connectAs(env);
  const { leaders } = (await wall(env)).bits;
  assert.deepEqual(leaders.map((l) => l.name), ['Cheer1', 'Cheer2', 'Cheer4', 'Cheer5', 'Cheer6', 'Cheer8', 'Cheer9', 'Cheer10', 'Cheer11', 'Cheer12']);
  assert.deepEqual(leaders.map((l) => l.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);      // places among those shown, with no gaps
  assert.deepEqual(leaders.slice(0, 3).map((l) => l.score), [5000, 4900, 4700]);
});

test('gifted subs are shown unless SUBS_GIFTED is "0"', async () => {
  const names = async (vars) => {
    const env = wallEnv(vars);
    channel.subs = [sub('3001', 'NovaKat'), sub('3002', 'Lucky', '1000', gifted), sub('3003', 'Mint', '2000', gifted), sub('3004', 'Pixel')];
    await connectAs(env);
    return (await wall(env)).subs.map((s) => s.name);
  };
  assert.deepEqual(await names({}), ['NovaKat', 'Lucky', 'Mint', 'Pixel']);
  assert.deepEqual(await names({ SUBS_GIFTED: '1' }), ['NovaKat', 'Lucky', 'Mint', 'Pixel']);
  assert.deepEqual(await names({ SUBS_GIFTED: '' }), ['NovaKat', 'Lucky', 'Mint', 'Pixel']);
  assert.deepEqual(await names({ SUBS_GIFTED: '0' }), ['NovaKat', 'Pixel']);
  assert.deepEqual(await names({ SUBS_GIFTED: ' 0 ' }), ['NovaKat', 'Pixel']);
});

test('a sub keeps the day they were first seen, and a changed name is picked up', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  await connectAs(env);
  const first = clock;

  wait(5 * MINUTE);
  const second = clock;
  channel.subs = [sub('3002', 'Pixel'), sub('3001', 'NovaKat_Renamed')];
  await tick(env);
  wait(5 * MINUTE);
  await tick(env);
  const now = await wall(env);
  assert.equal(now.updated, iso(clock));
  assert.deepEqual(now.subs.map((s) => [s.id, s.name, s.since]), [
    ['3001', 'NovaKat_Renamed', iso(first)],
    ['3002', 'Pixel', iso(second)],
  ]);
  assert.deepEqual(wallRows(env).map((row) => [row.user_id, row.first_seen]), [['3001', first], ['3002', second]]);
});

test('a sub who changes tier counts as new at the new tier and is gone from the old one', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat', '1000'), sub('3002', 'Pixel', '1000')];
  await connectAs(env);
  const first = clock;

  wait(5 * MINUTE);
  channel.subs = [sub('3001', 'NovaKat', '3000'), sub('3002', 'Pixel', '1000')];
  await tick(env);
  const moved = clock;
  assert.deepEqual((await wall(env)).subs.map((s) => [s.name, s.tier, s.since]), [
    ['Pixel', 1, iso(first)],
    ['NovaKat', 3, iso(moved)],
  ]);
  // one row for them, not one per tier
  assert.deepEqual(wallRows(env).map((row) => [row.user_id, row.tier, row.first_seen]), [['3001', 3, moved], ['3002', 1, first]]);

  // staying at the new tier keeps the new day; going back down starts over again
  wait(5 * MINUTE);
  await tick(env);
  assert.equal((await wall(env)).subs[1].since, iso(moved));
  wait(5 * MINUTE);
  channel.subs = [sub('3001', 'NovaKat', '1000'), sub('3002', 'Pixel', '1000')];
  await tick(env);
  assert.deepEqual((await wall(env)).subs.map((s) => [s.name, s.tier, s.since]), [
    ['Pixel', 1, iso(first)],
    ['NovaKat', 1, iso(clock)],
  ]);
});

test('a sub who is no longer in Twitch\'s list is taken off, and starts over if they come back', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat'), sub('3002', 'Pixel'), sub('3003', 'Mint')];
  await connectAs(env);
  const first = clock;

  wait(5 * MINUTE);
  channel.subs = [sub('3001', 'NovaKat'), sub('3003', 'Mint')];
  await tick(env);
  assert.deepEqual((await wall(env)).subs.map((s) => s.name), ['NovaKat', 'Mint']);
  assert.deepEqual(wallRows(env).map((row) => row.user_id), ['3001', '3003']);

  wait(5 * MINUTE);
  channel.subs = [sub('3001', 'NovaKat'), sub('3002', 'Pixel'), sub('3003', 'Mint')];
  await tick(env);
  assert.deepEqual((await wall(env)).subs.map((s) => [s.name, s.since]), [['NovaKat', iso(first)], ['Mint', iso(first)], ['Pixel', iso(clock)]]);

  // everyone gone is an empty wall, with the time of the look
  wait(5 * MINUTE);
  channel.subs = [sub(OWNER.id, OWNER.name, '3000')];
  await tick(env);
  assert.deepEqual(await wall(env), { ...EMPTY_WALL, updated: iso(clock) });
  assert.deepEqual(wallRows(env), []);
});

test('a subscriber list that could not be read to the end changes nothing', async () => {
  const env = wallEnv();
  const viewers = Array.from({ length: 150 }, (_, i) => sub(String(4000 + i), 'Viewer' + i));
  channel.subs = viewers;
  channel.leaders = [leader('9001', 'ghostpepper77', 1, 48200)];
  await connectAs(env);
  const before = await wallText(env);
  const rowsBefore = wallRows(env);
  assert.equal(rowsBefore.length, 150);

  // twenty people leave, one arrives and the bits board moves, but Twitch never gets through the list
  channel.subs = [sub('5000', 'Newcomer'), ...viewers.slice(20)];
  channel.leaders = [leader('9002', 'someone_new', 1, 99999)];
  const unchanged = async (what) => {
    wait(5 * MINUTE);
    await tick(env);
    assert.equal(await wallText(env), before, what);
    assert.deepEqual(wallRows(env), rowsBefore, what);
  };
  channel.failSubsPage = 2;
  await unchanged('page two failed');
  assert.equal(channel.subsAsked.length, 2);
  assert.match(logged.at(-1), /did not give the whole list/);
  channel.failSubsPage = 1;
  await unchanged('page one failed');
  channel.failSubsPage = 0;
  channel.brokenSubs = true;
  await unchanged('an answer that is not a list');
  channel.brokenSubs = false;
  twitch.down = true;
  try { await unchanged('Twitch could not be reached'); } finally { twitch.down = false; }

  // once Twitch is back the changes arrive, all of them
  wait(5 * MINUTE);
  await tick(env);
  const now = await wall(env);
  assert.equal(now.updated, iso(clock));
  assert.equal(now.subs.length, 131);
  assert.deepEqual([now.subs.at(-1).name, now.subs.at(-1).since], ['Newcomer', iso(clock)]);
  assert.equal(now.bits.leaders[0].name, 'someone_new');
});

test('a bits board that could not be read keeps the subs, and keeps the board from before', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  channel.leaders = [leader('9001', 'ghostpepper77', 1, 48200), leader('3001', 'NovaKat', 2, 1500)];
  await connectAs(env);
  const before = await wall(env);
  assert.equal(before.bits.leaders.length, 2);

  wait(5 * MINUTE);
  channel.subs.push(sub('3002', 'Pixel'));
  channel.leaders = [leader('9002', 'someone_new', 1, 99999)];
  channel.failBits = true;
  await tick(env);
  let now = await wall(env);
  assert.equal(now.updated, iso(clock));
  assert.deepEqual(now.subs.map((s) => s.name), ['NovaKat', 'Pixel']);
  assert.deepEqual(now.bits, before.bits);

  // through a second bad run as well, and then the new board arrives
  wait(5 * MINUTE);
  await tick(env);
  assert.deepEqual((await wall(env)).bits, before.bits);
  wait(5 * MINUTE);
  channel.failBits = false;
  await tick(env);
  now = await wall(env);
  assert.deepEqual(now.bits, { period: 'all', leaders: [{ id: '9002', name: 'someone_new', avatar: avatarOf('9002'), rank: 1, score: 99999 }] });
  assert.deepEqual(now.subs.map((s) => s.name), ['NovaKat', 'Pixel']);
});

test('pictures that could not be looked up stay as they were', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  channel.leaders = [leader('9001', 'ghostpepper77', 1, 48200)];
  await connectAs(env);

  wait(5 * MINUTE);
  channel.subs.push(sub('3002', 'Pixel'));
  channel.failUsers = true;
  await tick(env);
  let now = await wall(env);
  assert.equal(now.updated, iso(clock));
  assert.deepEqual(now.subs.map((s) => [s.name, s.avatar]), [['NovaKat', avatarOf('3001')], ['Pixel', '']]);
  assert.equal(now.bits.leaders[0].avatar, avatarOf('9001'));

  // a picture Twitch no longer gives (the account is gone) does go away once Twitch answers
  wait(5 * MINUTE);
  channel.failUsers = false;
  channel.unknown.add('3001');
  await tick(env);
  now = await wall(env);
  assert.deepEqual(now.subs.map((s) => [s.name, s.avatar]), [['NovaKat', ''], ['Pixel', avatarOf('3002')]]);
});

test('when Twitch swaps the refresh token, the new one is kept and used the next time', async () => {
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  await connectAs(env);
  const first = grantOf(env).refresh_token;

  // Twitch gives the same one back: nothing to do
  wait(5 * MINUTE);
  await tick(env);
  assert.deepEqual(twitch.forms.at(-1), { grant_type: 'refresh_token', refresh_token: first, client_id: CLIENT, client_secret: APP_SECRET });
  assert.equal(grantOf(env).refresh_token, first);

  channel.rotate = true;
  wait(5 * MINUTE);
  await tick(env);
  const second = grantOf(env).refresh_token;
  assert.notEqual(second, first);
  assert.equal(channel.refreshers.get(second), OWNER);
  assert.equal(grantOf(env).at, clock);

  // the first one is dead at Twitch by now, so only the second can have made this run work
  wait(5 * MINUTE);
  await tick(env);
  assert.equal(twitch.forms.at(-1).refresh_token, second);
  assert.equal((await wall(env)).updated, iso(clock));
  assert.equal(grantOf(env).refused_at, null);

  // and a new one is kept even when the rest of that run goes wrong
  const third = grantOf(env).refresh_token;
  channel.failSubsPage = 1;
  wait(5 * MINUTE);
  await tick(env);
  const fourth = grantOf(env).refresh_token;
  assert.notEqual(fourth, third);
  assert.equal(channel.refreshers.get(fourth), OWNER);
  assert.equal(channel.refreshers.size, 1);
});

test('when Twitch refuses the connection it is noted, the wall stays, and Twitch is left alone until the owner connects again', async () => {
  for (const status of [400, 401]) {
    const env = wallEnv();
    channel.subs = [sub('3001', 'NovaKat')];
    await connectAs(env);
    const before = await wallText(env);

    // the owner disconnected the application in Twitch's settings, or changed their password
    if (status === 400) channel.refreshers.clear();
    else channel.tokenStatus = 401;
    channel.subs = [];
    wait(5 * MINUTE);
    await tick(env);
    assert.equal(grantOf(env).refused_at, clock, status);
    assert.match(logged.at(-1), /Open \/connect again/);
    assert.equal(await wallText(env), before);
    assert.equal(wallRows(env).length, 1);

    const asked = twitch.calls.length;
    const notes = logged.length;
    wait(5 * MINUTE);
    await tick(env);
    assert.equal(twitch.calls.length, asked);
    assert.equal(logged.length, notes);   // said once, not every five minutes
    assert.equal(await wallText(env), before);

    // connecting again clears the note and the timer picks up where it left off
    channel.tokenStatus = 0;
    channel.subs = [sub('3002', 'Pixel')];
    assert.equal((await connectAs(env)).status, 200);
    assert.equal(grantOf(env).refused_at, null);
    wait(5 * MINUTE);
    await tick(env);
    assert.equal((await wall(env)).updated, iso(clock));
    assert.deepEqual((await wall(env)).subs.map((s) => s.name), ['Pixel']);
  }

  // a sign-in desk that is only having trouble, or cannot be reached, is not a refusal
  const env = wallEnv();
  channel.subs = [sub('3001', 'NovaKat')];
  await connectAs(env);
  const before = await wallText(env);
  channel.tokenStatus = 503;
  wait(5 * MINUTE);
  await tick(env);
  twitch.down = true;
  try { await tick(env); } finally { twitch.down = false; }
  assert.equal(grantOf(env).refused_at, null);
  assert.equal(await wallText(env), before);
  channel.tokenStatus = 0;
  await tick(env);
  assert.equal((await wall(env)).updated, iso(clock));
});

test('no answer ever repeats a sign-in pass, the admin key or the ticket secret', async () => {
  assert.ok(answers.length > 100);
  for (const secret of [...Object.keys(people), 'a-pass-twitch-never-issued', ADMIN, SECRET]) {
    assert.ok(!answers.some((text) => text.includes(secret)), secret);
  }
});

test('nor does any answer or log line repeat the client secret, a sign-in code, a pass or a refresh token', async () => {
  assert.ok(handedOut.length > 100);
  assert.ok(logged.length > 5);
  for (const secret of [APP_SECRET, 'not-the-secret-twitch-has', ...handedOut]) {
    assert.ok(!answers.some((text) => text.includes(secret)), secret);
    assert.ok(!logged.some((text) => text.includes(secret)), secret);
  }
  // and the stand-in for Twitch was never asked something it does not know about
  assert.deepEqual(twitch.unexpected, []);
});

let passed = 0, failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log('ok    ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + name);
    console.log(String(err && err.stack || err).replace(/^/gm, '        '));
  }
}
console.log(`\n${passed} passed, ${failed} failed (Node ${process.version}, database: node:sqlite ${new DatabaseSync(':memory:').prepare('SELECT sqlite_version() AS v').get().v})`);
process.exit(failed ? 1 : 0);
