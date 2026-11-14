// The crosshair shown while a weapon is in the hands, and the panel that chooses it.
//
// It is drawn the way the game draws its static crosshair (style 4): four bars set by size,
// thickness and gap, an optional dot, outline and "T" shape, in a colour. The numbers mean what
// they mean in the game's settings, scaled as the game scales them (one unit is the height of
// the picture divided by 480), so a crosshair copied from the game comes out the same size
// against the picture here. The game's moving styles (bars that spread as you fire) are not
// drawn: a moving one is shown at rest.
//
// A crosshair can be pasted in as the code the game hands out (CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx).
// Reading it follows what is publicly known of that code's layout; it has not been checked here
// against the game with a code of the owner's own.

const KEY = 'crosshair';
const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
const COLOURS = [[250, 50, 50], [50, 250, 50], [250, 250, 50], [50, 50, 250], [50, 250, 250]];      // the game's five named colours; a sixth is the visitor's own
const NAMES = ['Red', 'Green', 'Yellow', 'Blue', 'Cyan', 'White', 'Magenta'];
const SWATCHES = [...COLOURS, [255, 255, 255], [255, 60, 220]];
// The first is what a visitor has until they choose: a plain plus, its four bars meeting in the
// middle (the owner's wish). 'Classic' is the game's own default, which this page began with.
const PRESETS = [
  { name: 'Plus', size: 4, thickness: 1, gap: -5, dot: false, outline: true, t: false, rgb: [50, 250, 50], alpha: 255 },
  { name: 'Classic', size: 5, thickness: 0.5, gap: 1, dot: false, outline: false, t: false, rgb: [50, 250, 50], alpha: 200 },
  { name: 'Small cross', size: 2, thickness: 1, gap: -2, dot: false, outline: true, t: false, rgb: [50, 250, 250], alpha: 255 },
  { name: 'Tight', size: 1.5, thickness: 1, gap: -3, dot: false, outline: true, t: false, rgb: [255, 255, 255], alpha: 255 },
  { name: 'Dot', size: 0, thickness: 2, gap: 0, dot: true, outline: true, t: false, rgb: [250, 250, 50], alpha: 255 },
  { name: 'T', size: 3, thickness: 1, gap: -1, dot: false, outline: true, t: true, rgb: [255, 60, 220], alpha: 255 },
  { name: 'Wide', size: 4, thickness: 0.5, gap: 2, dot: true, outline: true, t: false, rgb: [255, 255, 255], alpha: 230 },
];

/** A crosshair code from the game, as settings; null if it is not one. */
export function decodeCrosshair(code) {
  const text = String(code || '').trim();
  if (!/^CSGO(-[A-Za-z0-9]{5}){5}$/.test(text)) return null;
  let big = 0n;
  for (const ch of [...text.slice(5).replace(/-/g, '')].reverse()) {
    const i = DICT.indexOf(ch);
    if (i < 0) return null;
    big = big * 57n + BigInt(i);
  }
  const b = [];
  for (let i = 0; i < 18; i++) { b.unshift(Number(big & 0xffn)); big >>= 8n; }
  if (big !== 0n || b[0] !== (b.slice(1).reduce((s, v) => s + v, 0) & 0xff)) return null;      // the first byte is the sum of the rest
  const int8 = (v) => (v > 127 ? v - 256 : v);
  const colour = b[10] & 7;
  return {
    name: 'From a code', size: (((b[15] & 0x1f) << 8) + b[14]) / 10, thickness: b[12] / 10, gap: int8(b[2]) / 10,
    dot: !!(b[13] & 0x10), outline: !!(b[10] & 8), outlineThickness: b[3] / 2, t: !!(b[13] & 0x80),
    rgb: colour < 5 ? COLOURS[colour] : [b[4], b[5], b[6]], alpha: b[13] & 0x40 ? b[7] : 200,
    style: (b[13] & 0xf) >> 1,
  };
}

/** Draw a crosshair at the middle of a canvas. `unit` is how many of the canvas's pixels one of the game's units is. */
export function drawCrosshair(ctx, w, h, c, unit) {
  ctx.clearRect(0, 0, w, h);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  // The bars start 4 + gap units out, so a gap of -4 brings them together and one below it carries
  // them past the middle, each over the others: a plus with nothing open at its centre.
  const len = Math.round(c.size * unit), thick = Math.max(1, Math.round(c.thickness * unit)), gap = Math.round((4 + c.gap) * unit);
  const o = c.outline ? Math.max(1, Math.round((c.outlineThickness || 1) * Math.max(1, unit / 2.25))) : 0;
  const half = Math.floor(thick / 2);
  const bars = [];
  if (len > 0) {
    bars.push([cx - gap - len, cy - half, len, thick], [cx + gap + (thick % 2), cy - half, len, thick], [cx - half, cy + gap + (thick % 2), thick, len]);
    if (!c.t) bars.push([cx - half, cy - gap - len, thick, len]);
  }
  if (c.dot || (len > 0 && gap <= 0)) bars.push([cx - half, cy - half, thick, thick]);      // bars that have met own the middle too
  // filled as one shape, so bars that overlap are not painted twice where they cross
  const fill = (grow, style) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    for (const [x, y, bw, bh] of bars) ctx.rect(x - grow, y - grow, bw + 2 * grow, bh + 2 * grow);
    ctx.fill();
  };
  if (o) fill(o, `rgba(0,0,0,${(c.alpha ?? 255) / 255})`);
  fill(0, `rgba(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]},${(c.alpha ?? 255) / 255})`);
}

export function createCrosshair() {
  let current = { ...PRESETS[0] };
  // One saved under 'Default' is this page's first default, kept from an earlier visit and not a
  // choice against the plus: it gives way to it.
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved && Array.isArray(saved.rgb) && Number.isFinite(saved.size) && saved.name !== 'Default') current = { ...PRESETS[0], ...saved }; } catch { /* private window */ }
  const listeners = new Set();

  const style = document.createElement('style');
  style.textContent = `
    .xhair { position: fixed; left: 50%; top: 50%; z-index: 11; pointer-events: none; display: none; image-rendering: pixelated; }
    .xhair.is-open { display: block; }
    body.has-xhair #crosshair { opacity: 0; }
    .xhair-panel { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: rgba(4, 4, 10, .62);
      font-family: Jost, system-ui, sans-serif; color: #f3ead8; }
    .xhair-panel.is-open { display: flex; }
    .xhair-panel section { width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 20px); overflow: auto; padding: 18px 22px; background: rgba(10, 10, 16, .97);
      border: 1px solid rgba(255, 255, 255, .14); border-top: 2px solid var(--accent, #19e3ff); }
    .xhair-panel h2 { margin: 0 0 10px; font: 500 12px/1.3 Jost, system-ui, sans-serif; letter-spacing: .2em; text-transform: uppercase; opacity: .75; }
    .xhair-panel .top { display: flex; gap: 14px; align-items: stretch; }
    .xhair-panel .view { flex: 0 0 150px; height: 150px; background: linear-gradient(135deg, #2b3340, #6d6a5f 55%, #1d2026); border: 1px solid rgba(255, 255, 255, .18); }
    .xhair-panel .view canvas { width: 150px; height: 150px; image-rendering: pixelated; display: block; }
    .xhair-panel .sets { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .xhair-panel button { font: 600 11px/1 Jost, system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #f3ead8; cursor: pointer;
      padding: 9px 8px; background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .26); }
    .xhair-panel button:hover, .xhair-panel button.is-on { background: rgba(255, 255, 255, .16); border-color: #fff; }
    .xhair-panel .rows { display: grid; grid-template-columns: 88px 1fr 40px; gap: 7px 10px; align-items: center; margin: 14px 0 10px; font-size: 13px; }
    .xhair-panel input[type=range] { width: 100%; }
    .xhair-panel .line { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 8px 0; font-size: 13px; }
    .xhair-panel .dotc { width: 22px; height: 22px; padding: 0; border-radius: 50%; }
    .xhair-panel input[type=text] { flex: 1; min-width: 180px; font: 13px/1 ui-monospace, Consolas, monospace; padding: 9px 10px; color: #fff; background: rgba(255, 255, 255, .07); border: 1px solid rgba(255, 255, 255, .26); }
    .xhair-panel p { margin: 8px 0 0; font-size: 12px; line-height: 1.45; opacity: .72; }
    .xhair-panel p.is-bad { color: #ff8a80; opacity: 1; }`;
  document.head.append(style);

  // the crosshair on the page
  const canvas = document.createElement('canvas');
  canvas.className = 'xhair';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  function redraw() {
    const ratio = window.devicePixelRatio || 1, unit = (window.innerHeight * ratio) / 480;
    const reach = Math.ceil((current.size + 4 + Math.max(0, current.gap) + current.thickness + 3) * unit) * 2 + 8;
    const px = Math.max(16, reach + (reach % 2));
    canvas.width = canvas.height = px;
    canvas.style.width = canvas.style.height = `${px / ratio}px`;
    canvas.style.marginLeft = canvas.style.marginTop = `${-px / ratio / 2}px`;
    drawCrosshair(ctx, px, px, current, unit);
  }
  redraw();
  window.addEventListener('resize', redraw);

  function set(next, keep = true) {
    current = { ...current, ...next };
    if (keep) { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private window */ } }
    redraw();
    for (const fn of listeners) fn(current);
  }

  // the panel
  const panel = document.createElement('div');
  panel.className = 'xhair-panel';
  panel.innerHTML = `<section>
    <h2>Crosshair</h2>
    <div class="top"><div class="view"><canvas width="150" height="150"></canvas></div><div class="sets"></div></div>
    <div class="rows">
      <label>Size</label><input type="range" data-k="size" min="0" max="10" step="0.5"><span data-v="size"></span>
      <label>Thickness</label><input type="range" data-k="thickness" min="0.5" max="4" step="0.5"><span data-v="thickness"></span>
      <label>Gap</label><input type="range" data-k="gap" min="-5" max="5" step="0.5"><span data-v="gap"></span>
    </div>
    <div class="line"><label><input type="checkbox" data-c="dot"> Centre dot</label><label><input type="checkbox" data-c="outline"> Outline</label><label><input type="checkbox" data-c="t"> T shape</label><span class="cols"></span></div>
    <div class="line"><input type="text" placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx" spellcheck="false"><button data-do="code">Use this code</button><button data-do="close">Done</button></div>
    <p data-k="note">Copy your code in the game from Settings, Game, Crosshair, Share or Import.</p>
  </section>`;
  document.body.append(panel);
  const $ = (q) => panel.querySelector(q);
  const view = $('.view canvas'), vctx = view.getContext('2d');
  const sync = () => {
    drawCrosshair(vctx, 150, 150, current, 3.2);               // enlarged, so its shape can be judged
    for (const k of ['size', 'thickness', 'gap']) { $(`[data-k=${k}]`).value = current[k]; $(`[data-v=${k}]`).textContent = current[k]; }
    for (const k of ['dot', 'outline', 't']) $(`[data-c=${k}]`).checked = !!current[k];
    panel.querySelectorAll('.sets button').forEach((b, i) => b.classList.toggle('is-on', PRESETS[i].name === current.name));
  };
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.onclick = () => { set({ outlineThickness: 1, ...p }); sync(); };
    $('.sets').append(b);
  });
  SWATCHES.forEach((rgb, i) => {
    const b = document.createElement('button');
    b.className = 'dotc'; b.title = NAMES[i]; b.setAttribute('aria-label', NAMES[i]);
    b.style.background = `rgb(${rgb.join(',')})`;
    b.onclick = () => { set({ rgb, name: 'Custom' }); sync(); };
    $('.cols').append(b);
  });
  panel.querySelectorAll('input[type=range]').forEach((i) => { i.oninput = () => { set({ [i.dataset.k]: Number(i.value), name: 'Custom' }); sync(); }; });
  panel.querySelectorAll('input[type=checkbox]').forEach((i) => { i.onchange = () => { set({ [i.dataset.c]: i.checked, name: 'Custom' }); sync(); }; });
  let done = null;
  $('[data-do=code]').onclick = () => {
    const got = decodeCrosshair($('input[type=text]').value), note = $('[data-k=note]');
    if (!got) { note.className = 'is-bad'; note.textContent = 'That is not a crosshair code this page can read. It should look like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.'; return; }
    set(got); sync();
    note.className = '';
    note.textContent = got.style !== 4 ? 'Taken. That crosshair moves in the game (it spreads as you fire); here it is drawn at rest.' : 'Taken.';
  };
  $('[data-do=close]').onclick = () => done?.();
  panel.addEventListener('mousedown', (e) => { if (e.target === panel) done?.(); });

  return {
    get current() { return current; },
    set,
    /** Show or hide it at the middle of the page. */
    show(on) { if (canvas.classList.contains('is-open') !== on) { canvas.classList.toggle('is-open', on); document.body.classList.toggle('has-xhair', on); } },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** For a thing in the venue that opens the chooser (see main.js: open and close). */
    open(whenDone) { done = whenDone; sync(); panel.style.setProperty('--accent', `rgb(${current.rgb.join(',')})`); panel.classList.add('is-open'); },
    close() { panel.classList.remove('is-open'); done = null; },
  };
}
