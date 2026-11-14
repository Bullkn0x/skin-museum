// The stream room's walls: the channel's subscribers, a plaque each, in a section for each tier,
// and the bits leaderboard. Approved by the owner from the drawings on the club's concept canvas
// (2026-11-13). As you face the screen:
//
//   left wall    Tier 1 name plates beside the seats (10 across, 8 high), the bits board by the screen
//   right wall   Tier 2 framed plaques beside the seats (6 across, 3 high), Tier 3 by the screen (3 across, 2 high)
//
// Who is on it comes from subfeed.js and changes while the visitor is in the room: a new plaque
// flies in and locks on with a flash, one whose sub has ended goes dark and fades, and the ones
// after it slide along to close the gap. Oldest first, so nobody's plaque wanders. A section with
// more subs than places turns them over a page at a time.
//
// Every plaque's face is a tile on one picture per tier, painted here with canvas drawing calls,
// and shown through one small shader that adds what moves: the band of light across a Tier 2,
// the colours that slide over a Tier 3 as you walk past and the ring turning round its picture.
import * as THREE from 'three';
import { createSubFeed } from './subfeed.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY = 86400e3;
const PAGE = 20;                   // seconds a page of a crowded section stays up

/** A plaque of each tier, in metres, and the tile its face is painted on. `rim` is how much of the slab shows round the face. */
const SHAPE = {
  1: { w: 0.6, h: 0.19, rim: 0, deep: 0, tile: [336, 106], cols: 6, rows: 19 },
  2: { w: 0.9, h: 0.45, rim: 0.014, deep: 0.045, tile: [510, 246], cols: 4, rows: 8 },
  3: { w: 1.15, h: 1.6, rim: 0.06, deep: 0.07, tile: [510, 732], cols: 4, rows: 2 },
};

/** Each club's own materials for the same three steps. */
const LOOK = {
  neon: {
    font: 'Orbitron, Bahnschrift, "Arial Narrow", sans-serif', weight: 700, small: 'Jost, system-ui, sans-serif',
    t1: { plate: '#0a0c24', edge: '#19e3ff', text: '#eafcff', dim: '#4fe9ff' },
    t2: { a: '#262860', b: '#0e0f28', edge: '#ff2bd6', text: '#ffffff', dim: '#ff8ee9', ring: ['#ff2bd6', '#8a5bff', '#19e3ff'] },
    t3: { a: '#1b1446', b: '#0a0a22', c: '#26124a', text: '#ffe9ad', dim: '#ffcf5a', rule: '#ffe7a1' },
    bits: { ground: '#0c0d2a', edge: '#a970ff', head: '#e7d9ff', dim: '#b89cff', text: '#e8ecff' },
    sign: { 1: '#19e3ff', 2: '#ff2bd6', 3: '#ffcf5a' }, names: ['TIER 1', 'TIER 2', 'TIER 3'],
  },
  velvet: {
    font: 'Cinzel, "Cormorant Garamond", Georgia, serif', weight: 600, small: 'Jost, system-ui, sans-serif',
    t1: { plate: '#1d120c', edge: '#c9a45a', text: '#f3e6c8', dim: '#c9a45a' },
    t2: { a: '#5a1420', b: '#2a090f', edge: '#e3b866', text: '#fff3d6', dim: '#e3b866', ring: ['#e3b866', '#8c5c14', '#fff3c4'] },
    t3: { a: '#6a1826', b: '#2a080e', c: '#4a101c', text: '#ffe9ad', dim: '#f7da80', rule: '#ffe7a1' },
    bits: { ground: '#170b0d', edge: '#e3b866', head: '#fff3d6', dim: '#e3b866', text: '#f3e6c8' },
    sign: { 1: '#e3b866', 2: '#ff5c9f', 3: '#ffcf5a' }, names: ['Tier 1', 'Tier 2', 'Tier 3'],
  },
};
const MEDAL = ['#ffcf5a', '#c8d2f0', '#e0985c'];
/** The colour Twitch gives a cheer of that many bits. */
const gemOf = (bits) => (bits >= 10000 ? '#f43021' : bits >= 5000 ? '#0099fe' : bits >= 1000 ? '#1db2a5' : bits >= 100 ? '#9c3ee8' : '#979797');

// ---- drawing ------------------------------------------------------------------------------------
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const spaced = (ctx, px) => { try { ctx.letterSpacing = `${px}px`; } catch { /* an older browser: plain spacing */ } };
/** Write `text` no wider than `max`, in the largest size from `big` down to `least` that fits; cut short with dots if none does. */
function fitText(ctx, text, x, y, max, big, least, font) {
  let size = big;
  for (; size > least; size -= 2) { ctx.font = font(size); if (ctx.measureText(text).width <= max) break; }
  ctx.font = font(size);
  let shown = text;
  while (shown.length > 3 && ctx.measureText(shown).width > max) shown = `${shown.slice(0, -2)}…`;
  ctx.fillText(shown, x, y);
}
/** The tier's mark: that many chevrons, one above the other, their middle at (x, y). */
function chevrons(ctx, x, y, n, color, s) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.34; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let k = 0; k < n; k++) {
    const cy = y + (k - (n - 1) / 2) * s * 0.95;
    ctx.beginPath(); ctx.moveTo(x - s, cy + s * 0.42); ctx.lineTo(x, cy - s * 0.42); ctx.lineTo(x + s, cy + s * 0.42); ctx.stroke();
  }
  ctx.restore();
}
function newTag(ctx, right, top, S) {
  ctx.save();
  ctx.font = `600 15px ${S.small}`; spaced(ctx, 2);
  const w = ctx.measureText('NEW').width + 16;
  rr(ctx, right - w, top, w, 22, 4); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.fillStyle = '#06061a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('NEW', right - w + 8, top + 12);
  ctx.restore();
}
/** A stand-in for a picture that has not arrived (or was never given): two colours and an initial, the same every time for the same name. */
function standIn(ctx, cx, cy, r, name) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = n % 360, g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, `hsl(${hue}, 85%, 62%)`); g.addColorStop(1, `hsl(${(hue + 70) % 360}, 80%, 48%)`);
  ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = 'rgba(8,8,24,.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 1.05)}px "Space Grotesk", Jost, system-ui, sans-serif`;
  ctx.fillText((name.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase(), cx, cy + r * 0.06);
}

/**
 * @param c     the club's helpers (see buildClub): hall, K, neon, mat, tex, box, sign, lamp, additive, col, cfg, renderer
 * @param room  the stream room's measurements (see rooms.js)
 * Returns { update(t, dt, camera), feed, sections }.
 */
export function buildSubWall(c, room) {
  const { hall, K, neon, mat, tex, box, sign, lamp, additive, col, cfg, renderer } = c;
  const { X0, X1, XT, XF, YB, YF, ZC, HALF, TIER, DROP, ROWS, HW } = room;
  const S = LOOK[neon ? 'neon' : 'velvet'];
  const sc = cfg.subs || {};
  const feed = createSubFeed({ url: sc.url, api: sc.api || cfg.range?.scoreApi, hide: sc.hide });
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;      // the walls are seen from the aisles beside them, at a slant
  const root = new THREE.Group();
  root.visible = false;
  hall.add(root);
  const planeGeo = new THREE.PlaneGeometry(1, 1), cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const shared = { uTime: { value: 0 } };
  const left = { z: ZC + HALF, nz: -1, rotY: Math.PI }, right = { z: ZC - HALF, nz: 1, rotY: 0 };

  // ---- pictures -----------------------------------------------------------------------------------
  const faces = new Map(), arrived = new Set();
  function face(url) {
    if (!url) return null;
    if (!faces.has(url)) {
      const img = new Image();
      img.crossOrigin = 'anonymous';             // or it could not be painted onto a plaque
      img.onload = () => { faces.set(url, img); arrived.add(url); };
      img.onerror = () => faces.set(url, null);
      faces.set(url, undefined);
      img.src = url;
    }
    return faces.get(url) || null;
  }
  function drawFace(ctx, cx, cy, r, who, ring, ringW) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    const img = face(who.avatar);
    if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2); else standIn(ctx, cx, cy, r, who.name);
    ctx.restore();
    if (ring) { ctx.lineWidth = ringW; ctx.strokeStyle = ring; ctx.beginPath(); ctx.arc(cx, cy, r + ringW / 2 - 0.5, 0, Math.PI * 2); ctx.stroke(); }
  }
  const conic = (ctx, cx, cy, stops) => {
    if (!ctx.createConicGradient) return stops[0];
    const g = ctx.createConicGradient(0, cx, cy);
    stops.forEach((s, i) => g.addColorStop(i / stops.length, s)); g.addColorStop(1, stops[0]);
    return g;
  };

  const DRAW = {
    1(ctx, w, h, sub, fresh) {
      const m = 3, pw = w - m * 2, ph = h - m * 2, T = S.t1;
      rr(ctx, m, m, pw, ph, 7); ctx.fillStyle = T.plate; ctx.fill();
      const g = ctx.createLinearGradient(0, m, 0, m + ph);
      g.addColorStop(0, rgba(T.edge, 0.2)); g.addColorStop(0.5, rgba(T.edge, 0.03)); g.addColorStop(1, rgba(T.edge, 0.14));
      ctx.fillStyle = g; ctx.fill();
      const lw = fresh ? 4 : 2.5;
      rr(ctx, m + lw / 2, m + lw / 2, pw - lw, ph - lw, 6); ctx.lineWidth = lw; ctx.strokeStyle = fresh ? '#ffffff' : T.edge; ctx.stroke();
      const r = ph * 0.35, cx = m + 14 + r, cy = h / 2;
      drawFace(ctx, cx, cy, r, sub, fresh ? '#ffffff' : T.edge, 3);
      const tx = cx + r + 17;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.text;
      fitText(ctx, sub.name, tx, cy - ph * 0.15, m + pw - 12 - tx, 28, 14, (s) => `${S.weight} ${s}px ${S.font}`);
      chevrons(ctx, tx + 7, cy + ph * 0.24, 1, T.dim, 6.5);
      ctx.font = `600 14px ${S.small}`; spaced(ctx, 2.5); ctx.fillStyle = T.dim; ctx.fillText('TIER 1', tx + 22, cy + ph * 0.25); spaced(ctx, 0);
      if (fresh) newTag(ctx, m + pw - 8, m + 8, S);
    },
    2(ctx, w, h, sub, fresh) {
      const m = 3, pw = w - m * 2, ph = h - m * 2, T = S.t2;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, T.a); g.addColorStop(0.55, T.b); g.addColorStop(1, T.a);
      rr(ctx, m, m, pw, ph, 8); ctx.fillStyle = g; ctx.fill();
      rr(ctx, m + 1.5, m + 1.5, pw - 3, ph - 3, 7); ctx.lineWidth = 3; ctx.strokeStyle = fresh ? '#ffffff' : T.edge; ctx.stroke();
      rr(ctx, m + 11, m + 11, pw - 22, ph - 22, 4); ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(T.edge, 0.55); ctx.stroke();
      const r = ph * 0.3, cx = m + 30 + r, cy = h / 2;
      ctx.lineWidth = 8; ctx.strokeStyle = conic(ctx, cx, cy, T.ring); ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
      drawFace(ctx, cx, cy, r, sub, null, 0);
      const tx = cx + r + 30;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.text;
      fitText(ctx, sub.name, tx, cy - ph * 0.11, m + pw - 24 - tx, 42, 18, (s) => `${S.weight} ${s}px ${S.font}`);
      chevrons(ctx, tx + 10, cy + ph * 0.2, 2, T.edge, 9);
      ctx.font = `600 19px ${S.small}`; spaced(ctx, 4); ctx.fillStyle = T.dim; ctx.fillText('TIER 2', tx + 32, cy + ph * 0.205); spaced(ctx, 0);
      if (fresh) newTag(ctx, m + pw - 18, m + 18, S);
    },
    3(ctx, w, h, sub, fresh) {
      const T = S.t3;
      const g = ctx.createLinearGradient(0, 0, w * 0.5, h);
      g.addColorStop(0, T.a); g.addColorStop(0.52, T.b); g.addColorStop(1, T.c);
      ctx.fillStyle = g; ctx.fillRect(3, 3, w - 6, h - 6);
      ctx.lineWidth = 2; ctx.strokeStyle = T.rule; ctx.strokeRect(8, 8, w - 16, h - 16);
      // a crown
      const kx = w / 2, ky = h * 0.058, kw = w * 0.085;
      ctx.beginPath();
      ctx.moveTo(kx - kw, ky + kw * 0.78); ctx.lineTo(kx - kw, ky - kw * 0.42); ctx.lineTo(kx - kw * 0.5, ky + kw * 0.16); ctx.lineTo(kx, ky - kw * 0.82);
      ctx.lineTo(kx + kw * 0.5, ky + kw * 0.16); ctx.lineTo(kx + kw, ky - kw * 0.42); ctx.lineTo(kx + kw, ky + kw * 0.78); ctx.closePath();
      ctx.fillStyle = '#ffcf5a'; ctx.fill(); ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff3c4'; ctx.stroke();
      // the picture, in a ring of gold (the ring of colours round that is the shader's, so it can turn)
      const r = w * 0.255, cx = w / 2, cy = h * 0.36;
      ctx.lineWidth = 12; ctx.strokeStyle = conic(ctx, cx, cy, ['#fff3c4', '#c98f22', '#fff3c4', '#8c5c14', '#f7da80', '#c98f22']);
      ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.stroke();
      drawFace(ctx, cx, cy, r, sub, null, 0);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.shadowColor = 'rgba(255,201,74,.75)'; ctx.shadowBlur = 18; ctx.fillStyle = T.text;
      fitText(ctx, sub.name, cx, h * 0.662, w * 0.86, 58, 24, (s) => `${S.weight} ${s}px ${S.font}`);
      ctx.restore();
      ctx.font = `600 23px ${S.small}`; spaced(ctx, 6);
      const tw = ctx.measureText('TIER 3').width;
      ctx.fillStyle = T.dim; ctx.fillText('TIER 3', cx + 18, h * 0.762); spaced(ctx, 0);
      chevrons(ctx, cx + 18 - tw / 2 - 24, h * 0.76, 3, T.dim, 10);
      const d = new Date(sub.since);
      ctx.font = `500 16px ${S.small}`; spaced(ctx, 2.5); ctx.fillStyle = rgba(T.dim, 0.78);
      ctx.fillText(`ON THE WALL SINCE ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, cx, h * 0.838); spaced(ctx, 0);
      if (fresh) newTag(ctx, w - 22, 22, S);
    },
  };

  // ---- the one material every face is shown through -----------------------------------------------
  const vertexShader = /* glsl */`
    uniform vec4 uRect; varying vec2 vUv; varying vec2 vTile; varying vec3 vWorld;
    void main() {
      vUv = uv; vTile = uRect.xy + uv * uRect.zw;
      vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const fragmentShader = /* glsl */`
    uniform sampler2D map; uniform float uTime, uShow, uFlash, uPulse, uPhase, uSweep, uHolo, uAspect; uniform vec3 uRing;
    varying vec2 vUv; varying vec2 vTile; varying vec3 vWorld;
    void main() {
      vec4 t = texture2D(map, vTile);
      vec3 c = t.rgb;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      if (uHolo > 0.0) {
        // colours that slide across the dark of the panel as the eye moves past it
        vec3 v = normalize(cameraPosition - vWorld);
        float a = vUv.x * 0.9 + vUv.y * 0.55 + v.x * 1.7 + v.y * 0.9 + uPhase;
        vec3 hue = 0.5 + 0.5 * cos(6.2832 * (a + vec3(0.0, 0.33, 0.67)));
        c += hue * hue * uHolo * 0.13 * (1.0 - smoothstep(0.12, 0.5, lum));
      }
      if (uRing.z > 0.0) {
        // the ring round the picture, turning
        vec2 d = vec2((vUv.x - uRing.x) * uAspect, vUv.y - uRing.y);
        float turn = atan(d.y, d.x) / 6.2832 + uTime * 0.06;
        vec3 hue = 0.5 + 0.5 * cos(6.2832 * (turn + vec3(0.0, 0.33, 0.67)));
        c += hue * 1.5 * smoothstep(0.011, 0.004, abs(length(d) - uRing.z));
      }
      // a band of light crossing the plate every few seconds
      float band = smoothstep(0.17, 0.0, abs(vUv.x + vUv.y * 0.3 - (fract(uTime / 7.0 + uPhase) * 3.2 - 1.0)));
      c += uSweep * band * 0.2;
      c *= 1.0 + uFlash * 3.0 + uPulse * 0.22 * (0.5 + 0.5 * sin(uTime * 3.2 + uPhase * 6.0));
      gl_FragColor = vec4(c, t.a * uShow);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const faceMaterial = (atlas, tier) => new THREE.ShaderMaterial({
    uniforms: {
      map: { value: atlas.texture }, uRect: { value: new THREE.Vector4() }, uTime: shared.uTime,
      uShow: { value: 0 }, uFlash: { value: 0 }, uPulse: { value: 0 }, uPhase: { value: Math.random() },
      uSweep: { value: tier === 1 ? 0 : tier === 2 ? 1 : 0.45 }, uHolo: { value: tier === 3 ? (neon ? 1 : 0.35) : 0 },      // on velvet the gilt frame does the talking
      uRing: { value: tier === 3 ? new THREE.Vector3(0.5, 0.64, (0.255 * SHAPE[3].tile[0] + 21) / SHAPE[3].tile[1]) : new THREE.Vector3() },
      uAspect: { value: SHAPE[tier].tile[0] / SHAPE[tier].tile[1] },
    },
    vertexShader, fragmentShader, transparent: true, depthWrite: false,
  });

  function makeAtlas(tier) {
    const { tile: [tw, th], cols, rows } = SHAPE[tier];
    const canvas = document.createElement('canvas');
    canvas.width = cols * tw; canvas.height = rows * th;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = aniso;
    const free = Array.from({ length: cols * rows }, (_, i) => cols * rows - 1 - i);
    return {
      canvas, ctx: canvas.getContext('2d'), texture, tw, th, dirty: false, sent: 0,
      take: () => free.pop(), give: (i) => free.push(i),
      at: (i) => ({ px: (i % cols) * tw, py: Math.floor(i / cols) * th }),
      rect: (i, out) => out.set(((i % cols) * tw) / canvas.width, 1 - (Math.floor(i / cols) * th + th) / canvas.height, tw / canvas.width, th / canvas.height),
    };
  }

  // ---- where the places are -----------------------------------------------------------------------
  const floorAt = (x) => (x > XT ? YB : x <= XF ? YF : YB - DROP * (Math.floor((XT - x) / TIER) + 1));
  const stepped = (onLanding, onTread) => {          // columns from the door end toward the screen, each with the floor under it
    const xs = [...onLanding.map((d) => X0 - d)];
    for (let i = 0; i < ROWS; i++) for (const d of onTread) xs.push(XT - TIER * i - d);
    return xs.map((x) => ({ x, floor: floorAt(x) }));
  };
  const rowsThenColumns = (columns, heights) => heights.flatMap((h) => columns.map((col) => ({ x: col.x, y: col.floor + h })));
  const PLACES = {
    // rows nearest the eye fill first, each from the door toward the screen. Ten rows, a hundred
    // places: the design drew eight, and the channel turned out to have 86 Tier 1 subs, who
    // should all be up at once rather than taking turns.
    1: rowsThenColumns(stepped([0.65, 1.35], [0.35, 1.05]), [1.495, 1.745, 1.245, 1.995, 0.995, 2.245, 2.495, 2.745, 0.745, 2.995]),
    2: rowsThenColumns(stepped([0.52, 1.48], [0.7]), [1.65, 1.05, 2.25]),
    3: [1.95, 4.0].flatMap((h) => [2.95, 1.25, 4.65].map((d) => ({ x: X1 + d, y: YF + h }))),
  };

  // ---- a section --------------------------------------------------------------------------------
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0aa3c, metalness: 1, roughness: 0.3, emissive: 0x4a3008 });
  const slabMat = {
    2: neon ? new THREE.MeshBasicMaterial({ color: col(0xff2bd6).multiplyScalar(1.25) }) : new THREE.MeshStandardMaterial({ color: K.metal, metalness: 1, roughness: 0.4, emissive: 0x2a1c08 }),
    3: gold,
  };
  function outlineTexture(tier) {
    const { tile: [tw, th] } = SHAPE[tier], cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    const ctx = cv.getContext('2d'), inset = tier === 3 ? 10 : 5;
    ctx.setLineDash(tier === 1 ? [10, 8] : [18, 12]); ctx.lineWidth = tier === 1 ? 3 : 4; ctx.strokeStyle = '#ffffff';
    rr(ctx, inset, inset, tw - inset * 2, th - inset * 2, tier === 1 ? 6 : 8); ctx.stroke();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    return t;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

  function makeSection(tier, wall) {
    const shape = SHAPE[tier], slots = PLACES[tier];
    const section = { tier, wall, shape, slots, atlas: makeAtlas(tier), plaques: [], list: [], used: 0, page: 0, pageAt: 0, ready: false, turning: false };
    // every place has a faint outline until a plaque is on it
    const outlines = new THREE.InstancedMesh(planeGeo, new THREE.MeshBasicMaterial({
      map: outlineTexture(tier), color: col(S.sign[tier]), transparent: true, opacity: tier === 1 ? 0.2 : 0.26, depthWrite: false, fog: false,
    }), slots.length);
    outlines.renderOrder = 2;
    root.add(outlines);
    section.outline = () => {
      _q.setFromEuler(_e.set(0, wall.rotY, 0));
      slots.forEach((slot, i) => {
        const on = i >= section.used ? 1 : 0;
        outlines.setMatrixAt(i, _m.compose(_p.set(slot.x, slot.y, wall.z + wall.nz * 0.006), _q, _s.set(shape.w * on, shape.h * on, 1)));
      });
      outlines.instanceMatrix.needsUpdate = true;
      outlines.computeBoundingSphere();
    };
    section.outline();
    return section;
  }

  const isFresh = (sub) => Date.now() - sub.since < DAY;
  function paint(section, p) {
    const { ctx, tw, th } = section.atlas, { px, py } = section.atlas.at(p.tile);
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath(); ctx.rect(0, 0, tw, th); ctx.clip(); ctx.clearRect(0, 0, tw, th);
    p.fresh = isFresh(p.sub);
    DRAW[section.tier](ctx, tw, th, p.sub, p.fresh);
    ctx.restore();
    section.atlas.dirty = true;
  }

  /** Put a plaque up. `how`: 'new' flies in with a flash, anything else fades in after `delay` seconds. */
  function mount(section, sub, slot, how, delay) {
    const tile = section.atlas.take();
    if (tile === undefined) { section.short = true; return; }      // every tile is held by plaques still fading: arranged again once one is free
    const { shape, wall, tier } = section;
    const g = new THREE.Group();
    g.rotation.y = wall.rotY;
    const p = { sub, tile, g, slot, x: slot.x, y: slot.y, show: 0, fly: how === 'new' ? 1 : 0, flash: how === 'new' ? 1 : 0, delay, out: false, fresh: false, extras: [] };
    if (shape.deep) {
      p.slab = new THREE.Mesh(cubeGeo, slabMat[tier]);
      p.slab.position.z = shape.deep / 2;
      g.add(p.slab);
    }
    p.face = new THREE.Mesh(planeGeo, faceMaterial(section.atlas, tier));
    p.face.scale.set(shape.w - shape.rim * 2, shape.h - shape.rim * 2, 1);
    p.face.position.z = shape.deep + 0.006;
    p.face.renderOrder = 3;
    section.atlas.rect(tile, p.face.material.uniforms.uRect.value);
    g.add(p.face);
    if (tier === 3) {
      // its own lit shelf, the light that falls round it, and the glow under the shelf
      const shelf = new THREE.Mesh(cubeGeo, gold);
      shelf.scale.set(shape.w + 0.16, 0.035, 0.17); shelf.position.set(0, -shape.h / 2 - 0.045, 0.085);
      g.add(shelf);
      p.shelf = shelf;
      for (const [w, h, y, strength] of [[shape.w * 2.1, shape.h * 1.75, 0.05, 0.3], [shape.w * 1.5, 0.7, -shape.h / 2 - 0.2, 0.55]]) {
        const m = new THREE.Mesh(planeGeo, additive(tex.glow, col(0xffc94a), 0));
        m.scale.set(w, h, 1); m.position.set(0, y, 0.003); m.renderOrder = 1;
        g.add(m);
        p.extras.push([m.material, strength]);
      }
    }
    paint(section, p);
    root.add(g);
    section.plaques.push(p);
  }
  function unmount(section, p) {
    root.remove(p.g);
    p.face.material.dispose();
    for (const [m] of p.extras) m.dispose();
    section.atlas.give(p.tile);
    section.plaques.splice(section.plaques.indexOf(p), 1);
  }

  /** Bring a section into line with its list: who stays moves to their place, who is new goes up, who has gone comes down. */
  function arrange(section, how) {
    const n = section.slots.length, list = section.list;
    const pages = Math.max(1, Math.ceil(list.length / n));
    if (section.page >= pages) section.page = 0;
    const per = Math.ceil(list.length / pages);       // pages of equal size, so the last is not a handful of plaques on an empty wall
    const showing = pages > 1 ? list.slice(section.page * per, section.page * per + per) : list;
    const place = new Map(showing.map((s, i) => [s.id, i]));
    const up = new Set();
    for (const p of section.plaques) {
      if (p.out) continue;
      const i = place.get(p.sub.id);
      if (i === undefined) { p.out = true; continue; }
      const now = showing[i];
      if (now.name !== p.sub.name || now.avatar !== p.sub.avatar) { p.sub = now; paint(section, p); } else p.sub = now;
      p.slot = section.slots[i];
      up.add(now.id);
    }
    showing.forEach((s, i) => { if (!up.has(s.id)) mount(section, s, section.slots[i], how, how === 'new' ? 0 : i * (how === 'page' ? 0.012 : 0.03)); });
    section.used = showing.length;
    section.outline();
    section.pages = pages;
    section.ready = true;
  }

  const sections = { 1: makeSection(1, left), 2: makeSection(2, right), 3: makeSection(3, right) };

  // ---- the names of the sections, and a word when the names on them are not real --------------------
  const label = (text, w, h, x, y, wall, opts) => {
    const m = sign(root, text, w, h, x, y, wall.z + wall.nz * 0.02, opts);
    m.rotation.y = wall.rotY;
    return m;
  };
  const mid = (X0 + XF) / 2;                                 // the middle of the landing and the steps
  label(S.names[0], 2.5, 0.62, mid, YB + 3.66, left, { color: S.sign[1] });
  label(S.names[1], 2.5, 0.62, mid, YB + 3.12, right, { color: S.sign[2] });
  label(S.names[2], 2.7, 0.66, X1 + 2.95, YF + 5.42, right, { color: S.sign[3] });
  if (feed.mode === 'demo') {
    const note = { color: '#cfd6ff', font: 'Jost, system-ui, sans-serif', weight: 500, w: 1024, h: 128, spacing: 4 };
    label('SAMPLE NAMES', 1.5, 0.19, mid, YB + 3.26, left, note);
    label('SAMPLE NAMES', 1.5, 0.19, mid, YB + 2.72, right, note);
    label('SAMPLE NAMES', 1.5, 0.19, X1 + 2.95, YF + 5.0, right, note);
  }

  // ---- the bits leaderboard ------------------------------------------------------------------------
  const BW = 3.4, BH = 4.4, bx = X1 + 2.95, by = YF + 0.9 + BH / 2;
  const board = document.createElement('canvas');
  board.width = 1020; board.height = 1320;
  const boardTexture = new THREE.CanvasTexture(board);
  boardTexture.colorSpace = THREE.SRGBColorSpace; boardTexture.anisotropy = aniso;
  {
    box(root, mat.black, BW + 0.16, BH + 0.16, 0.07, bx, by, left.z - 0.035);
    const edge = new THREE.MeshBasicMaterial({ color: col(S.bits.edge).multiplyScalar(1.2) });
    for (const s of [-1, 1]) {
      box(root, edge, BW + 0.2, 0.03, 0.03, bx, by + s * (BH / 2 + 0.085), left.z - 0.07);
      box(root, edge, 0.03, BH + 0.2, 0.03, bx + s * (BW / 2 + 0.085), by, left.z - 0.07);
    }
    const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: boardTexture, fog: false }));
    m.scale.set(BW, BH, 1); m.position.set(bx, by, left.z - 0.072); m.rotation.y = left.rotY;
    root.add(m);
  }
  let leaders = [];
  function drawBoard() {
    const ctx = board.getContext('2d'), w = board.width, h = board.height, T = S.bits;
    ctx.fillStyle = T.ground; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = T.head; ctx.font = `${S.weight} 66px ${S.font}`; spaced(ctx, 4); ctx.fillText('TOP CHEERS', 56, 90);
    ctx.textAlign = 'right'; ctx.fillStyle = T.dim; ctx.font = `600 26px ${S.small}`; spaced(ctx, 5); ctx.fillText(feed.mode === 'demo' ? 'SAMPLE NAMES' : 'ALL TIME', w - 56, 94); spaced(ctx, 0);
    ctx.fillStyle = rgba(T.edge, 0.6); ctx.fillRect(56, 140, w - 112, 3);
    if (!leaders.length) {
      ctx.textAlign = 'center'; ctx.fillStyle = T.text; ctx.font = `500 40px ${S.small}`;
      // with no list to read at all the board promises nothing
      ctx.fillText(feed.mode === 'off' ? 'Coming soon.' : 'No cheers yet.', w / 2, h * 0.46);
      if (feed.mode !== 'off') { ctx.fillStyle = T.dim; ctx.fillText('Yours could be the first.', w / 2, h * 0.46 + 58); }
    }
    let y = 166;
    leaders.forEach((l, i) => {
      const top = i < 3, rh = i === 0 ? 150 : top ? 132 : 98, cy = y + (rh - 14) / 2;
      if (top) {
        rr(ctx, 56, y, w - 112, rh - 14, 10); ctx.fillStyle = rgba(MEDAL[i], 0.12); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = MEDAL[i]; ctx.stroke();
      }
      ctx.textAlign = 'left'; ctx.fillStyle = top ? MEDAL[i] : T.dim;
      ctx.font = `${top ? S.weight : 500} ${i === 0 ? 62 : top ? 54 : 34}px ${S.font}`; ctx.fillText(String(l.rank), top ? 84 : 78, cy + 2);
      const r = top ? (rh - 14) * 0.36 : 30, ax = 190 + (top ? 14 : 0);
      drawFace(ctx, ax, cy, r, l, top ? MEDAL[i] : null, 4);
      const amount = l.score.toLocaleString('en-US');
      ctx.textAlign = 'right'; ctx.fillStyle = top ? '#fff6dc' : T.text; ctx.font = `${top ? S.weight : 600} ${i === 0 ? 46 : top ? 42 : 36}px ${top ? S.font : S.small}`;
      const right = w - 84, aw = ctx.measureText(amount).width;
      ctx.fillText(amount, right, cy + 2);
      const gs = top ? 13 : 10, gx = right - aw - gs - 16;
      ctx.fillStyle = gemOf(l.score); ctx.beginPath(); ctx.moveTo(gx, cy - gs); ctx.lineTo(gx + gs, cy); ctx.lineTo(gx, cy + gs); ctx.lineTo(gx - gs, cy); ctx.closePath(); ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = top ? '#ffffff' : T.text;
      fitText(ctx, l.name, ax + r + 26, cy + 1, gx - gs - 22 - (ax + r + 26), i === 0 ? 48 : top ? 44 : 36, 20, (s) => `${top ? 600 : 500} ${s}px ${S.small}`);
      y += rh;
    });
    boardTexture.needsUpdate = true;
  }
  drawBoard();

  // ---- the Tier 3 corner's light, and the sparks that rise there ---------------------------------------
  const cornerLight = lamp(X1 + 2.95, YF + 2.7, right.z + 2.3, 0xffcf8a, 0, 8);
  const PER = 14, sparkCount = PLACES[3].length * PER;
  const sparkGeo = new THREE.BufferGeometry(), sparkAt = new Float32Array(sparkCount * 3).fill(-999);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkAt, 3));
  const sparkSeed = Array.from({ length: sparkCount }, () => [Math.random(), (Math.random() - 0.5) * 1.5, 0.14 + Math.random() * 0.16, Math.random() * 6.28]);
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    map: tex.glow, color: col(0xffd98a).multiplyScalar(1.7), size: 0.055, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sparks.frustumCulled = false; sparks.renderOrder = 4;
  root.add(sparks);

  // ---- the list arrives ------------------------------------------------------------------------------
  let got = false;
  feed.onChange((data) => {
    if (data.updated === null && !data.subs.length && !got) return;        // nothing fetched yet
    got = true;
    for (const tier of [1, 2, 3]) {
      const section = sections[tier];
      section.list = data.subs.filter((s) => s.tier === tier).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
      if (!section.turning) arrange(section, section.ready ? 'new' : 'first');      // mid-turn, the page going up will be drawn from the new list anyway
    }
    leaders = data.leaders;
    drawBoard();
  });
  // lettering drawn before its font has arrived falls back to a plain one: draw again once they are in
  let redrawAll = false;
  if (document.fonts?.load) {
    Promise.all([`${S.weight} 30px ${S.font}`, `600 20px ${S.small}`, `500 20px ${S.small}`].map((f) => document.fonts.load(f).catch(() => null))).then(() => { redrawAll = true; });
  }

  const smooth = (v) => v * v * (3 - 2 * v);
  let checked = 0, lit = 0;
  function update(t, dt, camera) {
    const e = camera.position;
    // seen only from the room, its corridor, and the gallery just outside its door
    const near = e.x < -HW + 4 && Math.abs(e.z - ZC) < HALF + 2 && e.y > YB - 1.6;
    root.visible = near;
    feed.setActive(near);
    if (!near) return;
    shared.uTime.value = t;

    // pictures that have arrived, tags that have run out, fonts that have loaded
    if (t - checked > 0.3) {
      checked = t;
      const redo = (p) => redrawAll || arrived.has(p.sub.avatar) || p.fresh !== isFresh(p.sub);
      for (const section of Object.values(sections)) for (const p of section.plaques) if (redo(p)) paint(section, p);
      if (redrawAll || leaders.some((l) => arrived.has(l.avatar))) drawBoard();
      arrived.clear(); redrawAll = false;
    }

    let legends = 0;
    for (const section of Object.values(sections)) {
      const { wall, shape, atlas } = section;
      // a crowded section turns its page: the plaques come down, then the next lot go up
      if (section.pages > 1 && !section.turning && t - section.pageAt > PAGE) {
        section.pageAt = t; section.turning = true; section.page = (section.page + 1) % section.pages;
        for (const p of section.plaques) p.out = true;
      }
      if (section.turning && !section.plaques.length) { section.turning = false; section.pageAt = t; arrange(section, 'page'); }
      if (section.pages <= 1) section.pageAt = t;
      if (section.short && !section.turning && !section.plaques.some((p) => p.out)) { section.short = false; arrange(section, 'first'); }

      for (let i = section.plaques.length - 1; i >= 0; i--) {
        const p = section.plaques[i];
        if (p.delay > 0 && !p.out) { p.delay -= dt; continue; }
        if (p.out) { p.show -= dt / (section.turning ? 0.45 : 0.9); if (p.show <= 0) { unmount(section, p); continue; } }
        else p.show = Math.min(1, p.show + dt / 0.5);
        p.fly = Math.max(0, p.fly - dt / 0.8); p.flash = Math.max(0, p.flash - dt / 1.7);
        p.x = THREE.MathUtils.damp(p.x, p.slot.x, 5, dt); p.y = THREE.MathUtils.damp(p.y, p.slot.y, 5, dt);
        const out = smooth(p.fly), s = smooth(Math.max(0, p.show));
        p.g.position.set(p.x, p.y, wall.z + wall.nz * (0.004 + out * 0.75));
        p.g.scale.setScalar(1 + out * 0.55);
        const u = p.face.material.uniforms;
        u.uShow.value = s; u.uFlash.value = p.flash * p.flash; u.uPulse.value = p.fresh && !p.out ? 1 : 0;
        if (p.slab) p.slab.scale.set(shape.w * s, shape.h * s, shape.deep);
        if (p.shelf) p.shelf.visible = s > 0.5;
        for (const [m, strength] of p.extras) m.opacity = strength * s;
        if (section.tier === 3 && !p.out) legends += s;
      }
      if (atlas.dirty && t - atlas.sent > 0.2) { atlas.texture.needsUpdate = true; atlas.dirty = false; atlas.sent = t; }
    }

    // the corner glows once somebody is in it, and sparks rise past each plaque that is up
    lit = THREE.MathUtils.damp(lit, legends > 0 ? 1 : 0, 3, dt);
    cornerLight.intensity = 15 * lit;
    const three = sections[3];
    for (let k = 0; k < PLACES[3].length; k++) {
      const slot = PLACES[3][k], p = three.plaques.find((q) => q.slot === slot && !q.out && q.show > 0.6);
      for (let j = 0; j < PER; j++) {
        const i = k * PER + j, [phase, dx, speed, wob] = sparkSeed[i];
        if (!p) { sparkAt[i * 3 + 1] = -999; continue; }
        const rise = (t * speed + phase) % 1;
        sparkAt[i * 3] = slot.x + dx + Math.sin(t * 0.9 + wob) * 0.05;
        sparkAt[i * 3 + 1] = slot.y - SHAPE[3].h / 2 - 0.1 + rise * (SHAPE[3].h + 0.6);
        sparkAt[i * 3 + 2] = right.z + 0.12 + 0.1 * Math.sin(wob * 3 + t * 0.4);
      }
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  return { update, feed, sections, root, get leaders() { return leaders; } };
}
