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
    physics/                 car.ts (arcade car on a Matter body), world.ts (Matter engine, impacts)
    world/                   city.ts (procedural city: districts, highway ring, river, tunnels, jumps, road graph), traffic.ts (lane drivers), carGrid.ts (spatial grid), props.ts (smashable props)
    ai/                      pathfind (A*), drive, police units, heat (pursuit, roadblocks, spikes, helicopter)
    render/                  camera, effects (particles, skid marks), renderer (world), hudCanvas (speedo, minimap)
public/cars/                 car sprites
```

The city has three districts (downtown towers, an industrial port with container yards, suburbs with houses and lawns) picked by a seeded
Voronoi map, ringed by a fast three-lane highway that is walled off with concrete barriers except at a few ramps.

Living map features: a river that splits the city (crossed only at three bridges), tunnels under buildings that hide you from cops
and the helicopter, launch ramps (go fast enough and you fly; cops can't follow through the air), and construction zones with loose
gravel and smashable cones, sawhorses and park fences (smash one while wanted for a small bounty). Props are streamed in as light
physics bodies near the player, so the world stays cheap.

Police tactics (`ai/tactics.ts`): from heat 2 the dispatcher predicts where you are heading (the road you are on and its straight
continuation) and sends pursuers that can get there first to park across the lanes (amber blinking dots on the minimap). Interceptors
give up if you turn away or get past them. `heat.tactics = false` turns this off for A/B comparisons.

Tests live next to the code (`src/**/*.test.ts`). The Matter.js physics runs headless in them: 0-100 km/h time, steering stability,
braking and reversing, and a wall crash.

Deployed on Vercel: `vercel.json` runs `npm run build` and serves `dist/`.
