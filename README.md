# bhop_ascent

A browser **bunny-hop** game. Source-engine movement, run by hand — no auto-strafe, no
speed multipliers, no assists. You get 250 u/s for free and every unit above that you
take one 128Hz tick at a time.

**[▶ Play it here](https://neomorrison.github.io/bhop/)**

Runs from ES modules, so it has to be **served over HTTP** (modules will not load from
`file://`):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## How it actually works

The whole game is one rule, lifted straight out of `CGameMovement::AirAccelerate`:

```js
const wishspd = Math.min(wishspeed, 30);        // <- the entire skill ceiling
const currentspeed = vel.x * wx + vel.z * wz;
const addspeed = wishspd - currentspeed;
if (addspeed <= 0) return;                      // already faster than 30 that way: nothing
```

In the air, the speed you are allowed to *aim for* along the direction you are holding is
clamped to **30 u/s** — but the rate you accelerate toward it is not. So once you are
moving faster than 30 u/s forwards, holding **W** does exactly nothing. The only way to
add speed is to point the wish vector nearly *sideways* of your velocity and keep rotating
it with the mouse, tick after tick: hold **A** and swing the mouse left, or **D** and swing
right, for the whole jump. Flip on the next one.

The per-tick ceiling works out to `sqrt(v² + 30²) − v`, so gains shrink as you get faster
and a run is a long grind rather than a switch you flip. `test/movement.test.mjs` measures it:

```
8 hand-strafed hops:   250 -> 825 u/s   [343, 428, 507, 580, 648, 712, 771, 825]
8 hops holding only W: 250 -> 250 u/s
```

Everything else follows from Source's `FullWalkMove` order — **half gravity → jump →
friction → accelerate → move → categorise → half gravity**. Jumping happens *before*
friction, which is why a frame-perfect hop keeps every unit of speed and why touching down
for a single tick without jumping costs you ~4% of it.

### Why a fixed 128Hz timestep

Air acceleration is a per-tick sum, so at a variable frame rate a 240Hz machine would
strafe measurably faster than a 60Hz one. The simulation runs at a hard 1/128s with an
accumulator, and each frame's mouse movement is split evenly across the ticks it drives.
Rendering interpolates between ticks, so it stays smooth at any refresh rate.

### Auto-hop

On by default, and it is *only* timing — it re-jumps on the tick you land. It never touches
your direction or your speed. Turn it off in the pause menu (`F1`) and time the landings
yourself; the mouse wheel is bound to jump, which is how it is done.

## The map

`bhop_ascent` is a six-stage spiral that climbs ~1700 units above its own start line — from
the last stage you are looking down at the first.

| stage | what it asks for | speed you need to hold |
|---|---|---|
| **IGNITION** | find the rhythm | 387 u/s |
| **ASCENT** | every pad higher than the last; climbing costs airtime | 483 u/s |
| **ZIGZAG** | pads thrown side to side, flip the strafe every hop | 506 u/s |
| **THE VOID** | pitches past 400, plus a jump pad that only buys height | 602 u/s |
| **THE NEEDLE** | 96-unit beams — the gaps ease off, the landings do not | 605 u/s |

Those numbers are measured, not guessed. In a hop chain you take off from wherever you just
landed, so the binding constraint is the **centre-to-centre pitch**, not the visible gap: if
your hop covers less than the pitch you creep backwards a little every jump and eventually
come up short, however wide the hole was. `test/map.test.mjs` computes that for all 116 pads
and fails the build if the curve spikes, if a rise exceeds what a jump can reach, or if a
landing window gets narrower than the player hull.

Falling does not end a run. You go back to the last checkpoint and the clock keeps going —
losing your momentum is the punishment. Every checkpoint is followed by a graded run-up so a
fall is recoverable instead of fatal.

## Controls

| | |
|---|---|
| `W A S D` | move |
| Mouse | look |
| `Space` / mouse wheel / `LMB` | jump |
| `Ctrl` or `C` | duck |
| `R` | restart run · `Q` back to checkpoint |
| `Tab` | records · `Esc` settings |
| `F1` | auto-hop · `F2`/`F3` key + sync display · `M` mute |

The **strafe sync** meter is how much of the theoretically available gain your last few ticks
actually took. It reads your inputs; it does not supply any.

## Tests

```bash
node test/movement.test.mjs                        # the movement model
node --import ./test/register.mjs test/map.test.mjs # every gap on the course
node --import ./test/register.mjs test/bot.test.mjs # a scripted player runs it end to end
```

`bot.test.mjs` is the interesting one: it drops a scripted player on the start line and makes
it bunny-hop the entire course using nothing a human does not have — strafe keys, a jump, and
a yaw it turns at a bounded rate. Before each hop it tries a handful of candidate strafes on a
copy of the physics body and takes the one that lands furthest along. It finishes all five
stages, which is the only honest answer to "is this map completable".

## Project structure

```
index.html      HUD, panels, styles, import map, module entry point
src/
  config.js     movement CVars + user settings
  physics.js    collision volumes + Source PlayerMove. No THREE, no DOM — unit tested
  world.js      materials and builders that emit the mesh AND the matching collider
  map.js        bhop_ascent, plus the route-demand analysis the map test asserts on
  player.js     body + camera (the camera reads the body, never writes to it)
  input.js      keyboard/mouse, pointer lock, per-tick mouse distribution
  timer.js      run state, splits, personal bests (localStorage)
  hud.js        speedometer, clock, key display, sync meter, results
  core.js       renderer, scene, camera, sky, lighting
  fx.js         landing rings, speed lines
  audio.js      synthesised cues — no sample files
  main.js       fixed-timestep loop, trigger dispatch, menus
test/
  movement.test.mjs  physics + collision
  map.test.mjs       route feasibility and the difficulty curve
  bot.test.mjs       full scripted run
```

## Credits

Original game. The movement reproduces the Source-engine model (friction, ground
acceleration and the 30 u/s air wish-speed cap) from public documentation; all geometry, art
and code are original and no Valve assets are used. The renderer/module skeleton is adapted
from the [hvh](https://github.com/neomorrison/hvh) project — the rendering scaffold is the
only thing the two share.
