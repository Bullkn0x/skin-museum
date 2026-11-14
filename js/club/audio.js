// Club sound. The jukebox's playlist plays through two speaker stacks by the DJ booth, so the
// music has a place in the room: louder and drier near the stage, softer and more echoing far
// from it, and it swings past your ears as you turn. The same signal drives the light show.

const LS_LINKS = 'club.links';
const LS_VOLUME = 'club.volume';
const EDGES = [40, 90, 180, 360, 720, 1500, 3000, 6000, 12000];   // eight bands for the light show

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } },
};

function nameFrom(src) {
  try {
    const last = decodeURIComponent(new URL(src, location.href).pathname.split('/').pop() || '');
    return last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
  } catch { return 'Untitled'; }
}

export class ClubAudio extends EventTarget {
  /**
   * @param speakers  two { x, y, z } points: the left and right stacks
   * @param tracks    [{ title, artist, src }] from data/club.json
   */
  constructor({ speakers, tracks = [], volume = 0.7, order = 'playlist', idleBpm = 120 }) {
    super();
    this.speakers = speakers;
    this.tracks = tracks.filter((t) => t && t.src).map((t) => ({ title: t.title || nameFrom(t.src), artist: t.artist || '', src: t.src, kind: 'list' }));
    for (const l of store.get(LS_LINKS, [])) if (l && l.src) this.tracks.push({ title: l.title || nameFrom(l.src), artist: '', src: l.src, kind: 'link' });
    this.order = ['playlist', 'shuffle', 'loop'].includes(order) ? order : 'playlist';
    this.volume = store.get(LS_VOLUME, volume);
    this.index = this.tracks.length ? 0 : -1;
    this.playing = false;       // the visitor wants music
    this.muted = false;
    this.flat = false;          // true when a track cannot go through the room (no cross-origin access)
    this.error = '';
    this.unlocked = false;
    this.idleBpm = idleBpm;
    this.levels = { bass: 0, energy: 0.5, beat: 0, kick: 0, clock: 0, bpm: idleBpm, live: false, spectrum: new Float32Array(8) };
    this._lastBeat = 0; this._gap = 60 / idleBpm; this._dist = 10; this._pull = 0;
    this._flux = new Float32Array(700); this._fluxI = 0; this._fluxN = 0; this._fluxAcc = 0; this._fluxWas = 0; this._tempoAt = 0;

    this.el = new Audio();
    this.el.crossOrigin = 'anonymous';
    this.el.preload = 'auto';
    this.plain = new Audio();   // fallback for hosts that do not allow their audio to be processed
    this.plain.preload = 'auto';
    for (const el of [this.el, this.plain]) {
      el.addEventListener('ended', () => this._ended());
      el.addEventListener('playing', () => this._changed());
      el.addEventListener('pause', () => this._changed());
    }
    this.el.addEventListener('error', () => this._failed(false));
    this.plain.addEventListener('error', () => this._failed(true));
  }

  get current() { return this.tracks[this.index] || null; }
  get active() { return this.flat ? this.plain : this.el; }
  _changed() { this.dispatchEvent(new Event('change')); }

  /** Must be called from a click or key press: browsers keep audio locked until then. */
  unlock() {
    if (this.unlocked) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    this.unlocked = true;
    const src = ctx.createMediaElementSource(this.el);

    this.master = ctx.createGain();
    // a wall between the visitor and the music: wide open in the hall, closed down in a room next door
    this.wall = ctx.createBiquadFilter();
    this.wall.type = 'lowpass'; this.wall.Q.value = 0.6;
    this.master.connect(this.wall);
    this.wall.connect(ctx.destination);
    this.setMuffle(this.muffle ?? 0);

    // mids and highs come from the two stacks: left channel from the left one, right from the right
    const highs = ctx.createBiquadFilter(); highs.type = 'highpass'; highs.frequency.value = 140;
    const split = ctx.createChannelSplitter(2);
    src.connect(highs); highs.connect(split);
    this.panners = this.speakers.map((p, i) => {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
      pan.refDistance = 6; pan.rolloffFactor = 1.5; pan.maxDistance = 80;
      pan.coneInnerAngle = 360;
      if (pan.positionX) { pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z; } else pan.setPosition(p.x, p.y, p.z);
      split.connect(pan, i);
      pan.connect(this.master);
      return pan;
    });
    // bass is felt everywhere, so it does not come from a direction
    const lows = ctx.createBiquadFilter(); lows.type = 'lowpass'; lows.frequency.value = 140;
    this.bassGain = ctx.createGain();
    src.connect(lows); lows.connect(this.bassGain); this.bassGain.connect(this.master);
    // the room: a short reverb that takes over as you move away from the stage
    const send = ctx.createBiquadFilter(); send.type = 'lowpass'; send.frequency.value = 3200;
    const room = ctx.createConvolver(); room.buffer = this._impulse(2.4);
    this.wet = ctx.createGain();
    src.connect(send); send.connect(room); room.connect(this.wet); this.wet.connect(this.master);
    // for the lights: the untouched signal, never sent to the speakers
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0;      // fine enough to tell a kick from the bass under it; smoothed here, not there
    src.connect(this.analyser);
    this.db = new Float32Array(this.analyser.frequencyBinCount);
    this._peak = new Float32Array(8).fill(-70);      // each band's own loudest recent level, in decibels
    this._band = new Float32Array(8);                // each band against that, 0 to 1
    this._kickPeak = -70; this._kickWas = 0;
    this._applyVolume();
  }

  _impulse(seconds) {
    const rate = this.ctx.sampleRate, n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
    }
    return buf;
  }

  _applyVolume() {
    const v = this.muted ? 0 : this.volume, duck = this.duck ?? 1;
    if (this.master) this.master.gain.value = v * v * duck;  // a square feels linear to the ear
    // a track that cannot go through the room's sound cannot be filtered either: it is only turned down, a little more
    this.plain.volume = Math.min(1, v * v * this._flatGain() * duck * (1 - 0.5 * (this.muffle ?? 0)));
  }
  /** Turn the music down without touching the visitor's volume: 1 in the hall, less behind a wall, 0 for silence. */
  setDuck(k) {
    const now = this.duck ?? 1;
    if (k === now || (k > 0 && Math.abs(k - now) < 0.004)) return;
    this.duck = k;
    this._applyVolume();
  }
  /**
   * How much wall is between the visitor and the music: 0 in the hall, 1 in a room next door.
   * The highs go first and the bass keeps coming through, the way a club sounds from the corridor.
   */
  setMuffle(k) {
    k = Math.max(0, Math.min(1, k));
    if (this.wall && Math.abs(k - (this._muffled ?? -1)) < 0.003) return;
    this.muffle = k;
    if (this.wall) { this._muffled = k; this.wall.frequency.value = 20000 * Math.pow(320 / 20000, k); }   // 20 kHz open, 320 Hz through the wall
  }
  _flatGain() { return Math.max(0.12, Math.min(1, 6 / (6 + 1.5 * Math.max(0, this._dist - 6)))); }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); store.set(LS_VOLUME, this.volume); this._applyVolume(); this._changed(); }
  setMuted(m) { this.muted = !!m; this._applyVolume(); this._changed(); }
  setOrder(order) { this.order = order; this._changed(); }

  /** Start a track (or resume the current one). */
  play(i = this.index) {
    if (!this.tracks.length) { this._changed(); return; }
    this.unlock();
    const fresh = i !== this.index || !this.active.src;
    this.index = (i + this.tracks.length) % this.tracks.length;
    this.playing = true; this.error = '';
    if (fresh) {
      this.el.pause(); this.plain.pause();
      this.flat = false;
      this.el.src = this.current.src;
    }
    this.active.play().catch(() => { /* reported by the error event, or blocked until a click */ });
    this._changed();
  }
  pause() { this.playing = false; this.el.pause(); this.plain.pause(); this._changed(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  next(step = 1) {
    if (!this.tracks.length) return;
    let i = this.index + step;
    if (this.order === 'shuffle' && this.tracks.length > 1) { do { i = Math.floor(Math.random() * this.tracks.length); } while (i === this.index); }
    this.index = -1 - 1;   // force a fresh load even when the list has one track
    this.play(i);
  }
  _ended() { if (this.order === 'loop') { this.active.currentTime = 0; this.active.play().catch(() => {}); } else this.next(1); }

  _failed(wasPlain) {
    const t = this.current;
    if (!t || !this.playing) return;
    if (!wasPlain && !this.flat && /^https?:/i.test(t.src) && new URL(t.src, location.href).origin !== location.origin) {
      // The host will not share this file with the page's audio engine, so play it straight
      // through instead: it still gets quieter with distance, but has no direction or echo.
      this.flat = true;
      this.plain.src = t.src;
      this.plain.play().catch(() => {});
      this._changed();
      return;
    }
    // a track from the club's own list that will not load is almost always a file that was never put in place
    this.error = t.kind === 'list' && !/^https?:/i.test(t.src)
      ? `“${t.title}” is listed, but its audio file is not at ${t.src} yet.`
      : `Could not play “${t.title}”.`;
    this.playing = false;
    this._changed();
  }

  /** Add a direct link to an audio file or stream. Remembered on this device. */
  addLink(url) {
    let src;
    try { src = new URL(url.trim()).href; } catch { return false; }
    if (!/^https?:/i.test(src)) return false;
    this.tracks.push({ title: nameFrom(src), artist: '', src, kind: 'link' });
    this._saveLinks();
    this.play(this.tracks.length - 1);
    return true;
  }
  remove(i) {
    const t = this.tracks[i];
    if (!t || t.kind === 'list') return;
    const wasCurrent = i === this.index;
    this.tracks.splice(i, 1);
    if (t.kind === 'link') this._saveLinks();
    if (wasCurrent) { this.el.pause(); this.plain.pause(); this.el.removeAttribute('src'); this.plain.removeAttribute('src'); this.playing = false; this.index = this.tracks.length ? Math.min(i, this.tracks.length - 1) : -1; }
    else if (i < this.index) this.index--;
    this._changed();
  }
  _saveLinks() { store.set(LS_LINKS, this.tracks.filter((t) => t.kind === 'link').map(({ title, src }) => ({ title, src }))); }

  /** The spacing, in seconds, at which the kick's recent rises best repeat; null when they do not. */
  _tempo() {
    const f = this._flux, n = f.length, N = this._fluxN, last = this._fluxI - 1;
    const ago = (k) => f[(((last - k) % n) + n) % n];
    const score = new Float32Array(66);
    let best = 0, lag = 0, sum = 0;
    for (let l = 36; l <= 63; l++) {
      let s = 0;
      const terms = N - 2 * l;
      for (let k = 0; k < terms; k++) s += ago(k) * (ago(k + l) + 0.5 * ago(k + 2 * l));      // a true beat also repeats at twice its spacing
      score[l] = s / terms;
      sum += score[l];
      if (l >= 37 && l <= 62 && score[l] > best) { best = score[l]; lag = l; }
    }
    if (!(best > 0) || best < (sum / 28) * 1.25) return null;      // nothing stands out: no steady kick to go by
    const a = score[lag - 1], b = score[lag], c = score[lag + 1];
    const fine = a + c - 2 * b !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;     // between two spacings: where the peak really is
    return (lag + Math.max(-0.5, Math.min(0.5, fine))) * 0.01;
  }

  /** Call every frame: moves the listener with the visitor and reads the music for the lights. */
  update(dt, camera, forward, up) {
    const lv = this.levels;
    const p = camera.position;
    if (this.unlocked) {
      const l = this.ctx.listener;
      if (l.positionX) {
        l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
        l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
        l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
      } else {
        l.setPosition(p.x, p.y, p.z);
        l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
      }
    }
    const s0 = this.speakers[0], s1 = this.speakers[1];
    this._dist = Math.hypot(p.x - (s0.x + s1.x) / 2, p.y - (s0.y + s1.y) / 2, p.z - (s0.z + s1.z) / 2);
    const far = Math.min(1, this._dist / 26);
    if (this.unlocked) {
      this.bassGain.gain.value = 1.0 - 0.5 * far;
      this.wet.gain.value = 0.14 + 0.3 * far;
    }
    if (this.flat) this._applyVolume();

    const sounding = this.playing && !this.active.paused && !this.flat && this.unlocked;
    lv.live = sounding;
    if (sounding) {
      // Dance music is mastered loud: read on a fixed scale, every band sits at the top all the
      // time and the lights have nothing to move to. So each band is read against its own
      // loudest recent level instead, and only the top of that range counts. And because the
      // kick is what this music moves to, the kick drives the show: the bars rest low and jump
      // with it, hardest at the bass end.
      this.analyser.getFloatFrequencyData(this.db);
      const hz = this.ctx.sampleRate / this.analyser.fftSize, db = this.db;
      const level = (f0, f1) => {              // a stretch of the spectrum, as decibels of its mean power
        const i0 = Math.max(1, Math.round(f0 / hz)), i1 = Math.min(db.length, Math.max(i0 + 1, Math.round(f1 / hz)));
        let sum = 0;
        for (let i = i0; i < i1; i++) sum += db[i] > -140 ? Math.pow(10, db[i] / 10) : 0;
        return sum > 0 ? 10 * Math.log10(sum / (i1 - i0)) : -140;
      };
      let total = 0;
      for (let b = 0; b < 8; b++) {
        const d = level(EDGES[b], EDGES[b + 1]);
        this._peak[b] = Math.max(d, this._peak[b] - dt * 1.5);              // the reference sinks slowly, so a quiet passage fills the range again
        const reach = b < 2 ? 20 : 26;                                      // how many decibels below its peak a band still shows
        const v = Math.min(1, Math.max(0, (d - (this._peak[b] - reach)) / reach));
        this._band[b] += (v - this._band[b]) * Math.min(1, dt * (v > this._band[b] ? 40 : 10));      // up at once, down a little slower
        total += this._band[b];
      }
      // the kick: its own narrow stretch, read unsmoothed so its attack stays sharp
      const kd = level(38, 115);
      this._kickPeak = Math.max(kd, this._kickPeak - dt * 1.5);
      const kick = Math.min(1, Math.max(0, (kd - (this._kickPeak - 18)) / 18));
      const rise = dt > 0 ? (kick - this._kickWas) / dt : 0;                // per second, so it means the same at any frame rate
      this._kickWas = kick;
      const now = this.ctx.currentTime;
      // The tempo. Timing the gap from one kick to the next does not hold up: a bass line puts
      // hits between the beats and a breakdown leaves beats out. So the kick's rises are kept
      // for the last seven seconds, a hundred to the second, and the tempo is whichever spacing
      // (within the range dance music lives in, 97 to 165 beats a minute) they best repeat at.
      this._fluxAcc += dt;
      while (this._fluxAcc >= 0.01) {
        this._fluxAcc -= 0.01;
        this._flux[this._fluxI] = Math.max(0, kick - this._fluxWas);
        this._fluxWas = kick;
        this._fluxI = (this._fluxI + 1) % this._flux.length;
        if (this._fluxN < this._flux.length) this._fluxN++;
      }
      if (now - this._tempoAt > 0.5 && this._fluxN >= 400) {
        this._tempoAt = now;
        const gap = this._tempo();
        if (gap) this._gap += (gap - this._gap) * (Math.abs(gap - this._gap) < 0.025 ? 0.35 : 0.15);      // a small change is taken up at once, a big one has to keep being said
      }
      if (rise > 5 && kick > 0.55 && now - this._lastBeat > 0.27) {
        this._lastBeat = now;
        lv.beat = 1;
        // Bring the clock onto the beat by running it a little fast or slow for a moment. It is
        // never set back: a clock that jumped backwards made the floor's patterns stutter. A hit
        // that falls between two beats says nothing about where the beat is, and is let pass.
        const frac = lv.clock - Math.floor(lv.clock), off = frac < 0.5 ? -frac : 1 - frac;
        if (Math.abs(off) < 0.28) this._pull = off * 0.6;
      }
      lv.bpm = 60 / this._gap;
      const pump = lv.beat;                    // 1 on the kick, dying away until the next
      for (let b = 0; b < 8; b++) {
        const own = Math.pow(this._band[b], 1.5), weight = 0.7 - 0.4 * (b / 7);      // how much of this bar is the kick's
        lv.spectrum[b] = own * (1 - weight) + pump * weight * (0.35 + 0.65 * own);
      }
      lv.kick = pump;
      lv.bass = 0.45 * Math.pow(this._band[0], 1.5) + 0.55 * pump;
      lv.energy += (Math.min(1, (total / 8) * 1.15) - lv.energy) * Math.min(1, dt * 1.5);
    } else {
      // no music to read: keep the room moving on a steady clock
      lv.bpm = this.idleBpm;
      const frac = lv.clock - Math.floor(lv.clock);
      const pulse = Math.pow(Math.max(0, 1 - frac * 2.4), 2) * (this.playing ? 0.75 : 0.5);
      lv.beat = Math.max(lv.beat, pulse);
      lv.kick = lv.beat;
      lv.bass = 0.3 + 0.25 * pulse;
      lv.energy += ((this.playing ? 0.7 : 0.45) - lv.energy) * Math.min(1, dt * 2);
      for (let b = 0; b < 8; b++) {
        const v = 0.3 + 0.28 * Math.sin(lv.clock * (0.7 + b * 0.23) + b * 1.7) + 0.2 * pulse * (1 - b / 8);
        lv.spectrum[b] += (v - lv.spectrum[b]) * Math.min(1, dt * 8);
      }
    }
    let step = dt * lv.bpm / 60;
    if (this._pull) {
      const make = Math.max(-step * 0.7, Math.min(step * 1.5, this._pull));      // at most 2.5 times as fast, at least 0.3
      step += make;
      this._pull = Math.abs(this._pull - make) < 1e-4 ? 0 : this._pull - make;
    }
    lv.clock += step;
    lv.beat *= Math.exp(-dt * 6.5);
  }
}
