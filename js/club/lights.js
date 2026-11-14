// The lighting rig: moving heads on a truss over the dance floor, fixed spots on the showpieces,
// lasers (Neon Grid) and a mirror ball (Velvet). The fixtures are for show: they draw beams in
// the haze and pools on the floor, but cast no light on the exhibits, so the pieces keep their
// own even lighting whatever the room is doing.
import * as THREE from 'three';
import { FLECKS_GLSL } from './floor.js';

const rnd = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);

/** A soft cone of light in the haze: bright at the lamp, dissolving at its edges and far end. */
function beamMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal; vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.8);
        float fall = smoothstep(0.0, 0.1, vUv.y) * (0.22 + 0.78 * vUv.y * vUv.y);
        gl_FragColor = vec4(uColor * edge * fall * uOpacity, 1.0);
      }`,
  });
}

export function buildRig({ scene, hall, K, D, floor, box, mat, podiums, washes, ballPos }) {
  const neon = K.neon;
  const palette = K.palette.map((c) => new THREE.Color(c));
  const white = new THREE.Color(K.warm);
  const TY = 6.7;                                   // truss height
  const C = { x: 0, z: (D.DANCE.z0 + D.DANCE.z1) / 2 };
  const RX = 2.9, RZ = (D.DANCE.z1 - D.DANCE.z0) / 2 - 0.6;

  // ---- truss ------------------------------------------------------------------
  const bars = [-8.0, -13.2, -18.4];
  for (const sx of [-1, 1]) for (const dy of [0, 0.28]) box(hall, mat.truss, 0.05, 0.05, 13.2, sx * 3.4, TY + dy, C.z);
  for (const z of [...bars, -6.6, -19.8]) for (const dy of [0, 0.28]) box(hall, mat.truss, 6.8, 0.05, 0.05, 0, TY + dy, z);
  for (const sx of [-1, 1]) for (let z = -6.6; z > -19.9; z -= 0.6) box(hall, mat.truss, 0.03, 0.3, 0.03, sx * 3.4, TY + 0.14, z);
  for (const z of bars) for (let x = -3.4; x < 3.41; x += 0.6) box(hall, mat.truss, 0.03, 0.3, 0.03, x, TY + 0.14, z);
  for (const sx of [-1, 1]) for (const z of [-7.2, -19.2]) box(hall, mat.truss, 0.03, D.H - TY - 0.28, 0.03, sx * 3.4, (D.H + TY + 0.28) / 2, z);   // hangers

  // ---- moving heads ---------------------------------------------------------------
  const coneGeo = new THREE.CylinderGeometry(0.07, 1, 1, 28, 1, true).translate(0, -0.5, 0);
  const bodyGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.3, 14).translate(0, -0.1, 0);
  const lensGeo = new THREE.CircleGeometry(0.11, 18).rotateX(Math.PI / 2).translate(0, -0.252, 0);
  const armGeo = new THREE.BoxGeometry(0.04, 0.34, 0.12).translate(0, -0.12, 0);
  const baseGeo = new THREE.BoxGeometry(0.32, 0.12, 0.32);
  const heads = [];
  bars.forEach((z, row) => {
    for (const x of [-2.55, -0.85, 0.85, 2.55]) {
      const base = new THREE.Group();
      base.position.set(x, TY - 0.08, z);
      base.add(new THREE.Mesh(baseGeo, mat.black));
      const yoke = new THREE.Group(); yoke.position.y = -0.12;
      for (const sx of [-1, 1]) { const arm = new THREE.Mesh(armGeo, mat.black); arm.position.x = sx * 0.17; yoke.add(arm); }
      const head = new THREE.Group(); head.position.y = -0.24;
      head.add(new THREE.Mesh(bodyGeo, mat.black));
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      head.add(new THREE.Mesh(lensGeo, lensMat));
      const beamMat = beamMaterial(0xffffff, 0.1);
      const beam = new THREE.Mesh(coneGeo, beamMat);
      beam.position.y = -0.25; beam.renderOrder = 2; beam.frustumCulled = false;
      head.add(beam);
      yoke.add(head); base.add(yoke); hall.add(base);
      const origin = new THREE.Vector3(x, TY - 0.08 - 0.12 - 0.24 - 0.25, z);
      heads.push({ yoke, head, beam, beamMat, lensMat, origin, row, home: { x, z }, aim: new THREE.Vector2(x, z), color: palette[0].clone(), want: new THREE.Color() });
    }
  });

  const mark = new THREE.Vector2();
  /** Where head `i` should be pointing on the floor, `b` beats into programme `prog`. */
  function choreography(i, prog, b) {
    const h = heads[i], n = heads.length;
    switch (prog) {
      case 0: mark.set(Math.sin(b * 0.39 + i * 0.9) * RX, C.z + Math.sin(b * 0.196 + i * 0.52) * RZ); break;                        // lazy figure-eights
      case 1: { const a = b * 0.5 + (i / n) * 6.2832; mark.set(Math.cos(a) * RX * 0.9, C.z + Math.sin(a) * RZ * 0.9); break; }      // a ring chasing round the floor
      case 2: { const k = 0.5 + 0.5 * Math.sin(b * 0.785); mark.set(h.home.x * 1.1 * k, C.z + (h.home.z - C.z) * (0.15 + k)); break; }   // gather in the middle, open out
      case 3: { const s = Math.floor(b / 2); mark.set((rnd(i * 7.1 + s * 3.3) * 2 - 1) * RX, C.z + (rnd(i * 5.7 + s * 9.1) * 2 - 1) * RZ); break; }   // snap to new marks every two beats
      case 4: mark.set(h.home.x * 1.15, C.z + Math.sin(b * 0.39 + h.row * 2.1) * RZ); break;                                          // each bar sweeps the length of the room
      default: mark.set(Math.sign(h.home.x) * (1.2 + 2.0 * (0.5 + 0.5 * Math.sin(b * 0.39 + i))), h.home.z + Math.sin(b * 0.2 + i) * 3.2);   // fan out to the edges
    }
    mark.x = THREE.MathUtils.clamp(mark.x, -3.4, 3.4);
    mark.y = THREE.MathUtils.clamp(mark.y, D.DANCE.z0 - 0.6, D.DANCE.z1 + 1.5);
    return mark;
  }
  function scheme(i, kind, bar) {
    const h = heads[i];
    if (!(bar >= 0)) bar = 0;        // a clock that has not started, or has been wound back, must not point outside the palette
    switch (kind) {
      case 0: return palette[bar % palette.length];
      case 1: return palette[(bar + (i % 2)) % palette.length];
      case 2: return palette[(bar + h.row) % palette.length];
      default: return palette[(i + bar) % palette.length];
    }
  }

  // ---- fixed spots: a pin spot on each floor podium, a soft wash on each VIP piece ---------
  const spotBase = heads.length;
  const fixed = [];
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
  const fixedBeam = (from, to, radius, color, opacity) => {
    const m = beamMaterial(color, opacity);
    const mesh = new THREE.Mesh(coneGeo, m);
    _v.copy(to).sub(from);
    const len = _v.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(DOWN, _v.normalize());
    mesh.scale.set(radius, len, radius);
    mesh.renderOrder = 2;
    hall.add(mesh);
    const can = new THREE.Mesh(bodyGeo, mat.black);
    can.position.copy(from); can.quaternion.copy(mesh.quaternion); can.position.addScaledVector(_v, -0.2);
    hall.add(can);
    return m;
  };
  podiums.forEach((p, i) => {
    const from = new THREE.Vector3(p.x * 0.8, TY - 0.1, p.z + (p.z > C.z ? -1 : 1) * 0.9);
    fixed.push({ m: fixedBeam(from, new THREE.Vector3(p.x, 0.36, p.z), 0.62, white, 0.085), base: 0.085 });
    floor.spot(spotBase + i, p.x, p.z, 1.7, 0.5, white);
  });
  for (const w of washes) fixed.push({ m: fixedBeam(w.from, w.to, w.radius, white, 0.05), base: 0.05 });

  // ---- lasers (Neon Grid) ----------------------------------------------------------------
  let lasers = null;
  if (neon) {
    const PER = 6;
    const emitters = [new THREE.Vector3(-1.5, D.YB - 0.14, D.ZG + 0.08), new THREE.Vector3(1.5, D.YB - 0.14, D.ZG + 0.08)];
    const geo = new THREE.CylinderGeometry(0.007, 0.007, 1, 6, 1, true).translate(0, 0.5, 0);
    const lm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const mesh = new THREE.InstancedMesh(geo, lm, emitters.length * PER);
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    hall.add(mesh);
    for (const e of emitters) box(hall, mat.black, 0.3, 0.14, 0.22, e.x, e.y, e.z - 0.06);
    const lo = new THREE.Vector3(-D.HW + 0.05, 0.05, -D.L + 0.05), hi = new THREE.Vector3(D.HW - 0.05, D.H - 0.05, -0.05);
    lasers = { PER, emitters, mesh, lo, hi, dir: new THREE.Vector3(), m4: new THREE.Matrix4(), s: new THREE.Vector3(), col: new THREE.Color() };
  }

  // ---- mirror ball (Velvet) ------------------------------------------------------------------
  let ball = null;
  const ballUniform = { value: ballPos ? new THREE.Vector4(ballPos.x, ballPos.y, ballPos.z, 1) : new THREE.Vector4() };
  const timeUniform = { value: 0 };
  if (ballPos) {
    const sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.46, 4),
      new THREE.MeshStandardMaterial({ color: 0xf4f4f8, metalness: 1, roughness: 0.1, flatShading: true, envMap: scene.environment, envMapIntensity: 3.2 }),
    );
    sphere.position.copy(ballPos);
    hall.add(sphere);
    box(hall, mat.metal, 0.02, D.H - ballPos.y - 0.46, 0.02, ballPos.x, (D.H + ballPos.y + 0.46) / 2, ballPos.z);
    ball = sphere;
    for (const sx of [-1, 1]) fixed.push({ m: fixedBeam(new THREE.Vector3(sx * 3.3, TY - 0.1, C.z + sx * 3.2), ballPos, 0.5, white, 0.1), base: 0.1 });
    // the flecks it throws onto the upper walls and the ceiling (the floor draws its own)
    const fleckMat = (normal) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uBall: ballUniform, uTime: timeUniform, uNormal: { value: normal } },
      vertexShader: /* glsl */`varying vec3 vWorld; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`
        uniform vec4 uBall; uniform float uTime; uniform vec3 uNormal; varying vec3 vWorld;
        ${FLECKS_GLSL}
        void main() { gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * flecks(vWorld, uNormal, uBall, uTime) * 0.8, 1.0); }`,
    });
    const sheet = (w, h, x, y, z, ry, rx, normal) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), fleckMat(normal));
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.renderOrder = 1;
      hall.add(m);
    };
    const upper = D.H - D.YB;
    sheet(D.L, upper, -D.HW + 0.014, D.YB + upper / 2, -D.L / 2, Math.PI / 2, 0, new THREE.Vector3(1, 0, 0));
    sheet(D.L, upper, D.HW - 0.014, D.YB + upper / 2, -D.L / 2, -Math.PI / 2, 0, new THREE.Vector3(-1, 0, 0));
    sheet(D.HW * 2, D.L, 0, D.H - 0.014, -D.L / 2, 0, Math.PI / 2, new THREE.Vector3(0, -1, 0));
    sheet(D.HW * 2, D.H, 0, D.H / 2, -0.014, Math.PI, 0, new THREE.Vector3(0, 0, -1));
  }

  const state = { prog: 0, kind: 0, lastBar: -1 };
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;

  function update(t, dt, levels) {
    timeUniform.value = t;
    const b = levels.clock * calm;
    const bar = Math.floor(levels.clock / 16);          // a new move every four bars
    if (bar !== state.lastBar) { state.lastBar = bar; state.prog = Math.floor(rnd(bar * 1.7) * 6); state.kind = Math.floor(rnd(bar * 4.1) * 4); }
    const pulse = 0.7 + 0.55 * levels.beat * calm;
    const follow = 1 - Math.exp(-dt * (state.prog === 3 ? 6 : 3.2));
    const radius = neon ? 0.5 : 0.85;

    heads.forEach((h, i) => {
      h.aim.lerp(choreography(i, state.prog, b), follow);
      // point the head at its mark: pan on the yoke, tilt on the head
      const vx = h.aim.x - h.origin.x, vy = -h.origin.y, vz = h.aim.y - h.origin.z;
      const len = Math.hypot(vx, vy, vz);
      h.yoke.rotation.y = Math.atan2(-vx, -vz);
      h.head.rotation.x = Math.acos(THREE.MathUtils.clamp(-vy / len, -1, 1));
      h.beam.scale.set(radius * (len / 6.3), len, radius * (len / 6.3));
      h.color.lerp(h.want.copy(scheme(i, state.kind, Math.floor(levels.clock / 8))), 1 - Math.exp(-dt * 4));
      h.beamMat.uniforms.uColor.value.copy(h.color);
      h.beamMat.uniforms.uOpacity.value = (neon ? 0.13 : 0.085) * pulse;
      h.lensMat.color.copy(h.color).multiplyScalar(2.2 * pulse);
      floor.spot(i, h.aim.x, h.aim.y, radius * (len / 6.3) * 2.1, (neon ? 0.55 : 0.5) * pulse, h.color);
    });
    for (const f of fixed) f.m.uniforms.uOpacity.value = f.base * (0.85 + 0.25 * levels.beat);
    if (ball) ball.rotation.y = -t * 0.21;

    if (lasers) {
      const { PER, emitters, mesh, lo, hi, dir, m4, s, col } = lasers;
      const tunnel = Math.floor(levels.clock / 32) % 2 === 1;
      const spread = 0.46 + 0.3 * Math.sin(b * 0.39);
      const width = 1 + 0.8 * levels.beat;
      emitters.forEach((e, k) => {
        const pitch = 0.5 + 0.13 * Math.sin(b * 0.196 + k * Math.PI);
        for (let j = 0; j < PER; j++) {
          if (tunnel) {
            const a = (j / PER) * 6.2832 + b * 0.4 * (k ? -1 : 1), r = 0.2 + 0.07 * Math.sin(b * 0.39);
            dir.set(Math.cos(a) * r - (k ? 0.12 : -0.12), Math.sin(pitch + 0.1) + Math.sin(a) * r * 0.8, Math.cos(pitch + 0.1)).normalize();
          } else {
            const yaw = ((j - (PER - 1) / 2) / ((PER - 1) / 2)) * spread + 0.12 * Math.sin(b * 0.098 + k * 2);
            dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
          }
          // run the beam until it meets a wall, the ceiling or the floor
          let len = 80;
          for (const ax of ['x', 'y', 'z']) { if (dir[ax] > 1e-4) len = Math.min(len, (hi[ax] - e[ax]) / dir[ax]); else if (dir[ax] < -1e-4) len = Math.min(len, (lo[ax] - e[ax]) / dir[ax]); }
          _q.setFromUnitVectors(UP, dir);
          m4.compose(e, _q, s.set(width, len, width));
          mesh.setMatrixAt(k * PER + j, m4);
          col.copy(palette[(k + (tunnel ? j % 2 : 0) + Math.floor(levels.clock / 16)) % palette.length]).multiplyScalar(1.5 + 1.2 * levels.beat);
          mesh.setColorAt(k * PER + j, col);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  return { update, trussY: TY };
}
