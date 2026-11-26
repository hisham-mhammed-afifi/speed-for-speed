# HEATLINE

An open-city police pursuit racer. React + TypeScript (Vite) for the UI, Canvas 2D for the game world, and
[Matter.js](https://brm.io/matter-js/) 0.20.0 for physics.

## Run it
```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # unit tests (vitest)
npm run lint       # oxlint
```
URL flags: `?auto=1&car=0..8&heat=1..5` skips the menus and starts a pursuit; add `&debug` to jump heat levels with the 1-5 keys.
`window.__HEATLINE__` (dev builds, or `?debug`) exposes the engine, game state and a `step(seconds)` helper for testing.

## Controls
| Key | Action |
|---|---|
| W / Up, S / Down | Throttle, brake then reverse |
| A D / Left Right | Steer |
| Space | Handbrake (drift) |
| Shift | Nitro |
| C | Camera: north-up / heading-up |
| R | Reset car onto the road |
| H | Start a pursuit |
| Esc / P | Pause + options |
| F3 | Debug overlay (Matter.js body outlines, forces) |

Gamepad: left stick, triggers, A = handbrake, X = nitro.

**Phones:** on-screen controls appear on touch devices: drag the left thumb to steer; the right thumb has GAS, BRAKE (hold to reverse),
DRIFT and NITRO; top-left buttons pause and reset. The game asks for fullscreen + landscape where the browser allows it and pauses when you
switch apps.

## Architecture
React owns the UI; the game engine stays imperative (a fixed 120 Hz loop drawing to a canvas) so React never re-renders 60 times a second.
They meet in a small zustand store.

```
src/
  main.tsx, App.tsx          React entry; App picks the screen from the store
  store.ts                   zustand: screen, result, save, HUD snapshot (~10 Hz), toasts, touch flag
  ui/
    GameCanvas.tsx           mounts the engine on the <canvas> (StrictMode-safe)
    screens/                 Loading, Title, Help, CarSelect, PauseMenu, ResultScreen
    hud/HudOverlay.tsx       heat stars, bounty, status, bust/evade meters, toasts, hints
    touch/                   TouchControls (steering pad + buttons), useTouchMode
  game/                      the engine: no React imports
    engine.ts                GameEngine: loop, game flow (start/pause/results), the world context hooks
    state.ts                 the shared `game` context every module reads (keeps imports cycle-free)
    core/                    math, input (keyboard/gamepad/touch), loop, assets, viewport
    data/cars.ts             car specs + car-select stats
    progress/                economy (prices, upgrades, buying), combo (skill chains), daily (challenges and streak)
    physics/                 car.ts (arcade car on a Matter body), world.ts (Matter engine, impacts)
    world/                   city.ts (types, road widths), layout.ts (road lines per tile column/row), tile.ts (one tile: districts, buildings, river, tunnels, jumps), world.ts (the endless world: tile cache and the 3x3 window), traffic.ts (lane drivers), carGrid.ts (spatial grid), props.ts (smashable props)
    ai/                      pathfind (A*), drive, police units, heat (pursuit, roadblocks, spikes, helicopter)
    render/                  camera, effects (particles, skid marks), renderer (world), hudCanvas (speedo, minimap)
public/cars/                 car sprites
public/bikes/                motorcycle sprites (top view and side view each)
public/trucks/               the three lorries of the traffic (top view)
public/world/textures/       sea, sand and rock ground textures; public/world/statues/ (optional) the statue pictures
```

The world is endless. It is an infinite grid of tiles (16 x 16 blocks, about 1.8 km), each generated on demand from `hash(seed, tx, ty)` so the
same place always looks the same. Every tile has its own mix of three districts (downtown towers, an industrial port with container yards,
suburbs with houses and lawns), its own name, and about four in ten have a river with three bridges. Tiles are separated by fast three-lane
highways (28 m wide) that form a grid across the whole world; they are walled with concrete barriers except at ramps, and cross each other in
open interchanges. The game never sees more than a 3 x 3 tile window around the player (`World.build`): when you are 100 m into the next
tile the window is rebuilt around it (`engine.recenter`, about 5-10 ms, with the tiles ahead pre-generated while you approach), node ids of every
car's route are shifted to the new window, and static colliders are streamed in lazily. There are no boundary walls; `createCity()` still builds a
single walled tile for the headless tests.

Living map features: a river that splits the city (crossed only at three bridges), tunnels under buildings that hide you from cops
and the helicopter, launch ramps (go fast enough and you fly; cops can't follow through the air), and construction zones with loose
gravel and smashable cones, sawhorses and park fences (smash one while wanted for a small bounty). Props are streamed in as light
physics bodies near the player, so the world stays cheap.

Scale: one world unit is one metre. Cars are 4.5-5 m long and 1.9 m wide; lanes are about 3.6 m (streets 11 m, avenues 18 m, highway 28 m with a
3 m median, alleys 6 m) and traffic drives in `LANE_OFFSET[roadType]`. Grass tiles cover 4 m, tree canopies are about 4-12 m, and landmark
photo lots are drawn at the size measured from the cars in the pictures (villa 55 m wide, residence 74 m, campus 120 m), never stretched.

Photo art (`public/world/`, drawn by `render/renderer.ts`, listed in `world/worldArt.ts`): top-down tree sprites (8 species, shadows baked from
their silhouettes), seamless grass textures for parks and suburbs lawns, and a few landmark lots (a villa in the suburbs, an office campus in the
port, a green-roof residence downtown). A lot is a photo laid over part of a block, turned and mirrored per placement, with collider rectangles measured
on the picture so you can crash into its roofs; villas are tiled into streets of three or four, and the rest of the block gets ordinary buildings. The source JPGs are not in the repo: `node scripts/build-assets.mjs "<folder>"` cuts out the
backgrounds, makes the grass tile, and writes the optimised WebP files (needs `sharp`, a dev dependency). Missing files fall back to the old
procedural drawing.

Performance: Matter.js only simulates static colliders within 450-520 m of the player (`Phys.streamStatics`, re-run every 0.5 s); the loop runs at
most 4 physics steps per frame so a slow device slows down instead of freezing; cars and police think at 60 Hz (far civilians at 30 Hz); the
speedometer dial, phone speed panel and minimap are cached offscreen. `render/quality.ts` has three tiers (high = 120 Hz physics and all effects;
medium and low = 60 Hz physics, no shadows or glows, less traffic, lower canvas resolution). Phones start on medium; in auto the game steps down
after 2 s of slow frames and back up after 8 s of headroom. Force one with `?quality=high|medium|low|auto` or the pause menu button (saved).

Long sessions: canvas memory is native, not in the JS heap, so it is capped. Skid marks live in at most 12 chunks of 128 m (the farthest is
recycled), minimap canvases are freed when their tile leaves the window, and every offscreen source canvas is CPU-backed
(`core/canvas.ts`, `willReadFrequently`), which avoids a GPU-to-CPU pixel readback on every `drawImage` that made long sessions crawl. Hot
loops allocate nothing per step (`carGrid` hash, A* typed arrays and heap, `hyp` instead of `Math.hypot`), and per-frame scans only visit the
tiles near the view. Soak test: open `/?debug&heat=3`, run `scripts/soak-bot.js` in the page, and read `window.__soak` (frame time, work time,
`canvasMB()` and heap every 10 s); frame time, canvas memory (under about 5 MB) and heap stay flat.

Bends and roundabouts: each tile has five 2 x 2 block parks (`tile.ts`, own random stream; `world/curve.ts` has the Hermite path and its
distance / projection helpers). In a *bend* park the centre crossing and its four inner streets are gone (lawn again), and two sweeping
quarter-turn roads join the mid-side crossings, leaving each street along its own direction. In a *roundabout* park the centre crossing is a
circle with a grass island. Bends are extra graph edges (`city.isCurve / edgeLength / edgeProject / edgePoint`; removed crossings are
`city.isDead`, roundabouts `city.roundAt`), so node ids, A* and recentring are unchanged. Cops aim along a bend, and traps and cut-offs
stay on straight streets.

Traffic that doesn't crash (`world/traffic.ts`, `ai/drive.ts`): every car books a junction (3+ roads) before entering. A booking is granted
only if it doesn't cross the path of one already granted or waiting longer (following cars and straight-through opposite cars share), and only
if the road out of it has room. Cars wait at a stop line well back from the junction with the parking brake on, and drive each turn along a
connector curve from their lane in to their lane out. Roundabouts give way to the ring and exit on a curve. `capForTraffic` also looks
along the steering path and at cars converging from the side (priority to the right). Wedged cars out of sight are recycled. Test:
80 civilians in 330 m of town run 90 s with no civilian-civilian collision (`game.test.ts`).

Chase rules: holding one heading above 30 m/s for 6 s makes you predictable and the evade meter stops filling until you make a real turn
(over 50 degrees), slow down or enter a tunnel; the highway fills it at half rate; a long highway run draws a three-car roadblock 300-400 m
ahead; most new pursuers spawn in a cone ahead of you; patrols that see you join the chase. Traffic is 80 cars on desktop (50 on phones) before
the tier multiplier, with three lanes each way on the highway. Chase and soak bots: `scripts/straight-bot.js`, `scripts/soak-bot.js`.

Police tactics (`ai/tactics.ts`): from heat 2 the dispatcher predicts where you are heading (the road you are on and its straight
continuation) and sends pursuers that can get there first to park across the lanes (amber blinking dots on the minimap). Interceptors
give up if you turn away or get past them. `heat.tactics = false` turns this off for A/B comparisons.

Police memory (`ai/memory.ts`): the game counts how long you hide in each 80 m cell, learns from every run (escapes count double), and
saves it with your progress. While you are out of sight the cops check your remembered hideouts first, and roadblocks and spike strips
go on the street leading into one ahead of you. Faint rings on the minimap show what they remember; the pause menu has "Reset police memory".

Adaptive difficulty (`ai/difficulty.ts`): a 0..1 wanted rating (default 0.4 = baseline) follows your results: quick escapes raise it, early
busts lower it. It scales the cop count, their speed boost and reaction time, how close new units spawn, roadblock/spike frequency, how long
you must stay hidden, and how many units try to cut you off. It shows on the car-select and result screens; the pause menu can freeze it
("Difficulty: Fixed"). `?skill=0..1` overrides it for testing (and is never saved). In a bot test, escape rate fell from 83% (0.1) to 28% (0.4) to 11% (0.9).

## Progression (why there is a next run)
Everything is saved in the browser (`localStorage`, key `heatline.v1`, save format `v: 2`); there is no server.

- **Bounty is only yours if you escape.** An escape banks the whole bounty into your wallet (`cash`); a bust or a wreck loses it.
- **Garage** (`progress/economy.ts`): all cars except the first cost money, and each owned car has four upgrades (engine, tyres, armour,
  nitro, three levels each). `applyUpgrades` returns a modified copy of the car's specs, so the catalogue is never changed and the stat bars
  show the upgrades. Old saves are migrated once: their total banked bounty becomes cash and the last car driven stays unlocked (`save.ts`).
- **Skill combos** (`progress/combo.ts`): near misses (a fast pass within 3.2 m of another car without touching it), drifts, jumps and cop
  takedowns raise a multiplier (x1 to x5) and a chain timer of 4 s. When it runs out the money is banked: onto your bounty during a pursuit
  (so it is at risk, scaled by the heat level) or half of it into your wallet in free roam. Crashing loses the chain. The checks run at 30 Hz
  with no allocation.
- **Daily challenges** (`progress/daily.ts`): three challenges per local date, picked by a seeded hash so everybody gets the same ones that
  day. Each pays once when done; finishing all three keeps a streak (up to +50% rewards).
- Tests cover the migration, buying rules, upgrade maths, daily picks and streak, and the combo and near-miss logic.

## Motorcycles
Three bikes sit in the garage after the cars (`data/cars.ts`, `bike: true`): the Orange Scrambler (dirt bike, best off-road), the Maroon Cruiser and
the Red Fireblade (fastest thing in the game, and fragile). They are narrow and light, turn tighter than any car, and about one vehicle in ten
in traffic is one too (`TRAFFIC_BIKES`).

- **Leaning** (`physics/car.ts`, `render/renderer.ts` `drawBikeBody`): the lean angle follows `atan(speed * yaw rate / g)`, up to about 43 degrees, smoothed
  over 0.12 s, and straightens in the air. It is only a drawing effect: the top picture shifts into the turn and narrows, and the side picture
  shows through as the bike's flank (wheels on the road line, the rider's side swinging out to the lean side). The shadow stays on the road.
- **Crashes**: a hard hit (a change of speed of 16 m/s, about 58 km/h) throws the rider and ends the run as Wrecked; a civilian bike hit that hard stops dead
  and is cleared away. Smaller bumps just hurt (bikes have low durability).
- **Art**: `node scripts/build-assets.mjs "<folder with motorcycle-*.jpg>" --only bikes` cuts the white background out, turns every picture to face left
  and writes 512 px WebP files to `public/bikes/` (top view `race.webp`, side view `race-side.webp`, and the same for `cruiser` and `dirt`).

## Lorries and busier roads
Three lorries only ever drive around in traffic (`TRAFFIC_TRUCKS` in `data/cars.ts`: a pickup 5.4 m, a box truck 7 m, a container truck 9 m). They are
not in the garage or the save. On the road about 1 vehicle in 8 is a lorry (mostly pickups), 1 in 10 a motorcycle, the rest cars; lorries are the
slow ones (speed cap x0.8). The traffic target is now 110 vehicles on desktop and 65 on phones, times the quality tier.

Long vehicles need room, so the spacing in traffic is length-aware:
- `capForTraffic` (`ai/drive.ts`) adds up the two vehicles' half lengths and widths for the following distance, the side corridor and the give-way
  distance, never going below the old fixed numbers (so two cars behave exactly as before).
- `LaneDriver` (`world/traffic.ts`) stops a lorry's nose at the same line as a car's, keeps its junction booking until its tail has cleared the junction
  (`+ 2 * extra` metres, where `extra` is how much longer than a car it is), needs more free road beyond a junction, and keeps closer to the kerb so
  its swing as it straightens up after a turn stays out of the other lane. Lorries also have proper brakes and the same turning circle as a car, so they
  can follow the junction curves.
- The 110-vehicle simulation test (cars, motorcycles and lorries packed into town for 90 s) has no collisions across 40 random seeds.
- Art: `node scripts/build-assets.mjs "<folder>" --only trucks`. The white lorry photos sit on a white backdrop, so their background cut-off is stricter.

## Sea, sand, rock and statue squares
Three photo textures (`public/world/textures/`: sea, sand, rock) are made seamless by `node scripts/build-assets.mjs "<folder>" --only textures`.
- **The river** is the sea: sandy banks (4 m on each side) with the water pattern drifting slowly (one pattern-matrix update per frame, `animateWater`).
- **Sandy lots**: 2 to 4 unbuilt blocks per town in the suburbs and the port are sand (`type: 'sand'`, `SURF.sand`: less grip, 0.78x top speed; the dirt
  bike barely notices it).
- **Rocky hills**: about 4 in 10 roomy plain parks get one or two outcrops (`BuildingKind` `'rock'`), drawn as stacked, shrinking layers of the rock texture
  that lean with the camera like a roof. They are real obstacles (collider, line of sight) and no tree grows out of one.
- **Statue squares**: every town has exactly three, each ON a crossing of two streets or avenues (`Tile.squares`, a `SuperBlock` of kind `'square'`; the
  home town's are the three nearest the start). A square is a roundabout (traffic gives way and circles it like any other, `city.roundAt`) whose island is
  paved and carries a stone fountain basin (moving water), a pedestal and the statue (a `'statue'` building, a collider inside the island). The four blocks
  around the crossing each get a 24 m paved plaza corner (`Block.corner`) with a tree, and no buildings on it (`rest` strips take over the rest of the block).
  Squares are at least 3 crossings apart and never beside a bend, a roundabout, the river, an alley or a highway.
  The island holds the artist's round pictures (`public/world/statues/statue.webp` and `fountain.webp`, cut out of `statues.jpg` and `fountain.jpg` with
  `node scripts/build-assets.mjs "<folder>" --only statues`, which finds the white-on-white disc instead of flood-filling): the three squares of a town
  take turns, statue, fountain, statue (`monumentFor` in `world/worldArt.ts`), and the picture fills the island (`drawMonument`; the fountain's water gets
  faint ripples). The collider is the centre box plus two hidden boxes (`Building.hidden`) forming a cross out to the island's edge, all inside the island.
  If a picture fails to load, a drawn basin, pedestal and bronze figure stand in (`drawStatuePlaceholder`).
  Cops steer round the island, not over it (`ringAim`, `ringSpeed` in `ai/police.ts`: they brake for the ring and take it the shorter way).
- All of this is generated on its own random stream (`seed ^ 0x5a1e5`), so the rest of a town doesn't depend on it.

## Damage (forgiving on purpose)
Players left because every bump cost health and a wreck lost the bounty, so the rules for the player's car are in `physics/damage.ts`:
- a bump under 5 m/s costs nothing; above that `(dv - 5) * 1.2 / durability` (about half the old cost at town speeds, a head-on at 100+ km/h still hurts);
- **free roam can never wreck you**: health stops at 25, and a car repairs itself (+6 per second after 2.5 s without a hit; +1.5 per second after 5 s in a
  pursuit; a "REPAIRING" toast says so);
- a motorcycle rider is thrown off only in a pursuit, at about 80 km/h or more; a combo survives anything lighter than 6 m/s;
- cops and civilians keep the old harsher formula.
Over the same reckless 150 s drive the old build wrecked the car after 5 crashes; the new one takes 28 crashes and ends at full health.

Traffic has a standoff breaker (`LaneDriver.unblock`): a driver that holds the right of way but has not moved for 4 s creeps on at walking pace unless
something is right in front of it, so two cars boxing each other in at a junction or ring sort themselves out.

Tests live next to the code (`src/**/*.test.ts`). The Matter.js physics runs headless in them: 0-100 km/h time, steering stability,
braking and reversing, and a wall crash. Three files:
- `game.test.ts`: unit tests and small simulations (world generation, traffic rules, junctions and roundabouts, economy, combos, damage rules, and the
  110-vehicle town simulation over six fixed random seeds).
- `engine.test.ts`: the REAL engine, headless (`testkit.ts` boots `engine.ts` with a stub canvas and a scripted driver): three minutes of reckless driving
  through the busy town in free roam must never wreck the car and it must repair itself; a pursuit's damage compared with the old rules; bikes, combos
  and the repair toast through the real hooks.
- `squares.test.ts`: the statue squares, geometry in 60+ towns, then cars (two models), all three lorries and a police car through every route of the
  three home squares (hits on the statue, leaving the road, getting out), and 48 vehicles round them for 90 s.

Deployed on Vercel: `vercel.json` runs `npm run build` and serves `dist/`.
