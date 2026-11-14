// Canvas textures for the night club: neon lettering, LED plaques, wall coverings.
import * as THREE from 'three';
import { SANS } from '../textures.js';

function make(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const spaced = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; };
function fit(ctx, text, maxWidth, size, font, min = 14) {
  let s = size;
  do { ctx.font = font(s); s -= 2; } while (ctx.measureText(text).width > maxWidth && s > min);
  return s + 2;
}
const DISPLAY = 'Orbitron, Bahnschrift, "Arial Narrow", sans-serif';

/** Glass-tube lettering: a coloured bloom, the tube, and a white-hot core. Transparent ground. */
export function neonSign(text, { color = '#19e3ff', font = DISPLAY, weight = 700, w = 1536, h = 384, spacing = 6 } = {}) {
  return make(w, h, (ctx) => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    spaced(ctx, spacing);
    fit(ctx, text, w * 0.84, h * 0.56, (s) => `${weight} ${s}px ${font}`, 30);
    const x = w / 2 + spacing / 2, y = h * 0.52;
    ctx.lineJoin = 'round';
    for (const [blur, alpha] of [[h * 0.16, 0.9], [h * 0.07, 1], [h * 0.025, 1]]) {
      ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.globalAlpha = alpha;
      ctx.fillStyle = color; ctx.fillText(text, x, y);
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff'; ctx.fillText(text, x, y);
  });
}

/** Exhibit plaque for the neon look: a small LED panel. Same content as the museum's bronze one. */
export function ledPlaque(skin, number, accent = '#19e3ff') {
  const tag = skin.nameTag;
  const w = 1024, h = tag ? 372 : 288;
  return make(w, h, (ctx) => {
    ctx.fillStyle = '#04051a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,200,255,0.05)';
    for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
    ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.shadowColor = accent; ctx.shadowBlur = 14;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.shadowBlur = 0;

    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = `500 24px ${DISPLAY}`; spaced(ctx, 6);
    ctx.fillText('NO', 112, h / 2 - 52);
    ctx.font = `700 84px ${DISPLAY}`; spaced(ctx, 0);
    ctx.fillText(String(number).padStart(2, '0'), 112, h / 2 + 26);
    ctx.globalAlpha = 0.5; ctx.fillRect(196, 52, 2, h - 104); ctx.globalAlpha = 1;

    const x = 232, maxW = w - x - 48;
    ctx.textAlign = 'left';
    const top = [skin.statTrak != null ? 'STATTRAK™' : null, skin.star ? '★' : null, ((skin.finish ? skin.weapon : skin.category) || '').toUpperCase()].filter(Boolean).join('  ');
    ctx.fillStyle = skin.statTrak != null ? '#ff8a4a' : '#9fb6e8';
    spaced(ctx, 6);
    fit(ctx, top, maxW, 32, (s) => `500 ${s}px ${SANS}`);
    ctx.fillText(top, x, 68);

    const title = (skin.finish || skin.weapon || skin.name).toUpperCase();
    ctx.fillStyle = '#f4fbff'; ctx.shadowColor = accent; ctx.shadowBlur = 12; spaced(ctx, 3);
    fit(ctx, title, maxW, 68, (s) => `700 ${s}px ${DISPLAY}`, 30);
    ctx.fillText(title, x, 150);
    ctx.shadowBlur = 0;

    let metaY = 232;
    if (tag) {
      ctx.fillStyle = '#8ea0d0'; spaced(ctx, 6);
      ctx.font = `500 22px ${SANS}`;
      ctx.fillText('NAME TAG', x, 236);
      const labelW = ctx.measureText('NAME TAG').width + 24;
      ctx.fillStyle = '#ffe58a'; spaced(ctx, 1);
      const quoted = `“${tag}”`;
      fit(ctx, quoted, maxW - labelW, 50, (s) => `500 ${s}px ${SANS}`, 22);
      ctx.fillText(quoted, x + labelW, 232);
      ctx.fillStyle = 'rgba(25,227,255,0.3)'; ctx.fillRect(x, 272, maxW, 1.5);
      metaY = 316;
    }
    const meta = [skin.exterior, skin.rarity, skin.category].filter(Boolean).join('   ·   ').toUpperCase();
    ctx.fillStyle = skin.rarityColor; ctx.beginPath(); ctx.arc(x + 10, metaY - 2, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a9b6dc'; spaced(ctx, 4);
    fit(ctx, meta, maxW - 36, 28, (s) => `400 ${s}px ${SANS}`);
    ctx.fillText(meta, x + 36, metaY);
  });
}

/** Wall covering, tiled: damask with gold beading for Velvet, dark panels with light seams for Neon. */
export function wallCovering(neon) {
  const t = make(512, 512, (ctx, w, h) => {
    if (neon) {
      ctx.fillStyle = '#8f8fa8'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.strokeRect(10, 10, w - 20, h - 20);
      for (let i = 0; i < 1400; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    } else {
      ctx.fillStyle = '#b89aa4'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(40,0,10,0.34)'; ctx.lineWidth = 5; ctx.fillStyle = 'rgba(255,220,200,0.07)';
      const motif = (cx, cy) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 110);
        ctx.bezierCurveTo(cx + 70, cy - 40, cx + 70, cy + 20, cx, cy + 110);
        ctx.bezierCurveTo(cx - 70, cy + 20, cx - 70, cy - 40, cx, cy - 110);
        ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.stroke();
      };
      for (const [cx, cy] of [[128, 128], [384, 128], [0, 384], [256, 384], [512, 384], [128, 640], [384, -128]]) motif(cx, cy);
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
      ctx.putImageData(img, 0, 0);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Diamond-tufted upholstery. */
export function tufting() {
  const t = make(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h); ctx.stroke();
    ctx.fillStyle = '#f1cf8a';
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]]) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Velvet's back bar: lit shelves of bottles behind the DJ. */
export function backBar() {
  return make(1024, 600, (ctx, w, h) => {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#3d1d0b'); bg.addColorStop(1, '#150903');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const tints = ['#241405', '#3d2209', '#102a17', '#35101a', '#1a1a2c'];
    for (let r = 0; r < 4; r++) {
      const y = 44 + r * 138;
      const g = ctx.createLinearGradient(0, y, 0, y + 112);
      g.addColorStop(0, 'rgba(255,186,90,0.95)'); g.addColorStop(1, 'rgba(150,72,20,0.35)');
      ctx.fillStyle = g; ctx.fillRect(46, y, w - 92, 112);
      for (let i = 0; i < 26; i++) {
        const bx = 60 + i * 35, bh = 62 + Math.random() * 34;
        ctx.fillStyle = tints[Math.floor(Math.random() * tints.length)];
        ctx.fillRect(bx, y + 112 - bh, 20, bh);
        ctx.fillRect(bx + 6.5, y + 112 - bh - 20, 7, 22);
        ctx.fillStyle = 'rgba(255,230,180,0.28)'; ctx.fillRect(bx + 3, y + 112 - bh + 6, 3, bh - 12);
      }
      ctx.fillStyle = '#d6a85a'; ctx.fillRect(46, y + 112, w - 92, 8);
    }
    ctx.strokeStyle = '#d6a85a'; ctx.lineWidth = 16; ctx.strokeRect(8, 8, w - 16, h - 16);
  });
}

/** Speaker cloth / grille. */
export function grille(neon) {
  const t = make(128, 128, (ctx, w, h) => {
    ctx.fillStyle = neon ? '#0a0a1e' : '#140c08'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = neon ? '#2c2f6e' : '#5a4423';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.beginPath(); ctx.arc(x * 16 + (y % 2 ? 8 : 0) + 4, y * 16 + 8, 4.2, 0, Math.PI * 2); ctx.fill(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Upstairs floor: a carpet with a gold border for Velvet, lit glass panels for Neon. */
export function upstairsFloor(neon) {
  const t = make(512, 512, (ctx, w, h) => {
    if (neon) {
      ctx.fillStyle = '#0b0b24'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#1a2a66'; ctx.lineWidth = 8; ctx.strokeRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(25,227,255,0.55)'; ctx.lineWidth = 2.5; ctx.strokeRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#4a0a18'; ctx.fillRect(0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n * 0.3; img.data[i + 2] += n * 0.4; }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = 'rgba(214,168,90,0.35)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(w / 2, 40); ctx.lineTo(w - 40, h / 2); ctx.lineTo(w / 2, h - 40); ctx.lineTo(40, h / 2); ctx.closePath(); ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The jukebox's little screen. Redrawn whenever the music changes. */
export function jukeboxScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const ctx = canvas.getContext('2d');
  function draw({ title, state, accent }) {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#05040c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 16;
    ctx.font = `700 34px ${DISPLAY}`; spaced(ctx, 8);
    ctx.fillText(state, w / 2, 64);
    ctx.shadowBlur = 8; ctx.fillStyle = '#ffffff'; spaced(ctx, 1);
    const words = String(title).split(/\s+/);
    const lines = [''];
    ctx.font = `600 46px ${SANS}`;
    for (const word of words) {
      const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
      if (ctx.measureText(next).width > w - 60 && lines[lines.length - 1]) lines.push(word); else lines[lines.length - 1] = next;
    }
    lines.slice(0, 3).forEach((line, i) => ctx.fillText(line, w / 2, 150 + i * 54 - (Math.min(lines.length, 3) - 1) * 27 + 20));
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 22px ${SANS}`; spaced(ctx, 6);
    ctx.fillText('PRESS E TO CHOOSE THE MUSIC', w / 2, h - 34);
    texture.needsUpdate = true;
  }
  return { texture, draw };
}

/** Yellow-and-black hazard stripes, tiled. */
export function hazardStripes() {
  const t = make(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f2b90c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#141414';
    for (let i = -3; i < 3; i++) {
      const x = i * 128;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 64, 0); ctx.lineTo(x + 64 + w, h); ctx.lineTo(x + w, h); ctx.closePath(); ctx.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A builder's site board: black capitals on yellow between two bands of hazard stripes. */
export function siteBoard(text, sub) {
  return make(1024, 352, (ctx, w, h) => {
    ctx.fillStyle = '#f2b90c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#141414';
    for (const y of [0, h - 46]) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, 46); ctx.clip();
      for (let x = -80; x < w + 80; x += 76) { ctx.beginPath(); ctx.moveTo(x, y + 46); ctx.lineTo(x + 38, y + 46); ctx.lineTo(x + 84, y); ctx.lineTo(x + 46, y); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    spaced(ctx, 6);
    fit(ctx, text, w - 90, 108, (s) => `700 ${s}px ${DISPLAY}`, 30);
    ctx.fillText(text, w / 2 + 3, sub ? 150 : h / 2);
    if (sub) { spaced(ctx, 14); ctx.font = `700 40px ${DISPLAY}`; ctx.fillText(sub, w / 2 + 7, 246); }
    // a builder's board is never clean
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  });
}

/** Words sprayed through a stencil, for a bare wall. Transparent ground. */
export function stencil(text, color = '#e0892a') {
  return make(1024, 256, (ctx, w, h) => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    spaced(ctx, 18);
    fit(ctx, text, w - 80, 150, (s) => `700 ${s}px ${DISPLAY}`, 30);
    ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.globalAlpha = 0.5;
    ctx.fillStyle = color; ctx.fillText(text, w / 2 + 9, h / 2);
    ctx.shadowBlur = 0; ctx.globalAlpha = 0.92; ctx.fillText(text, w / 2 + 9, h / 2);
    // the gaps a stencil leaves, and some patches the spray missed
    ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1;
    for (let x = 60; x < w; x += 118) ctx.fillRect(x, h / 2 - 5, 7, 10);
    for (let i = 0; i < 260; i++) { ctx.globalAlpha = Math.random() * 0.5; ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 2); }
  });
}

/** Poured concrete, tiled. */
export function concrete() {
  const t = make(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8b8a86'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${Math.random() < 0.5 ? '40,40,40' : '200,198,190'},0.14)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The studio light over the stream room's door. The material's colour turns it on and off. */
export function onAirSign() {
  return make(768, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a0a14'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.55);
    g.addColorStop(0, '#ff3344'); g.addColorStop(1, '#b20d1c');
    ctx.fillStyle = g; ctx.fillRect(10, 10, w - 20, h - 20);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    spaced(ctx, 26);
    ctx.font = `700 150px ${DISPLAY}`;
    ctx.fillStyle = '#ffffff'; ctx.fillText('ON AIR', w / 2 + 13, h / 2 + 8);
  });
}

/**
 * What the stream room's screen shows while nobody is watching: the stream's latest frame when it
 * is live, a card when it is not. Redrawn when either changes.
 */
export function streamSlate() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const ctx = canvas.getContext('2d');
  function draw({ channel, status, frame, accent, hint }) {
    const w = canvas.width, h = canvas.height;
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (status === 'live' && frame) {
      ctx.drawImage(frame, 0, 0, w, h);
      const g = ctx.createLinearGradient(0, h - 190, 0, h);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.82)');
      ctx.fillStyle = g; ctx.fillRect(0, h - 190, w, 190);
    } else {
      const g = ctx.createRadialGradient(w / 2, h * 0.45, 40, w / 2, h * 0.45, w * 0.7);
      g.addColorStop(0, status === 'live' ? '#2a0c1c' : '#14141f'); g.addColorStop(1, '#040407');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
      spaced(ctx, 6);
      fit(ctx, channel, w * 0.78, 150, (s) => `700 ${s}px ${DISPLAY}`, 40);
      ctx.shadowColor = accent; ctx.shadowBlur = 34; ctx.fillStyle = accent; ctx.fillText(channel, w / 2 + 3, h * 0.36);
      ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.92; ctx.fillText(channel, w / 2 + 3, h * 0.36);
      ctx.globalAlpha = 1;
      const word = status === 'live' ? 'LIVE NOW' : status === 'offline' ? 'OFFLINE' : 'CHECKING THE STREAM';
      spaced(ctx, 16); ctx.font = `700 46px ${DISPLAY}`;
      const tw = ctx.measureText(word).width + 70;
      ctx.fillStyle = status === 'live' ? '#e91916' : 'rgba(255,255,255,0.1)';
      ctx.fillRect(w / 2 - tw / 2, h * 0.55 - 40, tw, 80);
      ctx.fillStyle = status === 'live' ? '#ffffff' : 'rgba(255,255,255,0.75)'; ctx.fillText(word, w / 2 + 8, h * 0.55 + 3);
      spaced(ctx, 4); ctx.font = `500 34px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(`twitch.tv/${channel}`, w / 2, h * 0.71);
    }
    if (status === 'live') {
      spaced(ctx, 6); ctx.font = `700 34px ${DISPLAY}`;
      ctx.fillStyle = '#e91916'; ctx.fillRect(36, 34, 150, 62);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.fillText('LIVE', 62, 68);
      if (frame) { spaced(ctx, 2); ctx.font = `600 34px ${SANS}`; ctx.shadowColor = '#000'; ctx.shadowBlur = 10; ctx.fillText(channel, 206, 67); ctx.shadowBlur = 0; }
      ctx.textAlign = 'center';
    }
    if (hint) {
      spaced(ctx, 8); ctx.font = `600 30px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillText(hint, w / 2 + 4, h - 56);
    }
    texture.needsUpdate = true;
  }
  return { texture, draw };
}

/** The stand-in for the chat beside the screen: Twitch's own chat takes its place while you watch. */
export function chatCard(channel) {
  return make(640, 1080, (ctx, w, h) => {
    ctx.fillStyle = '#0e0e14'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#18181f'; ctx.fillRect(0, 0, w, 104);
    ctx.fillStyle = '#9146ff'; ctx.fillRect(0, 104, w, 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    spaced(ctx, 8); ctx.font = `700 34px ${DISPLAY}`;
    ctx.fillStyle = '#efeff1'; ctx.fillText('STREAM CHAT', w / 2 + 4, 54);
    // empty lines, waiting for the real thing
    for (let i = 0; i < 11; i++) {
      const y = 170 + i * 62;
      ctx.fillStyle = 'rgba(145,70,255,0.3)'; ctx.fillRect(38, y, 70 + ((i * 53) % 90), 16);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(38, y + 26, 220 + ((i * 97) % 300), 12);
    }
    ctx.fillStyle = 'rgba(14,14,20,0.86)'; ctx.fillRect(0, h * 0.4, w, 190);
    spaced(ctx, 5); ctx.font = `600 32px ${SANS}`;
    ctx.fillStyle = '#efeff1'; ctx.fillText('SIT DOWN TO READ', w / 2 + 2, h * 0.4 + 70);
    ctx.fillText('AND JOIN THE CHAT', w / 2 + 2, h * 0.4 + 120);
    ctx.fillStyle = '#1f1f27'; ctx.fillRect(28, h - 118, w - 56, 78);
    spaced(ctx, 1); ctx.font = `400 28px ${SANS}`; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText(`twitch.tv/${channel}`, 52, h - 78);
  });
}
