/* ============================== [FX] ==============================
   Transient visuals.  All of it is feedback about speed — at 700 u/s a
   static frame looks the same as at 250, so the game has to say so.       */
import * as THREE from 'three';
import { scene, camera } from './core.js';
import { NEON } from './world.js';

const live = [];
const RING = new THREE.RingGeometry(0.7, 1, 24);

function ring(x, y, z, color, r0, r1, life, flat = true) {
  const m = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, y, z);
  if (flat) m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(r0);
  scene.add(m);
  live.push({ m, t: 0, life, r0, r1, kind: "ring" });
  return m;
}

export function fxLand(x, y, z, impact) {
  ring(x, y + 2, z, impact > 0.6 ? NEON.magenta : NEON.cyan, 12, 46 + impact * 70, 0.34);
}
export function fxJump(x, y, z) { ring(x, y + 3, z, NEON.lime, 10, 40, 0.24); }
export function fxCheckpoint(x, y, z) {
  for (let i = 0; i < 3; i++) {
    const r = ring(x, y + 8 + i * 60, z, NEON.lime, 30, 300, 0.75);
    live[live.length - 1].delay = i * 0.09;
    r.visible = i === 0;
  }
}
export function fxFinish(x, y, z) {
  for (let i = 0; i < 6; i++) {
    ring(x, y + 10 + i * 46, z, i % 2 ? NEON.amber : NEON.magenta, 20, 520, 1.3);
    live[live.length - 1].delay = i * 0.08;
  }
}
export function fxFall(x, y, z) { ring(x, y, z, NEON.magenta, 20, 200, 0.5); }

export function updateFx(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i];
    if (f.delay > 0) { f.delay -= dt; f.m.visible = f.delay <= 0; continue; }
    f.m.visible = true;
    f.t += dt;
    const k = f.t / f.life;
    f.m.scale.setScalar(f.r0 + (f.r1 - f.r0) * (1 - (1 - k) * (1 - k)));
    f.m.material.opacity = Math.max(0, 0.9 * (1 - k));
    if (f.t >= f.life) { scene.remove(f.m); f.m.material.dispose(); live.splice(i, 1); }
  }
}
export function clearFx() { for (const f of live) { scene.remove(f.m); f.m.material.dispose(); } live.length = 0; }

/* ---------------- speed lines ---------------- */
// A cage of streaks parented to the camera; they only become visible past the
// speed you get for free, so seeing them at all means you earned something.
const LINES = 128;
let streaks = null, streakBase = null;
export function initSpeedLines() {
  const pos = new Float32Array(LINES * 6);
  streakBase = new Float32Array(LINES * 3);
  for (let i = 0; i < LINES; i++) {
    const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 190;
    streakBase[i * 3] = Math.cos(a) * r;
    streakBase[i * 3 + 1] = Math.sin(a) * r;
    streakBase[i * 3 + 2] = -60 - Math.random() * 700;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  streaks.frustumCulled = false;
  camera.add(streaks);
}
export function updateSpeedLines(speed, dt) {
  if (!streaks) return;
  const show = Math.max(0, Math.min(1, (speed - 300) / 620));
  streaks.material.opacity += (show * 0.5 - streaks.material.opacity) * Math.min(1, dt * 8);
  if (streaks.material.opacity < 0.005) { streaks.visible = false; return; }
  streaks.visible = true;
  const len = 40 + show * 320;
  const p = streaks.geometry.attributes.position.array;
  for (let i = 0; i < LINES; i++) {
    const bx = streakBase[i * 3], by = streakBase[i * 3 + 1], bz = streakBase[i * 3 + 2];
    p[i * 6] = bx; p[i * 6 + 1] = by; p[i * 6 + 2] = bz;
    p[i * 6 + 3] = bx; p[i * 6 + 4] = by; p[i * 6 + 5] = bz + len;
  }
  streaks.geometry.attributes.position.needsUpdate = true;
}
