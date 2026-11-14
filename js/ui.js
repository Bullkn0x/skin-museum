// DOM overlays: entrance, HUD, minimap and the exhibit detail panel.

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

const WEAR_BANDS = [
  { label: 'FN', to: 0.07 }, { label: 'MW', to: 0.15 }, { label: 'FT', to: 0.38 },
  { label: 'WW', to: 0.45 }, { label: 'BS', to: 1 },
];

// Each venue words its entrance card in its own voice. The museum keeps the original wording.
const VENUES = {
  museum: { ornament: '❦', enter: 'Enter the museum  →' },
  velvet: {
    kicker: (c) => (c ? `${c} presents` : 'Tonight only'), lede: 'Legendary CS2 skins, behind the velvet rope',
    ornament: '◆', enter: 'Step inside  →', count: (n) => `${n} pieces on show tonight`,
  },
  neon: {
    kicker: (c) => (c ? `${c} // live` : 'Live tonight'), lede: 'Legendary CS2 skins, live on the grid',
    ornament: '/ / /', enter: 'Enter the grid  →', count: (n) => `${n} exhibits online`,
  },
};
const info = { museum: null, count: 0 };

export function setMuseumInfo(museum, count) {
  info.museum = museum; info.count = count;
  const title = museum?.title || 'The Collection';
  document.title = title;
  $('intro-title').textContent = title;
  $('intro-subtitle').textContent = museum?.subtitle || '';
  $('intro-kicker').textContent = museum?.curator ? `Curated by ${museum.curator}` : 'A private collection';
  $('intro-count').textContent = `${count} exhibits on display`;
  $('hud-title').textContent = title;
  $('hud-sub').textContent = `${count} exhibits`;
}

export function setProgress(fraction) {
  $('progress-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
}

/** Mark the chosen venue on the entrance card; picking another one reloads into it. */
export function setTheme(theme, onPick) {
  document.body.dataset.theme = theme;
  const v = VENUES[theme] || VENUES.museum;
  if (v.kicker) $('intro-kicker').textContent = v.kicker(info.museum?.curator);
  if (v.lede) $('intro-subtitle').textContent = v.lede;
  if (v.count) $('intro-count').textContent = v.count(info.count);
  document.querySelector('#intro .rule i').textContent = v.ornament;
  for (const b of document.querySelectorAll('#themes .theme')) {
    const chosen = b.dataset.theme === theme;
    b.setAttribute('aria-pressed', String(chosen));
    if (!chosen) b.addEventListener('click', () => onPick(b.dataset.theme));
  }
}

export function setReady(theme = 'museum') {
  const b = $('enter');
  b.disabled = false;
  b.textContent = (VENUES[theme] || VENUES.museum).enter;
  $('progress').classList.add('is-done');
}

export function showFatal(message) {
  const f = $('fatal');
  f.textContent = message;
  f.classList.add('is-open');
}

export const toggle = (id, open) => $(id).classList.toggle('is-open', open);

/** The "E" prompt: for an exhibit, or for something else in reach (`thing`: { label, color }). */
export function setPrompt(display, thing) {
  const p = $('prompt');
  if (!display && !thing) { p.classList.remove('is-open'); return; }
  $('prompt-text').textContent = display ? `Inspect  ·  ${display.skin.name}` : thing.label;
  p.style.setProperty('--accent', display ? display.skin.rarityColor : thing.color);
  p.classList.add('is-open');
}

function wearBar(float) {
  const wrap = el('div', 'wear');
  const track = el('div', 'wear-track');
  let from = 0;
  for (const band of WEAR_BANDS) {
    const seg = el('span', `wear-seg wear-${band.label.toLowerCase()}`, band.label);
    seg.style.flex = String(band.to - from);
    track.append(seg);
    from = band.to;
  }
  const mark = el('i', 'wear-mark');
  mark.style.left = `${float * 100}%`;
  track.append(mark);
  wrap.append(track);
  return wrap;
}

function stat(label, value, className) {
  const d = el('div', 'stat');
  d.append(el('dt', null, label), el('dd', className, value));
  return d;
}

export function renderPanel(display, total) {
  const s = display.skin;
  const body = $('panel-body');
  body.replaceChildren();
  $('panel').style.setProperty('--accent', s.rarityColor);

  body.append(el('p', 'panel-kicker', `Exhibit ${String(display.number).padStart(2, '0')} of ${total}${s.collection ? `  ·  ${s.collection}` : ''}`));

  const over = el('p', 'panel-weapon');
  if (s.statTrak != null) over.append(el('span', 'stattrak', 'StatTrak™ '));
  if (s.star) over.append(el('span', 'star', '★ '));
  over.append(document.createTextNode(s.finish ? s.weapon : s.category || ''));
  body.append(over, el('h2', 'panel-title', s.finish || s.name));

  const badges = el('div', 'badges');
  if (s.rarity) badges.append(el('span', 'badge badge-rarity', s.rarity));
  if (s.exterior) badges.append(el('span', 'badge', s.exterior));
  if (s.category) badges.append(el('span', 'badge', s.category));
  body.append(badges);

  if (s.note) body.append(el('blockquote', 'note', s.note));

  if (s.float != null) {
    const f = el('div', 'float');
    const head = el('div', 'float-head');
    head.append(el('span', 'label', 'Float value'), el('span', 'float-value', s.float.toFixed(10)));
    f.append(head, wearBar(s.float));
    body.append(f);
  }

  const stats = el('dl', 'stats');
  if (s.pattern != null) stats.append(stat('Pattern seed', String(s.pattern)));
  if (s.statTrak != null) stats.append(stat('Confirmed kills', s.statTrak.toLocaleString('en-US'), 'stattrak'));
  if (s.nameTag) stats.append(stat('Name tag', `“${s.nameTag}”`));
  if (s.collection) stats.append(stat('Collection', s.collection));
  if (stats.children.length) body.append(stats);

  if (s.stickers?.length) {
    const sec = el('section', 'applied');
    sec.append(el('h3', 'label', `Stickers  ·  ${s.stickers.length}`));
    const grid = el('ul', 'stickers');
    for (const st of s.stickers) {
      const li = el('li', 'sticker');
      const i = el('img'); i.src = st.image; i.alt = ''; i.loading = 'lazy';
      const cap = el('span', 'sticker-name', st.name);
      li.append(i, cap);
      if (st.wear != null && st.wear > 0.005) li.append(el('span', 'sticker-wear', `${Math.round(st.wear * 100)}% scraped`));
      grid.append(li);
    }
    sec.append(grid);
    body.append(sec);
  }

  if (s.charm) {
    const sec = el('section', 'applied');
    sec.append(el('h3', 'label', s.charm.kind || 'Charm'));
    const row = el('div', 'charm');
    const i = el('img'); i.src = s.charm.image; i.alt = ''; i.loading = 'lazy';
    const txt = el('div');
    txt.append(el('span', 'sticker-name', s.charm.name));
    if (s.charm.pattern != null) txt.append(el('span', 'sticker-wear', `Pattern ${s.charm.pattern}`));
    row.append(i, txt);
    sec.append(row);
    body.append(sec);
  }

  if (s.description) body.append(el('p', 'description', s.description));
  if (s.flavor) body.append(el('p', 'flavor', `“${s.flavor}”`));

  const actions = el('div', 'actions');
  if (s.inspect) {
    const a = el('a', 'btn btn-primary', 'Inspect in CS2');
    a.href = s.inspect;
    actions.append(a);
  }
  if (s.market) {
    const a = el('a', 'btn btn-ghost', 'Steam Market ↗');
    a.href = s.market; a.target = '_blank'; a.rel = 'noopener';
    actions.append(a);
  }
  if (actions.children.length) body.append(actions);
  body.scrollTop = 0;
}

export function openPanel(open) {
  const p = $('panel');
  // never hide a panel that still holds keyboard focus
  if (!open && p.contains(document.activeElement)) document.activeElement.blur();
  p.classList.toggle('is-open', open);
  p.setAttribute('aria-hidden', String(!open));
  p.inert = !open;
  document.body.classList.toggle('is-inspecting', open);
}

/** Top-down map: hall outline, one dot per exhibit, and the visitor. */
export function drawMinimap(layout, displays, player, target) {
  const canvas = $('minimap');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = 132;
  const scale = (cssW - 20) / (layout.HW * 2);
  const cssH = Math.round(layout.length * scale + 20);
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const X = (x) => 10 + (x + layout.HW) * scale;
  const Y = (z) => 10 + (z - layout.zEnd) * scale;   // apse at the top

  const half = 3.2;
  ctx.beginPath();
  ctx.moveTo(X(-layout.HW), Y(0)); ctx.lineTo(X(-layout.HW), Y(layout.chamferZ));
  ctx.lineTo(X(-half), Y(layout.zEnd)); ctx.lineTo(X(half), Y(layout.zEnd));
  ctx.lineTo(X(layout.HW), Y(layout.chamferZ)); ctx.lineTo(X(layout.HW), Y(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,8,11,0.72)'; ctx.fill();
  ctx.strokeStyle = 'rgba(201,164,92,0.55)'; ctx.lineWidth = 1; ctx.stroke();

  for (const d of displays) {
    const x = X(d.pos.x), y = Y(d.pos.z);
    const active = d === target;
    ctx.fillStyle = d.skin.rarityColor;
    ctx.globalAlpha = active ? 1 : 0.8;
    ctx.beginPath();
    if (d.kind === 'pedestal') ctx.rect(x - 2.5, y - 2.5, 5, 5);
    else ctx.arc(x + d.normal.x * 2, y + d.normal.z * 2, d.kind === 'hero' ? 4 : 2.8, 0, Math.PI * 2);
    ctx.fill();
    if (active) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke(); }
  }
  ctx.globalAlpha = 1;

  // visitor
  ctx.save();
  ctx.translate(X(player.pos.x), Y(player.pos.z));
  ctx.rotate(-player.yaw);
  ctx.fillStyle = 'rgba(255,240,210,0.16)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 22, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f3ead8';
  ctx.beginPath(); ctx.moveTo(0, -5.5); ctx.lineTo(3.6, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.6, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}
