// The stream room's link to Twitch: whether the channel is live, its latest frame for the wall,
// and Twitch's own player and chat, laid flat over the wall while a visitor is watching.
//
// Twitch's player only plays while it is the size it was laid out at, square to the page, fully
// opaque and with nothing over it. Checked on 2026-11-12: any scaling, tilt, transparency or
// overlapping element (even an invisible one) pauses it within seconds; moving it and clipping
// part of it away are allowed. So the live picture cannot be tilted into the 3D view. The room
// shows the stream's latest frame on its screen until a visitor sits down; then the view turns
// square to the wall and the real player is laid over the screen.

const SCRIPT = 'https://player.twitch.tv/js/embed/v1.js';
const LS_VOLUME = 'club.stream.volume';
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } },
};

export class StreamWall extends EventTarget {
  /**
   * @param channel  the Twitch channel's name
   * @param chat     whether to show the channel's chat beside the picture
   */
  constructor({ channel, chat = true }) {
    super();
    this.channel = String(channel || '').trim();
    this.withChat = chat;
    // Twitch only serves its player to pages on https (or on localhost, for previews)
    this.usable = !!this.channel && /^https?:$/.test(location.protocol);
    this.status = this.usable ? 'unknown' : 'offline';   // 'unknown' | 'live' | 'offline'
    this.frame = null;            // the stream's latest frame, while it is live
    this.volume = store.get(LS_VOLUME, 0.6);
    this.watching = false;        // a visitor is sitting in front of the wall
    this.shown = false;           // the player is over the screen
    this.playing = false;
    this.free = false;            // the mouse is loose, so the player and chat take clicks
    this.soundBlocked = false;    // the browser would not let it start with sound
    this.failed = false;          // Twitch's player could not be loaded here
    this.player = null;
    this.hooks = {};
    this._heard = null;           // what the player itself last said: it knows before the picture does
    this._rects = '';
    this._retries = 0;
    if (this.usable) {
      this._check();
      setInterval(() => { if (!document.hidden) this._check(); }, 45000);
    }
  }

  _changed() { this.dispatchEvent(new Event('change')); this._bar(); }
  _set(status, frame) {
    if (status === this.status && frame === this.frame) return;
    this.status = status; this.frame = frame;
    this._changed();
  }

  /**
   * Ask Twitch for the channel's preview picture. While the channel is live this is a recent
   * frame of the stream; when it is not, Twitch answers with a stock "not found" picture.
   */
  async _check() {
    const url = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(this.channel.toLowerCase())}-1280x720.jpg?t=${Date.now()}`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      if (r.redirected || /404_preview/.test(r.url)) {
        if (this._heard !== 'live') this._set('offline', null);
        return;
      }
      const frame = await createImageBitmap(await r.blob());
      if (this._heard === 'offline') return;        // the picture lingers a few minutes after a stream ends
      this._set('live', frame);
    } catch { /* blocked, or no connection: the player still says, once it is loaded */ }
  }

  /** Load Twitch's player, out of sight. It reports the moment the channel goes live or stops. */
  prepare() {
    if (!this.usable || this.layer) return;
    const layer = this.layer = document.createElement('div');
    layer.className = 'stream-layer';
    layer.innerHTML = '<div class="stream-video" id="stream-video"></div>'
      + '<div class="stream-bar"><span class="stream-state"></span><span class="stream-hint"></span>'
      + '<button type="button" data-act="keep">Keep watching</button><button type="button" data-act="leave">Stand up</button></div>';
    document.body.append(layer);
    this.videoEl = layer.querySelector('.stream-video');
    layer.querySelector('[data-act="keep"]').addEventListener('click', () => this.hooks.relock?.());
    layer.querySelector('[data-act="leave"]').addEventListener('click', () => this.hooks.leave?.());
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true;
    s.onload = () => this._makePlayer();
    s.onerror = () => { this.failed = true; this._changed(); };
    document.head.append(s);
    this._bar();
  }

  _makePlayer() {
    const T = window.Twitch;
    if (!T || !T.Player) { this.failed = true; this._changed(); return; }
    const p = this.player = new T.Player('stream-video', {
      // autoplay: Twitch starts it by itself the moment it comes into view; it stays still while clipped away
      channel: this.channel, parent: [location.hostname], width: '100%', height: '100%', autoplay: true, muted: true,
    });
    const E = T.Player;
    p.addEventListener(E.READY, () => { this.ready = true; this._start(); });
    p.addEventListener(E.ONLINE, () => { this._heard = 'live'; this._set('live', this.frame); this._check(); this._start(); });
    p.addEventListener(E.OFFLINE, () => { this._heard = 'offline'; this.playing = false; this._set('offline', null); });
    p.addEventListener(E.PLAYING, () => {
      this.playing = true; this._retries = 0;
      if (!this.watching) p.pause();
      else if (!this.soundBlocked) { p.setVolume(this.volume); p.setMuted(false); }
      this._changed();
    });
    const stopped = () => { this.playing = false; this._changed(); };
    p.addEventListener(E.PAUSE, stopped);
    p.addEventListener(E.ENDED, stopped);
    // The browser refused to start it with sound: play it silent and say how to turn the sound on.
    p.addEventListener(E.PLAYBACK_BLOCKED, () => { this.soundBlocked = true; p.setMuted(true); p.play(); this._changed(); });
  }

  _start() {
    if (!this.player || !this.ready || !this.watching || !this.shown || this.playing) return;
    if (this.status !== 'offline') this.player.play();
  }

  /**
   * Call every frame while a visitor is watching. Twitch ignores a request to play that reaches it
   * before it has noticed the player come into view, and pauses a player it thinks is hidden, so
   * the request is repeated every second and a half until the picture is moving. Not while the
   * mouse is loose: then the visitor has Twitch's own pause button, and it is theirs to press.
   */
  tick(now) {
    if (!this.watching || !this.shown || this.playing || this.free || this.status === 'offline') return;
    if (now - (this._asked || 0) < 1.5) return;
    this._asked = now;
    this._start();
  }

  /** A visitor sat down (or stood up). `hooks`: { leave, relock } for the two buttons under the wall. */
  setWatching(on, hooks) {
    this.watching = on;
    if (hooks) this.hooks = hooks;
    if (on) { this._retries = 0; this.prepare(); }
    else {
      this.shown = false; this.free = false; this._rects = '';
      this.layer?.classList.remove('is-shown', 'is-free');
      if (this.player && this.ready) { this.player.setMuted(true); this.player.pause(); }
      this.playing = false;
    }
    this._bar();
  }

  /**
   * Lay the player and the chat over the wall. Rectangles are in page pixels: { x, y, w, h }.
   * They are moved and sized with left, top, width and height, never scaled.
   */
  place(video, chat) {
    if (!this.layer || !this.watching) return;
    const key = [video.x, video.y, video.w, video.h, ...(chat ? [chat.x, chat.y, chat.w, chat.h] : [])].map(Math.round).join();
    if (key !== this._rects) {
      this._rects = key;
      const put = (el, r) => { el.style.left = `${Math.round(r.x)}px`; el.style.top = `${Math.round(r.y)}px`; el.style.width = `${Math.round(r.w)}px`; el.style.height = `${Math.round(r.h)}px`; };
      put(this.videoEl, video);
      // nothing may lie over the picture, the line of help included
      this.layer.classList.toggle('no-bar', video.y + video.h > window.innerHeight - 64);
      if (this.chatEl) this.chatEl.style.display = chat ? '' : 'none';
      if (this.withChat && chat) {
        if (!this.chatEl) {
          const f = this.chatEl = document.createElement('iframe');
          f.className = 'stream-chat'; f.title = 'Stream chat';
          f.src = `https://www.twitch.tv/embed/${encodeURIComponent(this.channel)}/chat?parent=${encodeURIComponent(location.hostname)}&darkpopout`;
          this.layer.insertBefore(f, this.videoEl.nextSibling);
        }
        // chat needs about 340 pixels to lay itself out; on a narrow page it is drawn smaller instead
        const k = Math.min(1, chat.w / 340);
        put(this.chatEl, { x: chat.x, y: chat.y, w: chat.w / k, h: chat.h / k });
        this.chatEl.style.transform = k < 1 ? `scale(${k})` : '';
      }
    }
    if (!this.shown) {
      this.shown = true;
      this.layer.classList.add('is-shown');
      this._start();
      this._bar();
    }
  }

  /** The mouse was let go (true) or taken back (false). Loose, it works Twitch's own controls and the chat. */
  setFree(on) {
    this.free = on;
    this.layer?.classList.toggle('is-free', on);
    this._bar();
  }

  /** Louder or quieter, by the arrow keys. */
  nudgeVolume(step) {
    this.volume = Math.max(0, Math.min(1, Math.round((this.volume + step) * 20) / 20));
    store.set(LS_VOLUME, this.volume);
    if (this.player && this.ready) {
      this.player.setVolume(this.volume);
      if (this.watching && this.playing) { this.soundBlocked = false; this.player.setMuted(this.volume === 0); }
    }
    this._bar();
  }

  _bar() {
    if (!this.layer) return;
    this.layer.classList.toggle('is-watching', this.watching);
    const state = this.layer.querySelector('.stream-state'), hint = this.layer.querySelector('.stream-hint');
    const live = this.status === 'live';
    state.textContent = this.failed ? 'Twitch did not load' : live ? (this.playing ? 'Live' : 'Live · starting') : this.status === 'offline' ? 'Offline' : '';
    state.classList.toggle('is-live', live && !this.failed);
    const parts = [];
    if (this.free) parts.push('Click the room to keep watching');
    else parts.push('E  stand up', 'Esc  use the player and chat', `↑ ↓  volume ${Math.round(this.volume * 100)}%`);
    if (this.soundBlocked && live) parts.push('Sound is off: press Esc, then click the speaker on the player');
    hint.textContent = parts.join('   ·   ');
  }
}
