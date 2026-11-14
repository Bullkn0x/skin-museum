// The game's own sounds for a piece carried in first person, and for the shooting range.
//
// assets/sounds/ is built from the game's files by work/pipeline/make_sounds.py. Each event of
// the game's sound lists keeps the files it may play, its volume, its pitch and how many of it
// may sound at once (a rifle's shot cuts the tail of the one before, which is what gives a
// burst its sound), and each group of sounds keeps the level the game's default mix gives it
// (shots at 0.6 of the rest), and the lot passes through a limiter set like the game's own.
// What is not reproduced: the game's distance and room effects. What is this page's own:
// LEVEL, which turns the whole lot down to sit with a venue's music.
const BASE = 'assets/sounds/';
const LEVEL = 0.55;

/** Resolves to the player, or to null where the sounds have not been built (the page then stays silent). */
export async function createSounds() {
  const manifest = await fetch(BASE + 'manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!manifest?.events) return null;
  const events = manifest.events, GROUP = manifest.groups || {};
  const byLower = new Map(Object.keys(events).map((k) => [k.toLowerCase(), k]));      // the clips are not careful about case
  const find = (name) => events[name] || events[byLower.get(String(name).toLowerCase())] || null;
  const buffers = new Map();      // file -> the decoded sound, or the promise of it, or null if it could not be had
  const sounding = new Map();     // event -> the sources of it still playing, oldest first
  let ctx = null, bus = null, out = null, level = LEVEL;

  // Browsers only let a page make sound after a key or a click, so this is first called from one.
  function audio() {
    if (!ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      ctx = new Context();
      // Everything goes through a limiter set as the game sets the one on its own final mix
      // ("FinalMixGlue": threshold -6 dB, knee 3.125 dB, 40 to 1, 4 ms in, 458 ms out). It is
      // what keeps the snap of a magazine going home from standing out over a shot. A browser's
      // limiter stops at 20 to 1.
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -6; glue.knee.value = 3.125; glue.ratio.value = 20; glue.attack.value = 0.004; glue.release.value = 0.458;
      bus = ctx.createGain();
      out = ctx.createGain();
      out.gain.value = level;
      bus.connect(glue).connect(out).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function fetchBuffer(file) {
    if (!buffers.has(file)) {
      const c = audio();
      buffers.set(file, !c ? null : fetch(BASE + file)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(file))))
        .then((bytes) => c.decodeAudioData(bytes))
        .then((sound) => { buffers.set(file, sound); return sound; })
        .catch(() => { buffers.set(file, null); return null; }));
    }
    return Promise.resolve(buffers.get(file));
  }

  /** Fetch and decode these events' sounds ahead of time, so the first one is not late. */
  function load(names) {
    return Promise.all([...new Set(names)].flatMap((n) => (find(n)?.files || []).map(fetchBuffer)));
  }

  /** Play an event by its name in the game's lists. False if there is no such sound, or it has not arrived yet. */
  function play(name, { volume = 1 } = {}) {
    const e = find(name), c = e && audio();
    if (!c) return false;
    const file = e.files[Math.floor(Math.random() * e.files.length)];
    const sound = buffers.get(file);
    if (!sound || typeof sound.getChannelData !== 'function') { fetchBuffer(file); return false; }      // still on its way: there for the next time
    const src = c.createBufferSource(), gain = c.createGain();
    src.buffer = sound;
    src.playbackRate.value = Math.max(0.25, e.pitch + e.pitch_spread[0] + Math.random() * (e.pitch_spread[1] - e.pitch_spread[0]));
    gain.gain.value = e.volume * (GROUP[e.group] ?? 1) * volume;
    src.connect(gain).connect(bus);
    const at = c.currentTime + (e.delay || 0);
    src.start(at);
    // no more of one event at once than the game allows: the oldest is faded out to make room
    const live = sounding.get(name) || [];
    sounding.set(name, live);
    while (e.limit > 0 && live.length >= e.limit) {
      const old = live.shift();
      old.gain.gain.setTargetAtTime(0, at, 0.012);
      old.src.stop(at + 0.08);
    }
    const mine = { src, gain };
    live.push(mine);
    src.onended = () => { const i = live.indexOf(mine); if (i >= 0) live.splice(i, 1); };
    return true;
  }

  return {
    load, play,
    has: (name) => !!find(name),
    /** The node everything plays into, once anything has: for a venue that wants to meter it or route it. */
    get output() { return out; },
    get volume() { return level; },
    set volume(v) { level = Math.max(0, Math.min(1, v)); if (out) out.gain.value = level; },
  };
}
