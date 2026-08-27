/* Headless proof that the movement is Source-accurate and MANUAL.
   Run:  node test/movement.test.mjs                                        */
import { MOVE } from '../src/config.js';
import { clearPhysics, solid, makeBody, playerMove } from '../src/physics.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}${extra ? "  " + extra : ""}`); } else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}  ${extra}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const DT = MOVE.tick;

function ground() { clearPhysics(); solid(-100000, 100000, -64, 0, -100000, 100000, "floor"); }
function spawn() { const b = makeBody(0, 0, 0); b.onGround = true; return b; }
const speed = b => Math.hypot(b.vel.x, b.vel.z);

/* run `ticks` ticks of a command; cmdFn(i, body) may steer the yaw each tick */
function run(b, ticks, cmdFn) {
  for (let i = 0; i < ticks; i++) playerMove(b, cmdFn(i, b), DT);
  return b;
}

console.log("\n\x1b[1mmovement — ground\x1b[0m");
{
  ground(); const b = spawn();
  run(b, 128, () => ({ forward: 1, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  ok("W on ground reaches sv_maxspeed and stops there", near(speed(b), MOVE.maxSpeed, 0.5), `speed=${speed(b).toFixed(1)}`);
}
{
  ground(); const b = spawn(); b.vel.x = 0; b.vel.z = -MOVE.maxSpeed;
  run(b, 64, () => ({ forward: 0, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  ok("friction bleeds speed when no key is held", speed(b) < 40, `speed=${speed(b).toFixed(1)}`);
}
{
  ground(); const b = spawn();
  run(b, 64, () => ({ forward: 0, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  ok("standing still does NOT drift (no auto-forward)", speed(b) === 0, `speed=${speed(b)}`);
}
{
  ground(); const b = spawn();
  playerMove(b, { forward: 0, side: 0, yaw: 0, jump: true, duck: false, walk: false }, DT);
  const apex = (b.vel.y * b.vel.y) / (2 * MOVE.gravity) + b.pos.y;
  ok("jump apex is the CS ~57u", near(apex, 57, 2.5), `apex=${apex.toFixed(1)}u`);
}

console.log("\n\x1b[1mmovement — air: the manual-strafe rule\x1b[0m");
{
  // Airborne at 250 u/s along -Z, holding W and looking the same way.
  ground(); const b = spawn();
  run(b, 128, () => ({ forward: 1, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  const before = speed(b);
  b.onGround = false; b.vel.y = MOVE.jumpVel;
  clearPhysics();                                     // pure air, nothing to land on
  run(b, 90, () => ({ forward: 1, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  const after = speed(b);
  ok("holding W in the air gains NOTHING (airWishCap)", after <= before + 0.01, `${before.toFixed(1)} -> ${after.toFixed(1)} u/s`);
}
{
  // Same launch, but strafing by hand: hold D and rotate the mouse right.
  ground(); const b = spawn();
  run(b, 128, () => ({ forward: 1, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  const before = speed(b);
  b.onGround = false; b.vel.y = MOVE.jumpVel;
  clearPhysics();
  let yaw = 0;
  run(b, 90, () => { yaw -= 0.0075; return { forward: 0, side: 1, yaw, jump: false, duck: false, walk: false }; });
  const after = speed(b);
  ok("hand-strafing (D + mouse) DOES gain speed", after > before + 20, `${before.toFixed(1)} -> ${after.toFixed(1)} u/s`);
}
{
  // Holding a strafe key without turning the mouse must not gain.
  clearPhysics(); const b = makeBody(0, 500, 0); b.vel.z = -250;
  const before = speed(b);
  run(b, 90, () => ({ forward: 0, side: 1, yaw: 0, jump: false, duck: false, walk: false }));
  ok("strafe key alone, no mouse, is not enough", speed(b) < before + 16, `${before.toFixed(1)} -> ${speed(b).toFixed(1)} u/s`);
}
{
  // Turning the mouse without holding a strafe key must not gain either.
  clearPhysics(); const b = makeBody(0, 500, 0); b.vel.z = -250;
  const before = speed(b);
  let yaw = 0;
  run(b, 90, () => { yaw -= 0.0075; return { forward: 0, side: 0, yaw, jump: false, duck: false, walk: false }; });
  ok("mouse alone, no strafe key, is not enough", Math.abs(speed(b) - before) < 0.001, `${before.toFixed(1)} -> ${speed(b).toFixed(1)} u/s`);
}
{
  // Turning the WRONG way while holding D. Source air movement can never slow you
  // down (addspeed clamps at zero) — but the gain has to collapse, or the direction
  // you turn would not matter and the skill would be gone.
  const gainWith = (turn) => {
    clearPhysics(); const b = makeBody(0, 500, 0); b.vel.z = -250;
    const before = speed(b); let yaw = 0;
    run(b, 90, () => { yaw += turn; return { forward: 0, side: 1, yaw, jump: false, duck: false, walk: false }; });
    return speed(b) - before;
  };
  const right = gainWith(-0.0075), wrong = gainWith(+0.0075);
  ok("turning the wrong way collapses the gain", wrong < right * 0.15, `right=+${right.toFixed(1)}  wrong=+${wrong.toFixed(1)} u/s`);
}

console.log("\n\x1b[1mmovement — bunny hopping\x1b[0m");
{
  // Chain jumps with hand-strafing at a realistic mouse speed (~5 rad/s, which is
  // roughly a 285 deg/s flick — an ordinary strafe swing, not a superhuman one).
  ground(); const b = spawn();
  run(b, 128, () => ({ forward: 1, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  const start = speed(b);
  const TURN = 5 * DT;                                  // radians per tick
  let yaw = 0, flip = 1;
  const perHop = [];
  for (let hop = 0; hop < 8; hop++) {
    playerMove(b, { forward: 0, side: flip, yaw, jump: true, duck: false, walk: false }, DT);
    let t = 0;
    while (!b.onGround && t < 400) {
      yaw -= TURN * flip;
      playerMove(b, { forward: 0, side: flip, yaw, jump: true, duck: false, walk: false }, DT);
      t++;
    }
    perHop.push(speed(b));
    flip = -flip;                                       // alternate A / D each hop
  }
  ok("8 hand-strafed hops compound speed", speed(b) > start * 2, `${start.toFixed(0)} -> ${speed(b).toFixed(0)} u/s  [${perHop.map(v => v.toFixed(0)).join(", ")}]`);
  ok("every hop was faster than the last", perHop.every((v, i) => i === 0 || v > perHop[i - 1]), "monotonic");
}
{
  // Same chain but holding only W: must stay flat.
  ground(); const b = spawn();
  run(b, 128, () => ({ forward: 1, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  const start = speed(b);
  for (let hop = 0; hop < 8; hop++) {
    playerMove(b, { forward: 1, side: 0, yaw: 0, jump: true, duck: false, walk: false }, DT);
    let t = 0;
    while (!b.onGround && t < 200) { playerMove(b, { forward: 1, side: 0, yaw: 0, jump: true, duck: false, walk: false }, DT); t++; }
  }
  ok("8 hops holding only W stay at base speed", near(speed(b), start, 1), `${start.toFixed(0)} -> ${speed(b).toFixed(0)} u/s`);
}
{
  // Landing without re-jumping must cost speed (friction tick).
  ground(); const b = spawn();
  run(b, 128, () => ({ forward: 1, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  b.vel.z = -600; b.vel.x = 0;
  playerMove(b, { forward: 0, side: 0, yaw: 0, jump: true, duck: false, walk: false }, DT);
  while (!b.onGround) playerMove(b, { forward: 0, side: 0, yaw: 0, jump: false, duck: false, walk: false }, DT);
  const onLand = speed(b);
  run(b, 16, () => ({ forward: 0, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  ok("sitting on the ground burns the speed you carried", speed(b) < onLand * 0.8, `${onLand.toFixed(0)} -> ${speed(b).toFixed(0)} u/s`);
}

console.log("\n\x1b[1mdeterminism\x1b[0m");
{
  const sim = () => {
    ground(); const b = spawn(); let yaw = 0;
    for (let i = 0; i < 400; i++) { yaw -= 0.006; playerMove(b, { forward: 0, side: 1, yaw, jump: true, duck: false, walk: false }, DT); }
    return speed(b);
  };
  const a = sim(), c = sim();
  ok("identical input gives identical speed (fixed timestep)", a === c, `${a.toFixed(4)}`);
}

console.log("\n\x1b[1mcollision\x1b[0m");
{
  clearPhysics();
  solid(-1000, 1000, -64, 0, -1000, 1000, "floor");
  solid(-1000, 1000, 0, 16, 100, 140, "curb");         // 16u ledge: walk over it
  const b = makeBody(0, 0, 0); b.onGround = true;
  const cmd = { forward: 1, side: 0, yaw: Math.PI, jump: false, duck: false, walk: false };   // +Z
  let mounted = false;
  for (let i = 0; i < 160; i++) { playerMove(b, cmd, DT); if (b.pos.y === 16) mounted = true; }
  ok("walks up a 16u step without jumping", mounted, `mounted=${mounted}`);
  ok("comes back down off the step", b.pos.z > 200 && b.pos.y === 0, `z=${b.pos.z.toFixed(0)} y=${b.pos.y.toFixed(0)}`);
}
{
  clearPhysics();
  solid(-1000, 1000, -64, 0, -1000, 1000, "floor");
  solid(-1000, 1000, 0, 200, 100, 140, "wall");        // 200u wall: blocked
  const b = makeBody(0, 0, 0); b.onGround = true;
  run(b, 120, () => ({ forward: 1, side: 0, yaw: Math.PI, jump: false, duck: false, walk: false }));
  ok("is stopped by a tall wall", b.pos.z < 100 - MOVE.radius + 0.5, `z=${b.pos.z.toFixed(1)}`);
}
{
  clearPhysics();
  solid(-1000, 1000, -64, 0, -1000, 1000, "floor");
  const b = makeBody(0, 0, 0); b.onGround = true;
  b.vel.z = -3000;                                      // fast enough to tunnel a naive mover
  solid(-1000, 1000, 0, 200, -400, -360, "wall");
  run(b, 40, () => ({ forward: 0, side: 0, yaw: 0, jump: false, duck: false, walk: false }));
  ok("does not tunnel through a wall at 3000 u/s", b.pos.z > -360 - MOVE.radius - 1, `z=${b.pos.z.toFixed(1)}`);
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
