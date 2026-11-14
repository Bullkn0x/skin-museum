// Who is playing, for the shooting range's leaderboard: a "museum pass" from the owner's Knox
// Nation site. The museum is only files and cannot check a sign-in itself, and Knox Nation
// already signs people in with Twitch. So a small Knox Nation window opens; if the visitor is
// signed in there already it closes again by itself, and if not they sign in with Twitch in it.
// Knox Nation then leaves a pass for this page to collect: a signed note that says which Twitch
// account this is, good for twelve hours and for nothing but handing in range scores.
//
// It answers the same questions as twitch.js (the older way, a sign-in straight with Twitch for a
// museum with its own score server), so scores.js and the game can use either.

const KEY = 'range.pass';
const POLL_MS = 1000;
const GIVE_UP_MS = 5 * 60 * 1000;

// Kept for this tab only: a reload stays signed in, closing the tab signs out.
const store = {
  get() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } },
  set(value) { try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private window */ } },
  clear() { try { sessionStorage.removeItem(KEY); } catch { /* private window */ } },
};
const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * @param site  Knox Nation's address, for example "https://kn0xnation.com" ("" when not set up)
 * @returns { ready, user(), token(), signIn(), signOut(), onChange(fn) }
 */
export function createPass(site) {
  const base = typeof site === 'string' ? site.trim().replace(/\/+$/, '') : '';
  const ready = base !== '';
  const listeners = new Set();
  let held = null;        // { pass, user: { id, login, name, avatar }, expires (ms) }
  let pending = null;     // a sign-in that is under way: { promise, popup }

  const live = () => (held && held.expires - Date.now() > 60 * 1000 ? held : null);      // a pass with under a minute left is as good as gone
  function set(next) {
    const before = JSON.stringify(held?.user || null);
    held = next;
    if (held) store.set({ site: base, ...held }); else store.clear();
    if (before !== JSON.stringify(held?.user || null)) for (const fn of [...listeners]) { try { fn(held ? { ...held.user } : null); } catch (err) { console.error(err); } }
  }
  if (ready) {
    const saved = store.get();
    if (saved && saved.site === base && typeof saved.pass === 'string' && saved.user?.id && Number.isFinite(saved.expires)) held = { pass: saved.pass, user: saved.user, expires: saved.expires };
    if (!live()) { held = null; store.clear(); }
  }

  /** Has Knox Nation left a pass for this sign-in yet? Gives it back, or null. It is handed over once only. */
  async function collect(state) {
    try {
      const res = await fetch(`${base}/api/public/range/pass?state=${state}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const got = await res.json();
      if (!got || typeof got.pass !== 'string' || !got.user || !got.user.id) return null;
      const expires = Number(got.expires) || Date.parse(got.expires) || Date.now() + 11 * 60 * 60 * 1000;
      return { pass: got.pass, expires, user: { id: String(got.user.id), login: got.user.login || '', name: got.user.name || got.user.login || '', avatar: got.user.avatar || '' } };
    } catch {
      return null;      // offline for a moment: the next look may do better
    }
  }

  /** Must be called from a click or key press: browsers block windows that open by themselves. */
  function signIn() {
    if (!ready) return Promise.reject(new Error('The online leaderboard is not set up for this site yet.'));
    if (live()) return Promise.resolve({ ...held.user });
    if (pending) {
      try { pending.popup.focus(); } catch { /* the window is gone */ }
      return pending.promise;
    }
    // a long number made up for this one sign-in: only this page and the window it opens know it
    const state = randomHex(32);
    const w = 480, h = 640;
    const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - w) / 2));
    const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - h) / 2));
    const popup = window.open(`${base}/museum-pass?state=${state}&origin=${encodeURIComponent(location.origin)}`, 'museum-pass', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) return Promise.reject(new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'));
    try { popup.focus(); } catch { /* not allowed everywhere, and not needed */ }

    const promise = new Promise((resolve, reject) => {
      const began = Date.now();
      let closedLooks = 0, timer = 0;
      const done = (fn, value) => { clearTimeout(timer); pending = null; fn(value); };
      const look = async () => {
        const got = await collect(state);
        if (got) {
          try { popup.close(); } catch { /* it has closed itself */ }
          set(got);
          return done(resolve, { ...got.user });
        }
        // the window closes itself the moment it has left the pass: look a few more times before taking a closed window for a "no"
        if (popup.closed && ++closedLooks > 3) return done(reject, new Error('The sign-in window was closed before it finished.'));
        if (Date.now() - began > GIVE_UP_MS) {
          try { popup.close(); } catch { /* already gone */ }
          return done(reject, new Error('The sign-in took too long. Try again.'));
        }
        timer = setTimeout(look, POLL_MS);
      };
      timer = setTimeout(look, POLL_MS);
    });
    pending = { promise, popup };
    return promise;
  }

  function signOut() { if (held) set(null); }

  /** Calls fn(user or null) whenever someone signs in or out. Returns a function that stops it. */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    ready,
    user: () => (live() ? { ...held.user } : null),
    token: () => (live() ? held.pass : null),
    signIn,
    signOut,
    onChange,
  };
}
