// Skin Museum - entry point: loading, render loop, and the walk / inspect state machine.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildMuseum } from './museum.js';
import { Player } from './player.js';
import * as ui from './ui.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('is-touch');
// Pointer lock gives proper mouse look. Fall back to click-and-drag when it is
// unavailable (touch devices, some embeds) or when ?nolock is in the URL.
let useLock = !isTouch && !params.has('nolock') && 'requestPointerLock' in canvas;
let lockEverWorked = false;

const WALK_FOV = 68;
const INSPECT_FOV = 44;

let renderer, composer, bloom, scene, camera, museum, player;
let state = 'loading';          // loading | intro | walk | inspect | paused
let target = null;              // display the visitor is looking at
let inspecting = null;          // display currently being inspected
let mapVisible = true;
const pointer = { x: 0, y: 0 }; // -1..1, for inspect parallax
const view = { shift: 0, fov: WALK_FOV };
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
    const t = await loader.loadAsync(s.image).catch(() => { throw new Error(`could not load ${s.image}`); });
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    images.set(s.id, t);
    ui.setProgress(++done / data.skins.length);
  })]);

  museum = buildMuseum(scene, data, images, renderer);
  player = new Player(camera, museum.layout, museum.colliders);

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.6, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  resize();
  window.addEventListener('resize', resize);
  bindInput();
  if (!useLock) document.body.classList.add('is-drag');

  player.update(0);
  renderer.compile(scene, camera);
  state = 'intro';
  ui.setReady();
  renderer.setAnimationLoop(frame);

  if (params.has('debug')) window.__museum = { museum, player, camera, scene, renderer, inspect, closeInspect, get state() { return state; }, enter };
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
  const dx = narrow ? 0 : view.shift * panelW / 2;
  const dy = narrow ? view.shift * h * 0.29 : 0;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) camera.setViewOffset(w, h, dx, dy, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// state transitions
// ---------------------------------------------------------------------------
function enter() {
  ui.toggle('intro', false);
  ui.toggle('pause', false);
  ui.toggle('hud', true);
  state = 'walk';
  player.enabled = true;
  lockPointer();
}

function setDragMode() {
  useLock = false;
  document.body.classList.add('is-drag');
}

function lockPointer() {
  if (!useLock || document.pointerLockElement === canvas) return;
  let p = null;
  try { p = canvas.requestPointerLock(); } catch { /* handled below */ }
  if (p && p.catch) p.catch(() => {});
  setTimeout(() => {
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
  inspecting = display;
  state = 'inspect';
  player.enabled = false;
  player.keys.clear();
  ui.setPrompt(null);
  ui.renderPanel(display, museum.displays.length);
  ui.openPanel(true);
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
  inspecting = null;
  ui.openPanel(false);
  player.syncFromCamera();
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
  document.getElementById('pause').addEventListener('click', enter);
  document.getElementById('panel-close').addEventListener('click', closeInspect);
  document.getElementById('panel-back').addEventListener('click', closeInspect);
  document.getElementById('panel-prev').addEventListener('click', () => step(-1));
  document.getElementById('panel-next').addEventListener('click', () => step(1));

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      lockEverWorked = true;
      if (state === 'paused') enter();
    } else if (state === 'walk' && useLock) {
      pause();
    }
  });
  document.addEventListener('pointerlockerror', () => { if (!lockEverWorked) setDragMode(); });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (state === 'intro' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); enter(); return; }
    if (state === 'inspect') {
      if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); closeInspect(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') step(1);
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') step(-1);
      return;
    }
    if (state !== 'walk') return;
    if (e.code === 'KeyE' && !e.repeat) { inspect(target); return; }
    if (e.code === 'KeyM' && !e.repeat) { mapVisible = !mapVisible; document.getElementById('minimap').classList.toggle('is-hidden', !mapVisible); return; }
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    player.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => player.keys.delete(e.code));
  window.addEventListener('blur', () => player.keys.clear());

  // mouse look: locked pointer, or drag when lock is unavailable
  let dragging = false, lastX = 0, lastY = 0, dragId = null;
  document.addEventListener('mousemove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (state === 'walk' && document.pointerLockElement === canvas) player.look(e.movementX, e.movementY);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'walk') return;
    if (useLock) { lockPointer(); return; }
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.4 && e.clientY > window.innerHeight * 0.5) return;
    dragging = true; dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragId || state !== 'walk') return;
    const k = e.pointerType === 'touch' ? 2.2 : 1.6;
    player.look(-(e.clientX - lastX) * k, -(e.clientY - lastY) * k);
    lastX = e.clientX; lastY = e.clientY;
  });
  const endDrag = (e) => { if (e.pointerId === dragId) { dragging = false; dragId = null; } };
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
  document.getElementById('prompt').addEventListener('click', () => { if (state === 'walk') inspect(target); });
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
    // must be standing in front of wall pieces, not beside them
    if (d.kind !== 'pedestal' && tmp.v.dot(d.normal) > -0.6) continue;
    const dot = tmp.v.normalize().dot(tmp.fwd);
    if (dot < (d.kind === 'hero' ? 0.8 : 0.74)) continue;
    const score = dot * 3 - dist / d.radius;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const timer = new THREE.Timer();
let introT = 0;

function frame(now) {
  timer.update(now);
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
  } else {
    player.update(dt);
  }

  // ease field of view / framing between walking and inspecting
  const wantFov = state === 'inspect' ? INSPECT_FOV : WALK_FOV;
  const wantShift = state === 'inspect' ? 1 : 0;
  if (Math.abs(view.fov - wantFov) > 0.01 || Math.abs(view.shift - wantShift) > 0.001) {
    const k = 1 - Math.exp(-dt * 5);
    view.fov += (wantFov - view.fov) * k;
    view.shift += (wantShift - view.shift) * k;
    applyView();
  }

  if (state === 'walk') {
    const next = findTarget();
    if (next !== target) { target = next; ui.setPrompt(target); }
  } else if (target && state !== 'inspect') {
    target = null; ui.setPrompt(null);
  }

  museum.update(t, dt, camera, state === 'inspect' ? inspecting : target);
  composer.render(dt);
  if (mapVisible && state !== 'intro') ui.drawMinimap(museum.layout, museum.displays, state === 'inspect' ? { pos: camera.position, yaw: player.yaw } : player, state === 'inspect' ? inspecting : target);
}
