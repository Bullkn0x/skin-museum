// The club floor: a live mirror like the museum's, with an illuminated dance floor set into it.
// Everything is drawn in the shader, so the tiles can follow the music, the moving lights and
// the visitor's feet.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const MAX_SPOTS = 16;
export const MAX_STEPS = 8;

/** Mirror-ball flecks: a slowly turning lattice of light patches thrown from one point. */
export const FLECKS_GLSL = /* glsl */`
  float fleckHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float flecks(vec3 P, vec3 N, vec4 ball, float time) {
    vec3 d = P - ball.xyz;
    float dist = length(d);
    d /= dist;
    float facing = max(0.0, dot(N, -d));
    float a = time * 0.21, cs = cos(a), sn = sin(a);
    d.xz = mat2(cs, -sn, sn, cs) * d.xz;
    float rows = 46.0;
    float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
    float row = floor(v * rows);
    float lat = ((row + 0.5) / rows - 0.5) * 3.14159265;
    float cols = max(4.0, floor(cos(lat) * rows * 2.0));
    float u = atan(d.z, d.x) / 6.2831853 + 0.5;
    vec2 f = vec2(fract(u * cols), fract(v * rows)) - 0.5;
    vec2 id = vec2(row, floor(u * cols));
    float h = fleckHash(id);
    // not every facet catches the light, and no two patches are quite alike
    vec2 off = (vec2(fleckHash(id + 3.1), fleckHash(id + 7.7)) - 0.5) * 0.36;
    float size = 0.13 + 0.2 * fleckHash(id + 11.3);
    float blob = smoothstep(size + 0.1, size * 0.45, length(f - off)) * step(0.46, h);
    return blob * (0.55 + 0.45 * h) * clamp(20.0 / (dist * dist), 0.0, 0.75) * (0.25 + 0.75 * facing) * ball.w;
  }`;

const Shader = {
  name: 'ClubFloor',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    tLight: { value: null },
    uOrigin: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) },
    uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.015 },
    uTime: { value: 0 }, uBeat: { value: 0 }, uClock: { value: 0 }, uLook: { value: 0 }, uGain: { value: 1 },
    uPatA: { value: 0 }, uPatB: { value: 0 }, uPatMix: { value: 0 },
    uSpec: { value: new Float32Array(8) },
    uDance: { value: new THREE.Vector4() }, uTile: { value: 0.8 },
    uSpots: { value: [] }, uSpotCol: { value: [] }, uSteps: { value: [] },
    uPlayer: { value: new THREE.Vector3() },
    uBall: { value: new THREE.Vector4() },
    uLane: { value: new THREE.Vector4() },
    uShade: { value: new THREE.Vector2(99, -99) },
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
    #define MAX_SPOTS ${MAX_SPOTS}
    #define MAX_STEPS ${MAX_STEPS}
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tLight;
    uniform vec2 uOrigin;
    uniform vec2 uSize;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uTime, uBeat, uClock, uLook, uGain;
    uniform float uPatA, uPatB, uPatMix;
    uniform float uSpec[8];
    uniform vec4 uDance;     // x0, z0, x1, z1
    uniform float uTile;
    uniform vec4 uSpots[MAX_SPOTS];      // x, z, radius, strength
    uniform vec3 uSpotCol[MAX_SPOTS];
    uniform vec4 uSteps[MAX_STEPS];      // x, z, start time, strength
    uniform vec3 uPlayer;                // x, z, on the dance floor (0..1)
    uniform vec4 uBall;                  // mirror ball position, strength
    uniform vec4 uLane;                  // stair lanes: |x| from, |x| to, z from, z to
    uniform vec2 uShade;                 // the balconies shade the floor beyond this |x|, behind this z
    varying vec4 vUvR;
    varying vec3 vWorld;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float lum(vec3 c) { return dot(c, vec3(0.3, 0.55, 0.15)); }
    ${FLECKS_GLSL}

    vec3 ramp(float t, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
      t = fract(t) * 4.0;
      if (t < 1.0) return mix(c1, c2, t);
      if (t < 2.0) return mix(c2, c3, t - 1.0);
      if (t < 3.0) return mix(c3, c4, t - 2.0);
      return mix(c4, c1, t - 3.0);
    }
    vec3 pal(float t) {
      if (uLook > 0.5) return ramp(t, vec3(0.08, 0.86, 1.0), vec3(0.16, 0.38, 1.0), vec3(0.56, 0.30, 1.0), vec3(1.0, 0.14, 0.82));
      return ramp(t, vec3(1.0, 0.70, 0.30), vec3(1.0, 0.46, 0.10), vec3(0.92, 0.12, 0.30), vec3(0.82, 0.20, 0.08));
    }

    // One tile's colour (rgb) and brightness (a) in each of the floor's programmes.
    vec4 programme(float id, vec2 cell, vec2 n, float beats) {
      vec2 c = cell + 0.5, mid = n * 0.5;
      float r = hash(cell);
      vec4 o = vec4(0.0);
      if (id < 0.5) {            // diagonal waves
        float w = (cell.x + cell.y) * 0.15 - beats * 0.25;
        o = vec4(pal(w * 0.5 + r * 0.05), 0.26 + 0.74 * pow(0.5 + 0.5 * sin(w * 6.2832), 2.0));
      } else if (id < 1.5) {     // equaliser, rising from the DJ end
        float band = clamp(floor(cell.x / n.x * 8.0), 0.0, 7.0);
        float lvl = 0.06 + 0.9 * uSpec[int(band)];
        float h = c.y / n.y;
        float lit = smoothstep(lvl + 0.03, lvl - 0.03, h);
        float cap = smoothstep(0.06, 0.0, abs(h - lvl));
        o = vec4(mix(pal(0.02 + h * 0.7), vec3(1.0), cap * 0.7), 0.26 + 0.74 * max(lit * (0.55 + 0.45 * h), cap));
      } else if (id < 2.5) {     // rings spreading from the middle on the beat
        float w = length(c - mid) * 0.34 - beats * 0.5;
        o = vec4(pal(floor(w) * 0.27 + 0.1), 0.16 + 0.84 * pow(0.5 + 0.5 * cos(w * 6.2832), 3.0));
      } else if (id < 3.5) {     // chequers that swap each beat
        float bf = floor(beats), fr = fract(beats);
        float k = mod(cell.x + cell.y + bf, 2.0);
        o = vec4(pal(bf * 0.21 + k * 0.5), k > 0.5 ? 1.0 - fr * 0.5 : 0.40 + fr * 0.10);      // the resting tiles stay lit: at 0.22 they read as tiles going out
      } else if (id < 4.5) {     // sparkle
        float tk = floor(beats * 2.0), fr = fract(beats * 2.0);
        float h1 = hash(cell + tk * 17.0), h0 = hash(cell + (tk - 1.0) * 17.0);
        float b = step(0.6, h1) * (1.0 - fr * 0.5) + step(0.6, h0) * (1.0 - fr) * 0.5;
        o = vec4(pal(h1 * 3.0 + beats * 0.05), 0.32 + 0.68 * clamp(b, 0.0, 1.0));
      } else if (id < 5.5) {     // bands running down the floor
        float s = cell.y - floor(beats * 2.0);
        float k = mod(s, 6.0);
        o = vec4(pal(floor(s / 6.0) * 0.31 + abs(c.x - mid.x) * 0.03), k < 2.0 ? 1.0 : 0.34);
      } else {
        float v = sin(c.x * 0.7 + beats * 0.8) + sin(c.y * 0.5 - beats * 0.6) + sin((c.x + c.y) * 0.4 + beats * 0.5);   // plasma
        o = vec4(pal(v * 0.18 + beats * 0.03), 0.42 + 0.58 * (0.5 + 0.5 * sin(v * 2.0)));
      }
      return o;
    }

    void main() {
      vec2 p = vWorld.xz;
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.2);

      // polished, slightly imperfect reflection
      vec2 px = vUvR.w * vec2(0.0030, 0.0075);
      vec3 refl = texture2DProj(tDiffuse, vUvR).rgb * 0.24
                + texture2DProj(tDiffuse, vUvR + vec4(px.x, 0.0, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR - vec4(px.x, 0.0, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR + vec4(0.0, px.y, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR - vec4(0.0, px.y, 0.0, 0.0)).rgb * 0.14
                + texture2DProj(tDiffuse, vUvR + vec4(px.x, px.y, 0.0, 0.0) * 0.7).rgb * 0.10
                + texture2DProj(tDiffuse, vUvR - vec4(px.x, px.y, 0.0, 0.0) * 0.7).rgb * 0.10;
      // A reflection that is not a number (one bad pixel in the mirror's picture is enough) would
      // turn the tile black, and the glow pass would then smear that black across the floor.
      if (!(refl.r + refl.g + refl.b < 1.0e5) || !(refl.r >= 0.0 && refl.g >= 0.0 && refl.b >= 0.0)) refl = vec3(0.0);

      // pools from the moving heads and the fixed spots
      vec3 spot = vec3(0.0);
      for (int i = 0; i < MAX_SPOTS; i++) {
        vec4 s = uSpots[i];
        float a = 1.0 - smoothstep(s.z * 0.3, s.z, length(p - s.xy));
        spot += uSpotCol[i] * a * a * s.w;
      }
      vec3 light = texture2D(tLight, (p - uOrigin) / uSize).rgb;

      vec2 dmin = uDance.xy, dmax = uDance.zw;
      vec2 dc = (dmin + dmax) * 0.5, dh = (dmax - dmin) * 0.5;
      vec2 dq = abs(p - dc) - dh;
      float sd = max(dq.x, dq.y);                       // below zero on the dance floor
      float around = atan(p.y - dc.y, p.x - dc.x) / 6.2831853;

      // ---- the floor around the dance floor -----------------------------------------
      vec3 col; float reflectivity;
      if (uLook > 0.5) {
        // dark resin with a faint light grid that breathes outward from the dance floor
        vec2 gg = abs(fract(p / 1.6) - 0.5);
        float line = smoothstep(0.487, 0.497, max(gg.x, gg.y));
        float wave = 0.5 + 0.5 * sin(uTime * 0.9 - length(p - dc) * 0.55);
        col = vec3(0.010, 0.011, 0.026) * (1.0 + light * 14.0 + spot * 12.0) + light * 0.03 + spot * 0.045;
        col += pal(0.03 + 0.07 * wave) * line * (0.07 + 0.13 * wave + 0.3 * uBeat * exp(-max(sd, 0.0) * 0.5));
        float tube = smoothstep(0.05, 0.016, abs(sd - 0.11)) * step(0.0, sd);
        vec3 tc = pal(around + uTime * 0.05);
        col += tc * tube * 2.3 * (0.7 + 0.5 * uBeat) + tc * exp(-max(sd, 0.0) * 2.4) * 0.12 * step(0.0, sd);
        reflectivity = mix(0.14, 0.62, fres);
      } else {
        // black marble with gold veins and a brass inlay between the slabs
        vec2 mp = p / 1.4 + 0.5;
        vec2 mcell = floor(mp), mg = abs(fract(mp) - 0.5);
        float joint = smoothstep(0.487, 0.497, max(mg.x, mg.y));
        float chk = mod(mcell.x + mcell.y, 2.0);
        float vein = noise(p * 1.3 + mcell * 5.7) * 0.65 + noise(p * 5.0 + 11.0) * 0.35;
        float gold = smoothstep(0.02, 0.0, abs(noise(p * 0.85 + mcell * 3.1) - 0.5)) * 0.7;
        vec3 lit = light * 14.0 + spot * 11.0;
        col = vec3(0.022, 0.015, 0.018) * (0.7 + 0.6 * chk) * (0.7 + 0.6 * vein) * (1.0 + lit) + light * 0.03 + spot * 0.04;
        col += vec3(0.85, 0.62, 0.26) * gold * (0.04 + lum(lit) * 0.05);
        vec3 brass = vec3(0.72, 0.53, 0.22) * (0.10 + 0.5 * fres + lum(lit) * 0.06);
        col = mix(col, brass, joint);
        float band = smoothstep(0.09, 0.07, abs(sd - 0.16)) * step(0.0, sd);            // brass band round the dance floor
        col = mix(col, brass * 1.4, band);
        float glowLine = smoothstep(0.03, 0.01, abs(sd - 0.045)) * step(0.0, sd);
        col += vec3(1.0, 0.72, 0.36) * glowLine * (0.8 + 0.5 * uBeat);
        reflectivity = mix(0.13, 0.62, fres) * (0.8 + 0.4 * vein);
      }

      // ---- lanes to the stairs ---------------------------------------------------------
      float ax = abs(p.x);
      if (ax > uLane.x && ax < uLane.y && p.y > uLane.z && p.y < uLane.w) {
        float edge = min(min(ax - uLane.x, uLane.y - ax), uLane.w - p.y);
        if (uLook > 0.5) {
          float v = p.y / 0.8 + abs(ax - (uLane.x + uLane.y) * 0.5) * 1.5 + uTime * 1.3;
          float chev = smoothstep(0.3, 0.36, fract(v)) * (1.0 - smoothstep(0.62, 0.68, fract(v)));
          col += pal(floor(v) * 0.5 + 0.03) * chev * 0.9 * smoothstep(0.0, 0.12, edge);
        } else {
          vec3 carpet = vec3(0.30, 0.025, 0.06) * (0.75 + 0.35 * noise(p * 60.0)) * (0.35 + lum(light * 9.0 + spot * 7.0));
          col = mix(vec3(0.75, 0.55, 0.22) * (0.2 + 0.5 * fres), carpet, smoothstep(0.04, 0.07, edge));
          reflectivity *= 1.0 - 0.94 * smoothstep(0.04, 0.07, edge);
        }
      }

      // ---- the dance floor ---------------------------------------------------------------
      if (sd < 0.0) {
        vec2 n = floor((dmax - dmin) / uTile + 0.5);
        vec2 tp = (p - dmin) / uTile;
        vec2 cell = clamp(floor(tp), vec2(0.0), n - 1.0);
        vec2 f = tp - cell;
        float m = max(abs(f.x - 0.5), abs(f.y - 0.5));
        float frame = smoothstep(0.452, 0.474, m);
        float soft = 1.0 - 0.4 * smoothstep(0.1, 0.48, m);

        vec4 a = programme(uPatA, cell, n, uClock), b = programme(uPatB, cell, n, uClock);
        vec3 pc = mix(a.rgb * a.a, b.rgb * b.a, uPatMix);

        // tiles answer the visitor: the one underfoot glows and each step sends a ring outward
        vec2 tc = dmin + (cell + 0.5) * uTile;
        float tread = 0.0;
        for (int i = 0; i < MAX_STEPS; i++) {
          vec4 s = uSteps[i];
          float age = uTime - s.z;
          if (s.w > 0.0 && age < 4.0) {
            float d = length(tc - s.xy) - age * 3.2;
            tread += exp(-d * d / 0.3) * exp(-age * 0.9) * s.w;
          }
        }
        vec2 up = tc - uPlayer.xy;
        float under = uPlayer.z * exp(-dot(up, up) / 0.8);

        vec3 tile; float tileRefl;
        if (uLook > 0.5) {
          // frosted LED panels: the lamps show faintly through the diffuser
          float lamps = 0.8 + 0.2 * (0.5 + 0.5 * cos(f.x * 25.133)) * (0.5 + 0.5 * cos(f.y * 25.133));
          vec3 emis = pc * (0.42 + 0.36 * uBeat) + vec3(0.6, 0.92, 1.0) * (tread * 0.75 + under * 0.6);
          // light gathers at the edge of each acrylic panel
          float lip = smoothstep(0.34, 0.445, m) * (1.0 - frame);
          tile = emis * (lamps * soft + lip * 0.55) * uGain + vec3(0.012, 0.013, 0.03) + spot * 0.07;
          tile = mix(tile, vec3(0.02, 0.021, 0.03) + spot * 0.03, frame);
          tileRefl = mix(0.08 + 0.3 * fres, 0.3, frame);
        } else {
          // smoked glass over a warm under-light, pin-pricked with starlight, in a brass grid
          vec3 warm = pc * (0.24 + 0.26 * uBeat) * uGain;
          vec2 sp = f * 5.0, sc = floor(sp);
          float sr = hash(cell * 7.3 + sc);
          vec2 so = (vec2(hash(sc + cell * 1.3), hash(sc * 1.7 + cell)) - 0.5) * 0.5;
          float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + sr * 3.0) + sr * 40.0);
          float star = smoothstep(0.11, 0.0, length(fract(sp) - 0.5 + so)) * step(0.5, sr) * twinkle;
          tile = vec3(0.014, 0.009, 0.011) + warm * soft + vec3(1.0, 0.9, 0.72) * star * (1.1 + uBeat) + vec3(1.0, 0.78, 0.5) * (tread * 0.55 + under * 0.5) + spot * 0.06;
          // an art-deco medallion in brass at the centre
          vec2 md = p - dc;
          float mr = length(md), ma = atan(md.y, md.x);
          float rings = smoothstep(0.035, 0.015, abs(mr - 2.5)) + smoothstep(0.03, 0.012, abs(mr - 1.55)) + smoothstep(0.03, 0.012, abs(mr - 0.6));
          float rays = smoothstep(0.045, 0.02, abs(fract(ma / 6.2831853 * 24.0) - 0.5) * mr * 0.26) * step(1.55, mr) * step(mr, 2.5);
          float petals = smoothstep(0.04, 0.015, abs(mr - (1.05 + 0.42 * cos(ma * 8.0)))) * step(mr, 1.55);
          float deco = clamp(rings + rays + petals, 0.0, 1.0);
          vec3 brass = vec3(0.78, 0.57, 0.24) * (0.16 + 0.6 * fres + lum(spot) * 0.5 + 0.25 * uBeat);
          tile = mix(tile, brass, max(frame, deco));
          tileRefl = mix(0.09 + 0.42 * fres, 0.3 + 0.4 * fres, max(frame, deco));
        }
        col = tile; reflectivity = tileRefl;
      }

      if (uBall.w > 0.0) {
        float shade = 1.0 - smoothstep(uShade.x, uShade.x + 0.9, abs(p.x)) * step(p.y, uShade.y);
        col += vec3(1.0, 0.86, 0.62) * flecks(vWorld, vec3(0.0, 1.0, 0.0), uBall, uTime) * 0.7 * shade;
      }

      col += refl * reflectivity;
      if (!(col.r + col.g + col.b < 1.0e5)) col = vec3(0.02);
      float d = length(cameraPosition - vWorld);
      col = mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * d * d));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * Builds the floor. `spot(i, ...)` places a pool of light, `step(...)` starts a ripple
 * under the visitor, and `update(...)` feeds it the clock and the music.
 */
export function buildFloor({ neon, HW, L, dance, lane, lightTexture, fog, fogDensity, ball, shade }) {
  const floor = new Reflector(new THREE.PlaneGeometry(HW * 2, L), {
    shader: Shader, color: 0x000000, clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, multisample: 4,
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -L / 2);
  const u = floor.material.uniforms;
  u.tLight.value = lightTexture;
  u.uOrigin.value = new THREE.Vector2(-HW, -L);
  u.uSize.value = new THREE.Vector2(HW * 2, L);
  u.uFogColor.value = new THREE.Color(fog);
  u.uFogDensity.value = fogDensity;
  u.uLook.value = neon ? 1 : 0;
  u.uDance.value = new THREE.Vector4(dance.x0, dance.z0, dance.x1, dance.z1);
  u.uTile.value = dance.tile;
  u.uLane.value = new THREE.Vector4(lane.x0, lane.x1, lane.z0, lane.z1);
  u.uSpots.value = Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4(0, 0, 1, 0));
  u.uSpotCol.value = Array.from({ length: MAX_SPOTS }, () => new THREE.Color(0, 0, 0));
  u.uSteps.value = Array.from({ length: MAX_STEPS }, () => new THREE.Vector4(0, 0, -99, 0));
  u.uSpec.value = new Float32Array(8);
  u.uPlayer.value = new THREE.Vector3();
  if (shade) u.uShade.value = new THREE.Vector2(shade.x, shade.z);
  u.uBall.value = ball ? new THREE.Vector4(ball.x, ball.y, ball.z, 1) : new THREE.Vector4(0, 0, 0, 0);

  // Each look cycles through the programmes that suit it; the equaliser only when music plays.
  const order = neon ? [0, 2, 5, 3, 6, 4] : [6, 0, 2, 4];
  const state = { slot: 0, next: 0, mix: 0, lastBar: -1, stepI: 0 };
  u.uPatA.value = u.uPatB.value = order[0];

  function spot(i, x, z, radius, strength, color) {
    if (i >= MAX_SPOTS) return;
    u.uSpots.value[i].set(x, z, radius, strength);
    if (color) u.uSpotCol.value[i].copy(color);
  }
  function step(x, z, t, strength = 1) {
    u.uSteps.value[state.stepI].set(x, z, t, strength);
    state.stepI = (state.stepI + 1) % MAX_STEPS;
  }
  const inDance = (x, z) => x > dance.x0 && x < dance.x1 && z > dance.z0 && z < dance.z1;

  function update(t, dt, levels, feet) {
    u.uTime.value = t;
    u.uBeat.value = levels.beat;
    u.uClock.value = levels.clock;
    u.uGain.value = 0.85 + 0.35 * levels.energy;
    u.uSpec.value.set(levels.spectrum);
    // a new programme every eight bars, cross-faded over two beats
    const bar = Math.floor(levels.clock / 32);
    if (bar !== state.lastBar) {
      state.lastBar = bar;
      u.uPatA.value = u.uPatB.value;
      const cycle = levels.live && neon ? [...order, 1] : order;
      state.slot = (state.slot + 1) % cycle.length;
      u.uPatB.value = cycle[state.slot];
      state.mix = 0;
    }
    state.mix = Math.min(1, state.mix + dt * (levels.bpm / 60) / 2);
    u.uPatMix.value = state.mix * state.mix * (3 - 2 * state.mix);
    if (feet) {
      u.uPlayer.value.set(feet.x, feet.z, THREE.MathUtils.damp(u.uPlayer.value.z, feet.on && inDance(feet.x, feet.z) ? 1 : 0, 6, dt));
    } else {
      u.uPlayer.value.z = THREE.MathUtils.damp(u.uPlayer.value.z, 0, 6, dt);
    }
  }
  function resize(w, h, pixelRatio) {
    const s = Math.min(1, 1400 / (w * pixelRatio));
    floor.getRenderTarget().setSize(Math.round(w * pixelRatio * s * 0.75), Math.round(h * pixelRatio * s * 0.75));
  }
  return { mesh: floor, uniforms: u, spot, step, update, resize, inDance };
}
