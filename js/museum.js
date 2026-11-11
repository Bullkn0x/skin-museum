// Builds the gallery: architecture, lighting and one display per skin.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import {
  glowTexture, washTexture, backdropTexture, plaqueTexture,
  letteringTexture, shadowTexture, floorLightTexture,
} from './textures.js';

// Hall dimensions, in metres.
const HW = 7;            // half width
const H = 5.6;           // ceiling height
const PITCH = 4.8;       // spacing between wall bays
const FOYER = 6.5;       // entrance wall -> centre of first bay
const SANCTUM = 3.6;     // clear floor between the last bay and the apse
const APSE = 3.8;        // depth of the angled end walls
const APSE_HALF = 3.2;   // half width of the end wall
const WARM = 0xffe2b8;
const FOG = 0x050507;

const yAxis = new THREE.Vector3(0, 1, 0);

/** Decide where every skin goes. Pure layout, no meshes. */
export function planLayout(skins) {
  const heroes = skins.filter((s) => s.display === 'hero');
  const apse = heroes.slice(0, 3);
  const walls = [...heroes.slice(3), ...skins.filter((s) => s.display === 'wall')];
  const peds = skins.filter((s) => s.display === 'pedestal');

  const bays = Math.max(Math.ceil(walls.length / 2), Math.ceil(peds.length / 2), 2);
  const galleryEnd = -(FOYER + (bays - 0.5) * PITCH);
  const chamferZ = galleryEnd - SANCTUM;
  const zEnd = chamferZ - APSE;

  const displays = [];
  walls.forEach((skin, i) => {
    const left = i % 2 === 0;
    const z = -(FOYER + Math.floor(i / 2) * PITCH);
    displays.push({
      skin, kind: 'wall',
      pos: new THREE.Vector3(left ? -HW : HW, 0, z),
      normal: new THREE.Vector3(left ? 1 : -1, 0, 0),
      size: { w: 2.4, h: 1.6 }, cy: 1.92, viewDist: 3.0, radius: 4.4,
    });
  });
  peds.forEach((skin, i) => {
    const left = i % 2 === 0;
    const z = -(FOYER + (Math.floor(i / 2) + 0.5) * PITCH);
    displays.push({
      skin, kind: 'pedestal',
      pos: new THREE.Vector3(left ? -1.95 : 1.95, 0, z),
      normal: new THREE.Vector3(left ? 1 : -1, 0, 0),
      size: { w: 0.78, h: 0.585 }, cy: 1.5, viewDist: 1.7, radius: 3.0,
    });
  });

  // Apse: first hero on the end wall, the next two on the angled walls.
  const diag = Math.hypot(HW - APSE_HALF, APSE);
  const slots = [
    { pos: new THREE.Vector3(0, 0, zEnd), normal: new THREE.Vector3(0, 0, 1), size: { w: 4.3, h: 2.6 }, cy: 2.55, viewDist: 5.0, centre: true },
    { pos: new THREE.Vector3(-(HW + APSE_HALF) / 2, 0, zEnd + APSE / 2), normal: new THREE.Vector3(APSE / diag, 0, (HW - APSE_HALF) / diag), size: { w: 3.4, h: 2.2 }, cy: 2.3, viewDist: 4.1 },
    { pos: new THREE.Vector3((HW + APSE_HALF) / 2, 0, zEnd + APSE / 2), normal: new THREE.Vector3(-APSE / diag, 0, (HW - APSE_HALF) / diag), size: { w: 3.4, h: 2.2 }, cy: 2.3, viewDist: 4.1 },
  ];
  apse.forEach((skin, i) => displays.push({ skin, kind: 'hero', radius: 7, ...slots[i] }));

  // Exhibit numbers follow the walk: entrance to apse, the centrepiece last.
  const gallery = displays.filter((d) => d.kind !== 'hero').sort((a, b) => b.pos.z - a.pos.z || a.pos.x - b.pos.x);
  const finale = displays.filter((d) => d.kind === 'hero').sort((a, b) => (a.centre ? 1 : 0) - (b.centre ? 1 : 0) || a.pos.x - b.pos.x);
  const ordered = [...gallery, ...finale];
  ordered.forEach((d, i) => {
    d.number = i + 1;
    d.rotY = Math.atan2(d.normal.x, d.normal.z);
    d.center = d.pos.clone().setY(d.cy).addScaledVector(d.normal, d.kind === 'pedestal' ? 0 : 0.2);
  });

  return {
    displays: ordered, bays, galleryEnd, chamferZ, zEnd,
    HW, H, length: -zEnd,
    spawn: new THREE.Vector3(0, 0, -2.4),
    // Angled apse walls as inward-facing planes, for collision.
    planes: [slots[1], slots[2]].map((s) => ({ point: s.pos.clone(), normal: s.normal.clone() })),
  };
}

const FloorShader = {
  name: 'MuseumFloor',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    tLight: { value: null },
    uOrigin: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) },
    uFogColor: { value: new THREE.Color(FOG) }, uFogDensity: { value: 0.016 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUvR;
    varying vec3 vWorld;
    void main() {
      vUvR = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tLight;
    uniform vec2 uOrigin;
    uniform vec2 uSize;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    varying vec4 vUvR;
    varying vec3 vWorld;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      // large stone tiles with a hairline joint
      vec2 p = vWorld.xz / 1.4 + 0.5;
      vec2 cell = floor(p);
      vec2 g = abs(fract(p) - 0.5);
      float joint = smoothstep(0.490, 0.498, max(g.x, g.y));
      float chk = mod(cell.x + cell.y, 2.0);
      float vein = noise(vWorld.xz * 1.3 + cell * 5.7) * 0.65 + noise(vWorld.xz * 5.0 + 11.0) * 0.35;
      vec3 base = color * (0.7 + 0.6 * chk) * (0.75 + 0.5 * vein);

      // polished, slightly imperfect reflection
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.2);
      vec2 px = vUvR.w * vec2(0.0030, 0.0075);
      vec3 refl = texture2DProj(tDiffuse, vUvR).rgb * 0.24
                + texture2DProj(tDiffuse, vUvR + vec4(px.x, 0.0, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR - vec4(px.x, 0.0, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR + vec4(0.0, px.y, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR - vec4(0.0, px.y, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR + vec4(px.x, px.y, 0.0, 0.0) * 0.7).rgb * 0.10
                + texture2DProj(tDiffuse, vUvR - vec4(px.x, px.y, 0.0, 0.0) * 0.7).rgb * 0.10;
      float reflectivity = mix(0.10, 0.52, fres) * (1.0 - joint * 0.75) * (0.75 + 0.5 * vein);

      vec3 light = texture2D(tLight, (vWorld.xz - uOrigin) / uSize).rgb;
      vec3 col = base * (1.0 + light * 16.0) + light * 0.035 + refl * reflectivity;
      col *= 1.0 - joint * 0.5;

      float d = length(cameraPosition - vWorld);
      col = mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * d * d));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function buildMuseum(scene, data, images, renderer) {
  const layout = planLayout(data.skins);
  const { displays, zEnd, chamferZ, bays } = layout;
  const L = layout.length;

  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.016);

  // ---- shared resources -------------------------------------------------
  const tex = { glow: glowTexture(), wash: washTexture() };
  const mat = {
    wall: new THREE.MeshStandardMaterial({ color: 0x24232a, roughness: 0.94 }),
    wallDark: new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.9 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x17171c, roughness: 0.42, metalness: 0.15 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xa8854f, roughness: 0.52, metalness: 1, envMapIntensity: 0.9 }),
    black: new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.6, metalness: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1,
      envMapIntensity: 2.2, depthWrite: false, clearcoat: 1,
    }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(WARM).multiplyScalar(1.9) }),
    cove: new THREE.MeshBasicMaterial({ color: new THREE.Color(WARM).multiplyScalar(1.3) }),
    // volumetric light cone: brightest face-on, dissolving at the silhouette
    beam: new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(WARM) }, uOpacity: { value: 0.085 } },
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
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float fall = smoothstep(0.0, 0.5, vUv.y) * (0.3 + 0.7 * vUv.y);
          gl_FragColor = vec4(uColor * edge * fall * uOpacity, 1.0);
        }`,
    }),
  };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  // Every box is static, so they are batched: one instanced draw call per material
  // instead of several hundred separate meshes.
  const boxes = new Map();
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const box = (parent, material, w, h, d, x, y, z) => {
    parent.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(w, h, d)).premultiply(parent.matrixWorld);
    if (!boxes.has(material)) boxes.set(material, []);
    boxes.get(material).push(m);
  };
  const flushBoxes = () => {
    for (const [material, list] of boxes) {
      const mesh = new THREE.InstancedMesh(boxGeo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (material === mat.glass) mesh.renderOrder = 4;
      scene.add(mesh);
    }
  };
  const plane = (parent, material, w, h, x, y, z) => {
    const m = new THREE.Mesh(planeGeo, material);
    m.scale.set(w, h, 1); m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const additive = (map, color, opacity) => new THREE.MeshBasicMaterial({
    map, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });

  const hall = new THREE.Group();
  scene.add(hall);

  // ---- floor (polished stone with live reflections) ----------------------
  const pools = [];
  for (let i = 0; i < bays + 2; i++) pools.push({ x: 0, z: -(FOYER - PITCH + i * PITCH), r: 5.5, color: WARM, a: 0.22 });
  for (const d of displays) {
    const out = d.kind === 'pedestal' ? 0 : d.kind === 'hero' ? 2.2 : 1.3;
    const p = d.pos.clone().addScaledVector(d.normal, out);
    pools.push({ x: p.x, z: p.z, r: d.kind === 'hero' ? 4.6 : 2.9, color: WARM, a: d.kind === 'hero' ? 0.5 : 0.34 });
    pools.push({ x: p.x, z: p.z, r: d.kind === 'hero' ? 3.4 : 2.0, color: d.skin.rarityColor, a: 0.3 });
  }
  const floor = new Reflector(new THREE.PlaneGeometry(HW * 2, L), {
    shader: FloorShader, color: 0x0b0b0e, clipBias: 0.003,
    textureWidth: 1024, textureHeight: 1024, multisample: 4,
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -L / 2);
  floor.material.uniforms.tLight.value = floorLightTexture({ xMin: -HW, zMin: zEnd, width: HW * 2, length: L, pools });
  floor.material.uniforms.uOrigin.value.set(-HW, zEnd);
  floor.material.uniforms.uSize.value.set(HW * 2, L);
  hall.add(floor);

  // ---- shell --------------------------------------------------------------
  const ceiling = plane(hall, mat.ceiling, HW * 2, L, 0, H, -L / 2);
  ceiling.rotation.x = Math.PI / 2;

  const sideLen = -chamferZ;
  const wallL = plane(hall, mat.wall, sideLen, H, -HW, H / 2, chamferZ / 2); wallL.rotation.y = Math.PI / 2;
  const wallR = plane(hall, mat.wall, sideLen, H, HW, H / 2, chamferZ / 2); wallR.rotation.y = -Math.PI / 2;
  const back = plane(hall, mat.wall, HW * 2, H, 0, H / 2, 0); back.rotation.y = Math.PI;
  plane(hall, mat.wallDark, APSE_HALF * 2, H, 0, H / 2, zEnd);
  const diag = Math.hypot(HW - APSE_HALF, APSE);
  for (const p of layout.planes) {
    const w = plane(hall, mat.wallDark, diag, H, p.point.x, H / 2, p.point.z);
    w.rotation.y = Math.atan2(p.normal.x, p.normal.z);
  }

  // skirting, brass rail and cove lighting along both side walls
  for (const side of [-1, 1]) {
    const x = side * HW;
    box(hall, mat.black, 0.08, 0.34, sideLen, x - side * 0.04, 0.17, chamferZ / 2);
    box(hall, mat.brass, 0.03, 0.025, sideLen, x - side * 0.085, 0.35, chamferZ / 2);
    box(hall, mat.black, 0.5, 0.3, sideLen, x - side * 0.25, H - 0.15, chamferZ / 2);
    box(hall, mat.cove, 0.04, 0.035, sideLen, x - side * 0.52, H - 0.28, chamferZ / 2);
  }
  // pilasters between bays, beams and ceiling light slots
  for (let i = 0; i <= bays; i++) {
    const z = -(FOYER + (i - 0.5) * PITCH);
    for (const side of [-1, 1]) {
      const x = side * HW;
      box(hall, mat.wallDark, 0.26, H, 0.62, x - side * 0.13, H / 2, z);
      box(hall, mat.brass, 0.012, H - 0.9, 0.05, x - side * 0.262, H / 2 + 0.05, z);
      box(hall, mat.black, 0.34, 0.5, 0.72, x - side * 0.17, 0.25, z);
    }
    box(hall, mat.black, HW * 2, 0.42, 0.5, 0, H - 0.21, z);
  }
  for (let i = -1; i <= bays; i++) {
    const z = -(FOYER + i * PITCH);
    box(hall, mat.cove, 0.16, 0.03, PITCH - 1.5, 0, H - 0.02, z);
    box(hall, mat.black, 0.5, 0.05, PITCH - 1.1, 0, H - 0.005, z);
    for (const sx of [-3.6, 3.6]) box(hall, mat.cove, 0.07, 0.03, PITCH - 2.2, sx, H - 0.02, z);
  }

  // ---- lighting -----------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x9aa0b4, 0x18130e, 0.55));
  const lightEvery = Math.max(1, Math.round(bays / 3));
  for (let i = -1; i <= bays; i += lightEvery) {
    const l = new THREE.PointLight(WARM, 70, 18, 1.8);
    l.position.set(0, H - 0.6, -(FOYER + i * PITCH));
    scene.add(l);
  }
  const apseLight = new THREE.PointLight(WARM, 60, 16, 1.8);
  apseLight.position.set(0, H - 0.8, zEnd + 4.2);
  scene.add(apseLight);

  // ---- entrance wall: doors and the museum's name ---------------------------
  const entrance = new THREE.Group();
  entrance.rotation.y = Math.PI;
  hall.add(entrance);
  box(entrance, mat.brass, 3.5, 0.07, 0.1, 0, 3.62, 0.05);
  for (const sx of [-1, 1]) {
    box(entrance, mat.brass, 0.07, 3.62, 0.1, sx * 1.715, 1.81, 0.05);
    box(entrance, mat.black, 1.66, 3.56, 0.06, sx * 0.84, 1.78, 0.03);
    box(entrance, mat.brass, 0.03, 0.7, 0.05, sx * 0.14, 1.5, 0.085);
    box(entrance, mat.wallDark, 1.2, 1.2, 0.02, sx * 0.84, 2.6, 0.065);
    box(entrance, mat.wallDark, 1.2, 1.5, 0.02, sx * 0.84, 1.0, 0.065);
  }
  const title = data.museum?.title || 'The Collection';
  const curator = data.museum?.curator ? `Curated by ${data.museum.curator}` : null;
  plane(entrance, new THREE.MeshBasicMaterial({ map: letteringTexture(title, curator), transparent: true, depthWrite: false, fog: false }), 7.6, 1.9, 0, 4.5, 0.03);
  plane(entrance, additive(tex.wash, WARM, 0.2), 11, 4.4, 0, 3.6, 0.015);

  // ---- displays -----------------------------------------------------------
  const colliders = [];
  for (const d of displays) {
    const image = images.get(d.skin.id);
    const group = new THREE.Group();
    group.position.copy(d.pos);
    group.rotation.y = d.rotY;
    hall.add(group);
    d.group = group;
    d.color = new THREE.Color(d.skin.rarityColor);
    d.phase = d.number * 1.7;

    const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTexture(d.skin, d.number) });
    const accentMat = new THREE.MeshBasicMaterial({ color: d.color.clone().multiplyScalar(1.6) });
    const glowMat = additive(tex.glow, d.color, 0.3);
    const img = image.image;
    const aspect = img.width / img.height;

    if (d.kind === 'pedestal') {
      // plinth
      box(group, mat.stone, 0.9, 1.0, 0.9, 0, 0.5, 0);
      box(group, mat.black, 1.0, 0.08, 1.0, 0, 0.04, 0);
      box(group, mat.brass, 0.93, 0.03, 0.93, 0, 0.985, 0);
      const top = plane(group, new THREE.MeshBasicMaterial({ map: tex.glow, color: new THREE.Color(WARM).multiplyScalar(0.42), transparent: true, depthWrite: false }), 0.86, 0.86, 0, 1.002, 0);
      top.rotation.x = -Math.PI / 2;
      // rarity light line around the base of the case
      for (const [w, dd, x, z] of [[0.86, 0.016, 0, 0.43], [0.86, 0.016, 0, -0.43], [0.016, 0.86, 0.43, 0], [0.016, 0.86, -0.43, 0]]) {
        box(group, accentMat, w, 0.012, dd, x, 1.008, z);
      }
      // floating piece
      let w = d.size.w, h = w / aspect;
      if (h > d.size.h) { h = d.size.h; w = h * aspect; }
      const halo = plane(group, glowMat, 1.0, 1.0, 0, d.cy, 0); halo.renderOrder = 1;
      const piece = plane(group, new THREE.MeshBasicMaterial({ map: image, transparent: true, depthWrite: false, alphaTest: 0.02 }), w, h, 0, d.cy, 0);
      piece.renderOrder = 3;
      d.billboard = [piece, halo];
      // glass case with brass edges
      box(group, mat.glass, 0.84, 0.98, 0.84, 0, 1.5, 0);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.84, 0.98, 0.84)), new THREE.LineBasicMaterial({ color: 0xc9a45c, transparent: true, opacity: 0.75 }));
      edges.position.set(0, 1.5, 0); group.add(edges);
      box(group, mat.brass, 0.87, 0.02, 0.87, 0, 1.995, 0);
      // plaques: aisle side and the side facing the entrance
      const pw = 0.78, ph = pw * 288 / 1024;
      plane(group, plaqueMat, pw, ph, 0, 0.66, 0.4515);
      const side = plane(group, plaqueMat, pw, ph, d.rotY > 0 ? -0.4515 : 0.4515, 0.66, 0);
      side.rotation.y = d.rotY > 0 ? -Math.PI / 2 : Math.PI / 2;
      // ceiling spot and its beam
      const beamH = H - 1.0;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.6, beamH, 32, 1, true), mat.beam);
      beam.position.set(0, 1.0 + beamH / 2, 0); beam.renderOrder = 2; group.add(beam);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.22, 16), mat.black);
      can.position.set(0, H - 0.11, 0); group.add(can);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), mat.lamp);
      lens.rotation.x = Math.PI / 2; lens.position.set(0, H - 0.225, 0); group.add(lens);

      d.parts = { piece, accentMat, glowMat, baseY: d.cy, baseScale: piece.scale.clone() };
      colliders.push({ x: d.pos.x, z: d.pos.z, hx: 0.5, hz: 0.5 });
    } else {
      const hero = d.kind === 'hero';
      const W = d.size.w, Hh = d.size.h, cy = d.cy;
      const t = hero ? 0.07 : 0.05, depth = 0.16;
      // lit wall wash behind the frame
      plane(group, additive(tex.wash, WARM, hero ? 0.26 : 0.3), W * (hero ? 1.45 : 2.1), Hh * (hero ? 1.9 : 2.5), 0, cy + Hh * (hero ? 0.2 : 0.28), 0.012);
      if (hero) {
        const up = plane(group, additive(tex.wash, d.color, 0.16), W * 1.5, Hh * 1.4, 0, cy - Hh * 0.55, 0.014);
        up.rotation.z = Math.PI;
      }
      // velvet backdrop, brass frame
      plane(group, new THREE.MeshBasicMaterial({ map: backdropTexture(d.skin.rarityColor, W / Hh) }), W, Hh, 0, cy, 0.03);
      box(group, mat.brass, W + t * 2, t, depth, 0, cy + Hh / 2 + t / 2, depth / 2);
      box(group, mat.brass, W + t * 2, t, depth, 0, cy - Hh / 2 - t / 2, depth / 2);
      box(group, mat.brass, t, Hh, depth, -W / 2 - t / 2, cy, depth / 2);
      box(group, mat.brass, t, Hh, depth, W / 2 + t / 2, cy, depth / 2);
      // floating piece with halo and drop shadow
      let w = W * 0.84, h = w / aspect;
      if (h > Hh * 0.9) { h = Hh * 0.9; w = h * aspect; }
      const halo = plane(group, glowMat, W * 1.05, Hh * 1.05, 0, cy, 0.04); halo.renderOrder = 1;
      const shadow = plane(group, new THREE.MeshBasicMaterial({ map: shadowTexture(img), transparent: true, opacity: 0.8, depthWrite: false }), w * 1.06, h * 1.06, w * 0.02, cy - h * 0.07, 0.05);
      shadow.renderOrder = 2;
      const piece = plane(group, new THREE.MeshBasicMaterial({ map: image, transparent: true, depthWrite: false, alphaTest: 0.02 }), w, h, 0, cy, 0.2);
      piece.renderOrder = 3;
      // rarity light line under the frame
      box(group, accentMat, W * 0.6, 0.014, 0.02, 0, cy - Hh / 2 - t - 0.04, 0.03);
      // plaque
      const pw = hero ? 1.9 : 1.4, ph = pw * 288 / 1024;
      const py = cy - Hh / 2 - t - 0.1 - ph / 2;
      box(group, mat.brass, pw + 0.03, ph + 0.03, 0.02, 0, py, 0.012);
      plane(group, plaqueMat, pw, ph, 0, py, 0.024);
      // picture light on two arms
      const ly = cy + Hh / 2 + t + 0.24;
      for (const sx of [-1, 1]) box(group, mat.brass, 0.02, 0.02, 0.4, sx * W * 0.2, ly, 0.2);
      const lw = hero ? W * 0.4 : W * 0.62;
      box(group, mat.brass, lw, 0.05, 0.07, 0, ly, 0.4);
      box(group, mat.lamp, lw - 0.1, 0.012, 0.045, 0, ly - 0.03, 0.4);

      if (hero) {
        // vertical light lines flanking the frame
        for (const sx of [-1, 1]) box(group, accentMat, 0.018, Hh * 0.9, 0.018, sx * (W / 2 + t + 0.22), cy, 0.02);
        if (d.centre) {
          const name = [d.skin.weapon, d.skin.finish].filter(Boolean).join('  |  ');
          plane(group, new THREE.MeshBasicMaterial({ map: letteringTexture(name, null, { w: 2048, h: 256 }), color: new THREE.Color(1.45, 1.45, 1.45), transparent: true, depthWrite: false, fog: false }), 5.4, 0.675, 0, cy + Hh / 2 + 0.92, 0.03);
        }
      }
      d.parts = { piece, shadow, accentMat, glowMat, baseY: cy, baseScale: piece.scale.clone() };
    }
  }

  flushBoxes();

  // ---- drifting dust in the light ------------------------------------------
  const DUST = 700;
  const dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() * 2 - 1) * (HW - 0.4);
    dustPos[i * 3 + 1] = Math.random() * H;
    dustPos[i * 3 + 2] = -Math.random() * L;
    dustSeed[i] = Math.random();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uHeight: { value: H }, uScale: { value: 600 } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uHeight, uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.015 + aSeed * 0.03), uHeight);
        p.x += sin(uTime * 0.21 + aSeed * 40.0) * 0.3;
        p.z += cos(uTime * 0.17 + aSeed * 31.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.006 + aSeed * 0.012) * uScale / max(0.1, -mv.z);
        vA = (0.3 + 0.7 * aSeed) * smoothstep(0.4, 2.5, -mv.z) * (1.0 - smoothstep(12.0, 24.0, -mv.z));
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.74) * a * vA * 0.5, 1.0);
      }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  hall.add(dust);

  // ---- per-frame life -------------------------------------------------------
  const q = new THREE.Quaternion();
  function update(t, dt, camera, target) {
    dustMat.uniforms.uTime.value = t;
    for (const d of displays) {
      const p = d.parts;
      const focus = d === target ? 1 : 0;
      d.focus = THREE.MathUtils.damp(d.focus || 0, focus, 7, dt);
      p.piece.position.y = p.baseY + Math.sin(t * 0.8 + d.phase) * (d.kind === 'pedestal' ? 0.012 : 0.018);
      p.piece.scale.copy(p.baseScale).multiplyScalar(1 + d.focus * 0.035);
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.3 + d.phase);
      p.glowMat.opacity = (d.kind === 'hero' ? 0.2 + pulse * 0.08 : 0.2) + d.focus * 0.22;
      p.accentMat.color.copy(d.color).multiplyScalar((d.kind === 'pedestal' ? 1.05 : 1.4) + d.focus * 1.1 + (d.kind === 'hero' ? pulse * 0.5 : 0));
      if (d.billboard) {
        // turn the piece to face the visitor (yaw only)
        const yaw = Math.atan2(camera.position.x - d.pos.x, camera.position.z - d.pos.z) - d.rotY;
        q.setFromAxisAngle(yAxis, yaw);
        for (const m of d.billboard) m.quaternion.slerp(q, 1 - Math.exp(-dt * 5));
      }
    }
  }

  function resize(w, h, pixelRatio) {
    const s = Math.min(1, 1400 / (w * pixelRatio));
    floor.getRenderTarget().setSize(Math.round(w * pixelRatio * s * 0.75), Math.round(h * pixelRatio * s * 0.75));
    dustMat.uniforms.uScale.value = h * pixelRatio;
  }

  return { layout, displays, colliders, update, resize };
}
