// Twitch sign-in for the shooting range, so a score can carry a name and a picture. The site has
// no server of its own, so this uses the sign-in Twitch offers to plain web pages: a small Twitch
// window opens, the visitor agrees there, and Twitch sends that window back to auth.html with a
// pass. No extra rights are asked for: the pass only says who the visitor is.

const KEY = 'range.twitch';
const AUTHORIZE = 'https://id.twitch.tv/oauth2/authorize';
const USERS = 'https://api.twitch.tv/helix/users';
const HOUR = 60 * 60 * 1000;

// The pass is kept for this tab only: a reload stays signed in, closing the tab signs out.
const store = {
  get() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } },
  set(value) { try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private window */ } },
  clear() { try { sessionStorage.removeItem(KEY); } catch { /* private window */ } },
};

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param clientId  the Client ID of the site's application at dev.twitch.tv ("" when not set up)
 * @returns { ready, user(), token(), signIn(), signOut(), onChange(fn) }
 */
export function createTwitch(clientId) {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  const ready = id !== '';
  const listeners = new Set();
  let token = null;
  let user = null;      // { id, login, name, avatar }
  let pending = null;   // a sign-in that is under way: { promise, popup }

  function set(nextToken, nextUser) {
    const changed = JSON.stringify(user) !== JSON.stringify(nextUser);
    token = nextToken;
    user = nextUser;
    if (token) store.set({ clientId: id, token, user }); else store.clear();
    if (changed) for (const fn of [...listeners]) { try { fn(user ? { ...user } : null); } catch (err) { console.error(err); } }
  }

  // Ask Twitch who a pass belongs to. The pass travels in a header, never in the address.
  // Twitch answers 401 once a pass has run out or the visitor has disconnected the site.
  async function whoHolds(pass) {
    let res;
    try {
      res = await fetch(USERS, { headers: { Authorization: 'Bearer ' + pass, 'Client-Id': id } });
    } catch {
      throw new Error('Could not reach Twitch. Check your connection and try again.');
    }
    if (res.status === 401) {
      if (pass === token) set(null, null);
      throw new Error('Your Twitch sign-in has run out. Sign in again.');
    }
    let found = null;
    try { found = (await res.json()).data[0]; } catch { /* not the answer we expected */ }
    if (!res.ok || !found || !found.id) throw new Error('Twitch did not say who signed in. Try again.');
    return { id: String(found.id), login: found.login || '', name: found.display_name || found.login || '', avatar: found.profile_image_url || '' };
  }

  // Twitch asks sites that keep a pass to check it when they start and every hour after. The
  // same question also picks up a changed name or picture.
  function recheck() {
    const pass = token;
    if (!pass) return;
    whoHolds(pass).then(
      (fresh) => { if (pass === token) set(pass, fresh); },
      () => { /* a pass that ran out was dropped above; anything else can wait for the next check */ },
    );
  }

  if (ready) {
    const saved = store.get();
    if (saved && saved.clientId === id && typeof saved.token === 'string' && saved.token && saved.user && saved.user.id) {
      token = saved.token;
      user = saved.user;
      recheck();
    }
    setInterval(recheck, HOUR);
  }

  /** Must be called from a click or key press: browsers block windows that open by themselves. */
  function signIn() {
    if (!ready) return Promise.reject(new Error('Twitch sign-in is not set up for this site yet.'));
    if (pending) {
      try { pending.popup.focus(); } catch { /* the window is gone */ }
      return pending.promise;
    }

    // a number made up for this one sign-in; Twitch hands it back, which shows the answer is to our question
    const state = randomHex(16);
    const ask = new URL(AUTHORIZE);
    ask.search = new URLSearchParams({
      response_type: 'token',
      client_id: id,
      redirect_uri: new URL('auth.html', location.href).href,
      scope: '',
      state,
      force_verify: 'false',
    }).toString();
    const w = 480, h = 720;
    const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - w) / 2));
    const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - h) / 2));
    const popup = window.open(ask.href, 'twitch-sign-in', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) return Promise.reject(new Error('Your browser blocked the Twitch window. Allow pop-ups for this site and try again.'));
    try { popup.focus(); } catch { /* not allowed everywhere, and not needed */ }

    const promise = new Promise((resolve, reject) => {
      let answered = false;
      let watch = 0;
      const stop = () => { window.removeEventListener('message', onMessage); clearInterval(watch); };
      const fail = (message) => { stop(); pending = null; reject(new Error(message)); };

      function onMessage(event) {
        // only auth.html on this very site may hand over a pass
        if (event.origin !== location.origin || !event.data || event.data.type !== 'twitch-auth' || answered) return;
        answered = true;
        stop();
        const answer = new URLSearchParams(String(event.data.hash || '').replace(/^#/, ''));
        const refusal = new URLSearchParams(String(event.data.query || ''));   // Twitch puts a "no" after the ? instead
        if ((answer.get('state') ?? refusal.get('state')) !== state) return fail('That answer did not belong to this sign-in. Try again.');
        const pass = answer.get('access_token');
        if (!pass) return fail(refusal.get('error') === 'access_denied' ? 'The Twitch sign-in was cancelled.' : 'Twitch did not sign you in. Try again.');
        whoHolds(pass).then(
          (who) => { pending = null; set(pass, who); resolve({ ...who }); },
          (err) => { pending = null; reject(err); },
        );
      }
      window.addEventListener('message', onMessage);

      watch = setInterval(() => {
        if (!popup.closed) return;
        clearInterval(watch);
        // auth.html closes the window right after sending its answer: give the answer a moment to land
        setTimeout(() => { if (!answered) fail('The Twitch window was closed before the sign-in finished.'); }, 800);
      }, 400);
    });
    pending = { promise, popup };
    return promise;
  }

  function signOut() {
    if (token || user) set(null, null);
  }

  /** Calls fn(user or null) whenever someone signs in or out, or their name or picture changes. Returns a function that stops it. */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    ready,
    user: () => (user ? { ...user } : null),
    token: () => token,
    signIn,
    signOut,
    onChange,
  };
}
