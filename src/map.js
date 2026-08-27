/* ============================== [MAP] ==============================
   bhop_ascent — a six-stage spiral that climbs ~1700 units above its own
   start line, so from the last stage you are looking down at the first.

   Every gap here was sized against the numbers the physics actually gives:
   a jump apexes 57u up and hangs 0.755s, so one hop covers speed x 0.755.
   Stage 1 is clearable at the free 250 u/s and nothing after it is — the
   course is the difficulty curve.  ROUTE records each landing pad in order
   so test/map.test.mjs can prove the whole thing stays inside what the
   movement can do (it prints the required-speed table).

   Two things deliberately are NOT here: no ramp is steep enough to be a
   "speed ramp" (Source's ClipVelocity would delete your speed head-on, not
   add to it), and no trigger ever steers you.  The one jump pad adds height
   and leaves your direction alone.                                         */
import * as THREE from 'three';
import { block, slope, wall, zone, gate, sign, decal, voidGrid, pointGlow, clearWorld, MATS, NEON } from './world.js';
import { MOVE } from './config.js';

export const MAP = {
  name: "bhop_ascent",
  spawn: { x: -980, y: 0, z: 0, yaw: -Math.PI / 2 },     // yaw -90deg looks down +X
  checkpoints: [], stages: [], finishPad: null,
  bounds: { minX: -1500, maxX: 5600, minZ: -1000, maxZ: 5200 },
};

export const ROUTE = [];        // ordered landing pads, for the feasibility test

const TH = 56;                  // deck thickness
const DIRS = { 'x+': [1, 0], 'x-': [-1, 0], 'z+': [0, 1], 'z-': [0, -1] };

/* ---------------- authoring helpers ---------------- */

function node(x, y, z, sx, sz, assist) {
  ROUTE.push({ x, y, z, sx, sz, stage: Math.max(0, MAP.stages.length - 1), assist: assist || null });
}

/** A deck: x/z centre, `topY` is the surface you land on. */
function deck(cx, cz, sx, sz, topY, mat = MATS.deck, o = {}) {
  block(cx, cz, sx, sz, topY - TH, TH, mat, { edge: NEON.cyan, ...o });
  node(cx, topY, cz, sx, sz, o.assist);
  return { x: cx, y: topY, z: cz };
}

/**
 * A run of decks marching along `dir`.
 *   len   size along travel      wide  size across travel
 *   gap(i)  empty span before deck i+1     rise(i)  height added
 *   lat(i)  lateral offset of deck i — this is what forces you to strafe
 */
function chain(x, z, y, dir, o) {
  const [tx, tz] = DIRS[dir], [lx, lz] = [-tz, tx];
  let cx = x, cz = z, cy = y;
  for (let i = 0; i < o.count; i++) {
    const lat = o.lat ? o.lat(i) : 0;
    const bx = cx + lx * lat, bz = cz + lz * lat;
    deck(bx, bz, tx ? o.len : o.wide, tx ? o.wide : o.len, cy, o.mat || MATS.deck, o.deckOpt || { strip: NEON.cyan });
    if (i === o.count - 1) { cx = bx; cz = bz; break; }
    const g = o.gap ? o.gap(i) : 180;
    cx += tx * (o.len + g); cz += tz * (o.len + g);
    cy += o.rise ? o.rise(i) : 0;
  }
  return { x: cx, z: cz, y: cy, half: o.len / 2 };
}

/**
 * A quarter-circle of pads swinging the route from `from` to `to`.
 * Corners are where a run is actually won or lost: keep strafing through one
 * or you arrive at the next straight with nothing left.
 */
function turn(x, z, y, from, to, R, count, riseTotal) {
  const t0 = DIRS[from], t1 = DIRS[to];
  let end = { x, z, y };
  for (let i = 1; i <= count; i++) {
    const th = (Math.PI / 2) * (i / count);
    const px = x + R * t1[0] * (1 - Math.cos(th)) + R * t0[0] * Math.sin(th);
    const pz = z + R * t1[1] * (1 - Math.cos(th)) + R * t0[1] * Math.sin(th);
    deck(px, pz, 260, 260, y + riseTotal * (i / count), MATS.deckAlt, { edge: NEON.violet, strip: NEON.violet });
    end = { x: px, z: pz, y: y + riseTotal * (i / count) };
  }
  return end;
}

function checkpoint(x, z, y, name, yaw, rotY = 0) {
  const i = MAP.checkpoints.length;
  deck(x, z, 420, 420, y, MATS.check, { edge: NEON.lime, strip: NEON.lime, stripW: 14 });
  gate(x, z, 300, y, 220, NEON.lime, { kind: "checkpoint", index: i }, 46);
  sign(x, y + 300, z, name, { color: NEON.lime, sub: "CHECKPOINT " + (i + 1), rotY, w: 470 });
  pointGlow(x, y + 160, z, NEON.lime, 1.0, 900);
  MAP.checkpoints.push({ i, name, x, y, z, yaw });
  return { x, y, z };
}

function stage(name, hint) { MAP.stages.push({ i: MAP.stages.length, name, hint }); }

/**
 * A short low-pitch run-up. Every checkpoint gets one, because you respawn on a
 * checkpoint at zero speed and the stage ahead of it wants 500+ — without a few
 * cheap pads to rebuild on, a single fall would end the run.
 */
function runway(x, z, y, dir, count = 8) {
  const [tx, tz] = DIRS[dir];
  return chain(x + tx * 120, z + tz * 120, y, dir, {
    count, len: 150, wide: 280,
    gap: i => 40 + i * 16,                                 // pitch 190 -> 302
    mat: MATS.deckAlt, deckOpt: { edge: NEON.lime, strip: NEON.lime },
  });
}

/* A sign is only useful if it is legible from the pad you are standing on, so
   every one of them is turned to face back down the direction of travel. */
const FACING = { 'x+': -Math.PI / 2, 'x-': Math.PI / 2, 'z+': Math.PI, 'z-': 0 };

/** Non-solid scenery — the void needs a sense of scale or 700 u/s feels like 200. */
function pillar(x, z, w, yTop, color) {
  block(x, z, w, w, -4200, yTop + 4200, MATS.beam, { solid: false, edge: color, edgeAlpha: 0.15, shadow: false });
}

/* ============================================================ */

export function buildMap() {
  clearWorld();
  MAP.checkpoints.length = 0; MAP.stages.length = 0; ROUTE.length = 0;

  voidGrid(-1000, 18000, 72, 0x4a2a7a, 0x241546);

  /* ---------------- start room ---------------- */
  stage("START", "Build speed, then cross the gate. The clock starts there.");
  block(-625, 0, 1000, 660, -TH, TH, MATS.start, { edge: NEON.lime, strip: null });
  wall(-1125, 0, 40, 660, -TH, 470);
  wall(-625, -330, 1000, 40, -TH, 470);
  wall(-625, 330, 1000, 40, -TH, 470);
  // you leave this floor from near the gate, not from its middle
  node(-230, 0, 0, 200, 660);

  sign(-160, 600, 0, "BHOP_ASCENT", { color: NEON.magenta, rotY: FACING["x+"], w: 440 });
  sign(-160, 390, 0, "A + MOUSE LEFT   ·   D + MOUSE RIGHT", { color: NEON.cyan, sub: "W on its own will never make you faster", rotY: FACING["x+"], w: 540 });
  pointGlow(-700, 300, 0, NEON.lime, 1.0, 1500);

  gate(-160, 0, 400, 0, 260, NEON.lime, { kind: "start" }, 40);
  sign(-160, 320, 0, "START", { color: NEON.lime, rotY: FACING["x+"], w: 210 });

  /* ---------------- 1 : IGNITION ----------------
     Pitch 210 -> 265, so a hop has to cover ~280-350 u/s worth of ground. The
     start room is long enough to hand you that if you strafe on the way in. */
  stage("IGNITION", "Eleven pads. The rhythm is the whole lesson: land, jump, keep the mouse turning.");
  sign(400, 300, 0, "1 — IGNITION", { color: NEON.cyan, rotY: FACING["x+"], w: 420 });
  let c = chain(0, 0, 0, 'x+', {
    count: 11, len: 140, wide: 300,
    gap: i => 70 + i * 5,                                  // pitch 210 -> 260
    lat: i => Math.sin(i * 0.9) * 40,
  });
  let cp = checkpoint(c.x + c.half + 120 + 210, 0, 0, "IGNITION", -Math.PI / 2, FACING["x+"]);

  /* ---------------- turn A ---------------- */
  c = runway(cp.x + 210, cp.z, cp.y, 'x+');
  c = turn(c.x + c.half - 75, c.z, c.y, 'x+', 'z+', 780, 6, 150);

  /* ---------------- 2 : ASCENT ----------------
     Same pitch, but every pad is 34 units higher. Rising cuts your airtime, so
     the identical spacing now costs you ~400 u/s instead of ~300. */
  stage("ASCENT", "Every pad is higher than the last. Climbing shortens your airtime — the gaps do not care.");
  sign(c.x, c.y + 330, c.z + 620, "2 — ASCENT", { color: NEON.amber, rotY: FACING["z+"], w: 470 });
  c = chain(c.x, c.z + 130 + 60 + 80, c.y + 30, 'z+', {
    count: 9, len: 160, wide: 260,
    gap: i => 50 + i * 6,                                  // pitch 210 -> 258
    rise: () => 34,
    lat: () => 0,                                          // the climb is the challenge here, not the line
    mat: MATS.deckAlt, deckOpt: { edge: NEON.amber, strip: NEON.amber },
  });

  // A 21-degree ramp. Walk up it and friction drags you back to 250; keep
  // bunny-hopping up it and you never pay friction at all. That is the lesson.
  {
    const rd = 620, rz = c.z + c.half + 190 + rd / 2;
    slope(c.x, rz, 340, rd, 'z', c.y - 10, c.y + 220, c.y - 320, MATS.ramp, { edge: NEON.amber });
    node(c.x, c.y - 10, rz, 340, rd, { walk: true });      // the ramp does the lifting
    decal(c.x, rz, 60, rd * 0.9, c.y + 105, NEON.amber, 0.30);
    sign(c.x, c.y + 360, rz, "KEEP HOPPING", { color: NEON.amber, sub: "touch down without jumping and friction takes it all", rotY: FACING["z+"], w: 580 });
    cp = checkpoint(c.x, rz + rd / 2 + 210, c.y + 220, "ASCENT", 0, FACING["z+"]);
  }

  /* ---------------- turn B ---------------- */
  c = runway(cp.x, cp.z + 210, cp.y, 'z+');
  c = turn(c.x, c.z + c.half - 75, c.y, 'z+', 'x-', 840, 6, 70);

  /* ---------------- 3 : ZIGZAG ----------------
     The pitch is mostly SIDEWAYS now: consecutive pads sit 190-260 units apart
     across the run, so the line you have to fly is diagonal and the strafe has
     to flip every single jump. */
  stage("ZIGZAG", "Pads thrown side to side. Change strafe direction on every hop or you land in the dark.");
  sign(c.x - 400, c.y + 330, c.z, "3 — ZIGZAG", { color: NEON.magenta, rotY: FACING["x-"], w: 470 });
  c = chain(c.x - 130 - 90 - 85, c.z, c.y + 22, 'x-', {
    count: 12, len: 170, wide: 250,
    gap: i => 86 + i * 2,
    rise: () => 24,
    lat: i => (i % 2 ? 1 : -1) * (95 + i * 3),
    mat: MATS.deckAlt, deckOpt: { edge: NEON.magenta, strip: NEON.magenta },
  });
  cp = checkpoint(c.x - c.half - 150 - 210, c.z, c.y + 20, "ZIGZAG", Math.PI / 2, FACING["x-"]);

  /* ---------------- turn C ---------------- */
  c = runway(cp.x - 210, cp.z, cp.y, 'x-');
  c = turn(c.x - c.half + 75, c.z, c.y, 'x-', 'z-', 1000, 6, 64);

  /* ---------------- 4 : THE VOID ----------------
     Pitch past 400. Nothing here is reachable on anything less than a stage of
     clean strafing, and the one jump pad only buys height. */
  stage("THE VOID", "Pitches past 400 units. Only clean strafing gets you across, and the jump pad only buys height.");
  sign(c.x, c.y + 350, c.z - 420, "4 — THE VOID", { color: NEON.violet, rotY: FACING["z-"], w: 510 });

  c = chain(c.x, c.z - 130 - 150 - 100, c.y + 24, 'z-', {
    count: 5, len: 200, wide: 300,
    gap: i => 130 + i * 14,
    rise: () => 24,
    lat: i => (i % 2 ? -1 : 1) * 80,
    mat: MATS.deckAlt, deckOpt: { edge: NEON.violet, strip: NEON.violet },
  });

  // Jump pad: pure height, nothing else. It buys airtime for one long carry —
  // the speed and the heading across it are still entirely yours.
  {
    const PAD_VY = 440;
    const pz = c.z - c.half - 175 - 170;
    deck(c.x, pz, 340, 340, c.y + 22, MATS.boost, { edge: NEON.cyan, strip: NEON.cyan, assist: { vy: PAD_VY } });
    zone(c.x, pz, 320, 320, c.y + 22, 140, { kind: "jumppad", up: PAD_VY });
    decal(c.x, pz, 300, 300, c.y + 22, NEON.cyan, 0.55);
    gate(c.x, pz, 330, c.y + 22, 240, NEON.cyan, { kind: "none" }, 26);
    sign(c.x, c.y + 300, pz, "JUMP PAD", { color: NEON.cyan, sub: "height only — the distance is on you", rotY: FACING["z-"], w: 480 });

    // the long carry the pad exists for: 595 units of pitch on 1.06s of airtime
    c = deck(c.x, pz - 595, 420, 420, c.y + 38, MATS.deckAlt, { edge: NEON.violet, strip: NEON.violet });
    c.half = 210;
  }

  c = chain(c.x, c.z - c.half - 160 - 100, c.y + 22, 'z-', {
    count: 5, len: 200, wide: 280,
    gap: i => 135 + i * 10,
    rise: () => 22,
    lat: i => (i % 2 ? 1 : -1) * 90,
    mat: MATS.deckAlt, deckOpt: { edge: NEON.violet, strip: NEON.violet },
  });
  cp = checkpoint(c.x, c.z - c.half - 200 - 210, c.y + 20, "THE VOID", Math.PI, FACING["z-"]);

  /* ---------------- turn D ---------------- */
  c = runway(cp.x, cp.z - 210, cp.y, 'z-');
  c = turn(c.x, c.z - c.half + 75, c.y, 'z-', 'x+', 1050, 6, 52);

  /* ---------------- 5 : THE NEEDLE ---------------- */
  stage("THE NEEDLE", "Beams three hulls wide. The pitch eases off — the landings do not.");
  sign(c.x + 300, c.y + 340, c.z, "5 — THE NEEDLE", { color: NEON.white, rotY: FACING["x+"], w: 540 });
  c = chain(c.x + 130 + 130 + 100, c.z, c.y + 22, 'x+', {
    count: 10, len: 200, wide: 96,                          // 96u beam vs a 32u hull
    gap: i => 130 + i * 7,
    rise: () => 26,
    lat: i => Math.sin(i * 1.15) * 90,
    mat: MATS.beam, deckOpt: { edge: NEON.white, strip: NEON.cyan, stripW: 5 },
  });

  /* ---------------- finish ---------------- */
  stage("FINISH", "");
  {
    const fx = c.x + c.half + 100 + 260, fy = c.y + 24, fz = c.z;
    deck(fx, fz, 520, 520, fy, MATS.finish, { edge: NEON.amber, strip: NEON.amber, stripW: 18 });
    block(fx, fz, 300, 300, fy, 26, MATS.finish, { edge: NEON.amber });
    gate(fx - 210, fz, 430, fy, 300, NEON.amber, { kind: "finish" }, 60);
    sign(fx, fy + 430, fz, "FINISH", { color: NEON.amber, rotY: FACING["x+"], w: 560 });
    pointGlow(fx, fy + 250, fz, NEON.amber, 2.0, 1700);
    MAP.finishPad = { x: fx, y: fy, z: fz };
  }

  /* ---------------- scenery ---------------- */
  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 30; i++) {
    pillar(-1800 + rnd() * 7800, -1500 + rnd() * 7000, 90 + rnd() * 210, -300 + rnd() * 1000, i % 2 ? NEON.violet : NEON.magenta);
  }
  pointGlow(1600, 400, 0, NEON.cyan, 1.4, 3200);
  pointGlow(4400, 1000, 2400, NEON.amber, 1.4, 3200);
  pointGlow(1900, 1500, 4500, NEON.magenta, 1.4, 3200);
  pointGlow(-500, 2000, 2000, NEON.violet, 1.4, 3200);

  return MAP;
}

/* ---------------- route feasibility ---------------- */

/** Horizontal distance a jump covers at `speed`, landing `drop` units below launch. */
export function hopDistance(speed, drop = 0, v0 = MOVE.jumpVel) {
  const g = MOVE.gravity;
  return speed * (v0 + Math.sqrt(Math.max(0, v0 * v0 + 2 * g * drop))) / g;
}

/**
 * Pad-by-pad report of what the course demands.
 *
 * The number that matters is NOT the empty span — it is the centre-to-centre
 * PITCH. In a hop chain you take off from wherever you just landed, so if your
 * hop covers less than the pitch you creep backwards a little every jump and
 * eventually come up short, however wide the gap itself was. `sustain` is the
 * speed at which a hop exactly covers the pitch, and `slack` is how many hops
 * of drift the pads can absorb before that becomes a fall.
 */
export function routeDemand() {
  const out = [];
  for (let i = 1; i < ROUTE.length; i++) {
    const a = ROUTE[i - 1], b = ROUTE[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const pitch = Math.hypot(dx, dz) || 1;
    const ux = dx / pitch, uz = dz / pitch;
    // support radius of each (axis-aligned) pad along the direction of travel
    const halfA = Math.abs(ux) * a.sx / 2 + Math.abs(uz) * a.sz / 2;
    const halfB = Math.abs(ux) * b.sx / 2 + Math.abs(uz) * b.sz / 2;
    const need = Math.max(0, pitch - halfA - halfB);      // the visible gap
    const rise = b.y - a.y;
    const assist = a.assist || null;
    const v0 = assist && assist.vy ? assist.vy : MOVE.jumpVel;
    const airtime = (v0 + Math.sqrt(Math.max(0, v0 * v0 - 2 * MOVE.gravity * rise))) / MOVE.gravity;
    const walked = !!(assist && assist.walk) || need < 1;
    out.push({
      i, from: a, to: b, pitch, need, rise, stage: b.stage, assist, airtime, walked,
      // A pad wider than a standard deck really does give you more room to land
      // in, so an extra-wide transition pad is not as demanding as its raw
      // centre-to-centre pitch suggests.
      sustain: walked ? 0 : Math.max(need, pitch - Math.max(0, halfA - 110) - Math.max(0, halfB - 110)) / airtime,
      rawPitchSpeed: pitch / airtime,
      clear: walked ? 0 : need / airtime,                 // bare minimum to not fall in the hole
      slack: halfB,                                       // landing window on the far pad
    });
  }
  return out;
}

/** The speed each stage asks you to be holding, and the peak of the whole course. */
export function difficultyCurve() {
  const per = new Map();
  for (const d of routeDemand()) {
    if (d.walked) continue;
    const k = MAP.stages[d.stage] ? MAP.stages[d.stage].name : String(d.stage);
    per.set(k, Math.max(per.get(k) || 0, d.sustain));
  }
  return [...per.entries()];
}
