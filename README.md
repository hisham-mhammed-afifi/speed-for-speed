# HEATLINE

An open-city police pursuit racer in HTML + JavaScript (Canvas 2D), with physics by
[Matter.js](https://brm.io/matter-js/) 0.20.0 (MIT, vendored in `js/vendor/matter.min.js`). No build step.

## Run it
Double-click `index.html`, or serve the folder:

```
python -m http.server 8765
```
then open http://localhost:8765. Useful URL flags: `?auto=1&car=0..8&heat=1..5` skips the menus and starts a pursuit; add `&debug` to jump heat levels with the 1-5 keys.

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

## How it works
- `js/physics/world.js` sets up the Matter.js engine (no gravity, 10 units per metre, stepped at 120 Hz). Buildings and
  the city boundary are static bodies; every car is a dynamic body. Collision events report impacts to the game for
  damage, sparks and police heat.
- `js/physics/car.js` is an arcade car on top of a Matter body: each step it turns pedals and steering into an engine
  force, a lateral-grip force (capped, so the car slides and drifts past the limit), drag, and a steering torque, then
  reads the body's position and velocity back after Matter integrates. Gear and RPM shown on the gauges are cosmetic.
- `js/data/cars.js` car specs (top speed, acceleration, grip, turning, mass, durability). Add or swap cars here.
- `js/world/city.js` seeded procedural city (avenues, streets, alleys, parks, buildings) and road graph.
- `js/ai/` A* pathfinding, AI steering, police units (flank / ram / block / PIT), and the heat system
  (roadblocks at heat 3, spike strips at 4, a helicopter at 5).
