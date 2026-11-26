import { vi } from 'vitest'
import { engine } from './engine'
import { heat } from './ai/heat'
import { input } from './core/input'
import { Phys } from './physics/world'
import { game } from './state'
import { Traffic } from './world/traffic'
import { World } from './world/world'
import type { Car } from './physics/car'
import type { Controls } from './types'

// Shared helpers for the headless scenario tests: they run the REAL engine (engine.ts, traffic, police, physics, damage) without a browser.

/** A reproducible Math.random (traffic and police choose routes with it). Returns a function that puts the real one back. */
export function seedRandom(seed: number): () => void {
  const real = Math.random
  let s = seed >>> 0
  Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  return () => {
    Math.random = real
  }
}

/** The engine draws skid marks into offscreen canvases: give it a canvas that does nothing. */
export function stubCanvas(): void {
  const ctx2d = new Proxy({} as object, { get: () => () => ({}), set: () => true })
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) })
}

export interface Sim {
  /** advance the real update loop by `secs` seconds (120 Hz steps) */
  run(secs: number): void
  /** what the driver does right now; replaced by the scenario */
  drive: (car: Car, t: number) => Partial<Controls>
  t: number
}

const eng = engine as unknown as {
  installGameHooks(): void
  update(dt: number): void
  saveData: { owned: string[] }
}

/**
 * Start a fresh game in the home town with the engine's own hooks installed. Everything is the real thing: traffic, patrols, the pursuit,
 * the damage rules. `car` is the index in PLAYER_CARS (every car is unlocked for the test).
 */
export function bootEngine(car = 0): Sim {
  stubCanvas()
  World.init()
  game.city = World.build(0, 0, 1)
  Phys.init(game.city)
  eng.installGameHooks()
  game.heat = heat
  heat.reset()
  Traffic.clearHolds()
  eng.saveData.owned = ['silver', 'rose', 'blacksuv', 'bluecross', 'red', 'green', 'white', 'orange', 'graphite', 'dirt', 'cruiser', 'race']
  engine.startGame(car)
  const sim: Sim = {
    t: 0,
    drive: () => ({}),
    run(secs) {
      const dt = 1 / 120
      for (let i = 0; i < secs * 120; i++) {
        sim.t += dt
        eng.update(dt)
        if (game.state !== 'play') return
      }
    },
  }
  vi.spyOn(input, 'poll').mockImplementation(() => {
    const c = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 }
    if (game.player) Object.assign(c, sim.drive(game.player.car, sim.t))
    return c as never
  })
  return sim
}

/** A reckless driver: flat out along the nearest east-west road with a weave, braking for nothing. */
export function recklessDriver(car: Car, t: number): Partial<Controls> {
  const city = game.city
  let j = 0
  for (let k = 1; k < city.NH; k++) if (Math.abs(city.hy[k] - car.y) < Math.abs(city.hy[j] - car.y)) j = k
  const err = city.hy[j] + 2 - car.y
  const want = Math.atan2(Math.max(-30, Math.min(30, err)) * 0.6, 40)
  let d = want - car.theta
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return { throttle: 1, steer: Math.max(-1, Math.min(1, d * 2.2 + 0.5 * Math.sin(t * 1.7))), handbrake: Math.sin(t * 0.9) > 0.92 ? 1 : 0 }
}

/** Record every impact the player is in (change of speed in m/s), before the engine's own handler sees it. */
export function recordPlayerHits(): number[] {
  const hits: number[] = []
  const real = game.onImpact
  game.onImpact = (a, b, dvA, dvB, x, y, nx, ny) => {
    const pl = game.player?.car
    if (pl && (a === pl || b === pl)) hits.push(a === pl ? dvA : dvB)
    real(a, b, dvA, dvB, x, y, nx, ny)
  }
  return hits
}
