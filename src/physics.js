/* ============================== [PHYSICS] ==============================
   The rulebook: collision volumes + a faithful port of Source's
   PlayerMove.  Deliberately free of THREE and the DOM so it can be unit
   tested headless (see test/movement.test.mjs) and so nothing in the
   renderer can accidentally reach in and nudge the player.

   Collision world
     SOLIDS   axis-aligned boxes (the whole course is built from these)
     RAMPS    boxes with a sloped top. A ramp whose normal is steeper than
              MOVE.walkableNormalY is not standable: you get clipped along
              it instead, which is what launches you.
     TRIGGERS non-solid volumes the game logic polls (start / checkpoint /
              finish / boost / teleport / kill).

   Movement order matches CGameMovement::FullWalkMove:
     half gravity -> jump -> friction -> accelerate -> move -> categorise
     -> half gravity                                                         */

import { MOVE } from './config.js';

export const SOLIDS = [];
export const RAMPS = [];
export const TRIGGERS = [];

const UP = Object.freeze({ x: 0, y: 1, z: 0 });

export function clearPhysics() { SOLIDS.length = 0; RAMPS.length = 0; TRIGGERS.length = 0; }

/* ---------------- authoring ---------------- */

/** Axis-aligned solid box. */
export function solid(minX, maxX, minY, maxY, minZ, maxZ, tag) {
  const s = { minX, maxX, minY, maxY, minZ, maxZ, tag: tag || "" };
  SOLIDS.push(s); return s;
}

/**
 * Sloped-top box. `axis` is the axis the slope runs along ('x' or 'z');
 * yLow is the surface height at that axis' minimum, yHigh at its maximum.
 * The volume is solid from `base` up to the sloped surface.
 */
export function ramp(minX, maxX, minZ, maxZ, axis, yLow, yHigh, base, tag) {
  const span = axis === 'x' ? (maxX - minX) : (maxZ - minZ);
  const slope = (yHigh - yLow) / (span || 1);
  const inv = 1 / Math.hypot(slope, 1);
  const r = {
    minX, maxX, minZ, maxZ, axis, yLow, yHigh, slope,
    base: base == null ? Math.min(yLow, yHigh) - 400 : base,
    minY: base == null ? Math.min(yLow, yHigh) - 400 : base,
    maxY: Math.max(yLow, yHigh),
    n: axis === 'x' ? { x: -slope * inv, y: inv, z: 0 } : { x: 0, y: inv, z: -slope * inv },
    walkable: inv >= MOVE.walkableNormalY,
    tag: tag || "",
  };
  RAMPS.push(r); return r;
}

/** Non-solid volume. `data` carries the gameplay meaning (see timer.js). */
export function trigger(minX, maxX, minY, maxY, minZ, maxZ, data) {
  const t = { minX, maxX, minY, maxY, minZ, maxZ, ...data };
  TRIGGERS.push(t); return t;
}

/* ---------------- ramp helpers ---------------- */

/** Surface height of a ramp at a point, clamped into its footprint. */
export function rampSurfaceY(r, x, z) {
  if (r.axis === 'x') {
    const t = clamp((x - r.minX) / (r.maxX - r.minX), 0, 1);
    return r.yLow + (r.yHigh - r.yLow) * t;
  }
  const t = clamp((z - r.minZ) / (r.maxZ - r.minZ), 0, 1);
  return r.yLow + (r.yHigh - r.yLow) * t;
}
/** Highest point of a ramp under the player's square hull. */
function rampMaxUnderHull(r, x, z, radius) {
  const uphillPos = r.slope > 0;
  if (r.axis === 'x') return rampSurfaceY(r, uphillPos ? x + radius : x - radius, z);
  return rampSurfaceY(r, x, uphillPos ? z + radius : z - radius);
}
function hullOverlapsXZ(b, x, z, radius) {
  return x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ---------------- queries ---------------- */

/**
 * Highest standable surface under the hull, searched in [lo, hi] of feet height.
 * Returns {y, n, ramp} or null.
 */
export function findGround(x, z, lo, hi, radius) {
  let bestY = -Infinity, bestN = UP, bestRamp = null;
  for (const s of SOLIDS) {
    if (!hullOverlapsXZ(s, x, z, radius)) continue;
    if (s.maxY < lo || s.maxY > hi) continue;
    if (s.maxY > bestY) { bestY = s.maxY; bestN = UP; bestRamp = null; }
  }
  for (const r of RAMPS) {
    if (!r.walkable) continue;                       // steep ramps are slid on, not stood on
    if (!hullOverlapsXZ(r, x, z, radius)) continue;
    const y = rampSurfaceY(r, x, z);
    if (y < lo || y > hi) continue;
    if (y > bestY) { bestY = y; bestN = r.n; bestRamp = r; }
  }
  return bestY > -Infinity ? { y: bestY, n: bestN, ramp: bestRamp } : null;
}

/** Lowest ceiling above the hull's head within `reach`, or null. */
export function findCeiling(x, z, headY, reach, radius) {
  let best = Infinity;
  for (const s of SOLIDS) {
    if (!hullOverlapsXZ(s, x, z, radius)) continue;
    if (s.minY < headY - 0.01 || s.minY > headY + reach) continue;
    if (s.minY < best) best = s.minY;
  }
  return best < Infinity ? best : null;
}

/** True if a standing hull would fit at this spot (used to refuse un-ducking). */
export function hullFits(x, y, z, height, radius) {
  for (const s of SOLIDS) {
    if (!hullOverlapsXZ(s, x, z, radius)) continue;
    if (y + height > s.minY + 0.01 && y < s.maxY - 0.01) return false;
  }
  return true;
}

export function triggersAt(pos, radius, height, out) {
  const hits = out || [];
  hits.length = 0;
  for (const t of TRIGGERS) {
    if (pos.x + radius <= t.minX || pos.x - radius >= t.maxX) continue;
    if (pos.z + radius <= t.minZ || pos.z - radius >= t.maxZ) continue;
    if (pos.y + height <= t.minY || pos.y >= t.maxY) continue;
    hits.push(t);
  }
  return hits;
}

/* ---------------- velocity clipping (Source ClipVelocity) ---------------- */

export function clipVelocity(vel, n, overbounce = 1.0) {
  const backoff = (vel.x * n.x + vel.y * n.y + vel.z * n.z) * overbounce;
  if (backoff >= 0) return false;                    // already separating
  vel.x -= n.x * backoff; vel.y -= n.y * backoff; vel.z -= n.z * backoff;
  return true;
}

/* ---------------- horizontal collision ---------------- */

/**
 * Push the hull out of anything it overlaps in XZ and clip the velocity into
 * the wall.  `canStep` lets a grounded player walk over low ledges instead of
 * being stopped by them.  Returns the number of surfaces hit.
 */
function resolveXZ(pos, vel, feetY, height, canStep, radius) {
  let hits = 0;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const s of SOLIDS) {
      if (feetY + height <= s.minY + 0.01 || feetY >= s.maxY - 0.01) continue;
      if (canStep && s.maxY - feetY <= MOVE.stepHeight + 0.01) continue;   // steppable ledge
      const ox = Math.min(s.maxX - (pos.x - radius), (pos.x + radius) - s.minX);
      const oz = Math.min(s.maxZ - (pos.z - radius), (pos.z + radius) - s.minZ);
      if (ox <= 0 || oz <= 0) continue;
      moved = true; hits++;
      if (ox < oz) {
        if (pos.x < (s.minX + s.maxX) * 0.5) { pos.x = s.minX - radius; clipVelocity(vel, { x: -1, y: 0, z: 0 }); }
        else { pos.x = s.maxX + radius; clipVelocity(vel, { x: 1, y: 0, z: 0 }); }
      } else {
        if (pos.z < (s.minZ + s.maxZ) * 0.5) { pos.z = s.minZ - radius; clipVelocity(vel, { x: 0, y: 0, z: -1 }); }
        else { pos.z = s.maxZ + radius; clipVelocity(vel, { x: 0, y: 0, z: 1 }); }
      }
    }
    // ramps: a walkable one only blocks when it rises out of step reach; a steep
    // one always deflects (this is the surf/launch case).
    for (const r of RAMPS) {
      if (feetY + height <= r.base + 0.01) continue;
      if (!hullOverlapsXZ(r, pos.x, pos.z, radius)) continue;
      const top = rampMaxUnderHull(r, pos.x, pos.z, radius);
      if (feetY >= top - 0.01) continue;                       // hull is above the surface
      const reach = r.walkable ? MOVE.stepHeight : MOVE.stepHeight;
      if (top - feetY <= reach + 0.01) {
        if (!r.walkable) { pos.y = rampSurfaceY(r, pos.x, pos.z); clipVelocity(vel, r.n); hits++; moved = true; }
        continue;                                              // otherwise the ground pass lifts us
      }
      // too tall to mount: treat the ramp's footprint as a wall
      moved = true; hits++;
      const ox = Math.min(r.maxX - (pos.x - radius), (pos.x + radius) - r.minX);
      const oz = Math.min(r.maxZ - (pos.z - radius), (pos.z + radius) - r.minZ);
      if (ox < oz) {
        if (pos.x < (r.minX + r.maxX) * 0.5) { pos.x = r.minX - radius; clipVelocity(vel, { x: -1, y: 0, z: 0 }); }
        else { pos.x = r.maxX + radius; clipVelocity(vel, { x: 1, y: 0, z: 0 }); }
      } else {
        if (pos.z < (r.minZ + r.maxZ) * 0.5) { pos.z = r.minZ - radius; clipVelocity(vel, { x: 0, y: 0, z: -1 }); }
        else { pos.z = r.maxZ + radius; clipVelocity(vel, { x: 0, y: 0, z: 1 }); }
      }
    }
    if (!moved) break;
  }
  return hits;
}

/* ---------------- Source movement primitives ---------------- */

export function applyFriction(vel, dt, surfaceFriction = 1) {
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed < 0.1) return;
  const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
  const drop = control * MOVE.friction * surfaceFriction * dt;
  const newSpeed = Math.max(0, speed - drop) / speed;
  vel.x *= newSpeed; vel.y *= newSpeed; vel.z *= newSpeed;
}

/** Ground acceleration — reaches, but never exceeds, wishspeed. */
export function accelerate(vel, wx, wz, wishspeed, accel, dt, surfaceFriction = 1) {
  const currentspeed = vel.x * wx + vel.z * wz;
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return 0;
  let accelspeed = accel * wishspeed * dt * surfaceFriction;
  if (accelspeed > addspeed) accelspeed = addspeed;
  vel.x += accelspeed * wx; vel.z += accelspeed * wz;
  return accelspeed;
}

/**
 * Air acceleration.  Identical to Accelerate except the *target* speed is
 * clamped to MOVE.airWishCap (30) while the acceleration rate still scales
 * with the full wishspeed.
 *
 * The consequence, and the entire skill of the game: holding W in the air
 * does nothing once you already move faster than 30 u/s forwards. To gain,
 * the wish vector has to sit nearly perpendicular to your velocity — hold
 * one strafe key and rotate the mouse the same way, every tick, by hand.
 */
export function airAccelerate(vel, wx, wz, wishspeed, accel, dt, surfaceFriction = 1) {
  const wishspd = Math.min(wishspeed, MOVE.airWishCap);
  const currentspeed = vel.x * wx + vel.z * wz;
  const addspeed = wishspd - currentspeed;
  if (addspeed <= 0) return 0;
  let accelspeed = accel * wishspeed * dt * surfaceFriction;
  if (accelspeed > addspeed) accelspeed = addspeed;
  vel.x += accelspeed * wx; vel.z += accelspeed * wz;
  return accelspeed;
}

/* ---------------- the tick ---------------- */

/** A fresh physics body. */
export function makeBody(x = 0, y = 0, z = 0) {
  return {
    pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
    onGround: false, groundNormal: { ...UP }, groundRamp: null,
    ducking: false, hullHeight: MOVE.standHeight,
    jumped: false, landed: false, wallHits: 0,
    /* per-tick telemetry the HUD reads (never fed back into movement) */
    gain: 0, wishX: 0, wishZ: 0, speed: 0, prevSpeed: 0,
  };
}

/**
 * One fixed simulation tick.
 * `cmd` = { forward:-1..1, side:-1..1, yaw, jump:bool, duck:bool, walk:bool }
 * Every term below comes from cmd or from the body's own state. Nothing
 * substitutes a direction the player did not press.
 */
export function playerMove(body, cmd, dt) {
  const M = MOVE;
  const pos = body.pos, vel = body.vel;
  body.jumped = false; body.landed = false; body.gain = 0;
  body.prevSpeed = Math.hypot(vel.x, vel.z);

  /* --- duck --- */
  const wantDuck = !!cmd.duck;
  if (wantDuck !== body.ducking) {
    if (wantDuck) { body.ducking = true; }
    else if (hullFits(pos.x, pos.y, pos.z, M.standHeight, M.radius)) { body.ducking = false; }
  }
  const height = body.ducking ? M.duckHeight : M.standHeight;
  body.hullHeight = height;

  /* --- wish direction: look angles x key state, and nothing else --- */
  const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
  let wx = (-sy * cmd.forward) + (cy * cmd.side);
  let wz = (-cy * cmd.forward) + (-sy * cmd.side);
  const wlen = Math.hypot(wx, wz);
  let wishspeed = 0;
  if (wlen > 1e-6) {
    wx /= wlen; wz /= wlen;
    wishspeed = M.maxSpeed * (cmd.walk ? M.walkSpeedMul : 1) * (body.ducking && body.onGround ? M.duckSpeedMul : 1);
  } else { wx = 0; wz = 0; }
  body.wishX = wx; body.wishZ = wz;

  /* --- 1. half gravity --- */
  vel.y -= M.gravity * 0.5 * dt;

  /* --- 2. jump (before friction: that is why a frame-perfect hop keeps speed) --- */
  if (cmd.jump && body.onGround) {
    vel.y = M.jumpVel;
    body.onGround = false; body.groundRamp = null; body.jumped = true;
  }

  /* --- 3. friction (skipped entirely on the tick you jump) --- */
  if (body.onGround) { vel.y = 0; applyFriction(vel, dt); }

  /* --- 4. accelerate --- */
  const speedBefore = Math.hypot(vel.x, vel.z);
  if (body.onGround) {
    accelerate(vel, wx, wz, wishspeed, M.accelerate, dt);
    vel.y = 0;
  } else {
    airAccelerate(vel, wx, wz, wishspeed, M.airAccelerate, dt);
  }
  body.gain = Math.hypot(vel.x, vel.z) - speedBefore;

  /* --- clamp --- */
  vel.x = clamp(vel.x, -M.maxVelocity, M.maxVelocity);
  vel.y = clamp(vel.y, -M.maxVelocity, M.maxVelocity);
  vel.z = clamp(vel.z, -M.maxVelocity, M.maxVelocity);

  /* --- 5. move --- */
  const wasOnGround = body.onGround;
  const dx = vel.x * dt, dz = vel.z * dt;
  const sub = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (M.radius * 0.75)));
  body.wallHits = 0;
  for (let i = 0; i < sub; i++) {
    pos.x += dx / sub; pos.z += dz / sub;
    body.wallHits += resolveXZ(pos, vel, pos.y, height, wasOnGround, M.radius);
  }

  const prevY = pos.y;
  pos.y += vel.y * dt;

  /* ceiling */
  if (vel.y > 0) {
    const c = findCeiling(pos.x, pos.z, prevY + height, (pos.y - prevY) + 1, M.radius);
    if (c != null && pos.y + height > c) { pos.y = c - height - 0.01; vel.y = 0; }
  }

  /* --- 6. categorise position --- */
  let grounded = false;
  if (vel.y <= 0.1) {
    // reach up by a step (mounting a ledge), and down by a step only if we were
    // already grounded (walking down stairs instead of launching off them). Mid-air
    // ducking tucks the legs, letting a crouch-jump catch a higher edge.
    const tuck = (body.ducking && !wasOnGround) ? M.duckTuck : 0;
    const hi = pos.y + M.stepHeight + tuck;
    const lo = wasOnGround ? pos.y - M.stepHeight : Math.min(pos.y, prevY) - 0.5;
    const g = findGround(pos.x, pos.z, lo, hi, M.radius);
    if (g) {
      pos.y = g.y; grounded = true;
      body.groundNormal = g.n; body.groundRamp = g.ramp;
      if (!wasOnGround) body.landed = true;
      if (g.n.y > 0.999) vel.y = 0; else clipVelocity(vel, g.n);
    }
  }
  if (!grounded) { body.groundNormal = { ...UP }; body.groundRamp = null; }
  body.onGround = grounded;

  /* --- 7. remaining half gravity (cleared next tick if still grounded) --- */
  vel.y -= M.gravity * 0.5 * dt;

  body.speed = Math.hypot(vel.x, vel.z);
  return body;
}
