// Scores for the shooting range. Every device remembers its own best round. Where there is a
// score server, a visitor signed in with Twitch can also put a round on the shared leaderboard.
// The owner's Knox Nation site is that server (addresses under /api/public/range: /round, /score,
// /top), and its board starts afresh every calendar month; server/range-scores is the same thing
// as a stand-alone server with one board for all time, and answers at the same three addresses.

const LS_BEST = 'range.best';
const BOARD_FRESH_MS = 15 * 1000;
const MIN_ROUND_MS = 175 * 1000;   // the server takes no round sooner than this after handing out its ticket

/** The same sum the server does: it works the score out again from the counts and ignores ours. */
export function scoreOf({ kills = 0, headshots = 0, far = 0 } = {}) {
  return 100 * kills + 50 * headshots + 25 * far;
}

// A slow or sleeping server must not leave the range waiting, so every call gives up after a while.
async function ask(url, options = {}, ms = 10000) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: stop.signal });
    let data = null;
    try { data = await res.json(); } catch { /* an answer that is not ours */ }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param api     the score server's address ("" when there is none: scores then stay on this device)
 * @param twitch  what createTwitch() returns
 */
export function createScores({ api = '', twitch = null } = {}) {
  const base = typeof api === 'string' ? api.trim().replace(/\/+$/, '') : '';
  const remote = base !== '';
  let ticket = null;      // { value, at }: proof for the server that the round was opened, and when we got it
  let rounds = 0;
  let memory = null;      // the best round, for a private window where nothing can be stored
  let board = null;       // the last good leaderboard: { entries, limit, at }
  let asking = null;      // a leaderboard request that is under way: { limit, promise }
  let asked = 0;          // counts leaderboard requests, to tell the newest answer from a late one
  let bust = '';          // added to the address after a save, so the browser does not hand back its own 15-second-old copy
  let saving = null;

  /** Call when a round starts. Never fails: without a ticket the round simply cannot go online. */
  async function begin() {
    const mine = ++rounds;
    ticket = null;
    if (!remote) return false;
    try {
      const res = await ask(base + '/round', { method: 'POST' });
      if (mine === rounds && res.ok && res.data && typeof res.data.ticket === 'string') {
        ticket = { value: res.data.ticket, at: performance.now() };
        return true;
      }
    } catch { /* offline, or the server is down */ }
    return false;
  }

  function local() {
    try {
      const best = JSON.parse(localStorage.getItem(LS_BEST));
      if (best && Number.isFinite(best.score)) return { best };
    } catch { /* private window */ }
    return { best: memory };
  }

  /** Call when a round ends. Keeps the round as this device's best if it beats the old one. */
  function finish(result) {
    const score = Number.isFinite(result.score) ? result.score : scoreOf(result);
    const { best } = local();
    if (score <= (best ? best.score : 0)) return { localBest: false };
    const { kills = 0, headshots = 0, shots = 0, hits = 0, weapon = '' } = result;
    // accuracy is a whole percentage, 0 to 100, the way the game shows it
    const accuracy = Number.isFinite(result.accuracy) ? result.accuracy : shots > 0 ? Math.round((100 * hits) / shots) : 0;
    memory = { score, kills, headshots, accuracy, weapon, at: Date.now() };
    try { localStorage.setItem(LS_BEST, JSON.stringify(memory)); } catch { /* private window */ }
    return { localBest: true };
  }

  async function send(result) {
    if (!remote) throw new Error('Online scores are not set up for this site.');
    if (!ticket) throw new Error('This round cannot be saved online: the score server could not be reached when it started.');
    const pass = twitch && twitch.token();
    if (!pass) throw new Error('Sign in with Twitch to save your score.');

    // If the ticket took a while to arrive, the server's three minutes started a little after
    // ours. Wait out a short gap here; a long one means the round was cut short, and the server
    // can say so itself.
    const early = MIN_ROUND_MS + 500 - (performance.now() - ticket.at);
    if (early > 0 && early <= 8000) await new Promise((done) => setTimeout(done, early));

    const { kills, headshots, far, shots, hits, weapon } = result;
    let res;
    try {
      res = await ask(base + '/score', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + pass, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: ticket.value, kills, headshots, far, shots, hits, weapon }),
      }, 15000);
    } catch {
      throw new Error('Could not reach the score server. Try again in a moment.');
    }
    const said = res.data && typeof res.data.error === 'string' ? res.data.error : '';
    if (res.status === 401) {
      // the pass has run out: forget it, so the range offers the sign-in again (the ticket still works after that)
      twitch.signOut();
      throw new Error(said || 'Your Twitch sign-in has run out. Sign in again.');
    }
    if (!res.ok || !res.data) throw new Error(said || 'The score server did not take this round.');

    ticket = null;
    // the board has changed: ask again next time, and do not let an answer already on its way stand in for it
    if (board) board.at = -Infinity;
    asked++;
    bust = '&v=' + Date.now();
    const { score, best, rank, improved } = res.data;
    return { score, best, rank, improved };
  }

  /** Put the round on the shared leaderboard. Throws an Error with a plain message when it cannot. */
  function save(result) {
    // a second click while the first is still on its way gets the same answer, not a second request
    if (!saving) saving = send(result).finally(() => { saving = null; });
    return saving;
  }

  async function fetchBoard(limit) {
    const mine = ++asked;
    try {
      const res = await ask(`${base}/top?limit=${limit}${bust}`);
      // an answer overtaken by a newer question (or by a save) is out of date: leave it
      if (mine === asked && res.ok && res.data && Array.isArray(res.data.entries)) {
        // a monthly board also says which month it is and when it ends
        board = { entries: res.data.entries, limit, at: performance.now(), month: typeof res.data.month === 'string' ? res.data.month : null, ends: Date.parse(res.data.ends) || null };
      }
    } catch { /* keep the last good answer */ }
  }

  /**
   * The leaderboard, best first. Never fails: at worst it is the last good answer, or empty.
   * Answers are reused for 15 seconds; pass force to ask the server anyway.
   */
  async function top(limit = 10, force = false) {
    limit = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 10));
    if (!remote) {
      const { best } = local();
      return best ? [{ rank: 1, name: 'This device', login: '', avatar: '', score: best.score, kills: best.kills, headshots: best.headshots, weapon: best.weapon, at: best.at }] : [];
    }
    const fresh = !force && board && board.limit >= limit && performance.now() - board.at < BOARD_FRESH_MS;
    if (!fresh) {
      if (force) bust = '&v=' + Date.now();
      if (force || !asking || asking.limit < limit) {
        const promise = fetchBoard(limit).finally(() => { if (asking && asking.promise === promise) asking = null; });
        asking = { limit, promise };
      }
      await asking.promise;
    }
    return board ? board.entries.slice(0, limit) : [];
  }

  /** For a board that starts afresh each month: { month: 'YYYY-MM', ends: ms }, once the board has been read. Null for any other. */
  const season = () => (board && board.month ? { month: board.month, ends: board.ends } : null);
  /** The board as last read, without asking again. */
  const known = () => (board ? board.entries : []);

  return { remote, begin, local, finish, save, top, season, known, score: scoreOf };
}
