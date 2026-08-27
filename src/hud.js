/* ============================== [HUD] ==============================
   Everything on screen that is not the world.  The speedometer is the real
   scoreboard here: in a bhop game the number in the middle of the bottom of
   the screen is the whole feedback loop.                                   */
import { MOVE, SETTINGS } from './config.js';
import { MAP } from './map.js';
import { RUN, RECORDS, formatTime, formatDelta, stageSplit } from './timer.js';

const $ = s => document.querySelector(s);

let el = {};
export function buildHUD() {
  el = {
    speed: $("#speedVal"), speedBar: $("#speedFill"), gain: $("#speedGain"), peak: $("#speedPeak"),
    timer: $("#runTime"), stage: $("#runStage"), pace: $("#runPace"),
    keys: $("#keysOverlay"), sync: $("#syncFill"), syncVal: $("#syncVal"), syncBox: $("#syncBox"),
    pb: $("#pbVal"), splits: $("#splitList"), stats: $("#runStats"),
    center: $("#centerMsg"), feed: $("#splitFeed"), cross: $("#crosshair"),
  };
  buildCrosshair();
  buildKeys();
  refreshPB();
}

function buildCrosshair() {
  const c = el.cross; if (!c) return;
  c.innerHTML = "";
  const mk = css => { const d = document.createElement("div"); d.className = "ch"; d.style.cssText = css; c.appendChild(d); };
  mk("width:2px;height:7px;left:-1px;top:-13px");
  mk("width:2px;height:7px;left:-1px;top:6px");
  mk("width:7px;height:2px;left:-13px;top:-1px");
  mk("width:7px;height:2px;left:6px;top:-1px");
  mk("width:2px;height:2px;left:-1px;top:-1px;opacity:.9");
}

const KEYCELLS = [["", "w", ""], ["a", "s", "d"]];
let keyEls = {};
function buildKeys() {
  const k = el.keys; if (!k) return;
  k.innerHTML = ""; keyEls = {};
  for (const row of KEYCELLS) {
    const r = document.createElement("div"); r.className = "krow";
    for (const name of row) {
      const c = document.createElement("div");
      c.className = "kcell" + (name ? "" : " kblank");
      c.textContent = name.toUpperCase();
      if (name) keyEls[name] = c;
      r.appendChild(c);
    }
    k.appendChild(r);
  }
  const r = document.createElement("div"); r.className = "krow";
  const sp = document.createElement("div"); sp.className = "kcell kwide"; sp.textContent = "SPACE";
  keyEls.jump = sp; r.appendChild(sp);
  const du = document.createElement("div"); du.className = "kcell"; du.textContent = "CTRL";
  keyEls.duck = du; r.appendChild(du);
  k.appendChild(r);
}

/* ---------------- per-frame ---------------- */

const SPEED_TIERS = [
  [MOVE.maxSpeed + 10, "#7d8aa6"],       // nothing earned yet
  [400, "#38f2ff"],
  [560, "#8dff5a"],
  [720, "#ffc23f"],
  [900, "#ff3f8e"],
  [Infinity, "#ffffff"],
];
function speedColor(v) { for (const [lim, c] of SPEED_TIERS) if (v < lim) return c; return "#fff"; }

let gainSmooth = 0;
export function updateHUD(view, dt) {
  const b = view.body;
  const spd = b.speed;

  /* speedometer */
  el.speed.textContent = Math.round(spd);
  const col = speedColor(spd);
  el.speed.style.color = col;
  el.speedBar.style.width = Math.min(100, (spd / 1000) * 100) + "%";
  el.speedBar.style.background = col;
  el.peak.textContent = Math.round(RUN.topSpeed);

  gainSmooth += ((view.gainPerSec || 0) - gainSmooth) * Math.min(1, dt * 9);
  if (b.onGround) {
    el.gain.textContent = "GROUNDED";
    el.gain.style.color = "#7d8aa6";
  } else if (gainSmooth > 4) {
    el.gain.textContent = "+" + Math.round(gainSmooth) + " u/s";
    el.gain.style.color = "#8dff5a";
  } else if (gainSmooth < -4) {
    el.gain.textContent = Math.round(gainSmooth) + " u/s";
    el.gain.style.color = "#ff5a7a";
  } else {
    el.gain.textContent = "no gain";
    el.gain.style.color = "#7d8aa6";
  }

  /* run clock */
  el.timer.textContent = formatTime(RUN.time);
  el.timer.style.color = RUN.state === "running" ? "#fff" : RUN.state === "finished" ? "#ffc23f" : "#7d8aa6";
  const st = MAP.stages[RUN.stage];
  el.stage.textContent = st ? `${RUN.stage > 0 ? RUN.stage + " / " + (MAP.stages.length - 2) + "  ·  " : ""}${st.name}` : "";

  const pace = liveDelta();
  if (pace == null) { el.pace.textContent = RECORDS.best == null ? "no PB yet" : ""; el.pace.style.color = "#7d8aa6"; }
  else { el.pace.textContent = formatDelta(pace); el.pace.style.color = pace <= 0 ? "#8dff5a" : "#ff5a7a"; }

  /* key overlay */
  el.keys.style.display = SETTINGS.showKeys ? "" : "none";
  if (SETTINGS.showKeys && view.keys) {
    const k = view.keys;
    for (const [name, node] of Object.entries(keyEls)) {
      if (!node) continue;
      node.classList.toggle("on", !!k[name]);
    }
    // a strafe key held with no turn is the classic beginner mistake — mark it
    keyEls.a && keyEls.a.classList.toggle("dead", k.a && !b.onGround && (view.turnRate || 0) >= -0.4);
    keyEls.d && keyEls.d.classList.toggle("dead", k.d && !b.onGround && (view.turnRate || 0) <= 0.4);
  }

  /* sync */
  el.syncBox.style.display = SETTINGS.showSync ? "" : "none";
  if (SETTINGS.showSync) {
    const s = Math.round((view.sync || 0) * 100);
    el.sync.style.width = s + "%";
    el.sync.style.background = s > 75 ? "#8dff5a" : s > 45 ? "#ffc23f" : "#ff5a7a";
    el.syncVal.textContent = s + "%";
  }

  el.stats.textContent = `${RUN.jumps} jumps · ${RUN.falls} falls`;
}

function liveDelta() {
  if (RUN.state !== "running" || RECORDS.best == null || !RECORDS.splits.length) return null;
  const i = RUN.splits.length - 1;
  if (i < 0 || RECORDS.splits[i] == null) return null;
  return RUN.splits[i] - RECORDS.splits[i];
}

/* ---------------- messages ---------------- */

let centerT = 0;
export function centerMessage(main, sub = "", secs = 2.2, color = "#fff") {
  el.center.querySelector(".m").textContent = main;
  el.center.querySelector(".s").textContent = sub;
  el.center.querySelector(".m").style.color = color;
  el.center.style.opacity = 1;
  centerT = secs;
}
export function tickMessages(dt) {
  if (centerT > 0) { centerT -= dt; if (centerT <= 0) el.center.style.opacity = 0; }
}

export function splitPopup(title, detail, color = "#8dff5a") {
  const d = document.createElement("div");
  d.className = "split";
  d.innerHTML = `<b style="color:${color}">${title}</b><span>${detail}</span>`;
  el.feed.appendChild(d);
  setTimeout(() => d.remove(), 4200);
  while (el.feed.children.length > 5) el.feed.firstChild.remove();
}

export function refreshPB() {
  if (!el.pb) return;
  fillRecordsPanel();
  el.pb.textContent = RECORDS.best == null ? "--:--.--" : formatTime(RECORDS.best);
  el.splits.innerHTML = "";
  MAP.checkpoints.forEach((cp, i) => {
    const row = document.createElement("div");
    row.className = "srow";
    const best = RECORDS.stageBest[i];
    row.innerHTML = `<span class="sn">${i + 1} ${cp.name}</span><span class="sv" id="sv${i}">${best == null ? "--" : best.toFixed(2)}</span>`;
    el.splits.appendChild(row);
  });
}

function fillRecordsPanel() {
  const body = document.querySelector("#recordsBody");
  if (!body) return;
  const rows = MAP.checkpoints.map((cp, i) => {
    const best = RECORDS.stageBest[i];
    const at = RECORDS.splits[i];
    return `<tr><td>${i + 1}</td><td>${cp.name}</td><td class="num">${best == null ? "--" : best.toFixed(2)}</td><td class="num">${at == null ? "--" : formatTime(at)}</td></tr>`;
  }).join("");
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
      <span style="letter-spacing:2px;font-size:11px">PERSONAL BEST</span>
      <span style="font-size:26px;font-weight:bold;color:#ffc23f;font-family:Consolas,monospace">${formatTime(RECORDS.best)}</span>
    </div>
    <table class="rtable"><thead><tr><th></th><th>stage</th><th class="num">best split</th><th class="num">pb at</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="margin-top:12px;font-size:12px;color:#6d7ba0">${RECORDS.runs || 0} finished run${(RECORDS.runs || 0) === 1 ? "" : "s"} &nbsp;·&nbsp; Tab to close</div>`;
}

/* ---------------- panels ---------------- */

export function showPanel(id) { const p = document.getElementById(id); if (p) p.classList.add("show"); }
export function hidePanel(id) { const p = document.getElementById(id); if (p) p.classList.remove("show"); }
export function panelOpen() { return !!document.querySelector(".panel.show"); }

export function showResults(f) {
  const body = $("#resultsBody");
  const rows = MAP.checkpoints.map((cp, i) => {
    const sp = f.splits[i] == null ? null : f.splits[i] - (i > 0 ? f.splits[i - 1] : 0);
    const best = RECORDS.stageBest[i];
    const isBest = sp != null && best != null && Math.abs(sp - best) < 1e-9;
    return `<tr><td>${i + 1}</td><td>${cp.name}</td><td class="num">${sp == null ? "--" : sp.toFixed(2)}</td>
            <td class="num">${f.splits[i] == null ? "--" : formatTime(f.splits[i])}</td>
            <td class="num ${isBest ? "good" : ""}">${isBest ? "BEST" : ""}</td></tr>`;
  }).join("");
  $("#resultsTitle").textContent = f.pb ? "NEW PERSONAL BEST" : "RUN COMPLETE";
  $("#resultsTitle").style.color = f.pb ? "#8dff5a" : "#ffc23f";
  $("#resultsTime").textContent = formatTime(f.time);
  $("#resultsDelta").textContent = f.delta == null ? "first finish" : formatDelta(f.delta) + " vs previous best";
  $("#resultsDelta").style.color = f.delta == null ? "#7d8aa6" : f.delta <= 0 ? "#8dff5a" : "#ff5a7a";
  body.innerHTML = `<table class="rtable"><thead><tr><th></th><th>stage</th><th class="num">split</th><th class="num">at</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="rmeta">top speed <b>${Math.round(f.topSpeed)}</b> u/s &nbsp;·&nbsp; <b>${f.jumps}</b> jumps &nbsp;·&nbsp; <b>${f.falls}</b> falls</div>`;
  showPanel("resultsPanel");
}
