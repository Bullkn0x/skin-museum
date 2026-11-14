// Carrying a piece: take it off its display, hold it in first person, inspect it, fire it.
// On in the two clubs (their shooting range needs it; ?noequip switches it off), on request in
// the museum (?equip).
//
// What is the game's own, built from its files by work/pipeline/make_viewmodel.py into
// assets/viewmodel/: the first-person arms and their skeleton, the gloves' meshes (wearing the
// collection's own painted pairs), each weapon type's draw, idle, inspect, shoot, reload and
// knife-attack animations with the cues they carry (when a reload adds its rounds, how long a shot
// blocks an inspect, which stretch of an inspect repeats while the key is held), and each gun's
// numbers: magazine, rate of fire, spread, and the angle and strength of every shot's kick.
// The weapon in the hands is the same model that hangs on the wall.
//
// What is this page's own, and so a guess at the game's feel: the slight lag of the weapon behind
// the view, the bob while walking, the forearm twist (the game's rig drives two twist bones that
// the clips do not carry), the blends between clips, the muzzle flash, the streak and the mark a
// round leaves. How a kick builds and settles is the rule and the constants known from CS:GO; it
// is no longer a guess: stepped at the game's 64 ticks a second it reproduces the AK-47's and the
// M4A4's sprays as players have measured them in the game, shot for shot (docs/3d-pilot.md).
//
// main.js only calls in through a few hooks (key, update, resize), and a venue hears each shot
// through onShot, so this can be lifted out again by deleting this file and those calls.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { createSounds } from './sounds.js';
import { createCrosshair } from './crosshair.js';

const BASE = 'assets/viewmodel/';
const INCH = 0.0254, DEG = Math.PI / 180;
// The game's three first-person presets (Settings > Game > Item > Viewmodel position).
const VIEWS = [
  { name: 'Desktop', fov: 60, offset: [1, 1, -1] },
  { name: 'Couch', fov: 54, offset: [0, 0, 0] },
  { name: 'Classic', fov: 68, offset: [2.5, 0, -1.5] },
];
// How a kick settles: the console values CS:GO shipped with (weapon_recoil_scale, view_recoil_tracking,
// weapon_recoil_decay2_exp, _lin, weapon_recoil_vel_decay, weapon_recoil_decay_coefficient,
// weapon_recoil_suppression_shots, _factor). With the game's own angle, strength and seed for each
// weapon they give the measured sprays (sideways steps within a count or two in forty, the climb within three).
const RECOIL = { scale: 2.0, tracking: 0.45, decayExp: 8, decayLin: 18, velDecay: 4.5, indexDecay: 2.0, quietShots: 4, quietFactor: 0.75 };
// A knife's reach and the wait after a swing: CS:GO's numbers (48 and 32 units; 0.4/0.5 s and 1.0/1.1 s).
const KNIFE = { slash: { reach: 48 * INCH, miss: 0.4, hit: 0.5 }, stab: { reach: 32 * INCH, miss: 1.0, hit: 1.1 } };
const MARKS = 48, MARK_LIFE = 14;
const damp = THREE.MathUtils.damp, clamp = THREE.MathUtils.clamp;

export async function createEquip({ scene, camera, composer, museum, player, debug }) {
  const res = await fetch(BASE + 'manifest.json');
  if (!res.ok) throw new Error('assets/viewmodel/manifest.json is missing: run work/pipeline/make_viewmodel.py --install <checkout>');
  const manifest = await res.json();
  const loader = new GLTFLoader();

  // ---- a second, tiny scene drawn over the hall: the arms and what they hold ------------------
  const vmScene = new THREE.Scene();
  vmScene.add(new THREE.HemisphereLight(0x9aa0b4, 0x18130e, 0.5));     // the same sky light the venues give their models
  const vmCamera = new THREE.PerspectiveCamera(47, 1, 0.01, 12);
  const holder = new THREE.Group();        // the game's viewmodel offset, plus this page's lag and bob
  vmScene.add(holder);
  const pass = new RenderPass(vmScene, vmCamera);
  pass.clear = false;                       // over the hall already drawn
  pass.clearDepth = true;                   // and never through a wall the visitor stands against
  pass.enabled = false;
  composer.insertPass(pass, 1);

  let viewIdx = 0;
  function applyViewPreset() {
    const v = VIEWS[viewIdx];
    // viewmodel_fov is the horizontal angle on a 4:3 picture; wider windows see more to the sides
    vmCamera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(v.fov / 2)) * 0.75));
    vmCamera.aspect = window.innerWidth / window.innerHeight;
    vmCamera.updateProjectionMatrix();
  }
  applyViewPreset();

  // ---- hint line and round counter ------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .equip-hint { position: fixed; left: 50%; bottom: calc(13% + 56px); transform: translateX(-50%); z-index: 12; pointer-events: none;
      font: 500 13px/1.3 Jost, system-ui, sans-serif; letter-spacing: .04em; color: #e9e6df; text-align: center; white-space: nowrap;
      padding: 7px 14px; border-radius: 999px; background: rgba(10, 10, 14, .62); border: 1px solid rgba(255, 255, 255, .14);
      opacity: 0; transition: opacity .2s; }
    .equip-hint.is-open { opacity: 1; }
    .equip-hint kbd { font: 600 11px/1 Jost, system-ui, sans-serif; padding: 2px 6px; margin: 0 4px 0 10px; border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, .35); background: rgba(255, 255, 255, .08); }
    .equip-hint kbd:first-child { margin-left: 0; }
    .equip-hint b { font-weight: 600; color: #fff; }
    .equip-ammo { position: fixed; right: 24px; bottom: 72px; z-index: 12; pointer-events: none; color: #f3ead8;
      font: 600 34px/1 Jost, system-ui, sans-serif; letter-spacing: .02em; text-shadow: 0 1px 6px rgba(0, 0, 0, .7);
      opacity: 0; transition: opacity .2s; font-variant-numeric: tabular-nums; }
    .equip-ammo.is-open { opacity: 1; }
    .equip-ammo.is-low b { color: #ff6b5e; }
    .equip-ammo b { font-weight: 600; }
    .equip-ammo span { font-size: 16px; font-weight: 500; opacity: .7; margin-left: 8px; }
    .equip-scope { position: fixed; inset: 0; z-index: 11; pointer-events: none; display: none;
      background:
        linear-gradient(#000, #000) 50% 50% / 100% 1.5px no-repeat, linear-gradient(#000, #000) 50% 50% / 1.5px 100% no-repeat,
        radial-gradient(circle at 50% 50%, transparent 0, transparent 44vh, rgba(0, 0, 0, .55) 44.6vh, #000 46vh); }
    .equip-scope.is-open { display: block; }
    body.is-scoped #crosshair, body.is-scoped .equip-hint { opacity: 0; }
    body.is-watching .equip-hint, body.is-touch .equip-hint, body.is-watching .equip-ammo, body.is-inspecting .equip-ammo { display: none; }
    @media (max-width: 720px) { .equip-hint { font-size: 11px; padding: 5px 10px; } .equip-ammo { font-size: 26px; } }`;
  document.head.append(style);
  const hintEl = document.createElement('div');
  hintEl.className = 'equip-hint';
  const ammoEl = document.createElement('div');
  ammoEl.className = 'equip-ammo';
  const scopeEl = document.createElement('div');
  scopeEl.className = 'equip-scope';
  document.body.append(hintEl, ammoEl, scopeEl);
  let hintHtml = null, flash = null, flashUntil = 0, ammoShown = null;
  function setHint(html) {
    if (html === hintHtml) return;
    hintHtml = html;
    if (html) hintEl.innerHTML = html;
    hintEl.classList.toggle('is-open', !!html);
  }
  const say = (text, seconds = 2.6) => { flash = text; flashUntil = performance.now() + seconds * 1000; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ---- the rig ----------------------------------------------------------------------------------
  const armsFiles = new Map(), animFiles = new Map(), partFiles = new Map();
  const getArms = (id) => {
    if (!armsFiles.has(id)) armsFiles.set(id, loader.loadAsync(BASE + manifest.arms.find((a) => a.id === id).file));
    return armsFiles.get(id);
  };
  const getAnims = (type) => {
    if (!animFiles.has(type)) animFiles.set(type, loader.loadAsync(BASE + manifest.weapons[type].file));
    return animFiles.get(type);
  };

  /** Which of the weapon's bones each vertex of an exhibit's model follows, where the weapon has parts that move. */
  const getParts = (id) => {
    const file = manifest.parts?.[id];
    if (!file) return Promise.resolve(null);
    if (!partFiles.has(id)) partFiles.set(id, fetch(BASE + file).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return partFiles.get(id);
  };

  let armsId = 'default';       // which gloves are on: 'default' or a glove exhibit's asset id
  let wornFrom = null;          // the display those gloves came from
  let rig = null;               // { id, root, bones, handBind, mixer, actions, type, weaponBones, mount }
  let held = null;              // { display, object, type }
  let busy = false;             // a take is loading
  let phase = 'none';           // none | draw | idle | inspect | shoot | reload | slash | stab | lower
  let playing = null;           // the clip by name
  let lower = 1;                // 1 = out of sight below the view, 0 = up
  let lowerThen = null;         // what to do once it is down
  let inspectNo = 0;
  let lastState = 'intro';
  const sway = { x: 0, y: 0, yaw: null, pitch: 0, kick: 0 };
  const q = new THREE.Quaternion(), qI = new THREE.Quaternion();

  // ---- a gun in the hands -------------------------------------------------------------------------
  let gun = null;               // the game's numbers for the weapon held, or null for a knife
  let melee = false;
  let clock = 0;                // seconds this demo has run, the time base of everything below
  let ammo = 0;
  let readyAt = 0;              // drawn and able to fire from then
  let nextAttack = 0;           // rate of fire
  let reload = null;            // { t, addAt, endAt, added }: runs to its end whatever the hands show
  let blockInspect = 0;         // a shot or a swing holds F off until then
  let fHeld = false;
  let keysUntil = 0;            // the list of keys shows until then
  const trig = { fire: false, alt: false, pending: false, altPending: false };
  const punch = { p: 0, y: 0, vp: 0, vy: 0 };     // the kick: an angle and its speed, in degrees, pitch positive downward as the game has it
  const TICK = 1 / 64;          // the game's step
  let ticking = 0;              // time waiting for the next tick
  let tickNo = 0, lastShotTick = -1e9;
  const was = { p: 0, y: 0 }, seen = { p: 0, y: 0 };      // the kick a tick ago, and where the view is between the two
  let recoilIndex = 0, lastShot = -9, penalty = 0, shotNo = 0, swingNo = 0;
  // A scope (the AWP's): right click steps through its magnifications, and while it is up the
  // weapon takes the numbers the game gives it for that: far steadier, a gentler kick.
  let zoom = 0;                 // 0 = not looking through it; 1, 2 = the scope's steps
  let rezoom = 0, rezoomAt = 0; // a shot drops the scope for the bolt, then it comes back up by itself
  let baseFov = null;           // the page's own angle of view, kept while the scope has changed it
  const sight = (key) => (zoom && gun.scope[key] !== undefined ? gun.scope[key] : gun[key]);
  const lens = (fov) => (2 * Math.atan(Math.tan((fov * DEG) / 2) * 0.75)) / DEG;      // the game's angles are across a 4:3 picture
  // The crosshair (js/crosshair.js): drawn while a piece is in the hands, chosen at the armory's wall.
  const crosshair = createCrosshair();
  // The game's sounds (js/sounds.js), where they have been built: a shot, the scope, and every
  // cue the clips carry (a magazine out and in, a bolt, a knife through the air).
  let sounds = null;
  createSounds().then((s) => { sounds = s; }).catch(() => {});
  let heard = -1;               // how far into the clip in the hands its sound cues have been played
  const shotSound = () => (gun.silenced && gun.sounds.special1 ? gun.sounds.special1 : gun.sounds.single);
  /** Every sound a weapon type can make, to fetch them before it is in the hands. */
  function soundsOf(type) {
    const w = manifest.weapons[type], s = w.gun?.sounds || {};
    const names = [s.single, s.special1, s.zoom_in, s.zoom_out].filter(Boolean);
    for (const clip of Object.values(w.clips)) for (const e of clip.events) if (e.sound) names.push(e.id);
    return names;
  }
  /** Play the cues the clip has passed since the last frame. A cue's time is a share of its clip. */
  function cues() {
    if (!sounds || !current || !playing) return;
    const meta = clipMeta(playing);
    if (!meta) return;
    const t = current.time;
    if (t < heard) heard = t - 1e-4;                      // wound back: a held inspect going round again
    for (const e of meta.events) {
      if (!e.sound) continue;
      const at = e.start * meta.duration;
      if (at > heard && at <= t) sounds.play(e.id);
    }
    heard = t;
  }
  const clipMeta = (name) => (rig?.type ? manifest.weapons[rig.type].clips[name] : null);
  const cue = (name, id) => clipMeta(name)?.events.find((e) => e.id === id) || null;      // an event's start and length are shares of its clip
  const idleName = () => (gun && ammo === 0 && rig.actions.idle_empty ? 'idle_empty' : 'idle');

  function prepareArms(gltf) {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;       // a skinned mesh's bounds are those of its rest pose
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.envMap = scene.environment;
        m.envMapIntensity = 0.5;      // as the exhibits' models
      }
    });
  }

  async function buildRig(id) {
    const gltf = await getArms(id);
    if (!gltf.prepared) { prepareArms(gltf); gltf.prepared = true; }
    const root = gltf.scene;
    const bones = {};
    root.traverse((o) => { if (o.name) bones[o.name] = o; });
    const handBind = {};
    for (const s of ['L', 'R']) {
      // a rig that has been used before is put back to rest first, so the bind pose read here is the real one
      handBind[s] = gltf.handBind?.[s] || bones['hand_' + s].quaternion.clone().invert();
    }
    gltf.handBind = handBind;
    return { id, root, bones, handBind, mixer: null, actions: {}, type: null, weaponBones: null, mount: null };
  }

  function clearWeapon() {
    if (!rig) return;
    if (rig.mixer) { rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.root); rig.mixer = null; }
    if (rig.weaponBones) { rig.weaponBones.removeFromParent(); rig.weaponBones = null; }
    rig.mount = null; rig.actions = {}; rig.type = null;
    current = null; playing = null;
  }

  async function fitWeapon(type) {
    const anim = await getAnims(type);
    clearWeapon();
    // the weapon's own bones hang from the arms' "wpn" bone, as the game attaches them
    rig.weaponBones = anim.scene.getObjectByName('weapon').clone(true);
    rig.bones.wpn.add(rig.weaponBones);
    rig.mount = rig.weaponBones.getObjectByName('mount');
    rig.mixer = new THREE.AnimationMixer(rig.root);
    rig.type = type;
    for (const clip of anim.animations) {
      const a = rig.mixer.clipAction(clip);
      a.clampWhenFinished = true;
      rig.actions[clip.name] = a;
    }
    rig.mixer.addEventListener('finished', (e) => {
      if (e.action !== current || phase === 'lower' || phase === 'none') return;
      play(idleName(), playing === 'draw' ? 0.12 : playing.startsWith('inspect') ? 0.25 : 0.15);
    });
  }

  let current = null;
  function play(name, fade = 0) {
    let a = rig.actions[name];
    if (!a) { name = 'idle'; a = rig.actions.idle; }
    const loop = name === 'idle' || name === 'idle_empty';
    // a blend already under way has nothing whole to blend from: cut instead (rapid F and R do this, as they do in the game)
    const cut = !current || current === a || fade <= 0 || current.getEffectiveWeight() < 0.999;
    for (const other of Object.values(rig.actions)) if (other !== a && (cut || other !== current)) other.stop();
    a.reset();
    a.setEffectiveWeight(1);
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.play();
    if (!cut) a.crossFadeFrom(current, fade, false);
    current = a; playing = name; heard = -1;
    phase = name.startsWith('inspect') ? 'inspect' : name.startsWith('idle') ? 'idle' : name.startsWith('shoot') ? 'shoot'
      : name.startsWith('reload') ? 'reload' : name.startsWith('slash') ? 'slash' : name.startsWith('stab') ? 'stab' : name;
    const block = cue(name, 'WPN_BLOCK_INSPECT'), meta = clipMeta(name);
    blockInspect = block ? clock + (block.start + block.duration) * meta.duration : 0;
  }

  /**
   * The display's own model, as it left the pipeline, on the rig's mount node (which knows where it
   * goes). The model is one rigid piece; where the game's weapon has parts that move (a slide, a
   * magazine, a butterfly knife's handles), its meshes are bound to the weapon's bones instead,
   * each vertex to the part the game's model gives it. Geometry and materials stay the display's own.
   */
  function mountCopy(display, parts) {
    const source = display.model.holder.children[0].children[0];
    const copy = source.clone(true);
    copy.position.set(0, 0, 0); copy.rotation.set(0, 0, 0); copy.scale.setScalar(1);
    copy.traverse((o) => { o.frustumCulled = false; });
    rig.mount.add(copy);
    if (!parts) return copy;
    const rest = rig.weaponBones.getObjectByName('weapon_offset').userData.bind;
    const bones = parts.bones.map((n) => rig.weaponBones.getObjectByName(n));
    if (bones.some((b) => !b)) return copy;
    const skeleton = new THREE.Skeleton(bones, bones.map((b) => new THREE.Matrix4().fromArray(b.userData.bind || rest)));
    const meshes = [];
    copy.traverse((o) => { if (o.isMesh && parts.meshes[o.name]) meshes.push(o); });
    for (const o of meshes) {
      const g = o.geometry, n = g.attributes.position.count;
      if (!g.attributes.skinIndex) {
        const follows = Uint8Array.from(atob(parts.meshes[o.name]), (c) => c.charCodeAt(0));
        if (follows.length !== n) continue;                 // not the model this file was made from: leave it rigid
        const index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { index[i * 4] = follows[i]; weight[i * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
      }
      const skinned = new THREE.SkinnedMesh(g, o.material);
      skinned.name = o.name; skinned.renderOrder = o.renderOrder; skinned.frustumCulled = false;
      skinned.bind(skeleton, new THREE.Matrix4());
      o.parent.add(skinned);                                 // made in the same order, so stickers still overlap the same way
      o.removeFromParent();
    }
    return copy;
  }

  const kindOf = (d) => {
    if (!d || !d.skin) return null;
    if (manifest.items[d.skin.id]) return 'weapon';
    if (manifest.arms.some((a) => a.id === d.skin.id)) return 'gloves';
    return null;
  };

  async function useArms(id, from) {
    if (wornFrom && wornFrom !== from && wornFrom.model) wornFrom.model.holder.visible = true;
    wornFrom = from || null;
    if (from?.model) from.model.holder.visible = false;
    armsId = id;
    if (!held) { getArms(id); return; }             // seen with the next weapon
    const type = held.type, was = phase;
    const [next, parts] = await Promise.all([buildRig(id), getParts(held.display.skin.id)]);
    if (!held || armsId !== id) return;             // changed again while this pair was loading
    held.object.removeFromParent();
    clearWeapon(); rig.root.removeFromParent();
    rig = next;
    holder.add(rig.root);
    await fitWeapon(type);
    held.object = mountCopy(held.display, parts);
    play(was === 'inspect' ? 'inspect' : idleName());
  }

  /** A weapon just taken starts as the game hands it over: a full magazine, steady, not yet ready until it is drawn. */
  function arm(type) {
    const data = manifest.weapons[type].gun || null;
    melee = !!data?.melee;
    gun = data && !data.melee ? data : null;
    ammo = gun ? gun.clip : 0;
    reload = null;
    readyAt = clock + (gun ? gun.deploy : 1) * 0.75;     // the game lets a shot out a little before the draw has fully settled
    nextAttack = 0; blockInspect = 0;
    punch.p = punch.y = punch.vp = punch.vy = 0;
    recoilIndex = 0; penalty = 0; shotNo = 0;
    was.p = was.y = seen.p = seen.y = 0; ticking = 0;
    dropScope();
    trig.fire = trig.alt = trig.pending = trig.altPending = false;
    keysUntil = clock + 7;
  }

  async function take(display) {
    if (busy) return;
    if (!display.model) { say('Its model is still loading'); return; }
    busy = true;
    try {
      const type = manifest.items[display.skin.id];
      if (!rig || rig.id !== armsId) {
        if (rig) { clearWeapon(); rig.root.removeFromParent(); }
        rig = await buildRig(armsId);
        holder.add(rig.root);
      }
      // its sounds are fetched with it, but a slow fetch does not keep the weapon waiting
      const ready = sounds ? Promise.race([sounds.load(soundsOf(type)), new Promise((done) => setTimeout(done, 700))]) : null;
      const [, parts] = await Promise.all([getAnims(type), getParts(display.skin.id), ready]);
      const swap = () => {
        if (held) { held.object.removeFromParent(); held.display.model.holder.visible = true; }
        return fitWeapon(type).then(() => {
          const object = mountCopy(display, parts);
          display.model.holder.visible = false;
          held = { display, object, type };
          arm(type);
          lower = 0; lowerThen = null;
          play('draw');
          rig.mixer.update(0);
          pass.enabled = true;
        });
      };
      if (held && lower < 0.9) await new Promise((done) => { phase = 'lower'; lowerThen = () => swap().then(done); });
      else await swap();
    } finally { busy = false; }
  }

  function putBack() {
    if (!held || phase === 'lower') return;
    phase = 'lower';
    reload = null;
    lowerThen = async () => {
      dropScope();
      held.object.removeFromParent();
      held.display.model.holder.visible = true;
      held = null; gun = null; melee = false;
      clearWeapon();
      pass.enabled = false;
      phase = 'none';
    };
  }

  /** F: the inspect, from its start. Pressed again during one it starts over (the next variant, where a weapon has several). */
  function inspectInHand() {
    if (!held || phase === 'lower' || clock < blockInspect) return;
    const names = Object.keys(rig.actions).filter((n) => n.startsWith('inspect'));
    const name = phase === 'inspect' ? names[++inspectNo % names.length] : names[inspectNo % names.length];
    play(name, 0.15);
  }

  /** R: a magazine that is not full is changed. The reload then runs to its end by the clock, whatever the hands go on to show. */
  function startReload() {
    if (!gun || reload || ammo >= gun.clip || phase === 'lower' || clock < readyAt) return false;
    const name = ammo === 0 && rig.actions.reload_empty ? 'reload_empty' : 'reload';
    const meta = clipMeta(name), add = cue(name, 'WPN_RELOAD_ADD_AMMO');
    reload = { t: 0, addAt: (add ? add.start : 0.5) * meta.duration, endAt: gun.no_attack_after_reload, added: false };
    play(name, 0.1);
    return true;
  }

  // ---- what a round leaves: a flash at the muzzle, a streak, a mark where it lands (all this page's own) --------
  function disc(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const flashTex = disc(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,246,214,1)'); r.addColorStop(0.18, 'rgba(255,205,120,.85)'); r.addColorStop(0.5, 'rgba(255,140,50,.22)'); r.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'lighter';
    g.translate(s / 2, s / 2);
    for (let i = 0; i < 5; i++) {                       // a few tongues, so no two flashes look alike once turned
      g.rotate((Math.PI * 2) / 5 + 0.4);
      const l = g.createLinearGradient(0, 0, s / 2, 0);
      l.addColorStop(0, 'rgba(255,230,170,.9)'); l.addColorStop(1, 'rgba(255,150,60,0)');
      g.fillStyle = l;
      g.beginPath(); g.moveTo(0, -s * 0.035); g.lineTo(s * 0.48, 0); g.lineTo(0, s * 0.035); g.fill();
    }
  });
  const markTex = disc(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.22, 'rgba(6,6,6,.95)'); r.addColorStop(0.4, 'rgba(22,20,18,.55)'); r.addColorStop(1, 'rgba(30,28,24,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
  muzzle.visible = false; muzzle.renderOrder = 10;
  muzzle.material.color.setScalar(0.75);          // any brighter and the venue's glow turns it into a white ball
  const muzzleLight = new THREE.PointLight(0xffc27a, 0, 2.2, 2);        // always there at zero, so lighting it up compiles nothing
  holder.add(muzzle, muzzleLight);
  let muzzleT = 0;

  const fx = new THREE.Group();          // in the hall itself
  fx.name = 'equip-fx';
  scene.add(fx);
  const markGeo = new THREE.PlaneGeometry(1, 1);
  const marks = [];
  let markNo = 0;
  const streaks = [0, 1, 2].map(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false; line.visible = false; line.userData.t = 0;
    fx.add(line);
    return line;
  });
  const puffs = [0, 1, 2, 3].map(() => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.visible = false; s.userData.t = 0;
    fx.add(s);
    return s;
  });
  let streakNo = 0, puffNo = 0;

  const ray = new THREE.Raycaster();
  ray.camera = camera;
  const aim = new THREE.Euler(0, 0, 0, 'YXZ'), aimQ = new THREE.Quaternion();
  const vDir = new THREE.Vector3(), vRight = new THREE.Vector3(), vUp = new THREE.Vector3(), vN = new THREE.Vector3(), vA = new THREE.Vector3();
  const mInst = new THREE.Matrix4(), Z = new THREE.Vector3(0, 0, 1);

  /** What a round can strike: something drawn and solid. Beams of light, glows, glass and the like let it through. */
  function solid(hit) {
    const o = hit.object;
    if (!o.isMesh || o.isSkinnedMesh || !hit.face) return false;
    const m = Array.isArray(o.material) ? o.material[hit.face.materialIndex || 0] : o.material;
    if (!m || m.visible === false || m.depthWrite === false || m.blending === THREE.AdditiveBlending) return false;
    if (m.transparent && m.opacity < 0.4) return false;
    for (let p = o; p; p = p.parent) if (!p.visible || p === fx || p.userData.shotsPass) return false;      // shotsPass: a game judges hits on this itself
    return true;
  }

  /** Where the eye is aiming once the kick is counted in: the round leaves along the view plus twice the kick, as the game does it. */
  function aimAt(spreadX = 0, spreadY = 0) {
    aim.set(player.pitch - punch.p * DEG * RECOIL.scale, player.yaw + punch.y * DEG * RECOIL.scale, 0);
    aimQ.setFromEuler(aim);
    vDir.set(0, 0, -1).applyQuaternion(aimQ);
    vRight.set(1, 0, 0).applyQuaternion(aimQ);
    vUp.set(0, 1, 0).applyQuaternion(aimQ);
    return vDir.addScaledVector(vRight, spreadX).addScaledVector(vUp, spreadY).normalize();
  }

  function cast(dir, far) {
    ray.set(camera.position, dir);
    ray.near = 0.02; ray.far = far;
    for (const hit of ray.intersectObjects(scene.children, true)) if (solid(hit)) return hit;
    return null;
  }

  function onExhibit(o) {
    for (let p = o; p; p = p.parent) if (p.userData.isExhibitModel) return true;
    return false;
  }

  function spark(point) {
    const puff = puffs[puffNo++ % puffs.length];
    puff.position.copy(point);
    puff.scale.setScalar(0.09 + Math.random() * 0.05);
    puff.material.rotation = Math.random() * 6.28;
    puff.visible = true; puff.userData.t = 0.07;
  }

  function leaveMark(hit, dir) {
    const o = hit.object;
    vN.copy(hit.face.normal);
    if (o.isInstancedMesh && hit.instanceId !== undefined) { o.getMatrixAt(hit.instanceId, mInst); mInst.premultiply(o.matrixWorld); vN.transformDirection(mInst); } else vN.transformDirection(o.matrixWorld);
    if (vN.dot(dir) > 0) vN.negate();
    spark(vA.copy(hit.point).addScaledVector(vN, 0.02));
    if (onExhibit(o)) return;                      // the collection itself takes no marks
    let mark = marks[markNo % MARKS];
    if (!mark) {
      mark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      mark.renderOrder = 2;
      marks[markNo % MARKS] = mark;
      fx.add(mark);
    }
    markNo++;
    mark.position.copy(hit.point).addScaledVector(vN, 0.003);
    mark.quaternion.setFromUnitVectors(Z, vN);
    mark.rotateZ(Math.random() * 6.28);
    mark.scale.setScalar(0.045 + Math.random() * 0.02);
    mark.material.opacity = 1;
    mark.visible = true; mark.userData.t = MARK_LIFE;
  }

  function inaccuracy() {
    const speed = Math.hypot(player.vel.x, player.vel.z) / INCH;            // the game counts in inches a second
    const moving = player.air > 0 ? 1 : clamp((speed - sight('max_speed') * 0.34) / (sight('max_speed') * 0.61), 0, 1);
    return sight('inaccuracy_stand') + penalty + sight('inaccuracy_move') * moving;
  }

  /** Where a venue says rounds are not counted (the range): the magazine never runs down, so nothing needs reloading. */
  const endless = () => !!api.endless?.();

  function shoot() {
    if (!endless()) ammo--;
    play(ammo === 0 && rig.actions.shoot_empty ? 'shoot_empty' : 'shoot');
    sounds?.play(shotSound());
    // the next shot is due one cycle after this one was due, not after the tick it happened to fall on: that keeps the rate exact
    nextAttack = (clock - nextAttack > 2 * TICK ? clock : nextAttack) + gun.cycle;
    // where it goes: the aim, the kick so far, and the weapon's own scatter
    const a0 = Math.random() * 6.2832, r0 = Math.random() * inaccuracy(), a1 = Math.random() * 6.2832, r1 = Math.random() * sight('spread');
    const dir = aimAt(Math.cos(a0) * r0 + Math.cos(a1) * r1, Math.sin(a0) * r0 + Math.sin(a1) * r1);
    const hit = cast(dir, 300);
    // a game may say the round struck something of its own first (a bot on the range): then it stops there
    const stop = api.onShot?.({ origin: camera.position, dir, hit, gun, weapon: held.display.skin }) || null;
    if (stop) spark(stop.point);
    else if (hit) leaveMark(hit, dir);
    if (gun.tracer_every > 0 && shotNo % gun.tracer_every === 0) {
      const line = streaks[streakNo++ % streaks.length], p = line.geometry.attributes.position;
      vA.copy(camera.position).addScaledVector(dir, 1.4).addScaledVector(vRight, 0.07).addScaledVector(vUp, -0.07);
      const end = stop ? stop.point : hit ? hit.point : vN.copy(camera.position).addScaledVector(dir, 60);
      if (end.distanceToSquared(camera.position) > 9) {
        p.setXYZ(0, vA.x, vA.y, vA.z); p.setXYZ(1, end.x, end.y, end.z); p.needsUpdate = true;
        line.visible = true; line.userData.t = 0.06;
      }
    }
    // then the kick this shot adds: its angle and strength are the game's, per shot of the spray
    const table = sight('recoil'), i = Math.floor(recoilIndex) % table.length;
    let mag = table[i][1];
    if (recoilIndex < RECOIL.quietShots) mag *= RECOIL.quietFactor + (1 - RECOIL.quietFactor) * (recoilIndex / RECOIL.quietShots);
    const ang = table[i][0] * DEG;
    punch.vy += -Math.sin(ang) * mag;
    punch.vp += -Math.cos(ang) * mag;
    recoilIndex += 1; lastShot = clock; lastShotTick = tickNo; shotNo++;
    penalty += sight('inaccuracy_fire');
    if (zoom && gun.scope.unzoom_after_shot) { rezoom = zoom; zoom = 0; rezoomAt = clock + gun.cycle - 0.25; }      // the bolt is worked with the eye off the scope
    if (!gun.silenced) {
      const m = gun.muzzle_in;
      muzzle.position.set(-m[1] * INCH, m[2] * INCH, -m[0] * INCH);
      muzzle.scale.setScalar((gun.clip <= 20 && !gun.auto && gun.cycle < 1 ? 0.15 : 0.23) * (0.85 + Math.random() * 0.3));
      muzzle.material.rotation = Math.random() * 6.2832;
      muzzleLight.position.copy(muzzle.position);
      muzzle.visible = true; muzzleT = 0.045;
    }
  }

  function swing(kind) {
    const rule = KNIFE[kind];
    const hit = cast(aimAt(), rule.reach);
    let name = kind === 'stab' ? 'stab' : swingNo++ % 2 ? 'slash2' : 'slash';
    if (hit && rig.actions[name + '_hit']) name += '_hit';
    play(rig.actions[name] ? name : kind, 0.06);
    nextAttack = clock + (hit ? rule.hit : rule.miss);
    api.onShot?.({ origin: camera.position, dir: vDir, hit, gun: null, weapon: held.display.skin, melee: kind });
  }

  /**
   * The stretch of an inspect that the game marks to repeat while F is held. Most end in the pose
   * they began in and are simply run round; a few do not (the game's graph blends them), and those
   * are held at the stretch's last pose instead.
   */
  const loops = new Map();
  function loopOf(name) {
    const id = rig.type + '/' + name;
    if (loops.has(id)) return loops.get(id);
    const at = cue(name, 'WPN_INSPECT_LOOP'), meta = clipMeta(name);
    let loop = null;
    if (at && at.duration > 0) {
      loop = { from: at.start * meta.duration, to: (at.start + at.duration) * meta.duration, seamless: true };
      for (const track of rig.actions[name].getClip().tracks) {
        if (track.times.length < 2) continue;
        const read = track.createInterpolant();
        const a = Array.from(read.evaluate(loop.from)), b = Array.from(read.evaluate(loop.to));
        const apart = track.name.endsWith('.quaternion')
          ? 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) > 6 * DEG
          : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.005;
        if (apart) { loop.seamless = false; break; }
      }
    }
    loops.set(id, loop);
    return loop;
  }

  function settle(dt) {
    // the kick dies away: the angle by a share and by a fixed step, its speed by a share
    const e = Math.exp(-RECOIL.decayExp * dt);
    punch.p *= e; punch.y *= e;
    const mag = Math.hypot(punch.p, punch.y), lin = RECOIL.decayLin * dt;
    if (mag > lin) { const k = 1 - lin / mag; punch.p *= k; punch.y *= k; } else { punch.p = 0; punch.y = 0; }
    punch.p += punch.vp * dt * 0.5; punch.y += punch.vy * dt * 0.5;
    const ev = Math.exp(-RECOIL.velDecay * dt);
    punch.vp *= ev; punch.vy *= ev;
    punch.p += punch.vp * dt * 0.5; punch.y += punch.vy * dt * 0.5;
    if (gun) {
      // A pause in the firing starts the spray over. Counted in whole ticks: an AK's rounds come
      // six and seven ticks apart, a hair inside this limit, and a clock that ran between ticks
      // would now and then call that a pause and repeat a step of the pattern.
      if ((tickNo - lastShotTick) * TICK > gun.cycle * 1.1) recoilIndex *= Math.exp(-Math.LN10 * RECOIL.indexDecay * dt);
      penalty *= Math.exp((-Math.LN10 / gun.recovery_stand) * dt);
    }
  }

  function fxUpdate(dt) {
    if (muzzleT > 0) {
      muzzleT -= dt;
      muzzleLight.intensity = muzzleT > 0 ? 1.6 : 0;
      if (muzzleT <= 0) muzzle.visible = false;
    }
    for (const s of streaks) if (s.visible) { s.userData.t -= dt; s.material.opacity = clamp(s.userData.t / 0.06, 0, 1) * 0.9; if (s.userData.t <= 0) s.visible = false; }
    for (const s of puffs) if (s.visible) { s.userData.t -= dt; s.material.opacity = clamp(s.userData.t / 0.07, 0, 1); if (s.userData.t <= 0) s.visible = false; }
    for (const m of marks) if (m && m.visible) { m.userData.t -= dt; if (m.userData.t < 2) m.material.opacity = Math.max(0, m.userData.t / 2); if (m.userData.t <= 0) m.visible = false; }
  }

  /** The trigger, the reload under way, the kick: everything that runs while a weapon is up. */
  function weaponUpdate(dt, live) {
    if (reload) {
      reload.t += dt;
      if (!reload.added && reload.t >= reload.addAt) { ammo = gun.clip; reload.added = true; }
      if (reload.t >= reload.endAt) reload = null;
    }
    if (gun && !reload && ammo < gun.clip && endless()) ammo = gun.clip;      // walked in with a magazine part used: it is full from here on
    // The kick and the trigger are worked out 64 times a second, as the game works them out, not
    // once a frame. It matters: the kick's fixed-step decay takes a different bite at a different
    // step, and only at the game's step does a spray climb the way the real one does (checked
    // against sprays measured in the game: see docs/3d-pilot.md).
    ticking += dt;
    while (ticking >= TICK) {
      ticking -= TICK;
      tickNo++;
      was.p = punch.p; was.y = punch.y;
      settle(TICK);
      trigger(live);
    }
    const k = ticking / TICK;                              // between two ticks the view glides from one to the next
    seen.p = was.p + (punch.p - was.p) * k; seen.y = was.y + (punch.y - was.y) * k;
    // F held: the inspect stays in the stretch the game marks to repeat, and carries on to its end once let go
    if (phase === 'inspect' && fHeld && current) {
      const loop = loopOf(playing);
      if (loop && current.time >= loop.to) current.time = loop.seamless ? loop.from + (current.time - loop.to) : loop.to;
    }
  }

  /** One tick of the trigger: the scope's button, a shot or a swing if one is due. */
  function trigger(live) {
    const ready = live && phase !== 'lower' && clock >= readyAt && clock >= nextAttack;
    if (gun?.scope) {
      // right click: the next magnification, and after the last one back to the naked eye
      if (trig.altPending && live && !reload && phase !== 'lower' && clock >= readyAt) {
        const at = zoom || rezoom;
        zoom = at >= gun.scope.fov.length ? 0 : at + 1; rezoom = 0;
        sounds?.play(zoom ? gun.sounds.zoom_in : gun.sounds.zoom_out);
      }
      trig.altPending = false;
      if (zoom && (!live || reload || phase === 'lower' || phase === 'inspect')) zoom = 0;
      if (rezoom && (!live || reload || phase === 'lower' || phase === 'inspect')) rezoom = 0;
      if (rezoom && clock >= rezoomAt) { zoom = rezoom; rezoom = 0; }
    }
    if (gun) {
      if (ready && !reload) {
        if (ammo > 0 && (trig.pending || (gun.auto && trig.fire))) shoot();
        else if (ammo === 0) startReload();                   // an empty magazine is changed without being asked
      }
      if (ready || !trig.fire) trig.pending = false;        // a click too early counts only while the button is still down
    } else if (melee && ready) {
      if (trig.pending || trig.fire) swing('slash');
      else if (trig.altPending || trig.alt) swing('stab');
      trig.pending = trig.altPending = false;
    }
  }

  /**
   * What the scope does to the view: the lens narrows to the game's angle for that step, the
   * mouse slows by the same share, and the scope's ring is drawn over the page. The page's own
   * angle of view is put back when the scope comes down.
   */
  let scoped = false;
  function scopeView(dt, live) {
    const want = zoom && gun?.scope ? lens(gun.scope.fov[zoom - 1]) : null;
    if (want !== null && baseFov === null) baseFov = camera.fov;
    if (baseFov !== null) {
      const target = want ?? baseFov;
      // away from walking (a panel has opened) the page is easing its own lens: hand it straight back
      camera.fov = !live || Math.abs(camera.fov - target) < 0.08 ? target : damp(camera.fov, target, 30, dt);
      camera.updateProjectionMatrix();
      if (want === null && camera.fov === target) baseFov = null;
    }
    player.aimScale = zoom && gun?.scope ? gun.scope.fov[zoom - 1] / 90 : 1;
    const now = want !== null && camera.fov < (baseFov + want) / 2;
    if (now !== scoped) { scoped = now; scopeEl.classList.toggle('is-open', scoped); document.body.classList.toggle('is-scoped', scoped); }
  }

  /** The scope comes down at once and the page has its own lens back: for when the weapon leaves the hands. */
  function dropScope() {
    zoom = 0; rezoom = 0;
    if (baseFov !== null) { camera.fov = baseFov; camera.updateProjectionMatrix(); baseFov = null; }
    player.aimScale = 1;
    if (scoped) { scoped = false; scopeEl.classList.remove('is-open'); document.body.classList.remove('is-scoped'); }
  }

  function showAmmo(open) {
    const free = open && gun && endless();
    const text = open && gun ? (free ? '&infin;' : `${ammo}`) : null;
    if (text === ammoShown) return;
    ammoShown = text;
    ammoEl.classList.toggle('is-open', text !== null);
    if (text !== null) { ammoEl.innerHTML = free ? `<b>${text}</b>` : `<b>${text}</b><span>/ &infin;</span>`; ammoEl.classList.toggle('is-low', !free && ammo <= Math.max(1, Math.floor(gun.clip / 5))); }
  }

  // ---- the mouse: fire (and a knife's stab on the right button) while the mouse is captured -----------------
  const captured = () => !!document.pointerLockElement;
  const liveNow = () => !!held && lastState === 'walk';
  function press(button, down) {
    if (button === 0) { trig.fire = down; if (down) trig.pending = true; }
    if (button === 2) { trig.alt = down; if (down) trig.altPending = true; }
  }
  document.addEventListener('mousedown', (e) => { if (liveNow() && captured()) press(e.button, true); });
  document.addEventListener('mouseup', (e) => press(e.button, false));
  document.addEventListener('contextmenu', (e) => { if (liveNow() && captured()) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => { if (!captured()) { press(0, false); press(2, false); trig.pending = trig.altPending = false; } });
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyF') fHeld = false; });
  window.addEventListener('blur', () => { fHeld = false; press(0, false); press(2, false); });

  // ---- hooks ------------------------------------------------------------------------------------
  /** A key pressed while walking (or while a display's panel is open: then `aimed` is that display). True when it was used. */
  function key(e, aimed) {
    if (e.repeat) return false;
    const kind = kindOf(aimed);
    if (e.code === 'KeyF') {
      if (kind === 'weapon' && (!held || held.display !== aimed)) { take(aimed); return true; }
      if (kind === 'weapon' && held && held.display === aimed) { putBack(); return true; }
      if (kind === 'gloves') {
        if (wornFrom === aimed) { useArms('default', null); say('Gloves back in their case'); } else if (!aimed.model) say('Its model is still loading');
        else { useArms(aimed.skin.id, aimed); say(held ? `Wearing <b>${esc(aimed.skin.name)}</b>` : `Wearing <b>${esc(aimed.skin.name)}</b>: take a weapon to see them`); }
        return true;
      }
      if (held) { fHeld = true; inspectInHand(); return true; }
      return false;
    }
    if (e.code === 'KeyR') { if (held) { startReload(); return true; } return false; }
    if (e.code === 'KeyG') { if (held) { putBack(); return true; } return false; }
    if (e.code === 'KeyH') {
      const ids = manifest.arms.map((a) => a.id);
      const id = ids[(ids.indexOf(armsId) + 1) % ids.length];
      const from = museum.displays.find((d) => d.skin.id === id && d.model) || null;
      useArms(id, from);
      say(`Gloves: <b>${esc(manifest.arms.find((a) => a.id === id).name)}</b>`);
      return true;
    }
    if (e.code === 'KeyV') {
      viewIdx = (viewIdx + 1) % VIEWS.length;
      applyViewPreset();
      say(`View: <b>${VIEWS[viewIdx].name}</b> (fov ${VIEWS[viewIdx].fov}, offset ${VIEWS[viewIdx].offset.join(' ')})`);
      return true;
    }
    return false;
  }

  function hint(state, aimed) {
    if (state !== 'walk' && state !== 'inspect') return null;
    if (flash && performance.now() < flashUntil) return flash;
    const kind = kindOf(aimed);
    const parts = [];
    if (kind === 'weapon' && (!held || held.display !== aimed)) parts.push(`<kbd>F</kbd>${held ? 'swap for' : 'take'} <b>${esc(aimed.skin.name)}</b>`);
    else if (kind === 'weapon') parts.push('<kbd>F</kbd>hang it back');
    else if (kind === 'gloves') parts.push(wornFrom === aimed ? '<kbd>F</kbd>take the gloves off' : `<kbd>F</kbd>put on <b>${esc(aimed.skin.name)}</b>`);
    else if (held && state === 'walk' && clock < keysUntil) parts.push(gun ? '<kbd>Click</kbd>fire' : '<kbd>Click</kbd>slash', '<kbd>F</kbd>inspect');
    // the list of keys is shown for a few seconds after a piece is taken, then gets out of the line of fire
    if (held && state === 'walk' && (kind || clock < keysUntil)) parts.push(...(gun?.scope ? ['<kbd>Right click</kbd>scope'] : []), ...(gun && !endless() ? ['<kbd>R</kbd>reload'] : []), '<kbd>G</kbd>put back', '<kbd>H</kbd>gloves', '<kbd>V</kbd>view');
    if (!parts.length && state === 'walk' && !held && clock < 16) return 'Walk up to a gun or knife and press <kbd>F</kbd> to take it';     // said once, on the way in
    return parts.join('');
  }

  function twistForearms() {
    // The forearm's two twist bones follow a share of the hand's roll about the arm, so the skin
    // does not pinch at the wrist. The shares are by position along the forearm (a guess).
    for (const s of ['L', 'R']) {
      const hand = rig.bones['hand_' + s];
      q.copy(hand.quaternion).multiply(rig.handBind[s]);
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.set(q.x, 0, 0, q.w).normalize();
      rig.bones[`arm_lower_${s}_TWIST`]?.quaternion.copy(qI).slerp(q, 1 / 3);
      rig.bones[`arm_lower_${s}_TWIST1`]?.quaternion.copy(qI).slerp(q, 2 / 3);
    }
  }

  function update(dt, t, state, aimed) {
    lastState = state;
    clock += dt;
    setHint(hint(state, aimed));
    fxUpdate(dt);
    for (const d of museum.displays) if (d.model && !d.model.holder.userData.isExhibitModel) d.model.holder.userData.isExhibitModel = true;
    showAmmo(!!held && state === 'walk' && phase !== 'lower');
    crosshair.show(!!held && state === 'walk' && phase !== 'lower' && !scoped);
    if (!held || !rig?.mixer) return;
    // opening the panel of the piece in hand hangs it back, so the panel has it to show
    if (state === 'inspect' && aimed === held.display && phase !== 'lower') putBack();
    const away = state !== 'walk';                        // a panel, a seat or the pause card: hands down
    const goal = phase === 'lower' || away ? 1 : 0;
    lower = Math.abs(goal - lower) < 0.004 ? goal : damp(lower, goal, goal ? 16 : 9, dt);
    if (lower === 1 && lowerThen) { const then = lowerThen; lowerThen = null; then(); if (!held) return; }
    weaponUpdate(dt, !away);
    scopeView(dt, !away);
    if (!away && (seen.p || seen.y)) {
      // the view follows a part of the kick; the round itself leaves higher still (see aimAt)
      camera.rotation.x = player.pitch - seen.p * DEG * RECOIL.tracking;
      camera.rotation.y = player.yaw + seen.y * DEG * RECOIL.tracking;
    }
    pass.enabled = lower < 0.995 && !(scoped && gun?.scope?.hide_weapon);       // through the scope the weapon itself is out of sight, as in the game
    if (!pass.enabled) { if (scoped) { rig.mixer.update(dt); cues(); } return; }

    rig.mixer.update(dt);
    cues();
    twistForearms();

    // the weapon trails the view a little, and bobs with each step (this page's own, not the game's numbers)
    if (sway.yaw === null) { sway.yaw = player.yaw; sway.pitch = player.pitch; }
    let dYaw = player.yaw - sway.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const dPitch = player.pitch - sway.pitch;
    sway.yaw = player.yaw; sway.pitch = player.pitch;
    const rate = dt > 0 ? 1 / dt : 0;
    sway.y = damp(sway.y, clamp(-dYaw * rate * 0.006, -0.045, 0.045), 9, dt);
    sway.x = damp(sway.x, clamp(-dPitch * rate * 0.005, -0.035, 0.035), 9, dt);
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const stride = player.air > 0 ? 0 : Math.min(1, speed / 3.2);
    sway.kick = damp(sway.kick, clamp(-player.vy * 0.0016, -0.012, 0.012), 10, dt);
    const off = VIEWS[viewIdx].offset;
    holder.position.set(
      off[0] * INCH + Math.sin(player.bob) * 0.0032 * stride,
      off[2] * INCH - Math.abs(Math.sin(player.bob)) * 0.0026 * stride + sway.kick - lower * 0.34,
      -off[1] * INCH,
    );
    holder.rotation.set(sway.x + lower * 0.5, sway.y, Math.sin(player.bob) * 0.004 * stride);
  }

  function resize() { applyViewPreset(); }

  const api = {
    key, update, resize, take, putBack, useArms, press, startReload, vmScene, vmCamera, holder, manifest, pass, fx,
    onShot: null,                 // ({ hit, dir, weapon, melee }) for whatever wants to count what was struck
    endless: null,                // () => true where a venue does not count rounds (the club's range): no magazine runs down there
    get held() { return held; }, get phase() { return phase; }, get playing() { return playing; }, get rig() { return rig; },
    crosshair,
    get sounds() { return sounds; },      // the game's sounds, for a venue that has some of its own to play (the range's hit feedback)
    get gun() { return gun; }, get ammo() { return ammo; }, get reload() { return reload; }, get punch() { return punch; },
    get recoilIndex() { return recoilIndex; }, get action() { return current; }, get marks() { return marks; },
  };
  if (debug) window.__equip = api;
  return api;
}
