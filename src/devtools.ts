import { engine } from './game/engine'
import { heat } from './game/ai/heat'
import { Difficulty } from './game/ai/difficulty'
import { quality } from './game/render/quality'
import { Memory } from './game/ai/memory'
import { Tactics } from './game/ai/tactics'
import { input } from './game/core/input'
import { loop } from './game/core/loop'
import { Phys } from './game/physics/world'
import { camera } from './game/render/camera'
import { Renderer } from './game/render/renderer'
import { game } from './game/state'
import { Props } from './game/world/props'
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
    input,
    loop,
    Phys,
    camera,
    Renderer,
    Props,
    Tactics,
    Memory,
    quality,
    Difficulty,
    store: useGameStore,
    update: (dt: number) => engine.update(dt),
    step: (seconds: number, dt = 1 / 120) => {
      for (let i = 0; i < seconds / dt; i++) engine.update(dt)
    },
  }
}
