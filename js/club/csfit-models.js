// The made things in the CSFIT room that follow the owner's own pictures: the giveaway case
// (a black moulded equipment crate with a lit seam) and the letters of the CSFIT sign. Both are
// built here as solids, from the pictures the owner sent; csfit.js says where each one stands.
//
//   the case     bevelled blocks merged into two shapes (body, lid), the label and the lid's
//                emblem painted on a canvas (or cut from the owner's picture of the case)
//   the letters  each an outline pushed out into a solid: drawn here in the logo's style, or
//                traced from the owner's logo picture when it is there
//
// What is this page's own: every measurement of the case's parts, the letterforms, and the
// painted labels. They are read off the pictures by eye.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DISPLAY = 'Orbitron, Bahnschrift, "Arial Narrow", sans-serif';

/** A giveaway case: 0.62 m long, 0.36 high, 0.42 deep, its lid the top two fifths. Its front looks along its own +z. */
export const CASE = { w: 0.62, h: 0.36, d: 0.42, lid: 0.4 };
/** Where the label sits on the body's front, and the emblem on the lid's top (metres, in the case's own frame). */
export const LABEL = { w: 0.46, h: 0.166, y: -0.077, z: 0.1986 };
export const EMBLEM = { w: 0.23, h: 0.17, y: 0.1746 };
/** The same label within the owner's picture of a case: shares of the case's own box in that picture (left, right, top, bottom). */
export const LABEL_IN_PICTURE = [0.136, 0.878, 0.48, 0.962];

const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const spaced = (ctx, px) => { try { ctx.letterSpacing = `${px}px`; } catch { /* plain spacing */ } };

// ---- solids -------------------------------------------------------------------------------------
/** Give a part the two things every part of a case needs: a picture laid flat on each of its sides, and a shade. */
function dress(g, w, h, d, tint) {
  g.clearGroups();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2), shade = new Float32Array(p.count * 3).fill(tint);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i) / w + 0.5, y = p.getY(i) / h + 0.5, z = p.getZ(i) / d + 0.5;
    if (ax >= ay && ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else if (ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  return g;
}
/** A block w by h by d with every edge taken off (by `r`), its middle at (x, y, z). */
function slab(w, h, d, x = 0, y = 0, z = 0, r = 0.005, tint = 1) {
  r = Math.min(r, w * 0.25, h * 0.25, d * 0.25);
  const a = w / 2 - r, b = h / 2 - r, k = r * 0.7;
  const s = new THREE.Shape();
  s.moveTo(-a + k, -b); s.lineTo(a - k, -b); s.lineTo(a, -b + k); s.lineTo(a, b - k); s.lineTo(a - k, b); s.lineTo(-a + k, b); s.lineTo(-a, b - k); s.lineTo(-a, -b + k); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 1, steps: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return dress(g, w, h, d, tint).translate(x, y, z);
}
/** A round bar of radius r and length len along `axis`, its middle at (x, y, z). */
function bar(r, len, axis, x, y, z, tint = 1) {
  const g = new THREE.CylinderGeometry(r, r, len, 10).toNonIndexed();
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.clearGroups();
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(tint), 3));
  return g.translate(x, y, z);
}
/** The small downward triangle stamped on the lid, standing off a front face at z. */
function arrow(x, y, z, tint) {
  const s = new THREE.Shape();
  s.moveTo(-0.012, 0.008); s.lineTo(0.012, 0.008); s.lineTo(0, -0.01); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false });
  return dress(g, 0.024, 0.018, 0.003, tint).translate(x, y, z);
}

let caseParts = null;
/**
 * The case's two shapes, each in the case's own frame (its middle at the origin, front to +z):
 * the body with its corner blocks, feet, end handles, ribs and hasp plates, and the lid with its
 * raised panel, the two bands that wrap down its front and back, and the two clasps that hang
 * across the seam. Made once and shared by every case in the room.
 */
export function caseGeometries() {
  if (caseParts) return caseParts;
  const { w: W, d: D } = CASE, body = [], lid = [];
  // ---- the body: y from -0.18 up to the seam at 0.036
  body.push(slab(0.596, 0.198, 0.396, 0, -0.073, 0, 0.008));                               // the shell
  body.push(slab(W, 0.024, D, 0, 0.020, 0, 0.006, 1.12));                                 // the rim the lid closes on
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    body.push(slab(0.08, 0.176, 0.07, sx * 0.27, -0.084, sz * 0.175, 0.01, 1.08));         // corner blocks
    body.push(slab(0.1, 0.012, 0.09, sx * 0.26, -0.174, sz * 0.165, 0.004, 0.9));          // feet
  }
  for (const sx of [-1, 1]) {
    body.push(slab(0.036, 0.05, 0.008, sx * 0.27, -0.125, 0.212, 0.003, 0.8));             // the stacking slot on each front corner, and the stud over it
    body.push(slab(0.036, 0.022, 0.006, sx * 0.27, -0.03, 0.211, 0.003, 0.85));
    // each end: a carry handle moulded in (a frame, with the grip across it) and a rib under it
    for (const y of [-0.035, -0.115]) body.push(slab(0.012, 0.012, 0.19, sx * 0.303, y, 0, 0.004, 1.1));
    for (const sz of [-1, 1]) body.push(slab(0.012, 0.092, 0.012, sx * 0.303, -0.075, sz * 0.095, 0.004, 1.1));
    body.push(slab(0.012, 0.014, 0.13, sx * 0.304, -0.052, 0, 0.005, 1.3));
    body.push(slab(0.008, 0.008, 0.2, sx * 0.301, -0.15, 0, 0.003));
    body.push(slab(0.078, 0.026, 0.012, sx * 0.155, 0.02, 0.214, 0.003, 1.25));            // the plate each clasp closes on
    body.push(bar(0.009, 0.06, 'x', sx * 0.17, 0.028, -0.207, 1.2));                       // hinge
    for (const x of [0.285, 0.06]) body.push(bar(0.0055, 0.005, 'z', sx * x, 0.02, 0.2115, 1.7));      // bolts along the rim
    body.push(bar(0.0055, 0.005, 'z', sx * 0.27, -0.075, 0.2115, 1.7));
  }
  body.push(slab(0.47, 0.012, 0.01, 0, -0.167, 0.2, 0.003, 1.1));                           // the ledge under the label
  for (const y of [-0.05, -0.12]) body.push(slab(0.44, 0.012, 0.008, 0, y, -0.201, 0.003));    // ribs across the back
  // ---- the lid: from the seam up to 0.18
  lid.push(slab(W, 0.022, D, 0, 0.051, 0, 0.006, 1.12));                                   // the rim that meets the body's
  lid.push(slab(0.6, 0.104, 0.4, 0, 0.112, 0, 0.016));                                     // the lid itself, its edges cut well back
  lid.push(slab(0.25, 0.012, 0.19, 0, 0.168, 0, 0.004, 1.15));                             // the raised panel on top, which carries the emblem
  for (const sx of [-1, 1]) {
    lid.push(slab(0.085, 0.016, 0.412, sx * 0.155, 0.171, 0, 0.005, 1.25));                // a band over the top,
    for (const sz of [-1, 1]) lid.push(slab(0.085, 0.11, 0.012, sx * 0.155, 0.117, sz * 0.204, 0.004, 1.25));      // down the front and down the back
    lid.push(slab(0.008, 0.008, 0.22, sx * 0.302, 0.11, 0, 0.003));
    lid.push(bar(0.009, 0.06, 'x', sx * 0.17, 0.046, -0.207, 1.2));
    lid.push(arrow(sx * 0.265, 0.112, 0.2, 6));
    // the clasp: its pivot on the lid, the lever across the seam, and the loop that hooks under the
    // body's plate. All of it stays above the label, whose top edge is at 0.006.
    lid.push(slab(0.078, 0.03, 0.02, sx * 0.155, 0.06, 0.218, 0.004, 1.3));
    lid.push(slab(0.052, 0.05, 0.012, sx * 0.155, 0.036, 0.226, 0.003, 1.45));
    for (const s of [-1, 1]) lid.push(slab(0.01, 0.03, 0.008, sx * 0.155 + s * 0.033, 0.024, 0.222, 0.003, 1.3));
    lid.push(slab(0.076, 0.01, 0.008, sx * 0.155, 0.012, 0.222, 0.003, 1.3));
  }
  caseParts = { body: mergeGeometries(body, false), lid: mergeGeometries(lid, false) };
  for (const g of [...body, ...lid]) g.dispose();
  return caseParts;
}

/** Moulded black plastic that has been handled: specks and scratches all over, and paler dust toward every edge of every part. */
export function scuffCanvas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d'), r = seeded(7);
  ctx.fillStyle = '#7d7d7d'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { const v = 60 + r() * 150; ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.16})`; ctx.fillRect(r() * 256, r() * 256, 1 + r() * 2.5, 1 + r() * 2.5); }
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = r() * 256, y = r() * 256, a = r() * Math.PI, l = 8 + r() * 60;
    ctx.strokeStyle = `rgba(235,235,235,${0.08 + r() * 0.2})`; ctx.lineWidth = 0.6 + r() * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  // dust and wear gather along the edges
  for (const [x0, y0, x1, y1] of [[0, 0, 30, 0], [256, 0, 226, 0], [0, 0, 0, 30], [0, 256, 0, 226]]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(255,255,255,.62)'); g.addColorStop(0.35, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  }
  return cv;
}

// ---- the letterforms ------------------------------------------------------------------------------
// The logo's capitals: very wide and heavy, corners clipped, the ends of the C's and S's arms
// turned in. Each is given for a letter 1 tall and `w` wide, as a ring of corners going round
// anticlockwise. None of the five has a hole, which keeps them one outline each.
const BAR = 0.23, STEM = 0.3, CLIP = 0.09;
export const GLYPH_WIDTH = { C: 0.912, S: 0.883, F: 0.79, I: 0.472, T: 0.693 };      // as the logo has them, in letter heights
export const GLYPHS = {
  C(w) {
    const t = 0.27, lip = 0.09, n = 0.05;
    return [[CLIP, 0], [w, 0], [w, BAR + lip], [w - t, BAR + lip], [w - t - n, BAR], [STEM, BAR], [STEM, 1 - BAR], [w - t - n, 1 - BAR], [w - t, 1 - BAR - lip], [w, 1 - BAR - lip], [w, 1], [CLIP, 1], [0, 1 - CLIP], [0, CLIP]];
  },
  S(w) {
    const t = 0.27, lip = 0.06, lo = 0.5 - BAR / 2, hi = 0.5 + BAR / 2;
    return [[0, 0], [w - CLIP, 0], [w, CLIP], [w, hi - CLIP], [w - CLIP, hi], [STEM, hi], [STEM, 1 - BAR], [w - t, 1 - BAR], [w - t, 1 - BAR - lip], [w, 1 - BAR - lip], [w, 1], [CLIP, 1], [0, 1 - CLIP],
      [0, lo + CLIP], [CLIP, lo], [w - STEM, lo], [w - STEM, BAR], [t, BAR], [t, BAR + lip], [0, BAR + lip]];
  },
  F(w) {
    const arm = w * 0.8, m0 = 0.4, m1 = 0.6;
    return [[0, 0], [STEM - 0.05, 0], [STEM, 0.05], [STEM, m0], [arm - 0.04, m0], [arm, m0 + 0.04], [arm, m1], [STEM, m1], [STEM, 1 - BAR], [w - 0.05, 1 - BAR], [w, 1 - BAR + 0.05], [w, 1], [CLIP, 1], [0, 1 - CLIP]];
  },
  I(w) { return [[0, 0], [w - CLIP, 0], [w, CLIP], [w, 1], [CLIP, 1], [0, 1 - CLIP]]; },
  T(w) {
    const x0 = (w - STEM) / 2, x1 = (w + STEM) / 2;
    return [[x0, 0], [x1 - 0.06, 0], [x1, 0.06], [x1, 1 - BAR], [w - 0.05, 1 - BAR], [w, 1 - BAR + 0.05], [w, 1], [CLIP, 1], [0, 1 - CLIP], [0, 1 - BAR], [x0, 1 - BAR]];
  },
};
/** A letter's outline with both sides running 0 to 1 (so it lies on its own square picture). */
export const glyphOutline = (ch, w = GLYPH_WIDTH[ch]) => GLYPHS[ch](w).map(([x, y]) => [x / w, y]);
/** The dumbbell mark that ends the logo: a bar through plates of three sizes. Boxes [x0, x1, y0, y1] for a mark 1 wide and 0.52 tall. */
export const MARK_PLATES = [[0.04, 0.96, 0.215, 0.305], [0.04, 0.1, 0.16, 0.36], [0.115, 0.215, 0.02, 0.5], [0.23, 0.31, 0.09, 0.43], [0.69, 0.77, 0.09, 0.43], [0.785, 0.885, 0.02, 0.5], [0.9, 0.96, 0.16, 0.36]];

/**
 * An outline pushed out into a solid, for a sign's letter. The outline runs 0 to 1 both ways;
 * the solid comes back 1 wide, 1 tall and 1 deep about its own middle (front at +0.5), leaning
 * over by `lean` (how far the top sits to the right of the bottom, in widths), for the caller to
 * scale. Its two flat ends take the first material, its sides the second, and its front lies
 * on the outline's own square picture.
 */
export function solidOf(outlines, lean = 0) {
  const shapes = outlines.map((pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
  const edge = 0.012;
  const g = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: edge, bevelOffset: -edge, bevelSegments: 2, steps: 1, curveSegments: 1 });
  g.translate(-0.5, -0.5, -0.5);
  g.scale(1, 1, 1 / 1.16);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + p.getY(i) * lean);
  g.computeVertexNormals();
  return g;
}

/**
 * The outline of the biggest bright thing in a picture (a letter cut from the logo, on clear
 * ground): followed round its edge pixel by pixel and then straightened into a few dozen
 * corners. Returns corners running 0 to 1 with y upward, or null if nothing usable is there.
 */
export function traceOutline(ctx, w, h, level = 96) {
  const px = ctx.getImageData(0, 0, w, h).data, on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = px[i * 4 + 3] > level ? 1 : 0;
  // the biggest piece that hangs together: streaks and glow round the letter fall away
  const piece = new Int32Array(w * h).fill(-1), sizes = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!on[s] || piece[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    stack.push(s); piece[s] = id;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i - x) / w;
      n++;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && on[j] && piece[j] < 0) { piece[j] = id; stack.push(j); }
    }
    sizes.push(n);
  }
  if (!sizes.length) return null;
  const big = sizes.indexOf(Math.max(...sizes));
  if (sizes[big] < w * h * 0.04) return null;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && piece[y * w + x] === big;
  // Walk the edge between inside and outside from corner to corner of the pixel grid, keeping
  // the inside on the right hand. It starts along the top of the first inside pixel, going east.
  let sx = -1, sy = -1;
  for (let y = 0; y < h && sx < 0; y++) for (let x = 0; x < w; x++) if (inside(x, y)) { sx = x; sy = y; break; }
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];      // east, south, west, north (y grows downward here)
  const ring = [];
  let x = sx, y = sy, d = 0;
  const leftIn = (cx, cy, dir) => (dir === 0 ? inside(cx, cy - 1) : dir === 1 ? inside(cx, cy) : dir === 2 ? inside(cx - 1, cy) : inside(cx - 1, cy - 1));
  const rightIn = (cx, cy, dir) => (dir === 0 ? inside(cx, cy) : dir === 1 ? inside(cx - 1, cy) : dir === 2 ? inside(cx - 1, cy - 1) : inside(cx, cy - 1));
  for (let guard = 0; guard < w * h * 4; guard++) {
    ring.push([x, y]);
    x += DIRS[d][0]; y += DIRS[d][1];
    // At the new corner, which way goes on with the inside on the right hand and the outside on
    // the left? A right turn is tried first: it keeps to the pixels that touch by their sides,
    // so the ring never crosses itself where two only touch by a corner.
    for (const nd of [(d + 1) % 4, d, (d + 3) % 4]) if (rightIn(x, y, nd) && !leftIn(x, y, nd)) { d = nd; break; }
    if (x === sx && y === sy && d === 0) break;
  }
  if (ring.length < 8) return null;
  // straighten: drop every corner that lies within a pixel and a bit of the line between its neighbours that are kept
  const keep = new Uint8Array(ring.length);
  const far = (a, b) => {
    let worst = 0, at = -1;
    const [ax, ay] = ring[a], [bx, by] = ring[b % ring.length], len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) { const dist = Math.abs((ring[i][0] - ax) * (by - ay) - (ring[i][1] - ay) * (bx - ax)) / len; if (dist > worst) { worst = dist; at = i; } }
    return [worst, at];
  };
  const split = (a, b) => { const [worst, at] = far(a, b); if (at > 0 && worst > 1.6) { keep[at] = 1; split(a, at); split(at, b); } };
  let opposite = 0, reach = 0;
  for (let i = 1; i < ring.length; i++) { const dd = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (dd > reach) { reach = dd; opposite = i; } }
  keep[0] = keep[opposite] = 1;
  split(0, opposite); split(opposite, ring.length);
  const out = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push([ring[i][0] / w, 1 - ring[i][1] / h]);
  return out.length >= 3 ? out : null;
}

// ---- painting -------------------------------------------------------------------------------------
/**
 * Cracked ice: shards of the given colours over what is there, and hairline cracks between them.
 * `blend` is how the shards meet what is under them ('multiply' deepens it and keeps its colour).
 */
function ice(ctx, x, y, w, h, colours, r, count, blend = 'source-over', cracks = true) {
  ctx.globalCompositeOperation = blend;
  for (let i = 0; i < count; i++) {
    const cx = x + r() * w, cy = y + r() * h, s = 14 + r() * Math.min(w, h) * 0.42, a0 = r() * 6.28, sides = 3 + Math.floor(r() * 3);
    ctx.beginPath();
    for (let k = 0; k < sides; k++) { const a = a0 + (k / sides) * 6.28 + r() * 0.5, d = s * (0.45 + r() * 0.55); ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * d, cy + Math.sin(a) * d); }
    ctx.closePath();
    ctx.fillStyle = colours[Math.floor(r() * colours.length)]; ctx.globalAlpha = 0.12 + r() * 0.3; ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.globalCompositeOperation = 'source-over';
  if (!cracks) return;
  for (let i = 0; i < count * 0.8; i++) {
    let cx = x + r() * w, cy = y + r() * h, a = r() * 6.28;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) { a += (r() - 0.5) * 1.3; cx += Math.cos(a) * (8 + r() * 26); cy += Math.sin(a) * (8 + r() * 26); ctx.lineTo(cx, cy); }
    ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,20,.3)'; ctx.stroke();
  }
}
/** The path of the word CSFIT in the logo's letters, `tall` high, its bottom left at (x, y). Returns how wide it came out. */
export function wordPath(ctx, x, y, tall, lean = 0.24, gap = 0.075) {
  let at = 0;
  ctx.beginPath();
  for (const ch of 'CSFIT') {
    const w = GLYPH_WIDTH[ch];
    GLYPHS[ch](w).forEach(([gx, gy], i) => ctx[i ? 'lineTo' : 'moveTo'](x + (at + gx + gy * lean) * tall, y - gy * tall));
    ctx.closePath();
    at += w + gap;
  }
  return (at - gap + lean) * tall;
}
/** The dumbbell mark, `wide` across, its middle at (x, y). */
export function markPath(ctx, x, y, wide) {
  ctx.beginPath();
  for (const [x0, x1, y0, y1] of MARK_PLATES) ctx.rect(x + (x0 - 0.5) * wide, y + (0.26 - y1) * wide, (x1 - x0) * wide, (y1 - y0) * wide);
}
/** A curved knife with a gut hook behind its point, about 2s long, its middle at (x, y). */
function knifePath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - 1.0 * s, y + 0.5 * s);
  ctx.lineTo(x - 0.3 * s, y - 0.02 * s);
  ctx.quadraticCurveTo(x + 0.25 * s, y - 0.8 * s, x + 1.0 * s, y - 0.78 * s);       // the spine, up to the point
  ctx.quadraticCurveTo(x + 0.8 * s, y - 0.5 * s, x + 0.56 * s, y - 0.5 * s);        // the hook
  ctx.quadraticCurveTo(x + 0.78 * s, y - 0.22 * s, x + 0.5 * s, y + 0.1 * s);       // the belly
  ctx.quadraticCurveTo(x + 0.12 * s, y + 0.34 * s, x - 0.2 * s, y + 0.3 * s);
  ctx.lineTo(x - 0.78 * s, y + 0.78 * s);
  ctx.closePath();
}
const wear = (ctx, w, h, r, n) => {
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) { ctx.globalAlpha = 0.25 + r() * 0.6; ctx.fillRect(r() * w, r() * h, 1 + r() * 3.5, 1 + r() * 2.2); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
};
const STYLE = {
  blue: { ground: ['#06103f', '#0b2a9c'], shards: ['#1746d6', '#2f6bff', '#0c2f9e', '#4a8dff', '#08185e'], ink: ['#7fc0ff', '#3f8fff'], pale: ['#d9eeff', '#9fd0ff'], stripe: '#5aa6ff', band: '#0a1f7a' },
  green: { ground: ['#0b0c0e', '#101114'], shards: [], ink: ['#c3ea2a', '#a4cf14'], pale: ['#e6f79a', '#6f8f0c'], stripe: '#b6e21e', band: '#0b0c0e' },
  violet: { ground: ['#0a0a10', '#0e0e16'], shards: [], ink: ['#3fb6ff', '#8a4bff'], pale: ['#bfe9ff', '#d0b0ff'], stripe: '#6a55f0', band: '#0a0a10' },
};
/** The label on a case's front, as the owner's pictures have it. `line` is the words under the name; `mark` is 'knife' or 'bell'. */
export function paintLabel(ctx, w, h, kind, line, mark) {
  const st = STYLE[kind], r = seeded(kind.length * 977 + 3);
  const ground = ctx.createLinearGradient(0, 0, w, h);
  ground.addColorStop(0, st.ground[0]); ground.addColorStop(1, st.ground[1]);
  ctx.fillStyle = ground; ctx.fillRect(0, 0, w, h);
  if (st.shards.length) ice(ctx, 0, 0, w, h, st.shards, r, 150);
  else for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 2 + r() * 5, 1.4); }
  const ink = ctx.createLinearGradient(w * 0.08, 0, w * 0.9, 0);
  ink.addColorStop(0, st.ink[0]); ink.addColorStop(1, st.ink[1]);
  // the name, in the logo's letters, and its mark after it
  const tall = h * 0.37, base = h * 0.55, x0 = w * 0.085;
  const wide = wordPath(ctx, x0, base, tall);
  ctx.save(); ctx.clip();
  ctx.fillStyle = ink; ctx.fillRect(0, 0, w, h);
  ice(ctx, x0, base - tall, wide, tall, st.pale, r, 70);
  ctx.restore();
  wordPath(ctx, x0, base, tall); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,10,.55)'; ctx.stroke();
  const mx = x0 + wide + (w * 0.93 - x0 - wide) / 2, my = base - tall * 0.5;
  const ks = Math.min(tall * 0.62, (w * 0.93 - x0 - wide) * 0.42);
  if (mark === 'knife') knifePath(ctx, mx, my + tall * 0.08, ks);
  else markPath(ctx, mx, my, Math.min(tall * 1.5, (w * 0.95 - x0 - wide) * 0.9));
  ctx.fillStyle = ink; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,10,.5)'; ctx.stroke();
  if (mark === 'knife') {
    // two holes through the handle
    ctx.globalCompositeOperation = 'destination-out';
    for (const [hx, hy] of [[-0.74, 0.5], [-0.5, 0.3]]) { ctx.beginPath(); ctx.arc(mx + hx * ks, my + tall * 0.08 + hy * ks, ks * 0.06, 0, 6.3); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
  }
  // the line under it, between two rules
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${Math.round(h * 0.085)}px ${DISPLAY}`; spaced(ctx, h * 0.022);
  const lw = ctx.measureText(line).width, ly = h * 0.7;
  ctx.fillStyle = kind === 'violet' ? ink : '#c9ccd4'; ctx.fillText(line, w / 2 + h * 0.011, ly); spaced(ctx, 0);
  ctx.fillStyle = 'rgba(201,204,212,.7)';
  for (const s of [-1, 1]) ctx.fillRect(w / 2 + s * (lw / 2 + h * 0.07) - (s < 0 ? h * 0.36 : 0), ly - 1.5, h * 0.36, 3);
  // hazard stripes along the bottom
  const y0 = h * 0.82, y1 = h * 0.955;
  ctx.fillStyle = st.band; ctx.fillRect(w * 0.035, y0, w * 0.93, y1 - y0);
  ctx.save(); ctx.beginPath(); ctx.rect(w * 0.035, y0, w * 0.93, y1 - y0); ctx.clip();
  ctx.fillStyle = kind === 'violet' ? ink : st.stripe;
  const pitch = h * 0.27;
  for (let x = -pitch; x < w + pitch; x += pitch) { ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x + pitch * 0.5, y1); ctx.lineTo(x + pitch * 0.5 + (y1 - y0) * 1.1, y0); ctx.lineTo(x + (y1 - y0) * 1.1, y0); ctx.closePath(); ctx.fill(); }
  if (st.shards.length) ice(ctx, 0, y0, w, y1 - y0, st.pale, r, 26);
  ctx.restore();
  // worn print, and the dark that gathers in the panel's corners
  wear(ctx, w, h, r, 900);
  const dark = ctx.createRadialGradient(w / 2, h / 2, h * 0.5, w / 2, h / 2, w * 0.62);
  dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = dark; ctx.fillRect(0, 0, w, h);
}
/** The small emblem on the lid's raised panel. */
export function paintEmblem(ctx, w, h, kind) {
  const st = STYLE[kind], r = seeded(kind.length * 131 + 9);
  ctx.fillStyle = st.ground[0]; ctx.fillRect(0, 0, w, h);
  if (st.shards.length) ice(ctx, 0, 0, w, h, st.shards, r, 60);
  const ink = ctx.createLinearGradient(w * 0.1, 0, w * 0.9, 0);
  ink.addColorStop(0, st.ink[0]); ink.addColorStop(1, st.ink[1]);
  if (kind === 'blue') { knifePath(ctx, w * 0.5, h * 0.55, h * 0.36); ctx.fillStyle = ink; ctx.fill(); }
  else if (kind === 'green') {
    ctx.fillStyle = st.stripe;
    for (let i = 0; i < 3; i++) { const x = w * (0.26 + i * 0.17); ctx.beginPath(); ctx.moveTo(x, h * 0.66); ctx.lineTo(x + w * 0.09, h * 0.66); ctx.lineTo(x + w * 0.2, h * 0.34); ctx.lineTo(x + w * 0.11, h * 0.34); ctx.closePath(); ctx.fill(); }
  } else {
    const tall = h * 0.3, wide = wordPath(ctx, 0, 0, tall);
    wordPath(ctx, (w - wide - tall * 0.9) / 2, h * 0.64, tall); ctx.fillStyle = ink; ctx.fill();
    markPath(ctx, (w - wide - tall * 0.9) / 2 + wide + tall * 0.5, h * 0.64 - tall / 2, tall * 0.85); ctx.fill();
  }
  wear(ctx, w, h, r, 260);
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, w - 8, h - 8);
}
/**
 * The front of one of the sign's letters, drawn: the logo's colours running across it from
 * `inkFrom` to `inkTo` (a gradient made by the caller), cracked like ice, with a bright rim just
 * inside its outline. The whole square is painted; the solid only shows the part inside its outline.
 */
export function paintFace(ctx, w, h, outline, ink, seed) {
  const r = seeded(seed * 31 + 5);
  ctx.fillStyle = ink; ctx.fillRect(0, 0, w, h);
  // deep shards first, which darken the letter's colour without changing it, then fewer pale ones
  ice(ctx, 0, 0, w, h, ['#2a3658', '#46557c', '#141c36'], r, 60, 'multiply', false);
  ice(ctx, 0, 0, w, h, ['#ffffff', '#dff4ff'], r, 26);
  const sheen = ctx.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, 'rgba(255,255,255,.14)'); sheen.addColorStop(0.45, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,30,.3)');
  ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  outline.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * w, (1 - y) * h));
  ctx.closePath();
  // half of this line falls outside the letter, so the rim is half as wide as it is drawn; kept
  // narrow because the club's bloom spreads it, and a wide one washed the face's colour out
  ctx.lineJoin = 'miter'; ctx.lineWidth = h * 0.045; ctx.strokeStyle = 'rgba(235,250,255,.95)'; ctx.stroke();
}
