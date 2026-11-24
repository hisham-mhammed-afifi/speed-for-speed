/** Fixed physics step (120 Hz). */
export const STEP = 1 / 120

export const loop = { paused: false, timeScale: 1 }

/**
 * Fixed-step loop: update() runs at 120 Hz, render() once per animation frame with the interpolation alpha.
 * Returns a function that stops the loop.
 */
export function startLoop(update: (dt: number) => void, render: (alpha: number, dt: number) => void): () => void {
  let last = performance.now()
  let acc = 0
  let raf = 0
  let running = true
  function frame(now: number) {
    if (!running) return
    let dt = (now - last) / 1000
    last = now
    if (dt > 0.1) dt = 0.1
    if (!loop.paused) {
      acc += dt * loop.timeScale
      let n = 0
      while (acc >= STEP && n++ < 12) {
        update(STEP)
        acc -= STEP
      }
      if (acc > STEP * 2) acc = 0
    }
    render(loop.paused ? 1 : acc / STEP, dt)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(raf)
  }
}
