// People in the club: a DJ behind the desk and a few guests in front of the booth and about the
// room. They are the game's own agents with the game's own animations, built from its files into
// assets/club/ (the DJ and the unarmed clips) and assets/range/ (the six agents the range also
// uses). Without those folders the club is simply empty of people.
//
// What is this page's own: where each one stands, which clips they move between and when, and
// the small bend of the knees in time with the music. The game has no animation of someone
// working turntables, so the DJ uses whichever of its clips comes closest (see the manifest's notes).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ---- moving to the music -----------------------------------------------------------------------
// The hips sink and rise once a beat, lowest on the beat, along one smooth curve read off the
// room's beat clock. Two things it must never do, both learned from the first version, which
// moved the whole figure by the kick's level:
//   - follow the kick's level itself. That leaps to full in a single frame, so every beat was a
//     two-centimetre jolt (the owner's "micro stutter"). The level only says how much to move.
//   - move the feet. Each leg is bent again to reach the ankle the animation gave it, and the
//     DJ's arms to reach his hands, so shoes stay on the floor and hands on the decks.
const BOB = { guest: 0.026, dj: 0.011 };      // metres the hips travel at full strength (0 turns it off)

const _h = new THREE.Vector3(), _k = new THREE.Vector3(), _e = new THREE.Vector3(), _to = new THREE.Vector3(), _u = new THREE.Vector3();
const _w = new THREE.Vector3(), _pole = new THREE.Vector3(), _ks = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _fwd = new THREE.Vector3(), _back = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _inv = new THREE.Quaternion();
const worldTurn = (o, out) => { o.matrixWorld.decompose(_p, out, _s); return out; };

/** The bones the bend works on, or null for a figure without them. */
function rigOf(root, role) {
  const bone = (n) => root.getObjectByName(n);
  const limb = (upper, lower, end, arm) => ({ upper: bone(upper), lower: bone(lower), end: bone(end), arm, at: new THREE.Vector3(), turn: new THREE.Quaternion(), was: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()] });
  const limbs = ['L', 'R'].map((s) => limb('leg_upper_' + s, 'leg_lower_' + s, 'ankle_' + s, false));
  if (role === 'dj') limbs.push(...['L', 'R'].map((s) => limb('arm_upper_' + s, 'arm_lower_' + s, 'hand_' + s, true)));
  const pelvis = bone('pelvis');
  if (!pelvis || limbs.some((l) => !l.upper || !l.lower || !l.end)) return null;
  return { pelvis, limbs, was: new THREE.Vector3(), bent: false };
}

/** Give the bones back to the animation as it left them. The mixer only writes a bone when its
 *  value changes, so a bend left in place would be bent again the next frame. */
function unbend(r) {
  if (!r?.bent) return;
  r.pelvis.position.copy(r.was);
  for (const l of r.limbs) { l.upper.quaternion.copy(l.was[0]); l.lower.quaternion.copy(l.was[1]); l.end.quaternion.copy(l.was[2]); }
  r.bent = false;
}

/** Turn a bone about its own joint by whatever takes one direction in the room to another. (Also used by the workers in csfit.js.) */
export function swing(bone, from, to) {
  _q.setFromUnitVectors(from, to);
  worldTurn(bone.parent, _pq);
  bone.quaternion.premultiply(_inv.copy(_pq).invert().multiply(_q).multiply(_pq));
}

/** Bend a limb of two bones so its end is back where it was (`l.at`), turned as it was (`l.turn`). */
export function reach(l, lean) {
  const H = _h.setFromMatrixPosition(l.upper.matrixWorld), K = _k.setFromMatrixPosition(l.lower.matrixWorld), E = _e.setFromMatrixPosition(l.end.matrixWorld);
  const l1 = H.distanceTo(K), l2 = K.distanceTo(E);
  const D = Math.min(_to.subVectors(l.at, H).length(), (l1 + l2) * 0.9998);
  if (!(D > 1e-4 && l1 > 1e-4 && l2 > 1e-4)) return;
  const u = _u.copy(_to).normalize();
  // which way the joint points: the way it is bent already, leaning on `lean` when the limb is all but straight
  const w = _w.subVectors(E, H).normalize();
  const pole = _pole.subVectors(K, H);
  pole.addScaledVector(w, -pole.dot(w)).addScaledVector(lean, 0.02);
  pole.addScaledVector(u, -pole.dot(u));
  if (pole.lengthSq() < 1e-10) return;
  pole.normalize();
  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D), up = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const joint = _ks.copy(H).addScaledVector(u, a).addScaledVector(pole, up);
  swing(l.upper, _d1.subVectors(K, H).normalize(), _d2.subVectors(joint, H).normalize());
  l.upper.updateMatrixWorld(true);
  K.setFromMatrixPosition(l.lower.matrixWorld); E.setFromMatrixPosition(l.end.matrixWorld);
  swing(l.lower, _d1.subVectors(E, K).normalize(), _d2.subVectors(l.at, K).normalize());
  l.lower.updateMatrixWorld(true);
  l.end.quaternion.copy(worldTurn(l.end.parent, _pq).invert()).multiply(l.turn);
}

/** Lower the hips by `drop` metres and keep the feet (and the DJ's hands) where the animation put them. */
function bend(p, drop) {
  const r = p.rig;
  if (!r || !(drop > 1e-5)) return;
  r.was.copy(r.pelvis.position);
  for (const l of r.limbs) { l.was[0].copy(l.upper.quaternion); l.was[1].copy(l.lower.quaternion); l.was[2].copy(l.end.quaternion); }
  r.bent = true;
  p.root.updateMatrixWorld(true);
  for (const l of r.limbs) { l.at.setFromMatrixPosition(l.end.matrixWorld); worldTurn(l.end, l.turn); }
  _p.setFromMatrixPosition(r.pelvis.matrixWorld); _p.y -= drop;
  r.pelvis.position.copy(r.pelvis.parent.worldToLocal(_p));
  r.pelvis.updateMatrixWorld(true);
  _fwd.set(Math.sin(p.root.rotation.y), 0, Math.cos(p.root.rotation.y));      // knees forward,
  _back.copy(_fwd).negate();                                                    // elbows back
  for (const l of r.limbs) reach(l, l.arm ? _back : _fwd);
}

/**
 * @param c      the club's helpers: hall, solid
 * @param cast   [{ role: 'dj' | 'guest', x, y, z, face: [x, z] the point they look toward, clips: [name prefixes] }]
 * Returns { update(dt, levels) }. The people arrive a moment after the doors open.
 */
export function buildNpcs(c, cast) {
  const { hall, solid } = c;
  const people = [];
  for (const p of cast) solid(p.x, p.z, 0.26, 0.26, (p.y || 0) - 0.5, (p.y || 0) + 1.9);       // nobody walks through them

  (async () => {
    const [club, range] = await Promise.all(['assets/club/', 'assets/range/'].map((base) => fetch(base + 'manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    if (!club?.anims?.file) return;
    const loader = new GLTFLoader();
    const anims = await loader.loadAsync('assets/club/' + club.anims.file).catch(() => null);
    if (!anims) return;
    const meta = club.anims.clips || {};
    const dj = club.agents?.[0] ? await loader.loadAsync('assets/club/' + club.agents[0].file).catch(() => null) : null;
    // guests: the range's agents, each used once before any is used twice
    const guests = [];
    for (const a of range?.agents || []) {
      if (guests.length >= cast.filter((p) => p.role === 'guest').length) break;
      const g = await loader.loadAsync('assets/range/' + a.file).catch(() => null);
      if (g) guests.push(g);
    }
    let next = 0;
    for (const p of cast) {
      const source = p.role === 'dj' ? dj : guests.length ? guests[next++ % guests.length] : dj;
      if (!source) continue;
      const root = SkeletonUtils.clone(source.scene);
      root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });      // a skinned mesh's bounds are its rest pose's
      root.userData.shotsPass = true;                                         // a round goes through: nobody in the club is a target
      root.position.set(p.x, p.y || 0, p.z);
      root.rotation.y = Math.atan2(p.face[0] - p.x, p.face[1] - p.z);
      hall.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const names = anims.animations.map((a) => a.name).filter((n) => p.clips.some((prefix) => n.startsWith(prefix)));
      const actions = Object.fromEntries(anims.animations.filter((a) => names.includes(a.name)).map((a) => {
        const action = mixer.clipAction(a);
        const m = meta[a.name] || {};
        action.setLoop(m.pingpong ? THREE.LoopPingPong : THREE.LoopRepeat, Infinity);
        return [a.name, action];
      }));
      if (!names.length) continue;
      // no two move quite alike: each a touch early or late, and by a little more or less
      people.push({ ...p, root, mixer, actions, names, now: null, until: 0, rig: rigOf(root, p.role), late: (Math.random() - 0.5) * 0.1, much: 0.75 + Math.random() * 0.4 });
    }
  })();

  let clock = 0, beat = null, heard = 0, drive = 0;
  function update(dt, levels) {
    clock += dt;
    // The beat, eased: the room's clock is hurried or held for a moment to stay on the kick, and
    // followed directly that would show as a twitch. And how much to move: fully while the kick
    // keeps coming, fading over a few seconds when it stops (a breakdown, or no music at all).
    if (beat === null || !(Math.abs(levels.clock - beat) < 2)) beat = levels.clock;
    beat += dt * levels.bpm / 60;
    beat += (levels.clock - beat) * Math.min(1, dt * 4);
    heard = Math.max(levels.live ? levels.kick : 0, heard - dt * 0.3);
    drive += (heard - drive) * Math.min(1, dt * 1.2);
    for (const p of people) {
      unbend(p.rig);
      if (clock >= p.until) {
        // on to another of their clips, for a few bars
        const pick = p.names.length > 1 ? p.names.filter((n) => n !== p.now)[Math.floor(Math.random() * (p.names.length - 1))] : p.names[0];
        const a = p.actions[pick];
        if (pick !== p.now) {
          a.reset().setEffectiveWeight(1).play();
          if (p.now) a.crossFadeFrom(p.actions[p.now], 0.6, false);
          p.now = pick;
        }
        p.until = clock + 7 + Math.random() * 9;
      }
      p.mixer.update(dt);
      // down on the beat and up between: more for a guest than for someone with records to mind
      const swell = 0.5 + 0.5 * Math.cos((beat + p.late) * 2 * Math.PI);
      bend(p, (BOB[p.role] ?? BOB.guest) * p.much * drive * Math.pow(swell, 1.4));
    }
  }
  return { update, people, get drive() { return drive; } };
}
