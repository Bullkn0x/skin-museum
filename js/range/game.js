// The range's game: for three minutes bots step out from cover down the lanes, and the visitor
// shoots them with whichever gun of the collection they carried in.
//
// The bots are the game's own agents where assets/range/ holds them (built from the game's files
// by work/pipeline/make_agents.py), and plain stand-in figures where it does not. A bot has 100
// health and takes what the gun really deals: its damage, less over distance, four times (or the
// gun's own figure) to the head, three quarters to the legs. Bots do not shoot back.
//
// Score: 100 a kill, 50 more for a headshot, 25 more for the far row. The same sum is worked out
// again by the score service, so the two must stay in step (js/range/scores.js, server/range-scores).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createBlood } from './blood.js';

const BASE = 'assets/range/';
const ROUND = 180, COUNT_IN = 3;
const POINTS = { kill: 100, head: 50, far: 25 };
const HEALTH = 100;
const INCH = 0.0254;
// How the three minutes build: how many bots may be out at once, the wait between them, how long
// one stays in the open, and how many of them run between covers instead of stepping out.
const STAGES = [
  { until: 60, most: 2, every: 1.25, stay: [2.6, 3.3], runs: 0 },
  { until: 120, most: 3, every: 0.9, stay: [1.9, 2.5], runs: 0.3 },
  { until: 180, most: 4, every: 0.62, stay: [1.3, 1.8], runs: 0.45 },
];
const ROW_SHARE = { near: 0.4, mid: 0.38, far: 0.22 };
const STEP_OUT = 1.15;            // how far from the middle of its cover a bot stands when it is out
const WALK = 2.3, RUN = 4.6;      // metres a second, for figures whose clips do not say
const STEP = 2.8;                 // the sidestep out from cover and back
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = ([a, b]) => a + Math.random() * (b - a);
const clockText = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export function createRangeGame({ parent, posts, cover, line, walls, config, accent, onConsole, onBoard }) {
  let equip = null, host = null;
  let scores = null, twitch = null;
  let phase = 'idle';              // idle | count | live | over
  let clock = 0;                   // seconds into the count-in or the round
  let round = null;                // what this round has tallied
  let zone = null;
  let lastSpawn = 0;
  let consoleKey = '';

  // ---- the page furniture: the round's numbers, the hit mark, the end card ---------------------
  const style = document.createElement('style');
  style.textContent = `
    .range-hud { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); z-index: 12; display: flex; gap: 2px; pointer-events: none;
      font-family: Jost, system-ui, sans-serif; color: #f3ead8; opacity: 0; transition: opacity .25s; }
    .range-hud.is-open { opacity: 1; }
    .range-hud div { min-width: 92px; padding: 7px 14px 8px; background: rgba(8, 8, 14, .72); border-top: 2px solid var(--range-accent, #19e3ff); text-align: center; }
    .range-hud span { display: block; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; opacity: .65; }
    .range-hud b { display: block; font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.15; }
    .range-hud .is-last b { color: #ff6b5e; }
    .range-mark { position: fixed; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px; z-index: 12; pointer-events: none; opacity: 0;
      background: linear-gradient(45deg, transparent 46%, #fff 46%, #fff 54%, transparent 54%) 0 0 / 9px 9px no-repeat, linear-gradient(-45deg, transparent 46%, #fff 46%, #fff 54%, transparent 54%) 100% 0 / 9px 9px no-repeat,
        linear-gradient(-45deg, transparent 46%, #fff 46%, #fff 54%, transparent 54%) 0 100% / 9px 9px no-repeat, linear-gradient(45deg, transparent 46%, #fff 46%, #fff 54%, transparent 54%) 100% 100% / 9px 9px no-repeat; }
    .range-mark.is-hit { animation: range-mark .22s ease-out; }
    .range-mark.is-kill { animation: range-mark .4s ease-out; filter: drop-shadow(0 0 0 #ff3d3d) sepia(1) saturate(30) hue-rotate(-50deg); }
    @keyframes range-mark { from { opacity: 1; transform: scale(1.25); } to { opacity: 0; transform: scale(1); } }
    .range-pop { position: fixed; left: 50%; top: calc(50% + 34px); transform: translateX(-50%); z-index: 12; pointer-events: none; white-space: nowrap;
      font: 600 15px/1 Jost, system-ui, sans-serif; letter-spacing: .08em; color: #fff; text-shadow: 0 1px 5px rgba(0, 0, 0, .8); opacity: 0; }
    .range-pop.is-on { animation: range-pop .9s ease-out; }
    @keyframes range-pop { 0% { opacity: 0; margin-top: 6px; } 12% { opacity: 1; margin-top: 0; } 70% { opacity: 1; } 100% { opacity: 0; margin-top: -10px; } }
    .range-big { position: fixed; left: 50%; top: 36%; transform: translate(-50%, -50%); z-index: 12; pointer-events: none; text-align: center;
      font: 700 84px/1 Orbitron, Jost, system-ui, sans-serif; color: #fff; text-shadow: 0 0 24px var(--range-accent, #19e3ff); opacity: 0; transition: opacity .2s; }
    .range-big.is-open { opacity: 1; }
    .range-big small { display: block; margin-top: 12px; font: 500 15px/1.3 Jost, system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; text-shadow: 0 1px 6px rgba(0, 0, 0, .8); }
    .range-card { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: rgba(4, 4, 10, .6);
      font-family: Jost, system-ui, sans-serif; color: #f3ead8; }
    .range-card.is-open { display: flex; }
    .range-card section { width: min(430px, calc(100vw - 32px)); max-height: calc(100vh - 24px); overflow: auto; padding: 22px 26px 20px; background: rgba(10, 10, 16, .96);
      border: 1px solid rgba(255, 255, 255, .14); border-top: 2px solid var(--range-accent, #19e3ff); }
    .range-card h2 { margin: 0; font: 500 12px/1.3 Jost, system-ui, sans-serif; letter-spacing: .2em; text-transform: uppercase; opacity: .7; }
    .range-card .score { margin: 4px 0 14px; font: 700 40px/1.1 Orbitron, Jost, system-ui, sans-serif; color: #fff; }
    .range-card dl { display: grid; grid-template-columns: 1fr auto; gap: 7px 12px; margin: 0 0 16px; font-size: 15px; }
    .range-card dt { opacity: .7; } .range-card dd { margin: 0; font-variant-numeric: tabular-nums; }
    .range-card .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .range-card button { font: 600 13px/1 Jost, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #f3ead8; cursor: pointer;
      padding: 12px 16px; background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .28); }
    .range-card button:hover { background: rgba(255, 255, 255, .14); }
    .range-card button.is-main { border-color: var(--range-accent, #19e3ff); color: #fff; }
    .range-card button[disabled] { opacity: .5; cursor: default; }
    .range-card p { margin: 12px 0 0; font-size: 13px; line-height: 1.45; opacity: .78; }
    .range-card p.is-bad { color: #ff8a80; opacity: 1; }
    .range-card p.standing { margin: -6px 0 14px; font-size: 14px; opacity: .9; }
    .range-card p.standing:empty { display: none; }
    .range-card .prize { margin: 0 0 16px; padding: 10px 12px; background: rgba(255, 207, 90, .08); border-left: 2px solid #ffcf5a; font-size: 13.5px; line-height: 1.45; }
    .range-card .prize b { color: #ffcf5a; font-weight: 600; }
    .range-card button.is-twitch { display: inline-flex; align-items: center; gap: 9px; background: #9146ff; border-color: #9146ff; color: #fff; text-transform: none; letter-spacing: .02em; font-size: 14px; }
    .range-card button.is-twitch:hover { background: #a66bff; }
    .range-card button.is-twitch svg { width: 15px; height: 17px; flex: none; }
    .range-card button[hidden] { display: none; }
    .range-card .who { display: flex; align-items: center; gap: 10px; margin: 14px 0 0; font-size: 13px; opacity: .85; }
    .range-card .who[hidden] { display: none; }
    .range-card .who img { width: 26px; height: 26px; border-radius: 50%; }
    .range-card .who button { padding: 0; border: 0; background: none; font: inherit; letter-spacing: 0; text-transform: none; text-decoration: underline; opacity: .7; }
    body.is-watching .range-hud, body.is-inspecting .range-hud { display: none; }
    @media (max-width: 720px) { .range-hud div { min-width: 70px; padding: 5px 8px 6px; } .range-hud b { font-size: 18px; } .range-big { font-size: 56px; } }`;
  document.head.append(style);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const hud = el('div', 'range-hud', '<div><span>Time</span><b data-k="time">3:00</b></div><div><span>Score</span><b data-k="score">0</b></div><div><span>Kills</span><b data-k="kills">0</b></div><div><span>Accuracy</span><b data-k="acc">–</b></div>');
  const mark = el('div', 'range-mark'), pop = el('div', 'range-pop'), big = el('div', 'range-big');
  const card = el('div', 'range-card', '<section></section>');
  for (const n of [hud, mark, pop, big, card]) { n.style.setProperty('--range-accent', accent); document.body.append(n); }
  const cell = Object.fromEntries([...hud.querySelectorAll('b')].map((b) => [b.dataset.k, b]));
  const shown = {};
  const show = (k, text) => { if (shown[k] !== text) { shown[k] = text; cell[k].textContent = text; } };
  const flash = (node, cls) => { node.classList.remove('is-hit', 'is-kill', 'is-on'); void node.offsetWidth; node.classList.add(cls); };
  let bigUntil = 0;
  function say(text, small = '', seconds = 2.4) {
    big.innerHTML = `${text}${small ? `<small>${small}</small>` : ''}`;
    big.classList.add('is-open');
    bigUntil = performance.now() + seconds * 1000;
  }

  // ---- the cast ---------------------------------------------------------------------------------
  // Loaded the first time a visitor walks into the hallway. Until it has arrived, or if there is
  // nothing to load, the bots are plain figures: the game plays the same either way.
  let cast = null, casting = null;
  const figures = [];              // every figure made so far: { root, mixer, actions, bones, busy, plain }
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

  async function loadCast() {
    const m = await fetch(BASE + 'manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!m || !m.agents?.length) return null;
    const loader = new GLTFLoader();
    const [anims, ...agents] = await Promise.all([
      m.anims?.file ? loader.loadAsync(BASE + m.anims.file).catch(() => null) : null,
      ...m.agents.map((a) => loader.loadAsync(BASE + a.file).catch(() => null)),
    ]);
    const list = m.agents.map((a, i) => ({ ...a, gltf: agents[i] })).filter((a) => a.gltf);
    if (!list.length) return null;
    const weapons = {};
    for (const [team, w] of Object.entries(m.weapons || {})) {
      const g = w?.file ? await loader.loadAsync(BASE + w.file).catch(() => null) : null;
      if (g) { g.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); weapons[team] = { ...w, scene: g.scene }; }       // carried on a bone: its own bounds say nothing of where it is
    }
    for (const a of list) a.gltf.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });      // a skinned mesh's bounds are its rest pose's
    return { manifest: m, agents: list, clips: anims ? anims.animations : list[0].gltf.animations, weapons };
  }

  function plainFigure(team) {
    const root = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: team === 'ct' ? 0x2c4d8f : 0x9a6a2c, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd6b08a, roughness: 0.8 });
    const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; root.add(o); return o; };
    add(new THREE.CapsuleGeometry(0.17, 0.62, 4, 10), body, 0.48);
    add(new THREE.CapsuleGeometry(0.22, 0.42, 4, 12), body, 1.22);
    const head = add(new THREE.SphereGeometry(0.125, 14, 10), skin, 1.68);
    return { root, mixer: null, actions: {}, bones: { head, chest: null, pelvis: null }, busy: false, plain: true, team };
  }

  function agentFigure(a) {
    const root = SkeletonUtils.clone(a.gltf.scene);
    const names = cast.manifest.bones || {};
    const bone = (role) => (names[role] ? root.getObjectByName(names[role]) : null) || null;
    const mixer = new THREE.AnimationMixer(root), actions = {};
    for (const clip of cast.clips) actions[clip.name] = mixer.clipAction(clip);
    // the rifle hangs from the skeleton's weapon bone, as the game hangs it
    const gun = cast.weapons[a.team], hand = gun && root.getObjectByName(gun.bone);
    let rifle = null;
    if (hand) {
      rifle = gun.scene.clone(true);
      if (gun.position) rifle.position.fromArray(gun.position);
      if (gun.quaternion) rifle.quaternion.fromArray(gun.quaternion);
      hand.add(rifle);
    }
    return {
      root, mixer, actions, rifle, busy: false, plain: false, team: a.team, current: null,
      bones: { head: bone('head'), chest: bone('chest') || bone('neck'), pelvis: bone('pelvis') },
      // where the middle of the head is, in the head bone's own frame, and how big a ball it is
      headIn: new THREE.Vector3().fromArray(a.head_in_bone_m || cast.manifest.head_in_bone_m || [0, 0.05, 0]),
      headR: a.head_radius_m || cast.manifest.head_radius_m || 0.12,
    };
  }

  /** How fast a clip's feet carry the body, in metres a second, where the files say. */
  const paceOf = (name, otherwise) => {
    const t = cast?.manifest.anims?.clips?.[name]?.travel_mps;
    return t ? Math.hypot(t.forward, t.left) : otherwise;
  };

  /**
   * Once the cast has arrived, each agent is drawn for a moment far under the floor, one after
   * another. That is when its shaders are built and its pictures sent to the graphics card: on
   * the way down the hallway, instead of as a stutter the first time it steps out in a round.
   */
  let warming = null;
  function warmUp(dt) {
    if (!cast || warming === false) return;
    if (!warming) warming = { list: cast.agents.slice(), f: null, t: 0 };
    warming.t -= dt;
    if (warming.t > 0) return;
    if (warming.f) { warming.f.root.visible = false; warming.f.root.position.y = 0; warming.f.busy = false; }
    const a = warming.list.shift();
    if (!a) { warming = false; return; }
    const f = agentFigure(a);
    f.root.userData.shotsPass = true;
    f.root.position.set(2, -60, -45);
    f.busy = true;
    parent.add(f.root);
    figures.push(f);
    warming.f = f; warming.t = 0.12;
  }

  function figure() {
    // any of the cast that is not out on the lanes already, so the same face does not come round every time
    const idle = figures.filter((x) => !x.busy && (cast ? !x.plain : x.plain));
    let f = idle.length >= 3 || (idle.length && figures.length >= 12) ? pick(idle) : null;
    if (!f) {
      f = cast ? agentFigure(pick(cast.agents)) : plainFigure(Math.random() < 0.5 ? 'ct' : 't');
      f.root.visible = false;
      f.root.userData.shotsPass = true;         // whether a round strikes a bot is worked out here, from its shape, not from its mesh
      parent.add(f.root);
      figures.push(f);
    }
    f.busy = true;
    return f;
  }

  function pose(f, name, fade = 0.15, rate = 1) {
    if (!f.mixer) return;
    const a = f.actions[name] || f.actions.idle;
    if (!a) return;
    a.setEffectiveTimeScale(rate);
    if (f.current === a) return;
    a.reset().setEffectiveWeight(1).setEffectiveTimeScale(rate).play();
    if (f.current) a.crossFadeFrom(f.current, fade, false);
    f.current = a;
  }

  // ---- the bots out on the lanes ------------------------------------------------------------------
  // What the shooter hears: the game's own feedback for a hit and a kill, and its count-in beeps.
  // They come through the sound player of whatever carries the gun, and are silent without it.
  const HEARD = { hit: 'Player.DamageBody.AttackerFeedback', kill: 'Player.DeathBody.AttackerFeedback', headHit: 'Player.DamageHeadShot.AttackerFeedback',
    headKill: 'Player.DeathHeadShot.AttackerFeedback', beep: 'UI.CounterBeep', go: 'UI.CounterBeep', over: 'UI.DeathMatch.EndTimer' };      // the game's own "done" beep is a silent file
  const sound = (what) => equip?.sounds?.play(HEARD[what]);

  const blood = createBlood(parent);      // a spray from a bot that is hit, a splatter on what is behind it (js/range/blood.js)

  const out = [];                 // { f, post, kind, step, t, x0, x1, z, stay, hp, dead }
  const hideZ = (p) => p.z - cover.d / 2 - 0.45;
  const free = (p) => !out.some((b) => !b.dead && (b.post === p || b.to === p));      // a bot that is down no longer holds its cover

  function send(stage) {
    const open = posts.filter(free);
    if (!open.length) return;
    // which row: by its share, among the rows that have a cover free
    const rows = [...new Set(open.map((p) => p.row))];
    let r = Math.random() * rows.reduce((s, k) => s + ROW_SHARE[k], 0), row = rows[0];
    for (const k of rows) { r -= ROW_SHARE[k]; if (r <= 0) { row = k; break; } }
    const post = pick(open.filter((p) => p.row === row));
    const f = figure();
    const b = { f, post, to: null, hp: HEALTH, dead: 0, t: 0, z: hideZ(post), step: 'out', stay: between(stage.stay) };
    const next = posts.filter((p) => p.row === post.row && p !== post && free(p));
    if (next.length && Math.random() < stage.runs) {
      b.kind = 'run'; b.to = pick(next);
      b.x0 = post.x; b.x1 = b.to.x;
    } else {
      // step out to whichever side has room for it
      const sides = [-1, 1].filter((s) => post.x + s * STEP_OUT > walls.x0 + 0.5 && post.x + s * STEP_OUT < walls.x1 - 0.5);
      b.kind = 'peek'; b.x0 = post.x; b.x1 = post.x + pick(sides) * STEP_OUT;
    }
    f.root.position.set(b.x0, 0, b.z);
    f.root.rotation.set(0, 0, 0);
    f.root.visible = true;
    if (f.rifle) f.rifle.visible = true;
    if (f.mixer) { f.mixer.stopAllAction(); f.current = null; }
    out.push(b);
    travel(b, b.x1);
  }

  /**
   * Set a bot moving sideways toward x. A run faces the way it goes. A step out from cover keeps
   * facing the counter, sidestepping, where the files have a clip for that. The body moves at
   * the pace the clip's feet do, so they do not slide.
   */
  function travel(b, x) {
    const f = b.f, dir = Math.sign(x - f.root.position.x) || 1;      // +1 is toward the right wall
    b.goal = x;
    const side = dir > 0 ? 'strafe_left' : 'strafe_right';           // facing the counter, the right wall is on the bot's left
    if (b.kind === 'peek' && f.actions[side]) {
      b.speed = STEP;
      f.root.rotation.y = 0;
      pose(f, side, 0.12, STEP / paceOf(side, STEP));
    } else {
      const clip = b.kind === 'run' || !f.actions.walk ? 'run' : 'walk';
      b.speed = paceOf(clip, clip === 'run' ? RUN : WALK);
      f.root.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      pose(f, clip);
    }
  }

  function retire(b) {
    b.f.root.visible = false;
    b.f.busy = false;
    out.splice(out.indexOf(b), 1);
  }

  function moveBots(dt) {
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i], f = b.f, p = f.root.position;
      if (f.mixer) f.mixer.update(dt);
      if (b.dead) {
        // down: by the game's own death clip where there is one, otherwise over backwards; then through the floor and gone
        b.dead += dt;
        if (!b.fell) { const k = Math.min(1, b.dead / 0.32); f.root.rotation.x = -k * k * (Math.PI / 2); }
        if (b.dead > b.lies) p.y = -(b.dead - b.lies) * 0.9;
        if (b.dead > b.lies + 0.7) { p.y = 0; f.root.rotation.x = 0; retire(b); }
        continue;
      }
      if (b.step === 'out' || b.step === 'back') {
        const d = b.goal - p.x, s = b.speed * dt;
        if (Math.abs(d) <= s) {
          p.x = b.goal;
          if (b.step === 'back' || b.kind === 'run') { retire(b); continue; }
          b.step = 'stay'; b.t = 0;
          f.root.rotation.y = 0;
          pose(f, 'idle');
        } else p.x += Math.sign(d) * s;
      } else if (b.step === 'stay') {
        b.t += dt;
        if (b.t >= b.stay) { b.step = 'back'; travel(b, b.x0); }
      }
    }
  }

  // ---- a shot: did it strike a bot before it struck the room? ---------------------------------------
  const spheres = [];
  function shapeOf(b) {
    // head, three spheres up the trunk and three down the legs, from the skeleton where there is one
    const f = b.f, root = f.root.position;
    spheres.length = 0;
    let head, r = 0.13;
    if (f.plain) head = f.bones.head.getWorldPosition(tmpA);
    else if (f.bones.head) { f.bones.head.updateWorldMatrix(true, false); head = tmpA.copy(f.headIn).applyMatrix4(f.bones.head.matrixWorld); r = f.headR; }
    else head = tmpA.set(root.x, 1.68, root.z);
    spheres.push({ x: head.x, y: head.y, z: head.z, r, part: 'head' });
    const pelvis = f.bones.pelvis ? f.bones.pelvis.getWorldPosition(tmpB) : tmpB.set(root.x, 0.98, root.z);
    const chest = f.bones.chest ? f.bones.chest.getWorldPosition(tmpC) : tmpC.set(root.x, 1.42, root.z);
    for (const k of [0, 0.5, 1]) spheres.push({ x: lerp(pelvis.x, chest.x, k), y: lerp(pelvis.y, chest.y, k), z: lerp(pelvis.z, chest.z, k), r: 0.215, part: 'body' });
    for (const k of [0.16, 0.5, 0.84]) spheres.push({ x: lerp(root.x, pelvis.x, k), y: lerp(0.08, pelvis.y, k), z: lerp(root.z, pelvis.z, k), r: 0.18, part: 'legs' });
    return spheres;
  }

  function strike(origin, dir, far) {
    let best = null;
    for (const b of out) {
      if (b.dead) continue;
      for (const s of shapeOf(b)) {
        const ox = s.x - origin.x, oy = s.y - origin.y, oz = s.z - origin.z;
        const along = ox * dir.x + oy * dir.y + oz * dir.z;
        if (along <= 0) continue;
        const off2 = ox * ox + oy * oy + oz * oz - along * along;
        if (off2 > s.r * s.r) continue;
        const t = along - Math.sqrt(s.r * s.r - off2);
        if (t > 0 && t < far && (!best || t < best.t)) best = { t, b, part: s.part };
      }
    }
    return best;
  }

  /** Every round the visitor fires comes through here. Returns where it stopped, if a bot stopped it. */
  function shot({ origin, dir, hit, gun, melee }) {
    if (phase !== 'live' || melee || !gun) return null;
    round.shots++;
    const s = strike(origin, dir, hit ? hit.distance : 300);
    if (!s) { round.streak = 0; return null; }
    round.hits++;
    const b = s.b;
    let dealt = gun.damage * Math.pow(gun.range_modifier, s.t / INCH / 500);
    dealt *= s.part === 'head' ? gun.headshot : s.part === 'legs' ? 0.75 : 1;
    b.hp -= dealt;
    const where = tmpA.copy(origin).addScaledVector(dir, s.t + 0.06).clone();
    blood.hit(where, dir, hit, hit ? hit.distance - s.t : 99, b.hp <= 0 || s.part === 'head');
    if (b.hp <= 0) {
      blood.pool(b.f.root.position.x, b.f.root.position.z);
      const head = s.part === 'head', far = b.post.row === 'far';
      const points = POINTS.kill + (head ? POINTS.head : 0) + (far ? POINTS.far : 0);
      round.kills++; round.headshots += head ? 1 : 0; round.far += far ? 1 : 0;
      round.score += points;
      round.streak++; round.best = Math.max(round.best, round.streak);
      b.dead = 1e-6;
      const death = Object.keys(b.f.actions).filter((n) => n.startsWith('death'));
      if (death.length) {
        const a = b.f.actions[pick(death)];
        a.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.play();
        if (b.f.current) a.crossFadeFrom(b.f.current, 0.08, false);
        b.f.current = a; b.fell = true;
        b.lies = Math.min(a.getClip().duration, 2.2) + 0.5;      // a moment on the floor, then it is cleared away
        if (b.f.rifle) b.f.rifle.visible = false;                // the clips let go of the rifle; there is nothing to make it fall
      } else { b.fell = false; b.lies = 0.9; pose(b.f, 'idle', 0.05); }
      flash(mark, 'is-kill');
      pop.textContent = `+${points}${head ? '  HEADSHOT' : ''}${far ? '  FAR' : ''}`;
      flash(pop, 'is-on');
      sound(head ? 'headKill' : 'kill');
    } else { flash(mark, 'is-hit'); sound(s.part === 'head' ? 'headHit' : 'hit'); }
    return { point: tmpA.copy(origin).addScaledVector(dir, s.t).clone() };
  }

  // ---- the round --------------------------------------------------------------------------------
  const stageAt = (t) => STAGES.find((s) => t < s.until) || STAGES[STAGES.length - 1];
  const accuracy = () => (round && round.shots ? Math.round((100 * round.hits) / round.shots) : null);

  function start() {
    if (phase === 'count' || phase === 'live') return;
    if (!equip) { say('No guns here yet', 'The carrying of weapons is switched off'); return; }
    if (!equip.held || !equip.gun) { say('Take a gun first', 'The rack is in the hallway behind you'); return; }
    round = { weapon: equip.held.display, name: equip.held.display.skin.name, score: 0, kills: 0, headshots: 0, far: 0, shots: 0, hits: 0, streak: 0, best: 0 };
    phase = 'count'; clock = 0; lastSpawn = 0;
    clearBots();
    blood.clear();
    hud.classList.add('is-open');
    scores?.begin();                 // asks the score service for this round's ticket, where there is a service
    if (!casting) casting = loadCast().then((c) => { cast = c; });
  }

  function clearBots() { while (out.length) retire(out[out.length - 1]); }

  function stop(why) {
    if (phase !== 'count' && phase !== 'live') return;
    phase = 'idle';
    clearBots();
    hud.classList.remove('is-open');
    if (why) say(why, 'It does not count', 2.6);
  }

  function finish() {
    phase = 'over';
    sound('over');
    clearBots();
    hud.classList.remove('is-open');
    const result = { score: round.score, kills: round.kills, headshots: round.headshots, far: round.far, shots: round.shots, hits: round.hits, weapon: round.name, accuracy: accuracy() ?? 0, streak: round.best };
    round.result = result;
    round.localBest = !!scores?.finish(result)?.localBest;
    refreshBoard();
  }

  // ---- the end card: the round's numbers, and putting them on the board under a Twitch name -----------
  // Someone already signed in has nothing to press: the round is saved as the card opens. Anyone
  // else sees where the round would stand this month and one button, in Twitch's own purple.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = (key) => MONTHS[Number(String(key).slice(5, 7)) - 1] || 'this month';
  const daysLeft = (ends) => {
    if (!ends) return '';
    const days = Math.ceil((ends - Date.now()) / 86400000);
    return days > 1 ? `${days} days left` : days === 1 ? 'One day left' : 'Ends today';
  };
  const prize = String(config.prize || 'a skin');
  const TWITCH_MARK = '<svg viewBox="0 0 24 28" aria-hidden="true" fill="currentColor"><path d="M2.4 0 0 4.8v19.2h6.4V28h3.6l3.6-4h5.2L24 18.8V0H2.4Zm19.2 17.6-4 4h-6.4l-3.6 3.6v-3.6H2.4V2.4h19.2v15.2Z"/><path d="M17.6 6.8h-2.4v7.2h2.4V6.8Zm-6.4 0H8.8v7.2h2.4V6.8Z"/></svg>';
  /** Where a score would stand on the board as last read: its place, or null when it is outside the ten shown. */
  const placeOf = (score) => {
    const rows = scores.known();
    const ahead = rows.filter((x) => x.score >= score).length;
    return rows.length < 10 || ahead < rows.length ? ahead + 1 : null;
  };
  let closeCard = null;
  const summary = {
    open(done) {
      closeCard = done;
      const r = round.result, section = card.firstElementChild;
      const online = !!(scores?.remote && twitch?.ready);
      const season = online ? scores.season() : null;
      section.innerHTML = `
        <h2>Round over  ·  ${esc(r.weapon)}</h2>
        <div class="score">${r.score.toLocaleString('en-US')} points</div>
        <dl><dt>Kills</dt><dd>${r.kills}</dd><dt>Headshots</dt><dd>${r.headshots}</dd><dt>Accuracy</dt><dd>${r.shots ? r.accuracy + '%' : '–'}</dd><dt>Best streak</dt><dd>${r.streak}</dd></dl>
        ${season ? `<div class="prize"><b>Top score in ${esc(monthName(season.month))} wins ${esc(prize)}.</b> ${esc(daysLeft(season.ends))}</div>` : ''}
        <p class="standing" data-k="standing"></p>
        <div class="row"><button data-do="save" class="is-main is-twitch">${TWITCH_MARK}<span>Sign in with Twitch to save</span></button><button data-do="again">Play again</button><button data-do="close">Close</button></div>
        <p data-k="note"></p>
        <div class="who" data-k="who" hidden></div>`;
      const save = section.querySelector('[data-do=save]'), note = section.querySelector('[data-k=note]');
      const standing = section.querySelector('[data-k=standing]'), who = section.querySelector('[data-k=who]');
      let saved = false;
      const label = () => {
        const u = twitch?.user();
        save.hidden = saved || !online || r.score <= 0 || !!u;         // signed in, the saving needs no button
        note.className = '';
        note.textContent = !online ? `The online leaderboard is not switched on yet. ${round.localBest ? 'This is your best round on this device.' : 'Your best round is kept on this device.'}`
          : r.score <= 0 ? 'Nothing to save this time.' : u || saved ? '' : 'Signing in shares only your public Twitch name and picture.';
        if (online && r.score > 0 && !saved) {
          const place = placeOf(r.score);
          standing.textContent = place ? `That would be number ${place} this month.` : 'That is outside this month\'s top ten.';
        }
        who.hidden = !u;
        if (u) {
          who.innerHTML = `${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : ''}<span>Signed in as <b>${esc(u.name)}</b></span><button data-do="out">Not you?</button>`;
          who.querySelector('[data-do=out]').onclick = () => { twitch.signOut(); label(); };
        }
      };
      const hand = async (clicked) => {
        if (saved || !online || r.score <= 0) return;
        save.disabled = true;
        try {
          if (!twitch.user()) {
            if (!clicked) return;
            note.className = ''; note.textContent = 'Waiting for the sign-in window…';
            await twitch.signIn();
            label();
          }
          note.className = ''; note.textContent = 'Saving your score…';
          const res = await scores.save(r);
          saved = true;
          label();
          standing.textContent = res.improved ? `You are number ${res.rank} this month.` : `Your best this month stays ${Number(res.best).toLocaleString('en-US')} (number ${res.rank}).`;
          note.textContent = 'Saved to the leaderboard.';
          refreshBoard(true);
        } catch (err) {
          label();
          save.hidden = saved || !online || r.score <= 0;        // offer the button again, signed in or not
          section.querySelector('[data-do=save] span').textContent = twitch.user() ? 'Try saving again' : 'Sign in with Twitch to save';
          note.className = 'is-bad'; note.textContent = err?.message || 'That did not work. Try again.';
        } finally { save.disabled = false; }
      };
      label();
      save.onclick = () => hand(true);
      section.querySelector('[data-do=again]').onclick = () => { done(); start(); };
      section.querySelector('[data-do=close]').onclick = () => done();
      card.classList.add('is-open');
      hand(false);
    },
    close() { card.classList.remove('is-open'); closeCard = null; if (phase === 'over') phase = 'idle'; },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  card.addEventListener('mousedown', (e) => { if (e.target === card && closeCard) closeCard(); });

  // ---- the board ----------------------------------------------------------------------------------
  let boardAt = -1e9;
  async function refreshBoard(force) {
    if (!scores) return;
    boardAt = performance.now();
    const rows = await scores.top(10, force);
    const season = scores.remote ? scores.season() : null;
    onBoard(rows, !scores.remote ? 'THIS DEVICE ONLY  ·  ONLINE BOARD NOT SWITCHED ON'
      : season ? [monthName(season.month), `TOP SCORE WINS ${prize}`, daysLeft(season.ends)].filter(Boolean).join('  ·  ').toUpperCase() : 'BEST ROUND PER TWITCH ACCOUNT');
  }

  // The Twitch sign-in and the score keeping are their own modules; without them the game still plays.
  (async () => {
    // With "site" set (the owner's Knox Nation), that site signs visitors in and keeps a board for
    // each month. Without it, the older pair: a Twitch application of the museum's own and a
    // stand-alone score server.
    const site = String(config.site || '').trim().replace(/\/+$/, '');
    const [tw, sc] = await Promise.all([import(site ? './pass.js' : './twitch.js').catch(() => null), import('./scores.js').catch(() => null)]);
    twitch = !tw ? null : site ? tw.createPass(site) : tw.createTwitch(config.twitchClientId || '');
    scores = sc ? sc.createScores({ api: site ? `${site}/api/public/range` : config.scoreApi || '', twitch }) : null;
    refreshBoard();
  })();

  function update(dt, camera, where) {
    zone = where;
    if (bigUntil && performance.now() > bigUntil) { big.classList.remove('is-open'); bigUntil = 0; }
    if (phase === 'count' || phase === 'live') {
      if (zone !== 'range') stop('You left the range');
      else if (!equip.held || equip.held.display !== round.weapon) stop('One gun a round');
    }
    if (phase === 'count') {
      clock += dt;
      const left = Math.ceil(COUNT_IN - clock);
      if (left > 0) { say(String(left), round.name, 0.5); if (left !== round.counted) { round.counted = left; sound('beep'); } }
      else { phase = 'live'; clock = 0; say('GO', '', 0.7); sound('go'); }
    } else if (phase === 'live') {
      clock += dt;
      const stage = stageAt(clock);
      if (out.filter((b) => !b.dead).length < stage.most && clock - lastSpawn >= stage.every && clock < ROUND - 1) { lastSpawn = clock; send(stage); }
      if (clock >= ROUND) finish();
    } else if (phase === 'over' && !closeCard) host?.openThing(summary);      // waits its turn if another panel has the page
    if (zone) warmUp(dt);
    moveBots(dt);
    blood.update(dt);

    if (phase === 'count' || phase === 'live') {
      const left = phase === 'live' ? ROUND - clock : ROUND;
      show('time', clockText(Math.ceil(left)));
      cell.time.parentElement.classList.toggle('is-last', left <= 10);
      show('score', round.score.toLocaleString('en-US'));
      show('kills', String(round.kills));
      show('acc', accuracy() == null ? '–' : `${accuracy()}%`);
    }
    // the console's little screen, redrawn only when what it says changes
    const view = phase === 'live' ? { big: clockText(Math.ceil(ROUND - clock)), small: `${round.score.toLocaleString('en-US')} POINTS` }
      : phase === 'count' ? { big: 'READY', small: round.name.toUpperCase().slice(0, 34) }
        : { big: '3:00', small: equip?.held && equip.gun ? 'PRESS E TO START A ROUND' : 'BRING A GUN FROM THE RACK' };
    const key = view.big + view.small;
    if (key !== consoleKey && zone) { consoleKey = key; onConsole(view); }
    if (zone === 'range' && scores?.remote && performance.now() - boardAt > 60000) refreshBoard();
  }

  return {
    update, start, stop, shot,
    get running() { return phase === 'count' || phase === 'live'; },
    get phase() { return phase; }, get round() { return round; }, get out() { return out; }, get cast() { return cast; },
    /** The visitor has walked into the hallway or the range (or out again): fetch the bots while they are still on their way in. */
    enter(where) {
      if (where && !casting) casting = loadCast().then((c) => { cast = c; });
      if (where) equip?.sounds?.load(Object.values(HEARD));
      if (where) blood.load();
      if (where === 'range') refreshBoard();
    },
    attachEquip(e) { equip = e; e.onShot = shot; },
    attachHost(h) { host = h; },
    /** For trying things out: end the round now, as if the clock had run down. */
    debugFinish() { if (phase === 'live') finish(); },
    debugClock(t) { if (phase === 'live') clock = t; },
  };
}
