/* ============================== [PLAYER] ==============================
   The physics body plus everything the camera needs: view angles, eye
   smoothing, the strafe lean and the speed-driven FOV.

   Note what is NOT here — the camera reads the body, it never writes to it.
   No view-based steering, no assisted turning.                            */
import * as THREE from 'three';
import { camera, followSun } from './core.js';
import { MOVE, SETTINGS } from './config.js';
import { makeBody } from './physics.js';
import { MAP } from './map.js';

export const view = {
  body: makeBody(),
  yaw: 0, pitch: 0,
  prev: { x: 0, y: 0, z: 0 },       // position at the previous tick, for render interpolation
  eye: MOVE.eyeStand,
  roll: 0,
  fov: SETTINGS.fov,
  keys: {}, sync: 0, gainPerSec: 0, turnRate: 0,
  sideInput: 0,
};

export function spawnAt(p) {
  const b = view.body;
  b.pos.x = p.x; b.pos.y = p.y; b.pos.z = p.z;
  b.vel.x = b.vel.y = b.vel.z = 0;
  b.onGround = false; b.ducking = false; b.hullHeight = MOVE.standHeight;
  b.speed = 0; b.gain = 0;
  view.prev = { ...b.pos };
  if (p.yaw != null) view.yaw = p.yaw;
  view.pitch = 0; view.roll = 0;
  view.eye = MOVE.eyeStand;
}

export function resetPlayer() { spawnAt(MAP.spawn); }

/** Called right before each physics tick so interpolation has both endpoints. */
export function beginTick() { view.prev.x = view.body.pos.x; view.prev.y = view.body.pos.y; view.prev.z = view.body.pos.z; }

/**
 * Place the camera. `alpha` is the fraction of a tick left over this frame,
 * so the view is smooth at any frame rate above or below the 128Hz sim.
 */
export function updateCamera(alpha, dt) {
  const b = view.body;
  const x = view.prev.x + (b.pos.x - view.prev.x) * alpha;
  const y = view.prev.y + (b.pos.y - view.prev.y) * alpha;
  const z = view.prev.z + (b.pos.z - view.prev.z) * alpha;

  // eye height eases when you duck so a crouch-jump does not snap the world
  const targetEye = b.ducking ? MOVE.eyeDuck : MOVE.eyeStand;
  view.eye += (targetEye - view.eye) * Math.min(1, dt * 16);

  // lean into the strafe you are holding: the only cue that tells you, without
  // looking away from the gap, which way you are currently pushing
  const targetRoll = SETTINGS.viewRoll ? -view.sideInput * (b.onGround ? 0.020 : 0.042) : 0;
  view.roll += (targetRoll - view.roll) * Math.min(1, dt * 9);

  // FOV opens up with speed. It starts at the free 250 so any widening at all
  // is speed you strafed for.
  const kick = Math.max(0, Math.min(22, (b.speed - MOVE.maxSpeed) / 26));
  const targetFov = SETTINGS.fov + kick;
  if (Math.abs(view.fov - targetFov) > 0.02) {
    view.fov += (targetFov - view.fov) * Math.min(1, dt * 5);
    camera.fov = view.fov; camera.updateProjectionMatrix();
  }

  camera.position.set(x, y + view.eye, z);
  camera.rotation.set(view.pitch, view.yaw, view.roll, 'YXZ');
  followSun(x, y, z);
}

export function eyeWorld() {
  const b = view.body;
  return new THREE.Vector3(b.pos.x, b.pos.y + view.eye, b.pos.z);
}
