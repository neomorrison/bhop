/* ============================== [TIMER] ==============================
   The run: start gate -> four checkpoints -> finish, with splits, personal
   bests and a fall counter.  Records live in localStorage.

   Falling does not end a run.  You are put back on the last checkpoint and
   the clock keeps going — losing 20 seconds of momentum is the punishment,
   which is exactly the punishment bhop deserves.                           */
import { MAP } from './map.js';

const LS_KEY = "bhop.records.v1";

export const RUN = {
  state: "idle",            // idle | running | finished
  time: 0,
  stage: 0,                 // index into MAP.stages
  splits: [],               // seconds at each checkpoint crossing
  falls: 0,
  jumps: 0,
  topSpeed: 0,
  respawn: null,            // {x,y,z,yaw} — last checkpoint, or spawn
  lastFinish: null,         // {time, splits, falls, topSpeed, pb, delta}
};

export const RECORDS = { best: null, splits: [], stageBest: [], runs: 0 };

export function loadRecords() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(RECORDS, JSON.parse(raw));
  } catch (e) {}
  return RECORDS;
}
function saveRecords() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(RECORDS)); } catch (e) {}
}
export function clearRecords() {
  RECORDS.best = null; RECORDS.splits = []; RECORDS.stageBest = []; RECORDS.runs = 0;
  saveRecords();
}

export function formatTime(t) {
  if (t == null) return "--:--.--";
  const neg = t < 0; t = Math.abs(t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return (neg ? "-" : "") + m + ":" + (s < 10 ? "0" : "") + s.toFixed(2);
}
export function formatDelta(d) {
  if (d == null) return "";
  return (d >= 0 ? "+" : "-") + Math.abs(d).toFixed(2);
}

/* ---------------- lifecycle ---------------- */

export function resetRun() {
  RUN.state = "idle"; RUN.time = 0; RUN.stage = 0;
  RUN.splits = []; RUN.falls = 0; RUN.jumps = 0; RUN.topSpeed = 0;
  RUN.respawn = { ...MAP.spawn };
  RUN.lastFinish = null;
  return RUN.respawn;
}

export function tickRun(dt) {
  if (RUN.state === "running") RUN.time += dt;
}

/** Split time for stage `i`, i.e. how long that stage alone took. */
export function stageSplit(i) {
  const end = RUN.splits[i];
  if (end == null) return null;
  return end - (i > 0 ? RUN.splits[i - 1] : 0);
}

/* ---------------- events (called by main.js from trigger overlaps) ---------------- */

export function onStartGate() {
  if (RUN.state === "running") return null;
  RUN.state = "running"; RUN.time = 0; RUN.stage = 1;
  RUN.splits = []; RUN.falls = 0; RUN.jumps = 0; RUN.topSpeed = 0;
  RUN.respawn = { ...MAP.spawn };
  return { kind: "start" };
}

export function onCheckpoint(index) {
  if (RUN.state !== "running") return null;
  if (RUN.splits[index] != null) return null;              // already taken
  if (index > 0 && RUN.splits[index - 1] == null) return null;   // no skipping ahead
  RUN.splits[index] = RUN.time;

  const cp = MAP.checkpoints[index];
  RUN.respawn = { x: cp.x, y: cp.y + 2, z: cp.z, yaw: cp.yaw };
  RUN.stage = index + 2;                                   // stages[0] is START

  const split = stageSplit(index);
  const best = RECORDS.stageBest[index];
  const isStageBest = best == null || split < best;
  if (isStageBest) { RECORDS.stageBest[index] = split; saveRecords(); }

  return {
    kind: "checkpoint", index, name: cp.name,
    at: RUN.time, split, stageBest: isStageBest,
    pace: RECORDS.splits[index] != null ? RUN.time - RECORDS.splits[index] : null,
  };
}

export function onFinish() {
  if (RUN.state !== "running") return null;
  if (RUN.splits[MAP.checkpoints.length - 1] == null) return null;   // must have run the whole course
  RUN.state = "finished";

  const time = RUN.time;
  const prev = RECORDS.best;
  const pb = prev == null || time < prev;
  if (pb) { RECORDS.best = time; RECORDS.splits = RUN.splits.slice(); }
  RECORDS.runs = (RECORDS.runs || 0) + 1;
  saveRecords();

  RUN.lastFinish = {
    time, splits: RUN.splits.slice(), falls: RUN.falls, jumps: RUN.jumps,
    topSpeed: RUN.topSpeed, pb, delta: prev == null ? null : time - prev, previous: prev,
  };
  return { kind: "finish", ...RUN.lastFinish };
}

/** Fell off. Back to the last checkpoint, clock still running. */
export function onFall() {
  RUN.falls++;
  return RUN.respawn || { ...MAP.spawn };
}

/** How far behind/ahead of the PB pace we are right now, or null. */
export function livePace() {
  if (RUN.state !== "running" || RECORDS.best == null) return null;
  const done = RUN.splits.length ? RUN.splits.length - 1 : -1;
  if (done < 0 || RECORDS.splits[done] == null) return null;
  return RUN.splits[done] - RECORDS.splits[done];
}
