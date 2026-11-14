// Blood on the range: what leaves a bot that is hit, and the splatter on whatever is behind it.
//
// The pictures are the game's own (assets/club/blood/, built from its files): its wall and floor
// splatters, and the three kinds of sprite its blood impact is made of, each a short film of
// sixteen frames or more. How much of each kind a hit throws, how big, how fast, how long it
// lasts and how hard it falls are the numbers of the game's own medium blood impact
// (particles/blood_impact/blood_impact_med*.vpcf, recorded in assets/club/manifest.json).
// What is this page's own: which way each kind is taken to fly (the spray out of the far side,
// the mist back toward the shooter: the game decides that in code), how a sprite fades, and the
// size of a wall splatter, which the files do not give. Without the folder a drawn splat stands in.
import * as THREE from 'three';

const BASE = 'assets/club/';
const UNIT = 0.0254;              // the game measures in inches
const DROPS = 40, SPLATS = 28;
const SPLAT_LIFE = 20;            // seconds: the longest the game keeps its own floor splatter
// one hit: [kind of sprite, how many, radius, life in seconds, speed along the round's path, sideways speed, fall, drag, how solid, how it grows over its life]
const IMPACT = [
  ['spray', [2, 3], [11, 16], [0.5, 0.7], [50, 120], 15, 250, 0.05, [0.78, 0.86], [0.1, 2]],
  ['trail', [1, 2], [14, 20], [0.5, 0.75], [120, 250], 20, 450, 0.05, [1, 1], [1, 1]],
  ['spray', [1, 1], [4, 8], [0.5, 0.65], [250, 450], 25, 450, 0.05, [1, 1], [1, 1]],
  ['mist', [2, 3], [9, 12], [0.5, 1.0], [-250, -75], 50, 50, 0.135, [0.3, 0.65], [1, 3]],
];
const rnd = ([a, b]) => a + Math.random() * (b - a);

export function createBlood(parent) {
  const loader = new THREE.TextureLoader();
  const sheets = { spray: [], trail: [], mist: [], wall: [], ground: [] };      // each added once its picture has arrived
  const tex = (list, file, grid) => loader.load(BASE + file, (map) => {
    map.colorSpace = THREE.SRGBColorSpace;
    const cols = grid?.cols || 1, rows = grid?.rows || 1;
    list.push({ map, cols, rows, frames: grid?.frames || cols * rows, aspect: grid?.frame_width ? grid.frame_width / grid.frame_height : 1 });
  });
  // a drawn stand-in, for a checkout that has not been given the game's pictures
  const drawn = (() => {
    const s = 128, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283, r = Math.pow(Math.random(), 1.7) * s * 0.42, rad = s * (0.03 + 0.13 * Math.random() * (1 - r / (s * 0.45)));
      g.fillStyle = `rgba(${70 + Math.random() * 40 | 0},4,6,${0.75 + Math.random() * 0.25})`;
      g.beginPath(); g.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, Math.max(1.5, rad), 0, 6.283); g.fill();
    }
    const map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
    return { map, cols: 1, rows: 1, frames: 1, aspect: 1 };
  })();
  const pick = (list) => (list.length ? list[Math.floor(Math.random() * list.length)] : drawn);

  /** Fetch the game's pictures. Safe to call more than once; the stand-in serves until they arrive, and for good if there are none. */
  let asked = false;
  function load() {
    if (asked) return;
    asked = true;
    fetch(BASE + 'manifest.json').then((r) => (r.ok ? r.json() : null)).then((m) => {
      const b = m?.blood;
      if (!b) return;
      for (const d of b.decals || []) tex(/ground/.test(d.file) ? sheets.ground : sheets.wall, d.file);
      for (const s of b.sprites || []) if (sheets[s.kind]) tex(sheets[s.kind], s.file, s);
    }).catch(() => {});
  }

  // A sheet holds a film's frames in a grid. Each sprite has its own copy of the texture (the picture itself is shared), so it can show its own frame.
  function useSheet(material, sheet) {
    if (material.map?.source !== sheet.map.source) { material.map = sheet.map.clone(); material.map.needsUpdate = true; }
    material.map.repeat.set(1 / sheet.cols, 1 / sheet.rows);
  }
  function showFrame(material, sheet, f) {
    const i = Math.min(sheet.frames - 1, Math.max(0, Math.floor(f)));
    material.map.offset.set((i % sheet.cols) / sheet.cols, 1 - (Math.floor(i / sheet.cols) + 1) / sheet.rows);
  }

  const group = new THREE.Group();
  group.name = 'range-blood';
  group.userData.shotsPass = true;          // a round does not stop at a drop of blood
  parent.add(group);

  const drops = Array.from({ length: DROPS }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: drawn.map, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    s.userData = { t: 0, life: 1, v: new THREE.Vector3(), size: 0.1, fall: 0, drag: 0, solid: 1, grow: [1, 1], sheet: drawn };
    group.add(s);
    return s;
  });
  const plane = new THREE.PlaneGeometry(1, 1);
  const splats = Array.from({ length: SPLATS }, () => {
    const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: drawn.map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0 }));
    m.visible = false; m.renderOrder = 2;
    m.userData.t = 0;
    group.add(m);
    return m;
  });
  let dropI = 0, splatI = 0;
  const n = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), mInst = new THREE.Matrix4(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3();

  function splat(point, normal, size, sheet) {
    const m = splats[splatI++ % SPLATS];
    useSheet(m.material, sheet);
    showFrame(m.material, sheet, 0);
    m.position.copy(point).addScaledVector(normal, 0.006 + (splatI % 7) * 0.0006);        // each a hair off the last, so two that overlap do not fight
    m.quaternion.setFromUnitVectors(Z, normal);
    m.rotateZ(Math.random() * 6.283);
    m.scale.setScalar(size);
    m.material.opacity = 0.95;
    m.visible = true; m.userData.t = SPLAT_LIFE;
  }

  /**
   * A bot has been struck at `point` by a round travelling along `dir`. `behind` is what the round
   * would have gone on to strike (a three.js intersection, or null) and `gap` how far past the bot
   * that is: a wall or cover close behind takes a splatter.
   */
  function hit(point, dir, behind, gap) {
    side.set(-dir.z, 0, dir.x).normalize();
    for (const [kind, count, radius, life, along, across, fall, drag, solid, grow] of IMPACT) {
      const many = Math.round(rnd(count));
      for (let i = 0; i < many; i++) {
        const s = drops[dropI++ % DROPS], d = s.userData;
        d.sheet = pick(sheets[kind]);
        useSheet(s.material, d.sheet);
        showFrame(s.material, d.sheet, 0);
        const forward = rnd(along) * UNIT;
        d.v.copy(dir).multiplyScalar(forward).addScaledVector(side, (Math.random() * 2 - 1) * across * UNIT).addScaledVector(up, (Math.random() * 2 - 1) * across * UNIT);
        s.position.copy(point).addScaledVector(dir, forward > 0 ? 0.1 : -0.12);
        d.size = rnd(radius) * 2 * UNIT; d.life = rnd(life); d.t = d.life; d.fall = fall * UNIT; d.drag = drag; d.solid = rnd(solid); d.grow = grow;
        s.material.rotation = kind === 'mist' ? Math.random() * 6.283 : (Math.random() - 0.5) * 0.5;      // a spray's film is drawn upright
        s.material.opacity = d.solid;
        s.scale.set(d.size * grow[0] * d.sheet.aspect, d.size * grow[0], 1);
        s.visible = true;
      }
    }
    if (behind && behind.face && gap < 3.6) {
      const o = behind.object;
      n.copy(behind.face.normal);
      if (o.isInstancedMesh && behind.instanceId !== undefined) { o.getMatrixAt(behind.instanceId, mInst); mInst.premultiply(o.matrixWorld); n.transformDirection(mInst); } else n.transformDirection(o.matrixWorld);
      if (n.dot(dir) > 0) n.negate();
      splat(behind.point, n, (0.55 + Math.random() * 0.4) * Math.max(0.5, 1 - gap / 6), pick(sheets.wall));
    }
  }

  /** Where a bot went down: the game's floor splatter under it (30 to 40 units in radius there). */
  function pool(x, z) {
    splat(at.set(x + (Math.random() - 0.5) * 0.3, 0.004, z + (Math.random() - 0.5) * 0.3), up, rnd([30, 40]) * 2 * UNIT * 0.8, pick(sheets.ground.length ? sheets.ground : sheets.wall));
  }

  function update(dt) {
    for (const s of drops) {
      if (!s.visible) continue;
      const d = s.userData;
      d.t -= dt;
      if (d.t <= 0) { s.visible = false; continue; }
      d.v.y -= d.fall * dt;
      d.v.multiplyScalar(Math.exp(-dt * d.drag * 30));          // the game's drag is per step of its own clock; taken here as thirty steps a second
      s.position.addScaledVector(d.v, dt);
      if (s.position.y < 0.03) s.position.y = 0.03;
      const age = 1 - d.t / d.life;
      const big = d.size * (d.grow[0] + (d.grow[1] - d.grow[0]) * age);
      s.scale.set(big * d.sheet.aspect, big, 1);
      showFrame(s.material, d.sheet, age * d.sheet.frames);     // the film plays once through over the sprite's life
      s.material.opacity = d.solid * (age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4);
    }
    for (const m of splats) {
      if (!m.visible) continue;
      m.userData.t -= dt;
      if (m.userData.t < 3) m.material.opacity = Math.max(0, 0.95 * (m.userData.t / 3));
      if (m.userData.t <= 0) m.visible = false;
    }
  }

  function clear() { for (const s of drops) s.visible = false; for (const m of splats) m.visible = false; }

  return { load, hit, pool, update, clear, sheets };
}
