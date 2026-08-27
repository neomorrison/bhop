/* An end-to-end run: a scripted player is dropped on the start line and made
   to bunny-hop the whole course.

   The bot is only ever allowed inputs a human has: forward/side keys, a jump,
   and a yaw it turns at a bounded rate. It never writes to its own velocity
   and never gets a speed it did not strafe for. Before each hop it tries a
   handful of candidate strafes on a COPY of the physics body and takes the
   one that lands furthest along the course — a stand-in for a player who has
   run the map enough times to know the line.

   This is the honest answer to "is bhop_ascent actually completable", and it
   exercises the real loop: physics, collision, triggers and the timer.
   Run:  node --import ./test/register.mjs test/bot.test.mjs                  */
import './dom-stub.mjs';
import { MOVE } from '../src/config.js';
import { makeBody, playerMove, triggersAt } from '../src/physics.js';
import { buildMap, MAP, ROUTE } from '../src/map.js';

const DT = MOVE.tick;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${n}${x ? "  " + x : ""}`); } else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${n}  ${x}`); } };

buildMap();

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const clone = b => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, groundNormal: { ...b.groundNormal } });

/** Which route pad is this landing on? -1 if none. */
function padAt(x, y, z, from, to) {
  for (let i = Math.min(to, ROUTE.length - 1); i >= Math.max(0, from); i--) {
    const p = ROUTE[i];
    const yTol = p.assist && p.assist.walk ? 320 : 24;    // standing on it, not near it (the ramp is one long pad)
    if (Math.abs(y - p.y) > yTol) continue;
    if (x < p.x - p.sx / 2 - 4 || x > p.x + p.sx / 2 + 4) continue;
    if (z < p.z - p.sz / 2 - 4 || z > p.z + p.sz / 2 + 4) continue;
    return i;
  }
  return -1;
}

const SIDES = [-1, 1];
const SWEEPS = [0.20, 0.55, 0.95, 1.45, 2.05];
const OFFSETS = [-0.45, -0.15, 0.15, 0.45];
const MAX_TURN = 9 * DT;                                   // rad/tick ceiling (~515 deg/s)

/**
 * Try each candidate hop on a copy of the body, keep the best.
 * Returns { side, turn, yaw0 } — the inputs to actually play out.
 */
function planHop(body, target, floorY, airborne = false, jitter = 0) {
  const t = ROUTE[Math.min(target, ROUTE.length - 1)];
  const want = yawTo(t.x - body.pos.x, t.z - body.pos.z);
  let best = null, bestScore = -Infinity;

  for (const side of SIDES) for (const sweep of SWEEPS) for (const off0 of OFFSETS) {
    const off = off0 + jitter;
    const est = Math.max(24, Math.round(2 * MOVE.jumpVel / MOVE.gravity / DT));
    let turn = -side * (sweep / est);
    if (Math.abs(turn) > MAX_TURN) turn = Math.sign(turn) * MAX_TURN;
    const yaw0 = want + side * sweep / 2 + off;

    const c = clone(body);
    let yaw = yaw0, dead = false, landedPad = -1, ticks = 0;
    // jump off (or, off a jump pad, we are already in the air with its height)
    if (!airborne) playerMove(c, { forward: 0, side, yaw, jump: true, duck: false, walk: false }, DT);
    while (ticks < 260) {
      ticks++;
      yaw += turn;
      playerMove(c, { forward: 0, side, yaw, jump: false, duck: false, walk: false }, DT);
      if (c.pos.y < floorY) { dead = true; break; }
      if (c.onGround) { landedPad = padAt(c.pos.x, c.pos.y, c.pos.z, target - 2, target + 4); break; }
    }
    if (dead || !c.onGround) continue;

    const speed = Math.hypot(c.vel.x, c.vel.z);
    const nxt = ROUTE[Math.min(target + 1, ROUTE.length - 1)];
    const toNext = Math.hypot(nxt.x - c.pos.x, nxt.z - c.pos.z);
    // furthest pad first, then speed, then set up for the pad after that
    const score = landedPad * 100000 + speed * 40 - toNext;
    if (landedPad >= 0 && score > bestScore) { bestScore = score; best = { side, turn, yaw0, landedPad }; }
  }
  return best;
}

function runBot() {
  const b = makeBody(MAP.spawn.x, MAP.spawn.y, MAP.spawn.z);
  b.onGround = true;
  let yaw = MAP.spawn.yaw, side = 1, turn = 0;
  let target = 1, maxTarget = 1, falls = 0, jumps = 0, top = 0, ticks = 0;
  let time = 0, started = false, finished = false, cpHit = 0;
  let respawn = { ...MAP.spawn }, respawnTarget = 1, braking = 0, replanAir = false, jitter = 0;
  const inside = new Set(); const hits = []; const trace = []; const fallLog = [];
  const MAX = 128 * 400;

  while (ticks < MAX && !finished) {
    ticks++;
    const t = ROUTE[Math.min(target, ROUTE.length - 1)];
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const floorY = (respawn.y) - 500;
    const want = yawTo(t.x - b.pos.x, t.z - b.pos.z);

    let cmd;
    if (b.onGround && speed < MOVE.maxSpeed * 0.94) {
      // Out of spawn (or after a fall) there is nothing to strafe for yet: run
      // on the ground. Jumping here would pin you at the 30 u/s air cap.
      braking = 0;
      yaw = want;
      cmd = { forward: 1, side: 0, yaw, jump: false, duck: false, walk: false };
    } else if (b.onGround) {
      const plan = planHop(b, target, floorY, false, jitter);
      if (plan) {
        braking = 0;
        side = plan.side; turn = plan.turn; yaw = plan.yaw0;
        cmd = { forward: 0, side, yaw, jump: true, duck: false, walk: false };
      } else if (braking < 48) {
        // Carrying too much speed for the pad ahead. Stay down and let friction
        // take some off, then look again — the same call a player makes before
        // a technical section.
        braking++;
        yaw = want;
        cmd = { forward: 0, side: 0, yaw, jump: false, duck: false, walk: false };
      } else {
        braking = 0;
        side = -side; turn = -side * 0.010; yaw = want + side * 0.5;
        cmd = { forward: 0, side, yaw, jump: true, duck: false, walk: false };
      }
    } else if (replanAir) {
      // A jump pad just threw us: the plan we were flying was for an ordinary
      // hop, so pick the strafe for this much longer one instead.
      replanAir = false;
      const plan = planHop(b, target, floorY, true, jitter);
      if (plan) { side = plan.side; turn = plan.turn; yaw = plan.yaw0; }
      cmd = { forward: 0, side, yaw, jump: true, duck: false, walk: false };
    } else {
      yaw += turn;
      cmd = { forward: 0, side, yaw, jump: true, duck: false, walk: false };
    }

    playerMove(b, cmd, DT);
    if (b.jumped) jumps++;
    if (b.speed > top) top = b.speed;
    if (started) time += DT;

    // waypoint advance: whichever pad we are standing on, aim at the next one
    if (b.onGround) {
      const on = padAt(b.pos.x, b.pos.y, b.pos.z, target - 2, target + 4);
      if (on >= 0 && on + 1 > target) { target = Math.min(ROUTE.length - 1, on + 1); if (target > maxTarget) maxTarget = target; }
    }

    /* triggers */
    triggersAt(b.pos, MOVE.radius, b.hullHeight, hits);
    const now = new Set(hits);
    for (const tr of hits) {
      if (inside.has(tr)) continue;
      if (tr.kind === "start" && !started) { started = true; time = 0; }
      else if (tr.kind === "checkpoint" && tr.index === cpHit) {
        cpHit++;
        const cp = MAP.checkpoints[tr.index];
        respawn = { x: cp.x, y: cp.y + 2, z: cp.z, yaw: cp.yaw };
        respawnTarget = ROUTE.findIndex(r => Math.abs(r.x - cp.x) < 1 && Math.abs(r.z - cp.z) < 1);
        trace.push(`  cp${tr.index + 1} ${cp.name.padEnd(11)} @ ${time.toFixed(2)}s   ${Math.round(b.speed)} u/s   ${falls} falls so far`);
      }
      else if (tr.kind === "finish" && cpHit === MAP.checkpoints.length) finished = true;
      else if (tr.kind === "jumppad") { if (b.vel.y < tr.up) b.vel.y = tr.up; b.onGround = false; replanAir = true; }
    }
    for (const tr of [...inside]) if (!now.has(tr)) inside.delete(tr);
    for (const tr of hits) inside.add(tr);

    /* fell off */
    if (b.pos.y < respawn.y - 520 || b.pos.y < -1600) {
      falls++;
      jitter = ((falls * 0.137) % 0.36) - 0.18;   // try a slightly different line each attempt
      if (fallLog.length < 6) fallLog.push(`fall #${falls} heading for waypoint ${target} at (${b.pos.x | 0}, ${b.pos.z | 0})`);
      b.pos.x = respawn.x; b.pos.y = respawn.y; b.pos.z = respawn.z;
      b.vel.x = b.vel.y = b.vel.z = 0; b.onGround = false;
      yaw = respawn.yaw; target = Math.max(1, respawnTarget + 1);
      inside.clear();
      if (falls > 250) break;
    }
  }
  return { finished, started, time, ticks, falls, jumps, top, cpHit, target, maxTarget, fallLog, pos: b.pos, trace };
}

console.log("\n\x1b[1mscripted run — bhop_ascent\x1b[0m");
const r = runBot();
r.trace.forEach(l => console.log("\x1b[36m" + l + "\x1b[0m"));
console.log(`  furthest waypoint ${r.maxTarget}/${ROUTE.length - 1} · ${r.falls} falls · ${r.jumps} jumps · top ${Math.round(r.top)} u/s`);
r.fallLog.forEach(l => console.log("   \x1b[33m" + l + "\x1b[0m"));

ok("the bot crosses the start gate", r.started);
ok("the bot bunny-hops rather than walking", r.jumps > 100, `${r.jumps} jumps`);
ok("hand-strafing alone builds real speed", r.top > 450, `top ${Math.round(r.top)} u/s`);
ok("reaches every checkpoint", r.cpHit === MAP.checkpoints.length, `${r.cpHit}/${MAP.checkpoints.length}`);
ok("finishes the course", r.finished, r.finished ? `in ${r.time.toFixed(2)}s` : `stalled at waypoint ${r.maxTarget}/${ROUTE.length - 1} (${r.pos.x | 0}, ${r.pos.y | 0}, ${r.pos.z | 0})`);
ok("the run is not trivially short", r.time > 15, `${r.time.toFixed(2)}s`);

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
