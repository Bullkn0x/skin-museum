// Who is on the stream room's sub wall, and the bits leaderboard beside it.
//
// The list comes from one of three places:
//   live   the owner's own server, which asks Twitch on the owner's behalf every few minutes.
//          Twitch shows a channel's subscribers to nobody but the channel, so a page cannot ask
//          Twitch itself. `url` is the address to read (the owner's Knox Nation site answers at
//          /api/public/sub-wall); `api` is the older way of saying it, a base address with /subs
//          on the end (the stand-alone server in server/range-scores).
//   demo   data/subs.sample.json: made-up names, with somebody arriving or leaving every half
//          minute or so, to see the wall at work before the server exists. Used when the address
//          says ?subs=demo, or when no server is set and the page is being run on the owner's
//          own machine (localhost). A public page with no server never shows made-up names.
//   off    nothing: the wall keeps its empty places.
//
// What comes out, to whoever listens: { subs: [{ id, name, tier 1..3, avatar, since (ms) }],
// leaders: [{ id, name, avatar, rank, score }], mode, updated }.

const POLL = 60;                   // seconds between looks at the live list, while someone is in the room
const local = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.hostname.endsWith('.localhost');

export function createSubFeed(cfg = {}) {
  const asked = new URLSearchParams(location.search).get('subs');
  const api = String(cfg.api || '').replace(/\/+$/, '');
  const url = String(cfg.url || '') || (api ? `${api}/subs` : '');
  const mode = asked === 'off' ? 'off' : asked === 'demo' ? 'demo' : url ? 'live' : local() ? 'demo' : 'off';
  const hide = new Set((cfg.hide || []).map((n) => String(n).toLowerCase()));
  const listeners = new Set();
  let data = { subs: [], leaders: [], mode, updated: null };
  let active = false, started = false, timer = 0, pool = [], serial = 0;

  const clean = (raw) => ({
    mode,
    updated: raw.updated || null,
    subs: (raw.subs || [])
      .filter((s) => s && s.id != null && s.name && [1, 2, 3].includes(Number(s.tier)) && !hide.has(String(s.name).toLowerCase()))
      .map((s) => ({ id: String(s.id), name: String(s.name).slice(0, 25), tier: Number(s.tier), avatar: s.avatar || '', since: Date.parse(s.since) || Date.now() })),
    leaders: (raw.bits?.leaders || [])
      .filter((l) => l && l.name && Number(l.score) > 0 && !hide.has(String(l.name).toLowerCase()))
      .map((l) => ({ id: String(l.id ?? l.name), name: String(l.name).slice(0, 25), avatar: l.avatar || '', rank: Number(l.rank) || 0, score: Number(l.score) }))
      .sort((a, b) => b.score - a.score).slice(0, 10).map((l, i) => ({ ...l, rank: i + 1 })),
  });
  const tell = (next) => { data = next; for (const fn of listeners) fn(data); };

  async function load() {
    try {
      const r = await fetch(mode === 'live' ? url : 'data/subs.sample.json', { cache: 'no-store' });
      if (!r.ok) return;
      const raw = await r.json();
      if (mode === 'demo') pool = [...(raw.pool || [])];
      const next = clean(raw);
      // the same list as last time says nothing new
      if (mode === 'live' && next.updated && next.updated === data.updated) return;
      tell(next);
    } catch { /* the server is away: the wall keeps what it has */ }
  }

  /** The demo's goings-on: someone arrives, someone leaves, someone moves up a tier, someone cheers. */
  function pretend() {
    const subs = [...data.subs], leaders = data.leaders.map((l) => ({ ...l }));
    const roll = Math.random();
    const of = (tier) => subs.filter((s) => s.tier === tier);
    if (roll < 0.5 && pool.length) {
      const name = pool.splice(Math.floor(Math.random() * pool.length), 1)[0], t = Math.random();
      subs.push({ id: `demo-${++serial}`, name, tier: t < 0.72 ? 1 : t < 0.93 ? 2 : 3, avatar: '', since: Date.now() });
    } else if (roll < 0.75 && of(1).length > 6) {
      const gone = of(Math.random() < 0.8 ? 1 : 2);
      const who = gone[Math.floor(Math.random() * gone.length)];
      if (who) { subs.splice(subs.indexOf(who), 1); if (who.id.startsWith('demo-')) pool.push(who.name); }
    } else if (roll < 0.87 && of(1).length) {
      const up = of(1)[Math.floor(Math.random() * of(1).length)];
      subs[subs.indexOf(up)] = { ...up, tier: 2, since: Date.now() };
    } else if (leaders.length > 3) {
      const who = leaders[3 + Math.floor(Math.random() * (leaders.length - 3))];
      who.score += [100, 250, 500, 1000, 2500][Math.floor(Math.random() * 5)];
      leaders.sort((a, b) => b.score - a.score).forEach((l, i) => { l.rank = i + 1; });
    }
    tell({ ...data, subs, leaders, updated: new Date().toISOString() });
  }

  function tick() {
    clearTimeout(timer);
    if (!active || mode === 'off') return;
    timer = setTimeout(async () => {
      if (mode === 'live') await load(); else pretend();
      tick();
    }, mode === 'live' ? POLL * 1000 : 22000 + Math.random() * 16000);
  }

  return {
    mode,
    get data() { return data; },
    onChange(fn) { listeners.add(fn); fn(data); return () => listeners.delete(fn); },
    /** Called every frame with whether a visitor is in the room: the list is only fetched, and kept fresh, while one is. */
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on && mode !== 'off') {
        if (!started || mode === 'live') { started = true; load().then(tick); } else tick();
      } else clearTimeout(timer);
    },
    /** For trying things from the console: put any list on the wall. */
    set(raw) { tell(clean(raw)); },
    pretend,
  };
}
