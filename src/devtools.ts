import { engine } from './game/engine'
import { heat } from './game/ai/heat'
import { loop } from './game/core/loop'
import { Phys } from './game/physics/world'
import { game } from './game/state'
import { useGameStore } from './store'

/**
 * Inspection handle for tests and debugging: `window.__HEATLINE__`.
 * Only available in dev builds, or in production when the URL has `?debug`.
 * `step(seconds)` advances the simulation without waiting for animation frames.
 */
declare global {
  interface Window {
    __HEATLINE__?: unknown
  }
}

if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  window.__HEATLINE__ = {
    engine,
    game,
    heat,
    loop,
    Phys,
    store: useGameStore,
    update: (dt: number) => engine.update(dt),
    step: (seconds: number, dt = 1 / 120) => {
      for (let i = 0; i < seconds / dt; i++) engine.update(dt)
    },
  }
}
