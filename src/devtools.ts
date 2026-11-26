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
import { FX } from './game/render/effects'
import { Renderer } from './game/render/renderer'
import { game } from './game/state'
import { Props } from './game/world/props'
import { World } from './game/world/world'
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
    World,
    FX,
    /** megabytes of offscreen canvas memory the game holds (skid chunks + minimap tiles); it is outside the JS heap, so watch it here */
    canvasMB: () => {
      let px = FX.canvasPixels()
      for (const t of World.cache.values()) if (t.map) px += t.map.width * t.map.height
      return +((px * 4) / 1e6).toFixed(2)
    },
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
