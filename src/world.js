/* ============================== [WORLD] ==============================
   Materials and the builders that create a piece of level: each one emits
   the THREE mesh AND the matching physics volume, so what you see is
   exactly what you collide with.  Map *layouts* live in map.js.            */
import * as THREE from 'three';
import { scene } from './core.js';
import { solid, ramp, trigger, clearPhysics, SOLIDS, RAMPS, TRIGGERS } from './physics.js';

/* Everything a map builds lives under mapGroup so a rebuild can wipe it clean. */
export const mapGroup = new THREE.Group(); scene.add(mapGroup);

/* ---------------- material palette ---------------- */
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.05, ...o });

export const MATS = {
  deck:    std(0x1d2140, { roughness: 0.72 }),                                   // ordinary run blocks
  deckAlt: std(0x241a44, { roughness: 0.72 }),
  start:   std(0x123a34, { roughness: 0.7, emissive: 0x0a2a22, emissiveIntensity: 0.6 }),
  finish:  std(0x3a2a10, { roughness: 0.6, emissive: 0x3a2600, emissiveIntensity: 0.7 }),
  check:   std(0x172c46, { roughness: 0.7, emissive: 0x0d2038, emissiveIntensity: 0.6 }),
  ramp:    std(0x2b1c4e, { roughness: 0.55, metalness: 0.25 }),
  launch:  std(0x4a1330, { roughness: 0.4, metalness: 0.35, emissive: 0x2a0018, emissiveIntensity: 0.7 }),
  wall:    std(0x14162c, { roughness: 0.95 }),
  beam:    std(0x151a34, { roughness: 0.6, metalness: 0.2 }),
  boost:   std(0x0f3a44, { roughness: 0.35, emissive: 0x0d5566, emissiveIntensity: 1.1 }),
};

export const NEON = { cyan: 0x38f2ff, magenta: 0xff3f8e, lime: 0x8dff5a, amber: 0xffc23f, violet: 0xa070ff, white: 0xdfe8ff };

/* Shared unit geometry — every block is one scaled box, which keeps a few
   hundred brushes cheap to upload. */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/* ---------------- primitives ---------------- */

function edgeLines(mesh, color, opacity = 0.85) {
  const e = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, fog: true })
  );
  e.position.copy(mesh.position); e.scale.copy(mesh.scale); e.rotation.copy(mesh.rotation);
  e.renderOrder = 2;
  mapGroup.add(e);
  return e;
}

/**
 * A solid block. x/z are the CENTRE, y is the BOTTOM.
 * `o.edge` draws a neon wireframe (this is what makes a gap readable at 700 u/s),
 * `o.strip` lays a glowing line down the middle of the top face.
 */
export function block(x, z, w, d, y, h, mat = MATS.deck, o = {}) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = o.shadow !== false; m.receiveShadow = true;
  mapGroup.add(m);
  if (o.edge !== null) edgeLines(m, o.edge === undefined ? NEON.cyan : o.edge, o.edgeAlpha);
  if (o.strip) topStrip(x, z, w, d, y + h, o.strip, o.stripW);
  if (o.solid !== false) solid(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, o.tag);
  return m;
}

/** Flat glowing decal on top of a block — a landing marker you can read mid-air. */
export function topStrip(x, z, w, d, y, color = NEON.cyan, sw) {
  const along = w >= d;
  const g = new THREE.Mesh(UNIT_BOX, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62, fog: true }));
  g.scale.set(along ? w * 0.86 : (sw || 8), 1.2, along ? (sw || 8) : d * 0.86);
  g.position.set(x, y + 0.7, z);
  mapGroup.add(g);
  return g;
}

/** Non-solid glowing plate (used to mark boost pads and hazards). */
export function decal(x, z, w, d, y, color, opacity = 0.5) {
  const g = new THREE.Mesh(UNIT_BOX, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, fog: true }));
  g.scale.set(w, 1.2, d); g.position.set(x, y + 0.8, z);
  mapGroup.add(g); return g;
}

/**
 * A sloped block. `axis` is the direction the slope runs; yLow/yHigh are the
 * surface heights at that axis' min/max.  Shallower than ~45 deg you run up it;
 * steeper and you get clipped along it instead — a launch pad.
 */
export function slope(x, z, w, d, axis, yLow, yHigh, base, mat = MATS.ramp, o = {}) {
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  const r = ramp(minX, maxX, minZ, maxZ, axis, yLow, yHigh, base, o.tag);

  // Box, with its four top vertices pulled onto the ramp surface.
  const g = new THREE.BoxGeometry(w, 1, d).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), ly = p.getY(i), lz = p.getZ(i);
    const wx = x + lx, wz = z + lz;
    const t = axis === 'x' ? (wx - minX) / (maxX - minX) : (wz - minZ) / (maxZ - minZ);
    const surf = yLow + (yHigh - yLow) * Math.min(1, Math.max(0, t));
    p.setY(i, (ly > 0 ? surf : r.base) - (yLow + yHigh) / 2);
  }
  g.computeVertexNormals(); p.needsUpdate = true;

  const m = new THREE.Mesh(g, mat);
  m.position.set(x, (yLow + yHigh) / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  mapGroup.add(m);
  if (o.edge !== null) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 20),
      new THREE.LineBasicMaterial({ color: o.edge === undefined ? NEON.magenta : o.edge, transparent: true, opacity: 0.9 }));
    e.position.copy(m.position); mapGroup.add(e);
  }
  return { mesh: m, ramp: r };
}

/** Vertical wall (bounds, guard rails, scenery you can bounce off). */
export function wall(x, z, w, d, y, h, mat = MATS.wall, o = {}) {
  return block(x, z, w, d, y, h, mat, { edge: NEON.violet, edgeAlpha: 0.35, ...o });
}

/* ---------------- triggers ---------------- */

/** Invisible gameplay volume. x/z centre, y bottom. `data` reaches timer.js. */
export function zone(x, z, w, d, y, h, data) {
  return trigger(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, data);
}

/** A trigger you can see: a glowing arch you run through. */
export function gate(x, z, w, y, h, color, data, depth = 40) {
  const t = zone(x, z, w, depth, y, h, data);
  const barMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, fog: true });
  const post = (px, pz, pw, ph, pd) => {
    const m = new THREE.Mesh(UNIT_BOX, barMat);
    m.scale.set(pw, ph, pd); m.position.set(px, y + ph / 2, pz); mapGroup.add(m); return m;
  };
  post(x - w / 2, z, 7, h, 7); post(x + w / 2, z, 7, h, 7);
  const top = new THREE.Mesh(UNIT_BOX, barMat);
  top.scale.set(w + 7, 7, 7); top.position.set(x, y + h, z); mapGroup.add(top);
  const pane = new THREE.Mesh(UNIT_BOX, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, fog: true }));
  pane.scale.set(w, h, 1.5); pane.position.set(x, y + h / 2, z); mapGroup.add(pane);
  return t;
}

/* ---------------- signage ---------------- */

const signCache = new Map();
function textTexture(text, color, sub) {
  const key = text + "|" + color + "|" + (sub || "");
  if (signCache.has(key)) return signCache.get(key);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.textAlign = 'center'; g.textBaseline = 'middle';

  // shrink to fit rather than letting a long line run off the edge of the canvas
  const fit = (str, start, weight, max) => {
    let px = start;
    do {
      g.font = `${weight}${px}px "Trebuchet MS", "Segoe UI", sans-serif`;
      if (g.measureText(str).width <= max) break;
      px -= 4;
    } while (px > 14);
    return px;
  };

  fit(text, 118, 'bold ', 950);
  g.shadowColor = color; g.shadowBlur = 34;
  g.fillStyle = '#ffffff';
  g.fillText(text, 512, sub ? 100 : 128);
  if (sub) {
    fit(sub, 52, '', 960);
    g.shadowBlur = 14; g.fillStyle = color;
    g.fillText(sub, 512, 196);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4; t.needsUpdate = true;
  signCache.set(key, t);
  return t;
}

/** Floating banner. `rotY` faces it; default faces -Z (the way a +X runner looks). */
export function sign(x, y, z, text, o = {}) {
  const colorHex = '#' + new THREE.Color(o.color == null ? NEON.cyan : o.color).getHexString();
  const w = o.w || 420, h = w / 4;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: textTexture(text, colorHex, o.sub), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true })
  );
  m.position.set(x, y, z);
  m.rotation.y = o.rotY || 0;
  m.renderOrder = 3;
  mapGroup.add(m);
  return m;
}

/* ---------------- ambience ---------------- */

/** The endless grid far below — the only thing that gives the void a floor. */
export function voidGrid(y, size, div, c1, c2) {
  const g = new THREE.GridHelper(size, div, c1, c2);
  g.position.y = y;
  g.material.transparent = true; g.material.opacity = 0.22; g.material.fog = true;
  mapGroup.add(g);
  return g;
}

export function pointGlow(x, y, z, color, intensity = 1.2, dist = 900) {
  const l = new THREE.PointLight(color, intensity, dist, 1.7);
  l.position.set(x, y, z); mapGroup.add(l); return l;
}

/* ---------------- lifecycle ---------------- */

export function clearWorld() {
  for (const o of [...mapGroup.children]) {
    mapGroup.remove(o);
    o.traverse?.(n => {
      if (n.geometry && n.geometry !== UNIT_BOX) n.geometry.dispose?.();
      if (n.material && !Object.values(MATS).includes(n.material)) n.material.dispose?.();
    });
  }
  clearPhysics();
}

export const worldStats = () => ({ solids: SOLIDS.length, ramps: RAMPS.length, triggers: TRIGGERS.length, meshes: mapGroup.children.length });
