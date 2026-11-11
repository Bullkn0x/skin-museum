// First-person visitor: WASD + mouse look, with simple collision against the hall.
import * as THREE from 'three';

const EYE = 1.65;
const RADIUS = 0.45;
const WALK = 3.1;
const RUN = 5.8;
const SENS = 0.0021;

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
    this.enabled = false;
  }

  look(dx, dy) {
    this.yaw -= dx * SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * SENS, -1.35, 1.35);
  }

  /** Take over from wherever the camera currently is (after an inspect fly-in). */
  syncFromCamera() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = THREE.MathUtils.clamp(e.x, -1.35, 1.35);
    this.pos.copy(this.camera.position);
    this.vel.set(0, 0, 0);
    this.collide();
  }

  collide() {
    const { HW, zEnd, planes } = this.layout;
    const p = this.pos;
    p.x = THREE.MathUtils.clamp(p.x, -HW + RADIUS, HW - RADIUS);
    p.z = THREE.MathUtils.clamp(p.z, zEnd + RADIUS, -RADIUS);
    for (const pl of planes) {
      const dist = (p.x - pl.point.x) * pl.normal.x + (p.z - pl.point.z) * pl.normal.z;
      if (dist < RADIUS) { p.x += pl.normal.x * (RADIUS - dist); p.z += pl.normal.z * (RADIUS - dist); }
    }
    for (const c of this.colliders) {
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
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += (EYE - this.pos.y) * (1 - Math.exp(-dt * 6));
    this.collide();

    const v = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * v * 2.1;
    const bobY = Math.sin(this.bob * 2) * 0.022 * Math.min(1, v / WALK);

    this.camera.position.set(this.pos.x, this.pos.y + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
