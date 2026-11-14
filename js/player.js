// First-person visitor: WASD + mouse look, with simple collision against the hall.
import * as THREE from 'three';

const EYE = 1.65;
const RADIUS = 0.45;
const WALK = 3.1;
const RUN = 5.8;
const SENS = 0.0021;
const JUMP = 4.4;        // take-off speed in m/s: a hop of about 0.8 m
const GRAVITY = 12;

export class Player {
  constructor(camera, layout, colliders) {
    this.camera = camera;
    this.layout = layout;
    this.colliders = colliders;
    this.pos = layout.spawn.clone().setY(EYE);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };   // touch joystick, -1..1
    this.bob = 0;
    this.ground = 0;               // height of the floor underfoot (halls with stairs)
    this.air = 0;                  // height above that floor while jumping
    this.vy = 0;
    this.dip = 0;                  // the knees giving on landing
    this.squat = 0;                // how far they are about to give: the dip eases toward it
    this.jumpHeld = false;
    this.onLand = null;            // (x, z, impact speed) => void
    this.lag = new THREE.Vector3(); // how far the view still trails the body after it was moved; eases to zero
    this.enabled = false;
  }

  look(dx, dy) {
    const k = SENS * (this.aimScale || 1);       // slower through a scope, by as much as it magnifies (set by whoever holds one up)
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.35, 1.35);
  }

  /** The body has just been placed somewhere else: let the view travel there from (x, z) instead of cutting. */
  glideFrom(x, z) {
    this.lag.set(x - this.pos.x, 0, z - this.pos.z);
  }

  /** Hop, if standing on the floor. */
  jump() {
    if (this.enabled && this.air === 0 && this.vy === 0) this.vy = JUMP;
  }

  /** Take over from wherever the camera currently is (after an inspect fly-in). */
  syncFromCamera() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = THREE.MathUtils.clamp(e.x, -1.35, 1.35);
    this.pos.copy(this.camera.position);
    this.vel.set(0, 0, 0);
    this.air = 0; this.vy = 0; this.dip = 0; this.squat = 0;
    this.lag.set(0, 0, 0);
    this.collide();
  }

  collide() {
    const { HW, zEnd, planes } = this.layout;
    const p = this.pos;
    // a venue may have rooms beyond the hall's own walls: its floor plan keeps the visitor in those
    if (!this.layout.annex?.(p.x, p.z)) {
      p.x = THREE.MathUtils.clamp(p.x, -HW + RADIUS, HW - RADIUS);
      p.z = THREE.MathUtils.clamp(p.z, zEnd + RADIUS, -RADIUS);
    }
    for (const pl of planes) {
      const dist = (p.x - pl.point.x) * pl.normal.x + (p.z - pl.point.z) * pl.normal.z;
      if (dist < RADIUS) { p.x += pl.normal.x * (RADIUS - dist); p.z += pl.normal.z * (RADIUS - dist); }
    }
    for (const c of this.colliders) {
      if (c.y1 !== undefined && (this.ground < c.y0 || this.ground > c.y1)) continue;   // on another floor
      const nx = THREE.MathUtils.clamp(p.x, c.x - c.hx, c.x + c.hx);
      const nz = THREE.MathUtils.clamp(p.z, c.z - c.hz, c.z + c.hz);
      let dx = p.x - nx, dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 < 1e-8) {
        // centre is inside the box: leave through the nearest face
        const ox = c.hx - Math.abs(p.x - c.x), oz = c.hz - Math.abs(p.z - c.z);
        if (ox < oz) p.x = c.x + Math.sign(p.x - c.x || 1) * (c.hx + RADIUS);
        else p.z = c.z + Math.sign(p.z - c.z || 1) * (c.hz + RADIUS);
        continue;
      }
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * RADIUS;
      p.z = nz + (dz / d) * RADIUS;
    }
  }

  update(dt) {
    const k = this.keys;
    let f = 0, s = 0;
    if (this.enabled) {
      f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.stick.y;
      s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.stick.x;
      this.yaw += ((k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0)) * 1.9 * dt;
    }
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const tx = (-sin * f + cos * s) * speed;
    const tz = (-cos * f - sin * s) * speed;
    const a = 1 - Math.exp(-dt * (len > 0 ? 9 : 12));
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // A hall with more than one level says where the floor is and what cannot be stepped onto.
    if (this.layout.walk) {
      const from = this.ground, bx = this.pos.x, bz = this.pos.z;
      this.ground = this.layout.walk(this.pos, ox, oz, from, this.air);
      const drop = from - this.ground;
      if (drop > 0.45) {
        // Over a balustrade: the floor is now far below. Same height in the room, measured from
        // the lower floor, and falling. If the hall carried the visitor clear of the edge, the
        // view glides there rather than cutting.
        this.air += drop;
        this.pos.y -= drop;
        this.lag.x += bx - this.pos.x;
        this.lag.z += bz - this.pos.z;
      }
    }
    this.pos.y += (EYE + this.ground - this.pos.y) * (1 - Math.exp(-dt * 6));
    this.collide();

    // jumping: one hop per press of Space, on top of whatever floor is underfoot
    const space = this.enabled && k.has('Space');
    if (space && !this.jumpHeld) this.jump();
    this.jumpHeld = space;
    if (this.vy !== 0 || this.air > 0) {
      this.air += this.vy * dt;
      this.vy -= GRAVITY * dt;
      if (this.air <= 0) {
        const impact = -this.vy;
        this.air = 0; this.vy = 0;
        this.squat = Math.min(0.3, impact * 0.014 + Math.max(0, impact - 5.5) * 0.045);   // a hop barely bends the knees; a drop from the gallery does
        this.onLand?.(this.pos.x, this.pos.z, impact);
      }
    }
    this.dip += (this.squat - this.dip) * (1 - Math.exp(-dt * 26));
    this.squat *= Math.exp(-dt * 7);

    const v = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * v * 2.1;
    const bobY = this.air > 0 ? 0 : Math.sin(this.bob * 2) * 0.022 * Math.min(1, v / WALK);

    // the view catches up with the body: quickly when close, and never faster than a leap
    const behind = this.lag.length();
    if (behind > 1e-4) this.lag.multiplyScalar(1 - Math.min(1 - Math.exp(-dt * 6), (9 * dt) / behind));
    else this.lag.set(0, 0, 0);
    this.camera.position.set(this.pos.x + this.lag.x, this.pos.y + bobY + this.air - this.dip, this.pos.z + this.lag.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
