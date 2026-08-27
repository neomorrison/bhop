/* Proves bhop_ascent is actually runnable: every gap is checked against what
   the movement can do, and the required speed curve is printed so the map's
   difficulty is a measured number rather than a guess.
   Run:  node --import ./test/register.mjs test/map.test.mjs                 */
import './dom-stub.mjs';
import { MOVE } from '../src/config.js';
import { SOLIDS, RAMPS, TRIGGERS } from '../src/physics.js';
import { buildMap, MAP, ROUTE, routeDemand, difficultyCurve, hopDistance } from '../src/map.js';

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${n}${x ? "  " + x : ""}`); } else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${n}  ${x}`); } };

buildMap();

console.log("\n\x1b[1mbhop_ascent — build\x1b[0m");
ok("world built", SOLIDS.length > 60, `${SOLIDS.length} solids, ${RAMPS.length} ramps, ${TRIGGERS.length} triggers`);
ok("has a start gate", TRIGGERS.some(t => t.kind === "start"));
ok("has a finish gate", TRIGGERS.some(t => t.kind === "finish"));
ok("has 4 checkpoints", MAP.checkpoints.length === 4, MAP.checkpoints.map(c => c.name).join(" -> "));
ok("checkpoint indices are sequential", MAP.checkpoints.every((c, i) => c.i === i));
ok("every checkpoint trigger maps to a checkpoint",
  TRIGGERS.filter(t => t.kind === "checkpoint").every(t => MAP.checkpoints[t.index]),
  `${TRIGGERS.filter(t => t.kind === "checkpoint").length} triggers`);

console.log("\n\x1b[1mspawn & landing pads\x1b[0m");
{
  const s = MAP.spawn;
  const under = SOLIDS.some(b => s.x > b.minX && s.x < b.maxX && s.z > b.minZ && s.z < b.maxZ && Math.abs(b.maxY - s.y) < 1);
  ok("spawn stands on the start floor", under, `(${s.x}, ${s.y}, ${s.z})`);
}
{
  // A pad the hull cannot fit on is a pad you cannot land on.
  const tooNarrow = ROUTE.filter(p => Math.min(p.sx, p.sz) < MOVE.radius * 2 + 8);
  ok("no pad is narrower than the player hull", tooNarrow.length === 0, `narrowest = ${Math.min(...ROUTE.map(p => Math.min(p.sx, p.sz))).toFixed(0)}u vs ${MOVE.radius * 2}u hull`);
}

console.log("\n\x1b[1mroute feasibility\x1b[0m");
const rows = routeDemand();
const hops = rows.filter(r => !r.walked);

ok("no gap asks for more height than a jump gives",
  !hops.some(r => r.rise > 57 + MOVE.duckTuck + 0.5),
  `max rise = ${Math.max(...hops.map(r => r.rise)).toFixed(0)}u vs ${57 + MOVE.duckTuck}u ceiling`);

const ign = hops.filter(r => MAP.stages[r.stage] && MAP.stages[r.stage].name === "IGNITION");
ok("IGNITION is runnable on what the start room can give you", Math.max(...ign.map(r => r.sustain)) <= 400,
  `hardest IGNITION pitch needs ${Math.max(...ign.map(r => r.sustain)).toFixed(0)} u/s held`);

const hardest = hops.reduce((a, b) => b.sustain > a.sustain ? b : a);
ok("nothing asks for more speed than the movement can build", hardest.sustain < 820,
  `peak demand ${hardest.sustain.toFixed(0)} u/s in ${MAP.stages[hardest.stage].name}`);

// A pad you can only land on inside a 40u window is a coin flip, not a jump.
const tight = hops.filter(r => r.slack < 45);
ok("every landing window is wider than the hull", tight.length === 0,
  `narrowest window ${Math.min(...hops.map(r => r.slack)).toFixed(0)}u`);

const curve = difficultyCurve();
let smooth = true;
for (let i = 1; i < curve.length; i++) if (curve[i][1] > curve[i - 1][1] * 1.55 + 40) smooth = false;
ok("difficulty ramps instead of spiking", smooth, curve.map(([n, v]) => `${n}:${v.toFixed(0)}`).join("  "));

console.log("\n\x1b[1mdemand table\x1b[0m   (sustain = speed a hop must hold to cover the pitch)");
console.log("  " + "stage".padEnd(12) + "pitch".padStart(7) + "gap".padStart(7) + "rise".padStart(6) + "air".padStart(7) + "sustain".padStart(9) + "window".padStart(8));
for (const r of hops) {
  const nm = (MAP.stages[r.stage]?.name || "?").padEnd(12);
  console.log(`  ${nm}${r.pitch.toFixed(0).padStart(7)}${r.need.toFixed(0).padStart(7)}${((r.rise >= 0 ? "+" : "") + r.rise.toFixed(0)).padStart(6)}${r.airtime.toFixed(2).padStart(7)}s${r.sustain.toFixed(0).padStart(8)}${r.slack.toFixed(0).padStart(8)}${r.assist ? "  jump pad" : ""}`);
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
