// Skin Museum - entry point: loading, render loop, and the walk / inspect state machine.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildMuseum } from './museum.js';
import { Player } from './player.js';
import * as ui from './ui.js';

const params = new URLSearchParams(location.search);
// The venue: the museum unless the address asks for one of the night clubs (?theme=velvet or ?theme=neon).
const THEMES = ['museum', 'velvet', 'neon'];
const theme = THEMES.includes(params.get('theme')) ? params.get('theme') : 'museum';
document.body.dataset.theme = theme;
const canvas = document.getElementById('scene');
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('is-touch');
// Pointer lock gives proper mouse look. Fall back to click-and-drag when it is
// unavailable (touch devices, some embeds) or when ?nolock is in the URL.
let useLock = !isTouch && !params.has('nolock') && 'requestPointerLock' in canvas;
let lockEverWorked = false;
let rawMouse = true;             // ask for the mouse's own movement until a browser says it cannot give it
let lockAttempt = 0;
const mouse = { ax: 0, ay: 0, quiet: 0 };   // recent mouse steps; and a moment after capture when steps are ignored
const uploads = [];              // textures waiting to be sent to the graphics card, one per frame

const WALK_FOV = 68;
const INSPECT_FOV = 44;
// How much of its frame a framed model may fill, by kind. A frame fits every model to its own
// size, so a pistol came out as big as the rifle beside it: pistols are held back a little.
const FRAME_FILL = { Pistol: 0.8 };

let renderer, composer, bloom, scene, camera, museum, player;
let state = 'loading';          // loading | intro | walk | inspect | paused | menu | watch
let target = null;              // display the visitor is looking at
let inspecting = null;          // display currently being inspected
let usable = null;              // something else in reach that E works on (the club's jukebox, a seat)
let usableSays = null;          // and what its prompt last said
let menu = null;                // the usable whose panel is open
let inspectFrom = null;         // where the visitor stood when they began inspecting
let watching = null;            // the usable the visitor has sat down at (the club's stream room)
let watchPose = null;           // where their eye rests while they watch: { pos, quat, stand }
let watchFrom = null;           // where they stood before
let mapVisible = true;
let equip = null;               // the equip demo (?equip): a piece carried in first person, see js/equip-demo.js
const pointer = { x: 0, y: 0 }; // -1..1, for inspect parallax
const view = { shift: 0, fov: WALK_FOV, ox: 0, oy: 0 };   // ox, oy: the lens shifted sideways and up, in pixels
const tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), fwd: new THREE.Vector3() };
const inspectPose = { pos: new THREE.Vector3(), side: new THREE.Vector3() };

init().catch((err) => {
  console.error(err);
  ui.showFatal(`The museum could not open: ${err.message}`);
});

async function init() {
  const data = await fetch('data/skins.json').then((r) => {
    if (!r.ok) throw new Error('data/skins.json is missing - run "node scripts/sync-skins.mjs" first');
    return r.json();
  });
  if (!data.skins?.length) throw new Error('data/skins.json has no skins in it');
  ui.setMuseumInfo(data.museum, data.skins.length);
  ui.setTheme(theme, pickTheme);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(WALK_FOV, 1, 0.08, 120);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;
  pmrem.dispose();

  // Fonts first (plaques are drawn to canvas), then every skin image.
  const fontsReady = Promise.race([
    Promise.all([
      document.fonts.load('600 80px Cinzel'),
      document.fonts.load('500 80px Cinzel'),
      document.fonts.load('500 30px Jost'),
      document.fonts.load('400 30px Jost'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]).catch(() => {});

  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let done = 0;
  const images = new Map();
  await Promise.all([fontsReady, ...data.skins.map(async (s) => {
    // the in-game picture when there is one, otherwise Steam's stock render
    // (an exhibit with a 3D model keeps the stock cut-out as its stand-in while the model loads)
    const picture = s.model ? null : s.ingame;
    const t = await (picture ? loader.loadAsync(picture).catch(() => loader.loadAsync(s.image)) : loader.loadAsync(s.image))
      .catch(() => { throw new Error(`could not load ${s.image}`); });
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    images.set(s.id, t);
    ui.setProgress(++done / data.skins.length);
  })]);

  museum = theme === 'museum'
    ? buildMuseum(scene, data, images, renderer)
    : await (await import('./club/club.js')).buildClub(scene, data, images, renderer, { look: theme });
  player = new Player(camera, museum.layout, museum.colliders);
  player.onLand = (x, z, impact) => museum.onLand?.(x, z, impact);

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.6, 1.0);
  if (museum.post) Object.assign(bloom, museum.post);   // a venue may ask for more or less glow
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  resize();
  window.addEventListener('resize', resize);
  bindInput();
  if (!useLock) document.body.classList.add('is-drag');

  player.update(0);
  renderer.compile(scene, camera);
  // Send every texture to the graphics card now, behind the entrance card. Otherwise each one
  // is uploaded in the frame it first comes into view, which shows as a hitch while walking.
  queueTextures(scene);
  for (const t of uploads.splice(0)) renderer.initTexture(t);
  state = 'intro';
  ui.setReady(theme);
  renderer.setAnimationLoop(frame);

  // Real 3D models arrive after the doors open; each display shows its picture until then.
  // They come a few at a time, the centrepieces first: opening every download at once makes a
  // small server turn some away. A download that fails is tried again before giving up.
  const modelled = museum.displays.filter((d) => d.skin.model).sort((a, b) => (b.kind === 'hero') - (a.kind === 'hero'));
  if (modelled.length) {
    const gltf = new GLTFLoader();
    gltf.setMeshoptDecoder(MeshoptDecoder);
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));
    const download = async (d) => {
      for (let attempt = 0; ; attempt++) {
        try { return await gltf.loadAsync(d.skin.model); } catch (err) {
          if (attempt >= 2) throw err;
          await pause(700 * (attempt + 1));
        }
      }
    };
    const loadNext = async () => {
      for (let d = modelled.shift(); d; d = modelled.shift()) {
        try {
          const g = await museum.prepareModel(await download(d));   // sticker draw order, holo sticker textures
          museum.attachModel(d, g.scene, d.skin.modelRotation);
          const fill = d.kind === 'pedestal' ? null : FRAME_FILL[d.skin.category];
          if (fill) { d.model.holder.scale.setScalar(fill); d.model.half.multiplyScalar(fill); }
          // prepare its shaders and textures now, not in the frame the visitor first turns to it
          renderer.compileAsync(d.group, camera, scene).then(() => queueTextures(d.group)).catch(() => {});
          if (d === inspecting) document.body.classList.add('has-model');
        } catch (err) {
          console.warn(`Could not load the 3D model for ${d.skin.name}`, err);
        }
      }
    };
    for (let i = 0; i < 4; i++) loadNext();
  }

  // Carrying a piece in first person lives in its own file. The museum offers it on request
  // (?equip). The clubs have it on, because their shooting range is no use without a gun in
  // hand (?noequip switches it off there).
  if (params.has('equip') || (theme !== 'museum' && !params.has('noequip'))) {
    import('./equip-demo.js')
      .then((m) => m.createEquip({ scene, camera, composer, museum, player, debug: params.has('debug') }))
      .then((e) => { equip = e; museum.attachEquip?.(e); })
      .catch((err) => console.warn('Carrying pieces could not start', err));
  }
  // A venue may need to open a panel of its own accord (the range's end-of-round card). It asks
  // here, and is told whether the page was free to show it.
  museum.attachHost?.({ openThing: (thing) => { if (state !== 'walk') return false; useThing(thing); return true; } });

  if (params.has('debug')) window.__museum = { museum, player, camera, scene, renderer, composer, theme, inspect, closeInspect, use, leaveWatch, view, frame, get state() { return state; }, enter };
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  museum.resize(w, h, pr);
  equip?.resize();
  applyView();
  if (inspecting) placeInspectCamera();
}

/** Mirrors the CSS: a side panel on wide screens, a bottom sheet on narrow ones. */
function panelMetrics() {
  const w = window.innerWidth;
  const narrow = w < 860;
  return { narrow, panelW: narrow ? 0 : Math.max(340, Math.min(460, w * 0.4)) };
}

/** How far back the camera must sit for the piece to fill the space beside the panel. */
function fitDistance(d) {
  const w = window.innerWidth, h = window.innerHeight;
  const { narrow, panelW } = panelMetrics();
  const tanV = Math.tan(THREE.MathUtils.degToRad(INSPECT_FOV / 2));
  const availW = (w - panelW) / w, availH = narrow ? 0.42 : 1;
  const byW = (d.parts.baseScale.x * 1.28) / (2 * tanV * (w / h) * availW);
  const byH = (d.parts.baseScale.y * 1.55) / (2 * tanV * availH);
  return THREE.MathUtils.clamp(Math.max(byW, byH), d.kind === 'pedestal' ? 1.2 : 1.9, 9);
}

/** Projection with the subject pushed off-centre while the detail panel is open. */
function applyView() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.fov = view.fov;
  const { narrow, panelW } = panelMetrics();
  const dx = (narrow ? 0 : view.shift * panelW / 2) + view.ox;
  const dy = (narrow ? view.shift * h * 0.29 : 0) + view.oy;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) camera.setViewOffset(w, h, dx, dy, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// state transitions
// ---------------------------------------------------------------------------
function pickTheme(name) {
  const q = new URLSearchParams(location.search);
  if (name === 'museum') q.delete('theme'); else q.set('theme', name);
  const s = q.toString();
  location.assign(location.pathname + (s ? `?${s}` : ''));
}

function enter() {
  museum.onEnter?.();   // sound may only start from a click or key press
  ui.toggle('intro', false);
  ui.toggle('pause', false);
  ui.toggle('hud', true);
  state = 'walk';
  player.enabled = true;
  lockPointer();
}

/**
 * Whether one captured-mouse step could have come from a hand. A browser re-centring its hidden
 * cursor can report a single step of hundreds of pixels, often against the direction of travel;
 * no hand goes from a steady turn to that between two events, so such a step is dropped.
 */
function plausibleStep(d, avg) {
  const size = Math.abs(d), pace = Math.abs(avg);
  if (size > 200 && size > pace * 6 + 60) return false;                  // a leap out of nowhere
  if (d * avg < 0 && pace > 6 && size > pace * 6 + 60) return false;      // a leap back against a steady turn
  return true;
}

/** Queue every texture under `root` for upload, so none is first sent to the graphics card mid-walk. */
function queueTextures(root) {
  const seen = new Set(uploads);
  const take = (t) => { if (t && t.isTexture && !t.isRenderTargetTexture && t.image && !seen.has(t)) { seen.add(t); uploads.push(t); } };
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const k in m) take(m[k]);
      if (m.uniforms) for (const k in m.uniforms) take(m.uniforms[k]?.value);
    }
  });
}

function setDragMode() {
  useLock = false;
  document.body.classList.add('is-drag');
}

function lockPointer() {
  if (!useLock || document.pointerLockElement === canvas) return;
  const attempt = ++lockAttempt, raw = rawMouse;
  // Ask for unadjusted movement: the mouse's own steps, without the system's cursor handling.
  // Without it some browsers report a huge step the wrong way each time they pull the hidden
  // cursor back from the edge of the window, which throws the view back mid-turn.
  let p = null;
  try { p = raw ? canvas.requestPointerLock({ unadjustedMovement: true }) : canvas.requestPointerLock(); } catch { /* handled below */ }
  if (p && p.catch) p.catch((err) => {
    if (!raw || err?.name !== 'NotSupportedError') return;
    rawMouse = false;                       // this browser cannot: capture the ordinary way
    if (attempt === lockAttempt) lockPointer();
  });
  setTimeout(() => {
    if (attempt !== lockAttempt) return;      // a newer request has taken over
    if (!useLock || document.pointerLockElement === canvas) return;
    // Never worked: this browser or embed does not allow it, so drag to look instead.
    // Worked before: the browser wants a fresh click (e.g. cooldown after Esc).
    if (!lockEverWorked) setDragMode();
    else if (state === 'walk') pause();
  }, 300);
}

function pause() {
  if (state !== 'walk') return;
  state = 'paused';
  player.enabled = false;
  player.keys.clear();
  ui.setPrompt(null);
  ui.toggle('pause', true);
}

function inspect(display) {
  if (!display) return;
  if (state !== 'inspect') inspectFrom = { display, x: player.pos.x, z: player.pos.z, ground: player.ground };
  usable = null;
  inspecting = display;
  state = 'inspect';
  player.enabled = false;
  player.keys.clear();
  ui.setPrompt(null);
  ui.renderPanel(display, museum.displays.length);
  ui.openPanel(true);
  document.body.classList.toggle('has-model', !!display.model);
  if (document.pointerLockElement) document.exitPointerLock();

  // Where the camera settles: square-on for wall pieces, from the visitor's side for cases.
  const dir = inspectPose.side;
  if (display.kind === 'pedestal') {
    dir.set(camera.position.x - display.pos.x, 0, camera.position.z - display.pos.z);
    if (dir.lengthSq() < 0.01 || dir.length() > 6) dir.copy(display.normal);
    dir.normalize();
  } else {
    dir.copy(display.normal);
  }
  placeInspectCamera();
}

function placeInspectCamera() {
  const d = inspecting;
  inspectPose.pos.copy(d.center).addScaledVector(inspectPose.side, fitDistance(d));
  inspectPose.pos.y = d.center.y + (d.kind === 'pedestal' ? 0.05 : -0.04);
}

function closeInspect() {
  if (state !== 'inspect') return;
  const shown = inspecting;
  inspecting = null;
  ui.openPanel(false);
  document.body.classList.remove('has-model');
  const cx = camera.position.x, cz = camera.position.z;
  player.syncFromCamera();
  museum.layout.settle?.(player, shown, inspectFrom);   // halls with more than one floor
  player.glideFrom(cx, cz);                              // if that moved the visitor, ease the view over rather than cut
  state = 'walk';
  player.enabled = true;
  lockPointer();
}

/** Open something that is not an exhibit, such as the jukebox. It closes itself through closeMenu. */
function useThing(thing) {
  state = 'menu';
  menu = thing;
  usable = null;
  player.enabled = false;
  player.keys.clear();
  ui.setPrompt(null);
  if (document.pointerLockElement) document.exitPointerLock();
  thing.open(closeMenu);
}

function closeMenu() {
  if (state !== 'menu') return;
  menu.close();
  menu = null;
  state = 'walk';
  player.enabled = true;
  lockPointer();
}

/**
 * Sit down at something made for watching (a seat in the club's stream room). The view comes to
 * rest where the venue says and stays there until the visitor stands up.
 */
function watch(thing) {
  state = 'watch';
  watching = thing;
  usable = null; target = null;
  watchFrom = { x: player.pos.x, z: player.pos.z, ground: player.ground };
  player.enabled = false;
  player.keys.clear();
  ui.setPrompt(null);
  document.body.classList.add('is-watching');
  watchPose = thing.watch.begin(player, { leave: leaveWatch, relock: lockPointer });
  thing.watch.pointer?.(useLock && document.pointerLockElement === canvas);
}

function leaveWatch() {
  if (state !== 'watch') return;
  watching.watch.end();
  watching = null;
  document.body.classList.remove('is-watching');
  const cx = camera.position.x, cz = camera.position.z;
  player.syncFromCamera();
  const to = watchPose.stand || watchFrom;       // beside the seat, or back where they stood
  player.pos.x = to.x; player.pos.z = to.z; player.ground = to.ground;
  player.glideFrom(cx, cz);
  state = 'walk';
  player.enabled = true;
  lockPointer();
}

function step(delta) {
  const list = museum.displays;
  const i = list.indexOf(inspecting);
  inspect(list[(i + delta + list.length) % list.length]);
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
function bindInput() {
  document.getElementById('enter').addEventListener('click', enter);
  // a click anywhere on the pause card steps back in, except on its link out, which is a way to leave
  document.getElementById('pause').addEventListener('click', (e) => { if (!e.target.closest?.('a')) enter(); });
  document.getElementById('panel-close').addEventListener('click', closeInspect);
  document.getElementById('panel-back').addEventListener('click', closeInspect);
  document.getElementById('panel-prev').addEventListener('click', () => step(-1));
  document.getElementById('panel-next').addEventListener('click', () => step(1));

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      lockEverWorked = true;
      mouse.ax = mouse.ay = 0;
      mouse.quiet = performance.now() + 80;   // the first step after capture is often a leftover jump
      if (state === 'paused') enter();
    } else if (state === 'walk' && useLock) {
      pause();
    }
    // while watching, letting the mouse go hands it to what is being watched (a player's own controls)
    if (state === 'watch') watching.watch.pointer?.(document.pointerLockElement === canvas);
  });
  // A refused capture is dealt with by the timer in lockPointer, which knows whether a second
  // attempt (without unadjusted movement) is still under way.

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Enter or Space walks in, unless a link has the focus: then the key is the link's
    if (state === 'intro' && (e.code === 'Enter' || e.code === 'Space') && !e.target.closest?.('a')) { e.preventDefault(); enter(); return; }
    if (state === 'menu') {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea');
      if (e.code === 'Escape' || (e.code === 'KeyE' && !typing)) { e.preventDefault(); closeMenu(); }
      return;
    }
    if (state === 'inspect') {
      if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); closeInspect(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') step(1);
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') step(-1);
      else if (e.code === 'KeyF' && equip?.key(e, inspecting)) closeInspect();      // equip demo: take it from its panel
      return;
    }
    if (state === 'watch') {
      if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); if (!e.repeat) leaveWatch(); }
      else { if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); watching.watch.key?.(e.code); }
      return;
    }
    if (state !== 'walk') return;
    if (e.code === 'KeyE' && !e.repeat) { if (target) inspect(target); else if (usable) use(usable); return; }
    if (e.code === 'KeyJ' && !e.repeat) { museum.toggleMusic?.(); return; }
    if (e.code === 'KeyM' && !e.repeat) { mapVisible = !mapVisible; document.getElementById('minimap').classList.toggle('is-hidden', !mapVisible); return; }
    if (equip?.key(e, target)) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    player.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => player.keys.delete(e.code));
  window.addEventListener('blur', () => player.keys.clear());

  // mouse look: locked pointer, or drag when lock is unavailable
  let dragging = false, turning = false, lastX = 0, lastY = 0, dragId = null;
  document.addEventListener('mousemove', (e) => {
    if (turning) return;   // hold the camera still while a model is being turned
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (state === 'walk' && document.pointerLockElement === canvas && performance.now() > mouse.quiet) {
      const dx = e.movementX, dy = e.movementY;
      if (!plausibleStep(dx, mouse.ax) || !plausibleStep(dy, mouse.ay)) return;
      mouse.ax += (dx - mouse.ax) * 0.3;
      mouse.ay += (dy - mouse.ay) * 0.3;
      player.look(dx, dy);
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (state === 'inspect' && inspecting?.model) {
      // turn the model by hand, like the in-game inspect
      turning = true; dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
      document.body.classList.add('is-turning');
      return;
    }
    if (state === 'watch') { if (useLock) lockPointer(); return; }    // a click on the room takes the mouse back
    if (state !== 'walk') return;
    if (useLock) { lockPointer(); return; }
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.4 && e.clientY > window.innerHeight * 0.5) return;
    dragging = true; dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (turning && e.pointerId === dragId && inspecting?.model) {
      const m = inspecting.model;
      m.yaw += (e.clientX - lastX) * 0.009;
      m.pitch = THREE.MathUtils.clamp(m.pitch + (e.clientY - lastY) * 0.006, -1.0, 1.0);
      lastX = e.clientX; lastY = e.clientY;
      return;
    }
    if (!dragging || e.pointerId !== dragId || state !== 'walk') return;
    // A finger drags the view along with it. A held mouse turns the same way as normal mouse look.
    const k = e.pointerType === 'touch' ? -2.2 : 1.6;
    player.look((e.clientX - lastX) * k, (e.clientY - lastY) * k);
    lastX = e.clientX; lastY = e.clientY;
  });
  const endDrag = (e) => {
    if (e.pointerId !== dragId) return;
    dragging = false; turning = false; dragId = null;
    document.body.classList.remove('is-turning');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // touch joystick + inspect button
  const stick = document.getElementById('stick'), knob = document.getElementById('stick-knob');
  let stickId = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    player.stick.x = x; player.stick.y = y;
    knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
  };
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null; player.stick.x = 0; player.stick.y = 0; knob.style.transform = '';
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  document.getElementById('jump').addEventListener('pointerdown', (e) => { e.preventDefault(); player.jump(); });
  document.getElementById('prompt').addEventListener('click', () => {
    if (state !== 'walk') return;
    if (target) inspect(target); else if (usable) use(usable);
  });
}

/** E on something that is not an exhibit: sit down at it, or open its panel. */
function use(thing) {
  if (thing.act) thing.act();            // done on the spot: nothing opens (a gun taken from the range's rack, a round started)
  else if (thing.watch) watch(thing);
  else useThing(thing);
}

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------
function findTarget() {
  let best = null, bestScore = -Infinity;
  camera.getWorldDirection(tmp.fwd);
  for (const d of museum.displays) {
    tmp.v.copy(d.center).sub(camera.position);
    const dist = tmp.v.length();
    if (dist > d.radius) continue;
    if (otherFloor(d)) continue;
    // must be standing in front of wall pieces, not beside them
    if (d.kind !== 'pedestal' && tmp.v.dot(d.normal) > -0.6) continue;
    const dot = tmp.v.normalize().dot(tmp.fwd);
    if (dot < (d.kind === 'hero' ? 0.8 : 0.74)) continue;
    const score = dot * 3 - dist / d.radius;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** In a hall with more than one storey: whether this thing stands on a floor the visitor is not on (the slab is in the way). */
function otherFloor(thing) {
  return thing.floor !== undefined && Math.abs(player.ground - thing.floor) > 1.2;
}

/** Something other than an exhibit that the visitor is close to and facing. */
function findUsable() {
  let best = null, bestScore = -Infinity;
  for (const u of museum.usables || []) {
    if (otherFloor(u)) continue;
    if (u.where && !u.where(player.pos)) continue;          // only from a certain part of the venue
    tmp.v.copy(u.center).sub(camera.position);
    const dist = tmp.v.length();
    if (dist > u.radius || (!u.anySide && tmp.v.dot(u.normal) > -0.4)) continue;
    const dot = tmp.v.normalize().dot(tmp.fwd);
    if (dot < (u.aim ?? 0.72)) continue;
    const score = (u.rank || 0) * 10 + dot * 3 - dist / u.radius;   // the nearer and better aimed; a seat before the screen behind it
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return best;
}

const timer = new THREE.Timer();
let introT = 0;

function frame(now) {
  timer.update(now);
  if (uploads.length) renderer.initTexture(uploads.pop());
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();

  if (state === 'intro') {
    // slow establishing drift behind the title card
    introT += dt;
    const s = museum.layout.spawn;
    camera.position.set(Math.sin(introT * 0.11) * 0.9, 1.72 + Math.sin(introT * 0.17) * 0.05, s.z - 0.4 - Math.sin(introT * 0.07) * 1.2);
    camera.rotation.set(0.02, Math.sin(introT * 0.11) * 0.05, 0, 'YXZ');
    player.pos.set(camera.position.x, camera.position.y, camera.position.z);
    player.yaw = camera.rotation.y; player.pitch = camera.rotation.x;
  } else if (state === 'inspect') {
    const d = inspecting;
    const k = 1 - Math.exp(-dt * 4.2);
    // gentle parallax from the mouse so the piece feels dimensional
    tmp.v2.set(-inspectPose.side.z, 0, inspectPose.side.x);
    tmp.v.copy(inspectPose.pos).addScaledVector(tmp.v2, pointer.x * 0.16);
    tmp.v.y -= pointer.y * 0.09;
    camera.position.lerp(tmp.v, k);
    tmp.m.lookAt(camera.position, d.center, THREE.Object3D.DEFAULT_UP);
    tmp.q.setFromRotationMatrix(tmp.m);
    camera.quaternion.slerp(tmp.q, k);
  } else if (state === 'watch') {
    // settle into the seat and come to a dead stop there, so what is watched can be lined up exactly
    const k = 1 - Math.exp(-dt * 5);
    camera.position.lerp(watchPose.pos, k);
    camera.quaternion.slerp(watchPose.quat, k);
    if (camera.position.distanceToSquared(watchPose.pos) < 1e-6) camera.position.copy(watchPose.pos);
    if (camera.quaternion.angleTo(watchPose.quat) < 1e-3) camera.quaternion.copy(watchPose.quat);
  } else {
    player.update(dt);
  }

  // ease field of view / framing between walking, inspecting and watching
  const lens = state === 'watch' ? watching.watch.view(window.innerWidth, window.innerHeight) : null;
  const wantFov = lens ? lens.fov : state === 'inspect' ? INSPECT_FOV : WALK_FOV;
  const wantShift = state === 'inspect' ? 1 : 0;
  const wantOx = lens ? lens.ox : 0, wantOy = lens ? lens.oy : 0;
  if (Math.abs(view.fov - wantFov) > 1e-4 || Math.abs(view.shift - wantShift) > 0.001 || Math.abs(view.ox - wantOx) > 1e-3 || Math.abs(view.oy - wantOy) > 1e-3) {
    const k = 1 - Math.exp(-dt * 5);
    const ease = (from, to, close) => (Math.abs(to - from) < close ? to : from + (to - from) * k);
    view.fov = ease(view.fov, wantFov, 0.01);
    view.shift = ease(view.shift, wantShift, 0.001);
    view.ox = ease(view.ox, wantOx, 0.25);
    view.oy = ease(view.oy, wantOy, 0.25);
    applyView();
  }

  if (state === 'walk') {
    const next = findTarget();
    const thing = next ? null : findUsable();
    // what a thing offers can change while the visitor stands at it (start a round, then stop it)
    const says = next ? null : thing?.label;
    if (next !== target || thing !== usable || says !== usableSays) { target = next; usable = thing; usableSays = says; ui.setPrompt(target, usable); }
  } else if ((target || usable) && state !== 'inspect') {
    target = null; usable = null; ui.setPrompt(null);
  }

  museum.update(t, dt, camera, state === 'inspect' ? inspecting : target, state === 'inspect' ? inspecting : null);
  // A model in a case stands in front of its glow. The glow is a flat sprite facing the visitor:
  // left at the centre, it would wash out whatever part of a deep model (a pair of gloves) fell
  // behind it. So it is kept on the far side of the model, wherever the visitor stands.
  for (const d of museum.displays) {
    const halo = d.model && d.kind === 'pedestal' && d.billboard ? d.billboard[1] : null;
    if (!halo) continue;
    d.group.worldToLocal(tmp.v.copy(camera.position));
    const away = Math.hypot(tmp.v.x, tmp.v.z) || 1, reach = Math.hypot(d.model.half.x, d.model.half.z) + 0.04;
    halo.position.x = (-tmp.v.x / away) * reach;
    halo.position.z = (-tmp.v.z / away) * reach;
  }
  equip?.update(dt, t, state, state === 'inspect' ? inspecting : target);
  composer.render(dt);
  // the map is of the hall: it steps aside in a room beyond the hall's walls
  const offMap = !!museum.layout.annex?.(camera.position.x, camera.position.z) && (Math.abs(camera.position.x) > museum.layout.HW || camera.position.z < museum.layout.zEnd);
  if (offMap !== frame.offMap) { frame.offMap = offMap; document.getElementById('minimap').classList.toggle('is-away', offMap); }
  if (mapVisible && !offMap && state !== 'intro') ui.drawMinimap(museum.layout, museum.displays, state === 'inspect' ? { pos: camera.position, yaw: player.yaw } : player, state === 'inspect' ? inspecting : target);
}
