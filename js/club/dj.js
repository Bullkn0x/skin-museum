// The DJ's gear on the booth's desk: two turntables with a mixer between them, the way a club
// booth is laid out. The records turn while the music plays and run down when it is paused; the
// mixer's meters follow the music. All of it is built here from simple shapes; none of it is a
// model of a real make.
import * as THREE from 'three';

const RPM = 33 + 1 / 3;

/**
 * @param c     the club's helpers and materials (see buildClub): hall, mat, box, neon, K, col, show
 * @param at    { y: the desk's top, z: the desk's middle }. The DJ stands on the -z side, facing +z.
 * Returns { update(dt, audio), decks: [{ x, z }] }.
 */
export function buildDjGear(c, at) {
  const { hall, mat, box, neon, K, col, show } = c;
  const { y, z } = at;
  const body = new THREE.MeshStandardMaterial({ color: neon ? 0x15161d : 0x16100f, roughness: 0.55, metalness: 0.25 });
  const plate = new THREE.MeshStandardMaterial({ color: neon ? 0x2a2c36 : 0x2b2420, roughness: 0.5, metalness: 0.55 });
  const platterMat = new THREE.MeshStandardMaterial({ color: neon ? 0x9aa3b8 : 0xb9965a, roughness: 0.45, metalness: 0.85 });
  const armMat = new THREE.MeshStandardMaterial({ color: neon ? 0xb8c0d4 : 0xc9a45c, roughness: 0.35, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 });
  const accent = col(K.sign);

  // one record's picture: grooves, a label in the look's own colour, and a stripe so the turning shows
  const recordTexture = (hue) => {
    const s = 512, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    g.fillStyle = '#060607'; g.fillRect(0, 0, s, s);
    g.translate(s / 2, s / 2);
    for (let r = s * 0.2; r < s * 0.49; r += 2.2) {
      g.strokeStyle = `rgba(255,255,255,${0.025 + 0.045 * Math.abs(Math.sin(r * 0.37))})`;
      g.lineWidth = 0.8; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    }
    for (const r of [0.27, 0.34, 0.41]) { g.strokeStyle = 'rgba(0,0,0,.9)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, s * r, 0, Math.PI * 2); g.stroke(); }      // the gaps between tracks
    // a sheen across the grooves, in two wedges
    for (const a of [0.5, 0.5 + Math.PI]) {
      const sheen = g.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 0.49);
      sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(1, 'rgba(255,255,255,0.03)');
      g.fillStyle = sheen; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, s * 0.49, a - 0.16, a + 0.16); g.closePath(); g.fill();
    }
    g.fillStyle = hue; g.beginPath(); g.arc(0, 0, s * 0.165, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(-s * 0.15, -s * 0.012, s * 0.3, s * 0.024);
    g.fillStyle = '#f4f4f4'; g.fillRect(s * 0.03, -s * 0.008, s * 0.12, s * 0.016);
    g.fillStyle = '#0a0a0a'; g.beginPath(); g.arc(0, 0, s * 0.012, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  };

  const records = [];
  const decks = [];
  const cyl = (r, h, material, x, yy, zz, parent = hall) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40), material);
    m.position.set(x, yy, zz);
    parent.add(m);
    return m;
  };
  for (const side of [-1, 1]) {
    const cx = side * 0.66, px = cx + 0.03;             // the platter sits a little off centre, away from the arm
    box(hall, body, 0.46, 0.07, 0.37, cx, y + 0.035, z);
    box(hall, plate, 0.44, 0.006, 0.35, cx, y + 0.073, z);
    for (const fx of [-1, 1]) for (const fz of [-1, 1]) box(hall, rubber, 0.04, 0.012, 0.04, cx + fx * 0.19, y - 0.004, z + fz * 0.15);      // feet
    cyl(0.158, 0.02, platterMat, px, y + 0.086, z);
    cyl(0.163, 0.008, rubber, px, y + 0.079, z);
    const label = recordTexture(side < 0 ? K.sign : `#${col(K.palette[1]).getHexString()}`);
    const record = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.004, 48), [rubber, new THREE.MeshStandardMaterial({ map: label, roughness: 0.35, metalness: 0.2 }), rubber]);
    record.position.set(px, y + 0.098, z);
    hall.add(record);
    records.push(record);
    cyl(0.004, 0.012, armMat, px, y + 0.104, z);        // spindle
    // the arm: pivot at the far corner on the DJ's right (the DJ faces +z, so that is -x), reaching in over the grooves
    const pivot = new THREE.Group();
    pivot.position.set(cx - 0.175, y + 0.076, z + 0.115);
    hall.add(pivot);
    cyl(0.024, 0.036, plate, 0, 0.018, 0, pivot);
    cyl(0.017, 0.03, armMat, 0, 0.05, 0, pivot);
    const arm = new THREE.Group();
    arm.position.y = 0.062;
    arm.rotation.y = Math.atan2(-(px - 0.105 - (cx - 0.175)), 0.145);      // its own -z is the way it reaches: aimed at the record's outer tracks
    pivot.add(arm);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.215, 12), armMat);
    tube.rotation.x = Math.PI / 2; tube.position.z = -0.085;
    arm.add(tube);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.04), rubber);
    shell.position.set(0, -0.006, -0.205);
    arm.add(shell);
    const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.034, 20), armMat);
    weight.rotation.x = Math.PI / 2; weight.position.z = 0.04;
    arm.add(weight);
    // start button and the lamp that lights the platter's edge (both keep time with the show), pitch fader on the arm's side
    box(hall, side < 0 ? mat.ledA : mat.ledB, 0.045, 0.008, 0.03, cx + 0.175, y + 0.08, z - 0.15);
    box(hall, side < 0 ? mat.ledA : mat.ledB, 0.012, 0.022, 0.012, px + 0.168, y + 0.087, z - 0.04);
    box(hall, rubber, 0.022, 0.004, 0.13, cx - 0.19, y + 0.078, z - 0.07);
    box(hall, armMat, 0.03, 0.012, 0.016, cx - 0.19, y + 0.084, z - 0.05 - side * 0.02);
    decks.push({ x: px, z });
  }

  // the mixer: four channels of knobs and faders, a crossfader, and a pair of meters that follow the music
  const mw = 0.34, md = 0.38, top = y + 0.1;
  box(hall, body, mw, 0.1, md, 0, y + 0.05, z);
  box(hall, plate, mw - 0.012, 0.004, md - 0.012, 0, top + 0.002, z);
  for (let ch = 0; ch < 4; ch++) {
    const x = (ch - 1.5) * 0.068;
    for (let k = 0; k < 4; k++) cyl(0.0105, 0.016, k === 0 ? armMat : rubber, x, top + 0.012, z + 0.15 - k * 0.042);       // gain and three bands of tone, farthest from the DJ
    box(hall, rubber, 0.01, 0.003, 0.11, x, top + 0.005, z - 0.075);                                                       // the fader's slot
    box(hall, armMat, 0.026, 0.014, 0.014, x, top + 0.011, z - 0.05 - [0.02, 0.045, 0.0, 0.03][ch]);                         // and its cap, each left where a hand last put it
  }
  box(hall, rubber, 0.15, 0.003, 0.012, 0, top + 0.005, z - 0.155);
  box(hall, armMat, 0.016, 0.014, 0.03, 0.012, top + 0.011, z - 0.155);
  const meters = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.13), new THREE.ShaderMaterial({
    uniforms: { uSpec: show.uSpec, uBeat: show.uBeat, uA: { value: accent.clone() }, uB: { value: col(K.palette[1]) } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uSpec[8]; uniform float uBeat; uniform vec3 uA, uB; varying vec2 vUv;
      void main() {
        float up = 1.0 - vUv.y;                                  // the panel lies flat with its top edge away from the DJ
        float lvl = vUv.x < 0.5 ? (uSpec[0] + uSpec[2] + uSpec[4]) / 3.0 : (uSpec[1] + uSpec[3] + uSpec[5]) / 3.0;
        lvl = clamp(lvl * 1.25, 0.0, 1.0);
        float seg = floor(up * 12.0) / 12.0;
        float lit = step(seg, lvl - 0.001);
        float inColumn = step(abs(fract(vUv.x * 2.0) - 0.5), 0.36), inSegment = step(0.2, fract(up * 12.0));
        vec3 hue = seg > 0.8 ? vec3(1.0, 0.25, 0.2) : mix(uA, uB, seg);
        vec3 c = hue * (0.06 + 1.5 * lit) * inColumn * inSegment;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  meters.rotation.x = -Math.PI / 2;
  meters.position.set(0, top + 0.0055, z + 0.055);
  hall.add(meters);

  let speed = 0;
  /** Turn the records: at 33 1/3 while music is playing, running down when it stops. */
  function update(dt, audio) {
    const on = audio.playing && !audio.active.paused ? 1 : 0;
    speed = THREE.MathUtils.damp(speed, on, on ? 2.2 : 1.1, dt);
    for (const r of records) r.rotation.y -= dt * (RPM / 60) * Math.PI * 2 * speed;
  }
  return { update, decks, top: y + 0.1 };
}
