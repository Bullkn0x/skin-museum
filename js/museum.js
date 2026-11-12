// Builds the gallery: architecture, lighting and one display per skin.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import {
  glowTexture, washTexture, backdropTexture, plaqueTexture,
  letteringTexture, shadowTexture, floorLightTexture, isCutout,
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

    const plaqueTex = plaqueTexture(d.skin, d.number);
    const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex });
    const plaqueRatio = plaqueTex.image.height / plaqueTex.image.width;
    const accentMat = new THREE.MeshBasicMaterial({ color: d.color.clone().multiplyScalar(1.6) });
    const glowMat = additive(tex.glow, d.color, 0.3);
    const img = image.image;
    const aspect = img.width / img.height;
    // A cut-out (Steam's stock render) floats in its display. A rectangular picture,
    // such as an in-game screenshot, is hung like a photograph instead.
    const photo = !isCutout(img);
    d.photo = photo;

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
      // floating piece, or a brass-edged print when it is a photograph
      let w = d.size.w, h = w / aspect;
      const maxH = photo ? 0.5 : d.size.h;
      if (h > maxH) { h = maxH; w = h * aspect; }
      let piece;
      if (photo) {
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image }), w, h, 0, d.cy, 0);
        const mount = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color: 0x9a7a45 }));
        mount.scale.set((w + 0.028) / w, (h + 0.028) / h, 1); mount.position.z = -0.004;
        const halo = new THREE.Mesh(planeGeo, glowMat);
        halo.scale.set(1.15 / w, 1.0 / h, 1); halo.position.z = -0.012; halo.renderOrder = 1;
        piece.add(mount, halo);
        d.billboard = [piece];
      } else {
        const halo = plane(group, glowMat, 1.0, 1.0, 0, d.cy, 0); halo.renderOrder = 1;
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image, transparent: true, depthWrite: false, alphaTest: 0.02 }), w, h, 0, d.cy, 0);
        d.billboard = [piece, halo];
      }
      piece.renderOrder = 3;
      // glass case with brass edges
      box(group, mat.glass, 0.84, 0.98, 0.84, 0, 1.5, 0);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.84, 0.98, 0.84)), new THREE.LineBasicMaterial({ color: 0xc9a45c, transparent: true, opacity: 0.75 }));
      edges.position.set(0, 1.5, 0); group.add(edges);
      box(group, mat.brass, 0.87, 0.02, 0.87, 0, 1.995, 0);
      // plaques: aisle side and the side facing the entrance
      const pw = 0.78, ph = pw * plaqueRatio;
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
      let W = d.size.w, Hh = d.size.h;
      const cy = d.cy;
      if (photo) {
        // the frame takes on the photograph's proportions
        if (W / aspect <= Hh) Hh = W / aspect; else W = Hh * aspect;
      }
      const t = hero ? 0.07 : 0.05, depth = 0.16;
      // lit wall wash behind the frame
      plane(group, additive(tex.wash, WARM, hero ? 0.26 : 0.3), W * (hero ? 1.45 : 2.1), Hh * (hero ? 1.9 : 2.5), 0, cy + Hh * (hero ? 0.2 : 0.28), 0.012);
      if (hero) {
        const up = plane(group, additive(tex.wash, d.color, 0.16), W * 1.5, Hh * 1.4, 0, cy - Hh * 0.55, 0.014);
        up.rotation.z = Math.PI;
      }
      // velvet backdrop (cut-outs only), brass frame
      if (!photo) plane(group, new THREE.MeshBasicMaterial({ map: backdropTexture(d.skin.rarityColor, W / Hh) }), W, Hh, 0, cy, 0.03);
      box(group, mat.brass, W + t * 2, t, depth, 0, cy + Hh / 2 + t / 2, depth / 2);
      box(group, mat.brass, W + t * 2, t, depth, 0, cy - Hh / 2 - t / 2, depth / 2);
      box(group, mat.brass, t, Hh, depth, -W / 2 - t / 2, cy, depth / 2);
      box(group, mat.brass, t, Hh, depth, W / 2 + t / 2, cy, depth / 2);
      let piece;
      if (photo) {
        // the photograph fills the frame, with the rarity colour as an aura on the wall around it
        const aura = plane(group, glowMat, W * 1.55, Hh * 1.8, 0, cy, 0.02); aura.renderOrder = 1;
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image }), W, Hh, 0, cy, 0.03);
        d.still = true;
      } else {
        // floating piece with halo and drop shadow
        let w = W * 0.84, h = w / aspect;
        if (h > Hh * 0.9) { h = Hh * 0.9; w = h * aspect; }
        const halo = plane(group, glowMat, W * 1.05, Hh * 1.05, 0, cy, 0.04); halo.renderOrder = 1;
        const shadow = plane(group, new THREE.MeshBasicMaterial({ map: shadowTexture(img), transparent: true, opacity: 0.8, depthWrite: false }), w * 1.06, h * 1.06, w * 0.02, cy - h * 0.07, 0.05);
        shadow.renderOrder = 2;
        d.shadowMesh = shadow;
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image, transparent: true, depthWrite: false, alphaTest: 0.02 }), w, h, 0, cy, 0.2);
      }
      piece.renderOrder = 3;
      // rarity light line under the frame
      box(group, accentMat, W * 0.6, 0.014, 0.02, 0, cy - Hh / 2 - t - 0.04, 0.03);
      // plaque
      const pw = hero ? 1.9 : 1.4, ph = pw * plaqueRatio;
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
      d.parts = { piece, accentMat, glowMat, baseY: cy, baseScale: piece.scale.clone() };
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

  // ---- real 3D models -------------------------------------------------------
  const _bounds = new THREE.Box3(), _size = new THREE.Vector3(), _centre = new THREE.Vector3();

  // Holographic stickers. A model's sticker material carries, in `userData.holo`, a mask
  // (r = how holographic, g = offset into the spectrum, b = which row of it) and a spectrum
  // strip. The game picks the colour by viewing angle: u = mask.g + V.N + V.L, where V points at
  // the camera, N is the surface normal and L the key light. The texture in the file holds one
  // frozen angle (`bakedPhase`); this swaps that for the live one, so the foil shifts as the
  // visitor moves or turns the gun. The colour fitting is the game's own.
  const HOLO_LIGHT = new THREE.Vector3(0.25, 0.9, 0.35).normalize();
  const HOLO_PARS = /* glsl */`
    uniform sampler2D uHoloMask;
    uniform sampler2D uHoloSpectrum;
    uniform float uHoloPhase;
    uniform float uHoloBoost;
    uniform vec3 uHoloLight;
    varying vec3 vHoloPos;
    varying vec3 vHoloNormal;
    vec3 holoFit( vec3 s ) {
      const vec3 W = vec3( 0.2125, 0.7154, 0.0721 );
      const vec3 H = vec3( 0.05, 0.6214905, 0.85 );
      float lum = dot( clamp( s * uHoloBoost, 0.0, 1.0 ), W );
      vec3 n = normalize( max( vec3( 0.0003 ), s ) ) * 1.06;
      vec3 a = ( n * H.x * 1.732 / length( n ) ) / dot( n, W );
      vec3 b = n * mix( H.x, H.z, clamp( pow( max( s.r, max( s.g, s.b ) ) * uHoloBoost, H.y ), 0.0, 1.0 ) );
      vec3 v = max( a, b );
      v = mix( v, min( vec3( H.z ), v + vec3( lum ) * uHoloBoost ), max( 0.0, uHoloBoost - 1.0 ) / 63.0 );
      return mix( vec3( H.x ), v, sqrt( smoothstep( 0.0003, H.x, lum ) ) );
    }`;
  const HOLO_MAIN = /* glsl */`
    {
      vec3 hMask = texture2D( uHoloMask, vMapUv ).rgb;
      if ( hMask.r > 0.0 ) {
        vec3 hView = normalize( cameraPosition - vHoloPos );
        float hU = hMask.g + dot( hView, normalize( vHoloNormal ) ) + dot( hView, uHoloLight );
        vec3 hLive = holoFit( texture2D( uHoloSpectrum, vec2( hU, hMask.b ) ).rgb );
        vec3 hStill = holoFit( texture2D( uHoloSpectrum, vec2( hMask.g + uHoloPhase, hMask.b ) ).rgb );
        diffuseColor.rgb = max( diffuseColor.rgb + ( hLive - hStill ) * hMask.r, vec3( 0.0 ) );
      }
    }`;

  /**
   * Get a loaded model ready for attachModel: put its stickers in drawing order and fetch the
   * extra textures its holographic stickers need.
   */
  async function prepareModel(gltf) {
    // Where stickers overlap, the one applied later lies on top. They are see-through decals, and
    // three.js draws those back to front by the centre of each mesh, then in the order the meshes
    // were created. Left alone, the order would change with the viewing angle and with which
    // texture happened to load first. So a model's stickers (siblings with no transform of their
    // own) get one shared centre and are re-created in sticker order.
    const layers = new Map();
    gltf.scene.traverse((o) => {
      const n = o.isMesh && /^sticker_(\d+)$/.exec(o.name);
      if (!n) return;
      if (!layers.has(o.parent)) layers.set(o.parent, []);
      layers.get(o.parent).push([Number(n[1]), o]);
    });
    for (const [parent, list] of layers) {
      list.sort((x, y) => x[0] - y[0]);
      const box = new THREE.Box3();
      for (const [, o] of list) {
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox);
      }
      const shared = box.getBoundingSphere(new THREE.Sphere());
      for (const [, o] of list) {
        o.geometry.boundingSphere = shared.clone();
        parent.remove(o);
        parent.add(o.clone());
      }
    }

    const jobs = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const h = m.userData?.holo;
        if (!h || h.maskTexture == null || h.spectrumTexture == null || !m.map) continue;
        jobs.push(Promise.all([
          gltf.parser.getDependency('texture', h.maskTexture),
          gltf.parser.getDependency('texture', h.spectrumTexture),
        ]).then(([mask, spectrum]) => {
          mask.colorSpace = THREE.NoColorSpace;
          spectrum.colorSpace = THREE.SRGBColorSpace;
          spectrum.wrapS = THREE.RepeatWrapping;       // the angle wraps around the strip
          spectrum.wrapT = THREE.ClampToEdgeWrapping;
          mask.needsUpdate = true; spectrum.needsUpdate = true;
          m.userData.holoMaps = { mask, spectrum };
        }).catch(() => { /* the still holo in the texture is shown instead */ }));
      }
    });
    await Promise.all(jobs);
    return gltf;
  }
  /**
   * Swap a display's flat picture for a real model (a loaded glTF scene). The model is
   * centred, scaled to fit and lit by the studio environment. From then on it turns
   * slowly in its glass case, or floats in its frame, parallel to the canvas.
   * `rotationDeg` ([x, y, z]) corrects models that were not exported play-side-forward.
   */
  function attachModel(d, root, rotationDeg) {
    if (rotationDeg) root.rotation.set(...rotationDeg.map((deg) => THREE.MathUtils.degToRad(deg)));
    root.updateMatrixWorld(true);
    _bounds.setFromObject(root);
    _bounds.getSize(_size); _bounds.getCenter(_centre);
    const cased = d.kind === 'pedestal';
    const maxW = cased ? 0.7 : d.parts.baseScale.x * 0.92;
    const maxH = cased ? 0.5 : d.parts.baseScale.y;
    const span = cased ? Math.hypot(_size.x, _size.z) : _size.x;   // a turntable sweeps its diagonal
    const s = Math.min(maxW / span, maxH / _size.y);

    const fit = new THREE.Group();
    fit.add(root);
    fit.scale.setScalar(s);
    fit.position.copy(_centre).multiplyScalar(-s);
    const holder = new THREE.Group();
    holder.add(fit);
    holder.position.set(0, d.cy, cased ? 0 : 0.2 + (_size.z * s) / 2);
    d.group.add(holder);

    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m.isMeshStandardMaterial) continue;
        m.envMap = scene.environment;   // its own studio light, brighter than the dim room
        m.envMapIntensity = 0.5;        // higher washes out paint and blooms glossy stickers
        // The hall's ceiling lights sit close to the walls and blow out pale finishes and foil
        // stickers, so a model takes only the environment and the sky light, not the lamps.
        const holo = m.userData.holoMaps ? m.userData.holo : null;
        m.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_end>',
            '#include <lights_fragment_end>\n\treflectedLight.directDiffuse = vec3( 0.0 );\n\treflectedLight.directSpecular = vec3( 0.0 );',
          );
          if (!holo) return;
          shader.uniforms.uHoloMask = { value: m.userData.holoMaps.mask };
          shader.uniforms.uHoloSpectrum = { value: m.userData.holoMaps.spectrum };
          shader.uniforms.uHoloPhase = { value: holo.bakedPhase ?? 0 };
          shader.uniforms.uHoloBoost = { value: holo.sfxBoost ?? 1 };
          shader.uniforms.uHoloLight = { value: HOLO_LIGHT };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vHoloPos;\nvarying vec3 vHoloNormal;')
            .replace('#include <fog_vertex>', '#include <fog_vertex>\n\tvHoloPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvHoloNormal = normalize( mat3( modelMatrix ) * objectNormal );');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${HOLO_PARS}`)
            .replace('#include <map_fragment>', `#include <map_fragment>\n${HOLO_MAIN}`);
        };
        m.customProgramCacheKey = () => (holo ? 'model-environment-light-only-holo' : 'model-environment-light-only');
        m.needsUpdate = true;
      }
    });

    d.parts.piece.visible = false;
    if (d.shadowMesh) d.shadowMesh.visible = false;
    // `half` is the fitted model's half-size; `gap` is how far its back stays off the canvas
    d.model = { holder, spin: d.phase, yaw: 0, pitch: 0, half: _size.clone().multiplyScalar(s / 2), gap: 0.2 };
  }

  // ---- per-frame life -------------------------------------------------------
  const q = new THREE.Quaternion();
  function update(t, dt, camera, target, inspected) {
    dustMat.uniforms.uTime.value = t;
    for (const d of displays) {
      const p = d.parts;
      const focus = d === target ? 1 : 0;
      d.focus = THREE.MathUtils.damp(d.focus || 0, focus, 7, dt);
      if (!d.still) {
        p.piece.position.y = p.baseY + Math.sin(t * 0.8 + d.phase) * (d.kind === 'pedestal' ? 0.012 : 0.018);
        p.piece.scale.copy(p.baseScale).multiplyScalar(1 + d.focus * 0.035);
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.3 + d.phase);
      p.glowMat.opacity = (d.kind === 'hero' ? 0.2 + pulse * 0.08 : 0.2) + d.focus * 0.22;
      p.accentMat.color.copy(d.color).multiplyScalar((d.kind === 'pedestal' ? 1.05 : 1.4) + d.focus * 1.1 + (d.kind === 'hero' ? pulse * 0.5 : 0));
      if (d.model) {
        const m = d.model;
        const held = d === inspected;   // while inspected, the visitor turns it by hand
        if (!held) {
          m.yaw = THREE.MathUtils.damp(m.yaw, 0, 2.5, dt);
          m.pitch = THREE.MathUtils.damp(m.pitch, 0, 2.5, dt);
        }
        if (d.kind === 'pedestal') {
          m.spin += dt * (held ? 0.05 : 0.38);
          m.holder.rotation.set(m.pitch, m.spin + m.yaw, 0);
          m.holder.position.y = p.baseY + Math.sin(t * 0.8 + d.phase) * 0.012;
        } else {
          // Framed pieces stay parallel to the canvas and only float: a slow bob and a
          // barely-there tilt within the plane. They turn only when the visitor turns them.
          const tilt = held ? 0 : Math.sin(t * 0.5 + d.phase * 1.3) * 0.007;
          m.holder.rotation.set(m.pitch, m.yaw, tilt);
          m.holder.position.y = p.baseY + Math.sin(t * 0.8 + d.phase) * 0.016;
          // A turned model would swing its ends through the canvas, so it comes forward by
          // exactly its own reach toward the wall (the rotated half-size along the normal).
          m.holder.updateMatrix();
          const e = m.holder.matrix.elements;
          m.holder.position.z = m.gap + Math.abs(e[2]) * m.half.x + Math.abs(e[6]) * m.half.y + Math.abs(e[10]) * m.half.z;
        }
      }
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

  return { layout, displays, colliders, update, resize, attachModel, prepareModel };
}
