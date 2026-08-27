/* ============================== [MAIN] ==============================
   Boot, the fixed-timestep loop, trigger dispatch and the menus.

   The loop runs the movement at a hard 128Hz no matter what the display is
   doing, and hands each tick an equal slice of the frame's mouse movement.
   Air acceleration is a per-tick sum, so this is what stops a 240Hz machine
   from strafing faster than a 60Hz one.                                    */
import * as THREE from 'three';
import { scene, camera, renderer, setFov } from './core.js';
import { MOVE, SETTINGS, loadSettings, saveSettings } from './config.js';
import { playerMove, triggersAt } from './physics.js';
import { buildMap, MAP } from './map.js';
import { worldStats } from './world.js';
import { view, spawnAt, resetPlayer, beginTick, updateCamera } from './player.js';
import { initInput, buildCommand, consumeLook, clearLook, endFrame, keyState, setSuspended, mouse } from './input.js';
import {
  RUN, RECORDS, loadRecords, clearRecords, resetRun, tickRun,
  onStartGate, onCheckpoint, onFinish, onFall, formatTime, formatDelta,
} from './timer.js';
import {
  buildHUD, updateHUD, tickMessages, centerMessage, splitPopup,
  refreshPB, showPanel, hidePanel, panelOpen, showResults,
} from './hud.js';
import { fxLand, fxJump, fxCheckpoint, fxFinish, fxFall, updateFx, initSpeedLines, updateSpeedLines } from './fx.js';
import { unlockAudio, updateAudio, sfxJump, sfxLand, sfxCheckpoint, sfxFinish, sfxPB, sfxFall, sfxPad, sfxUi } from './audio.js';

const $ = s => document.querySelector(s);
const TICK = MOVE.tick;

let booted = false, paused = false;
let acc = 0, last = performance.now();
const inside = new Set();          // triggers we are currently overlapping
let prevYaw = 0;

/* ============================== triggers ============================== */

const hits = [];
function handleTriggers() {
  const b = view.body;
  triggersAt(b.pos, MOVE.radius, b.hullHeight, hits);
  const now = new Set(hits);

  for (const t of hits) {
    if (inside.has(t)) continue;                  // enter-edge only
    fire(t);
  }
  for (const t of [...inside]) if (!now.has(t)) inside.delete(t);
  for (const t of hits) inside.add(t);
}

function fire(t) {
  const b = view.body;
  switch (t.kind) {
    case "start": {
      if (onStartGate()) {
        centerMessage("GO", MAP.stages[1].hint, 2.0, "#8dff5a");
        sfxUi(); refreshPB();
      }
      break;
    }
    case "checkpoint": {
      const r = onCheckpoint(t.index);
      if (!r) break;
      fxCheckpoint(t.minX / 2 + t.maxX / 2, t.minY, t.minZ / 2 + t.maxZ / 2);
      sfxCheckpoint();
      const paceTxt = r.pace == null ? "" : `<span style="color:${r.pace <= 0 ? "#8dff5a" : "#ff5a7a"}">${formatDelta(r.pace)}</span> `;
      splitPopup(r.name, `${paceTxt}${r.split.toFixed(2)}s${r.stageBest ? "  ★ stage best" : ""}`, r.stageBest ? "#8dff5a" : "#38f2ff");
      const nxt = MAP.stages[RUN.stage];
      centerMessage(formatTime(r.at), nxt ? nxt.name + " — " + nxt.hint : "", 2.6, r.stageBest ? "#8dff5a" : "#fff");
      break;
    }
    case "finish": {
      const f = onFinish();
      if (!f) break;
      fxFinish(MAP.finishPad.x, MAP.finishPad.y, MAP.finishPad.z);
      f.pb ? sfxPB() : sfxFinish();
      refreshPB();
      showResults(f);
      document.exitPointerLock();
      setSuspended(true);
      break;
    }
    case "jumppad": {
      if (b.vel.y < t.up) b.vel.y = t.up;
      b.onGround = false;
      fxJump(b.pos.x, b.pos.y, b.pos.z);
      sfxPad();
      break;
    }
    case "boost": {                                // speed floor, direction untouched
      const s = Math.hypot(b.vel.x, b.vel.z);
      if (s > 1 && s < t.minSpeed) { const k = t.minSpeed / s; b.vel.x *= k; b.vel.z *= k; }
      if (t.up && b.vel.y < t.up) b.vel.y = t.up;
      sfxPad();
      break;
    }
  }
}

/* ============================== per-tick bookkeeping ============================== */

const AIR_CAP2 = MOVE.airWishCap * MOVE.airWishCap;

function postTick() {
  const b = view.body;

  if (b.jumped) { RUN.jumps++; fxJump(b.pos.x, b.pos.y, b.pos.z); sfxJump(); }
  if (b.landed) {
    const impact = Math.min(1, Math.abs(b.vel.y) / 700 + b.speed / 1400);
    fxLand(b.pos.x, b.pos.y, b.pos.z, impact);
    sfxLand(impact);
  }
  if (b.speed > RUN.topSpeed && RUN.state === "running") RUN.topSpeed = b.speed;

  // strafe efficiency: this tick's gain against the theoretical per-tick ceiling
  // (sqrt(v^2 + cap^2) - v, which is what a perfect 90-degree wish vector gives).
  if (!b.onGround) {
    const v = b.prevSpeed;
    const ceiling = Math.sqrt(v * v + AIR_CAP2) - v;
    const eff = ceiling > 1e-6 ? Math.max(0, Math.min(1, b.gain / ceiling)) : 0;
    view.sync += (eff - view.sync) * 0.045;
    view.gainPerSec += (b.gain / TICK - view.gainPerSec) * 0.09;
  } else {
    view.sync += (0 - view.sync) * 0.02;
    view.gainPerSec += (0 - view.gainPerSec) * 0.12;
  }

  handleTriggers();

  // fell off the course — back to the last checkpoint, clock still running
  const floor = (RUN.respawn ? RUN.respawn.y : 0) - 520;
  if (b.pos.y < floor || b.pos.y < -1600) {
    const p = onFall();
    fxFall(b.pos.x, b.pos.y, b.pos.z);
    sfxFall();
    spawnAt(p);
    inside.clear();
    centerMessage("FELL", RUN.state === "running" ? "back to the checkpoint — the clock is still running" : "", 1.6, "#ff5a7a");
  }

  tickRun(TICK);
}

/* ============================== loop ============================== */

/**
 * Advance the simulation by `dt` seconds of wall clock, in whole 128Hz ticks.
 * Split out of the render loop so the exact input -> movement -> trigger path
 * can be driven headlessly (window.BHOP.simulate) instead of only by rAF.
 */
export function simulate(dt) {
  acc += dt;
  let steps = Math.floor(acc / TICK);
  if (steps > MOVE.maxSubSteps) { steps = MOVE.maxSubSteps; acc = steps * TICK; }

  if (steps > 0) {
    const applyLook = consumeLook(view, steps);
    for (let i = 0; i < steps; i++) {
      prevYaw = view.yaw;
      applyLook();
      view.turnRate = (view.yaw - prevYaw) / TICK;
      beginTick();
      const cmd = buildCommand(view, i);
      view.sideInput = cmd.side;
      playerMove(view.body, cmd, TICK);
      postTick();
      acc -= TICK;
    }
    clearLook();
  } else if (mouse.locked) {
    // frame rate above the sim rate: keep aiming instant, the ticks catch up
    const applyLook = consumeLook(view, 1); applyLook(); clearLook();
  }
  endFrame();
  view.keys = keyState();
  return steps;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000); last = now;

  if (booted && !paused) simulate(dt);

  updateCamera(booted ? acc / TICK : 0, dt);
  updateFx(dt);
  updateSpeedLines(view.body.speed, dt);
  if (booted) { updateHUD(view, dt); tickMessages(dt); updateAudio(view.body.speed, !view.body.onGround); }
  renderer.render(scene, camera);
}

/* ============================== menus & keys ============================== */

function pause(on) {
  paused = on;
  setSuspended(on);
  if (on) { acc = 0; showPanel("pausePanel"); document.exitPointerLock(); }
  else { hidePanel("pausePanel"); renderer.domElement.requestPointerLock(); }
}

function restartRun(full = true) {
  const p = full ? resetRun() : (RUN.respawn || MAP.spawn);
  if (full) { inside.clear(); RUN.state = "idle"; }
  spawnAt(p);
  view.sync = 0; view.gainPerSec = 0;
  hidePanel("resultsPanel");
  centerMessage(full ? "RESTART" : "CHECKPOINT", "", 1.0, "#38f2ff");
}

function onKey(code) {
  if (code === "Escape") {
    if ($("#resultsPanel").classList.contains("show")) { hidePanel("resultsPanel"); restartRun(true); setSuspended(false); renderer.domElement.requestPointerLock(); return true; }
    if (booted) { pause(!paused); return true; }
    return false;
  }
  if (!booted || paused) return false;
  switch (code) {
    case "KeyR": restartRun(true); return true;
    case "KeyQ": RUN.falls++; restartRun(false); return true;
    case "Tab": document.querySelector("#recordsPanel").classList.toggle("show"); return true;
    case "F1": SETTINGS.autoHop = !SETTINGS.autoHop; saveSettings(); syncSettingsUI();
      centerMessage("AUTO-HOP " + (SETTINGS.autoHop ? "ON" : "OFF"), SETTINGS.autoHop ? "hold space; timing is handled, direction never is" : "time every landing yourself — mouse wheel is bound to jump", 2.4, "#38f2ff"); return true;
    case "F2": SETTINGS.showKeys = !SETTINGS.showKeys; saveSettings(); syncSettingsUI(); return true;
    case "F3": SETTINGS.showSync = !SETTINGS.showSync; saveSettings(); syncSettingsUI(); return true;
    case "KeyM": SETTINGS.sound = !SETTINGS.sound; saveSettings(); syncSettingsUI(); return true;
  }
  return false;
}

function syncSettingsUI() {
  const set = (id, prop, v) => { const e = $(id); if (e) e[prop] = v; };
  set("#optSens", "value", SETTINGS.sensitivity); set("#optSensVal", "textContent", SETTINGS.sensitivity.toFixed(2));
  set("#optFov", "value", SETTINGS.fov); set("#optFovVal", "textContent", SETTINGS.fov + "°");
  set("#optAutohop", "checked", SETTINGS.autoHop);
  set("#optKeys", "checked", SETTINGS.showKeys);
  set("#optSync", "checked", SETTINGS.showSync);
  set("#optRoll", "checked", SETTINGS.viewRoll);
  set("#optSound", "checked", SETTINGS.sound);
}

function wireSettings() {
  const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
  on("#optSens", "input", e => { SETTINGS.sensitivity = +e.target.value; $("#optSensVal").textContent = SETTINGS.sensitivity.toFixed(2); saveSettings(); });
  on("#optFov", "input", e => { SETTINGS.fov = +e.target.value; $("#optFovVal").textContent = SETTINGS.fov + "°"; setFov(SETTINGS.fov); saveSettings(); });
  on("#optAutohop", "change", e => { SETTINGS.autoHop = e.target.checked; saveSettings(); });
  on("#optKeys", "change", e => { SETTINGS.showKeys = e.target.checked; saveSettings(); });
  on("#optSync", "change", e => { SETTINGS.showSync = e.target.checked; saveSettings(); });
  on("#optRoll", "change", e => { SETTINGS.viewRoll = e.target.checked; saveSettings(); });
  on("#optSound", "change", e => { SETTINGS.sound = e.target.checked; saveSettings(); });
  on("#btnResume", "click", () => pause(false));
  on("#btnRestart", "click", () => { pause(false); restartRun(true); });
  on("#btnWipe", "click", () => { if (confirm("Erase your personal best and all stage records?")) { clearRecords(); refreshPB(); } });
  on("#btnAgain", "click", () => { hidePanel("resultsPanel"); setSuspended(false); restartRun(true); renderer.domElement.requestPointerLock(); });
  on("#btnCloseResults", "click", () => { hidePanel("resultsPanel"); setSuspended(false); restartRun(true); renderer.domElement.requestPointerLock(); });
}

/* ============================== boot ============================== */

function start() {
  if (!booted) {
    buildMap();
    buildHUD();
    initSpeedLines();
    booted = true;
    $("#hud").style.display = "";
  }
  hidePanel("startPanel");
  resetRun();
  resetPlayer();
  inside.clear();
  acc = 0; last = performance.now();
  setSuspended(false);
  unlockAudio();
  renderer.domElement.requestPointerLock();
  centerMessage("BHOP_ASCENT", "run through the green gate to start the clock", 3.0, "#8dff5a");
}

function boot() {
  loadSettings(); loadRecords();
  setFov(SETTINGS.fov);
  wireSettings(); syncSettingsUI();

  initInput(renderer.domElement, {
    onKey,
    onLockChange: locked => {
      if (!locked && booted && !paused && !panelOpen()) pause(true);
    },
  });

  // A hidden tab gets no animation frames. Pause rather than banking wall clock
  // we would then have to burn through in one go on the way back.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && booted && !paused) pause(true);
    else if (!document.hidden) { acc = 0; last = performance.now(); }
  });

  $("#playBtn").addEventListener("click", start);
  $("#playBtn").disabled = false;
  $("#playBtn").textContent = "PLAY";
  const pb = $("#startPB");
  if (pb) pb.textContent = RECORDS.best == null ? "no personal best yet" : "personal best  " + formatTime(RECORDS.best);
  $("#hud").style.display = "none";
}

boot();
requestAnimationFrame(frame);

/* debug surface */
window.BHOP = {
  get view() { return view; }, get RUN() { return RUN; }, get RECORDS() { return RECORDS; },
  MOVE, SETTINGS, MAP, scene, camera, renderer, worldStats,
  simulate, get paused() { return paused; }, get booted() { return booted; },
  tp(x, y, z) { spawnAt({ x, y, z }); return view.body.pos; },
  toCheckpoint(i) { const c = MAP.checkpoints[i]; if (c) spawnAt({ x: c.x, y: c.y + 2, z: c.z, yaw: c.yaw }); },
  /** Drive the player headlessly: a perfect strafe for N ticks (used to sanity-check the course). */
  simStrafe(ticks = 128, turnRatePerSec = 5, side = 1) {
    for (let i = 0; i < ticks; i++) {
      view.yaw -= turnRatePerSec * TICK * side;
      beginTick();
      playerMove(view.body, { forward: 0, side, yaw: view.yaw, jump: true, duck: false, walk: false }, TICK);
      postTick();
    }
    return { speed: view.body.speed, pos: { ...view.body.pos } };
  },
};
