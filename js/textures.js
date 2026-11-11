// Procedural canvas textures: light washes, backdrops, plaques, lettering, shadows.
import * as THREE from 'three';

// Cinzel: inscriptional capitals with lining numerals, so "AK-47" and "Nº 07" engrave cleanly.
export const SERIF = 'Cinzel, "Trajan Pro", "Times New Roman", serif';
export const SANS = 'Jost, "Helvetica Neue", Helvetica, Arial, sans-serif';

function make(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rgba(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

function spaced(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

/** Shrinks the font until the text fits maxWidth. Returns the size used. */
function fitText(ctx, text, maxWidth, size, font, min = 12) {
  let s = size;
  do { ctx.font = font(s); s -= 2; } while (ctx.measureText(text).width > maxWidth && s > min);
  return s + 2;
}

/** Soft round falloff, white on transparent. Used for additive glows. */
export function glowTexture() {
  return make(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

/** Picture-light wash: hot at the top centre, spilling down and out across the wall. */
export function washTexture() {
  return make(256, 256, (ctx, w, h) => {
    ctx.save();
    ctx.translate(w / 2, h * 0.08);
    ctx.scale(1, 1.75);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h, w * 2, h * 2);
    ctx.restore();
  });
}

/** Dark velvet panel with a halo in the skin's rarity colour. */
export function backdropTexture(color, aspect = 1.5) {
  const w = 768, h = Math.round(768 / aspect);
  return make(w, h, (ctx) => {
    ctx.fillStyle = '#07070a'; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.52);
    g.addColorStop(0, rgba(color, 0.34));
    g.addColorStop(0.45, rgba(color, 0.13));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(-w, -w, w * 2, w * 2);
    ctx.restore();
    // top light falloff
    const top = ctx.createLinearGradient(0, 0, 0, h);
    top.addColorStop(0, 'rgba(255,236,205,0.10)');
    top.addColorStop(0.35, 'rgba(255,236,205,0.02)');
    top.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, w, h);
    // fabric grain
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 9;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** Engraved bronze plaque: exhibit number, weapon, finish, wear and rarity. */
export function plaqueTexture(skin, number) {
  const w = 1024, h = 288;
  return make(w, h, (ctx) => {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1d1812'); bg.addColorStop(0.5, '#14110d'); bg.addColorStop(1, '#0c0a08');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const edge = ctx.createLinearGradient(0, 0, w, h);
    edge.addColorStop(0, '#e2c48a'); edge.addColorStop(0.5, '#8d6f3d'); edge.addColorStop(1, '#d3b477');
    ctx.strokeStyle = edge; ctx.lineWidth = 5; ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.lineWidth = 1.5; ctx.strokeRect(20, 20, w - 40, h - 40);

    // exhibit number
    ctx.fillStyle = '#c9a45c'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = `500 26px ${SANS}`; spaced(ctx, 6);
    ctx.fillText('Nº', 112, 92);
    ctx.font = `500 92px ${SERIF}`; spaced(ctx, 0);
    ctx.fillText(String(number).padStart(2, '0'), 112, 172);
    ctx.fillStyle = 'rgba(201,164,92,0.45)'; ctx.fillRect(196, 52, 2, h - 104);

    // text block
    const x = 232, maxW = w - x - 48;
    ctx.textAlign = 'left';
    const top = [skin.statTrak != null ? 'STATTRAK™' : null, skin.star ? '★' : null, ((skin.finish ? skin.weapon : skin.category) || '').toUpperCase()].filter(Boolean).join('  ');
    ctx.fillStyle = skin.statTrak != null ? '#cf6a32' : '#b9a887';
    spaced(ctx, 7);
    fitText(ctx, top, maxW, 34, (s) => `500 ${s}px ${SANS}`);
    ctx.fillText(top, x, 68);

    const title = skin.finish || skin.weapon || skin.name;
    ctx.fillStyle = '#f3ead8'; spaced(ctx, 1);
    fitText(ctx, title, maxW, 84, (s) => `600 ${s}px ${SERIF}`, 36);
    ctx.fillText(title, x - 3, 150);

    const meta = [skin.exterior, skin.rarity, skin.category].filter(Boolean).join('   ·   ').toUpperCase();
    ctx.fillStyle = skin.rarityColor; ctx.beginPath(); ctx.arc(x + 10, 230, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b3a791'; spaced(ctx, 4);
    fitText(ctx, meta, maxW - 36, 29, (s) => `400 ${s}px ${SANS}`);
    ctx.fillText(meta, x + 36, 232);
  });
}

/** Brass wall lettering on a transparent ground. */
export function letteringTexture(title, subtitle, { w = 2048, h = 512 } = {}) {
  return make(w, h, (ctx) => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.8);
    g.addColorStop(0, '#fff0c9'); g.addColorStop(0.5, '#e0bb72'); g.addColorStop(1, '#a8823f');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = h * 0.06; ctx.shadowOffsetY = h * 0.012;
    spaced(ctx, 18);
    const size = fitText(ctx, title.toUpperCase(), w * 0.92, h * 0.4, (s) => `500 ${s}px ${SERIF}`, 40);
    const y = subtitle ? h * 0.42 : h * 0.5;
    ctx.fillText(title.toUpperCase(), w / 2 + 9, y);
    if (subtitle) {
      ctx.fillStyle = 'rgba(201,164,92,0.6)';
      const lineW = Math.min(w * 0.3, ctx.measureText(title.toUpperCase()).width * 0.35);
      ctx.fillRect(w / 2 - lineW / 2, y + size * 0.62, lineW, 2);
      ctx.fillStyle = '#a99670';
      spaced(ctx, 16);
      ctx.font = `400 ${Math.round(h * 0.085)}px ${SANS}`;
      ctx.fillText(subtitle.toUpperCase(), w / 2 + 8, y + size * 0.62 + h * 0.13);
    }
  });
}

/** Blurred black silhouette of an image, used as a fake drop shadow. */
export function shadowTexture(image) {
  const w = 96, h = Math.max(8, Math.round(96 * image.height / image.width));
  const small = document.createElement('canvas');
  small.width = 32; small.height = Math.max(4, Math.round(h / 3));
  const sctx = small.getContext('2d');
  sctx.drawImage(image, 0, 0, small.width, small.height);
  return make(w, h, (ctx) => {
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, w, h);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(small, -2, -2, w + 4, h + 4);
    ctx.drawImage(small, 2, 2, w - 4, h - 4);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  });
}

/**
 * Light pools baked for the floor shader. `pools` are { x, z, r, color, a } in
 * world metres; the canvas maps x across and z down (z = zMin at the top).
 */
export function floorLightTexture({ xMin, zMin, width, length, pools }) {
  const s = 20; // px per metre
  const t = make(Math.round(width * s), Math.round(length * s), (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of pools) {
      const cx = (p.x - xMin) * s, cy = (p.z - zMin) * s, r = p.r * s;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(p.color, p.a));
      g.addColorStop(0.5, rgba(p.color, p.a * 0.35));
      g.addColorStop(1, rgba(p.color, 0));
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  });
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}
