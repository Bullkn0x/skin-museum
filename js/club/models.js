// Real 3D models in the club are prepared and shaded exactly as in the museum.
//
// museum.js keeps that code (sticker order, holographic stickers, environment-only lighting)
// inside buildMuseum, and it is still changing. Rather than copy it, the club borrows it from
// a museum that is built once and never drawn. Only the per-frame motion below is repeated,
// and it follows the same rules: a cased model turns slowly, a framed one stays parallel to
// its backdrop with a slight float and comes forward when the visitor turns it by hand.
// When the model code settles into a module of its own, import that here instead.
import * as THREE from 'three';
import { buildMuseum } from '../museum.js';

export function modelKit(scene, data, renderer) {
  const backstage = new THREE.Scene();
  backstage.environment = scene.environment;
  const museum = buildMuseum(backstage, { museum: data.museum, skins: [] }, new Map(), renderer);

  function moveModel(d, t, dt, held) {
    const m = d.model, p = d.parts;
    if (!held) {
      m.yaw = THREE.MathUtils.damp(m.yaw, 0, 2.5, dt);
      m.pitch = THREE.MathUtils.damp(m.pitch, 0, 2.5, dt);
    }
    if (d.kind === 'pedestal') {
      m.spin += dt * (held ? 0.05 : 0.38);
      m.holder.rotation.set(m.pitch, m.spin + m.yaw, 0);
      m.holder.position.y = p.baseY + Math.sin(t * 0.8 + d.phase) * 0.012;
    } else {
      const tilt = held ? 0 : Math.sin(t * 0.5 + d.phase * 1.3) * 0.007;
      m.holder.rotation.set(m.pitch, m.yaw, tilt);
      m.holder.position.y = p.baseY + Math.sin(t * 0.8 + d.phase) * 0.016;
      m.holder.updateMatrix();
      const e = m.holder.matrix.elements;
      m.holder.position.z = m.gap + Math.abs(e[2]) * m.half.x + Math.abs(e[6]) * m.half.y + Math.abs(e[10]) * m.half.z;
    }
  }
  return {
    prepareModel: museum.prepareModel ? (g) => museum.prepareModel(g) : async (g) => g,
    attachModel: (d, root, rotationDeg) => museum.attachModel(d, root, rotationDeg),
    moveModel,
  };
}
