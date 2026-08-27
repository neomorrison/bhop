/* ============================== [CONFIG] ==============================
   Movement CVars and user settings.

   The numbers in MOVE are the Source-engine movement constants (CS:S/CS2
   values where they exist).  They are the whole game: `airWishCap` is what
   makes bunny-hopping a manual skill rather than a button — see physics.js.

   Nothing in here is a "boost" or an assist.  There is deliberately no
   auto-strafe, no directional smoothing and no speed multiplier: every unit
   of velocity a player has, they earned by turning the mouse and holding a
   strafe key at the right time.                                             */

export const MOVE = {
  /* simulation */
  tick: 1 / 128,           // fixed timestep. Air acceleration is per-tick in Source, so
                           // a fixed rate is what makes gains identical on a 60Hz laptop
                           // and a 240Hz monitor.
  maxSubSteps: 20,         // catch-up cap after a stall / tab-out

  /* world */
  gravity: 800,            // sv_gravity
  maxVelocity: 3500,       // sv_maxvelocity — absolute clamp per axis

  /* ground */
  maxSpeed: 250,           // player max ground speed (CS knife speed)
  stopSpeed: 100,          // sv_stopspeed
  friction: 5.2,           // sv_friction
  accelerate: 6.5,         // sv_accelerate
  walkSpeedMul: 0.52,      // Shift
  duckSpeedMul: 0.34,      // fully ducked

  /* air — the heart of bunny-hopping */
  airAccelerate: 100,      // sv_airaccelerate (bhop-server standard)
  airWishCap: 30,          // THE rule. Source clamps the air wish speed to 30 u/s, so
                           // once you already move faster than 30 u/s along the direction
                           // you are holding, that direction gives you nothing. Gaining
                           // speed therefore requires pointing the wish vector sideways
                           // of your velocity and rotating it with the mouse — manual
                           // strafing. Raise this and the game strafes itself; don't.

  /* jumping */
  jumpVel: 301.993,        // gives the CS jump apex of ~57 units at g=800

  /* hull */
  radius: 16,              // half-width of the (square, Source-style) player hull
  standHeight: 72,
  duckHeight: 54,
  eyeStand: 64,
  eyeDuck: 46,
  stepHeight: 18,          // stairs / ledges you walk up without jumping
  duckTuck: 16,            // extra ledge reach from tucking your legs mid-air (crouch-jump)

  /* surfaces */
  walkableNormalY: 0.7,    // cos(45.57°). Steeper than this and you slide instead of stand
                           // — that is what turns a ramp into a launch pad.
};

/* ---------------- user settings (persisted) ---------------- */
const LS_KEY = "bhop.settings.v1";

export const SETTINGS = {
  sensitivity: 2.2,        // ~CS 2.2 @ 800dpi feel
  fov: 90,
  autoHop: true,           // hold Space to re-jump on landing. Jump TIMING only —
                           // it never touches your direction or your speed.
  showKeys: true,
  showSync: true,
  viewRoll: true,          // camera leans into the strafe you are holding
  sound: true,
  crosshair: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(SETTINGS, JSON.parse(raw));
  } catch (e) { /* private mode / disabled storage — defaults are fine */ }
  return SETTINGS;
}
export function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(SETTINGS)); } catch (e) {}
}
