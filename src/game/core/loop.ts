/** Default physics step (120 Hz); the quality tiers may switch the loop to 60 Hz (loop.step). */
export const STEP = 1 / 120

/** Most physics steps run for one rendered frame. More than this and a slow device would spend ever longer catching up. */
export const MAX_STEPS_PER_FRAME = 4

export const loop = {
  paused: false,
  timeScale: 1,
  /** the physics step in use, seconds */
  step: STEP,
  /** smoothed real time between frames, ms (the quality manager watches this) */
  frameMs: 16.7,
  /** smoothed time one frame's update + render actually takes, ms (the real headroom, even when vsync pins the frame rate) */
  workMs: 4,
}

/**
 * Fixed-step loop: update() runs at 120 Hz, render() once per animation frame with the interpolation alpha.
 * If the device can't keep up, the game slows down a little instead of running more and more steps per frame
 * (the "spiral of death" that used to freeze phones). Returns a function that stops the loop.
 */
export function startLoop(update: (dt: number) => void, render: (alpha: number, dt: number) => void): () => void {
  let last = performance.now()
  let acc = 0
  let raf = 0
  let running = true
  function frame(now: number) {
    if (!running) return
    const t0 = performance.now()
    let dt = (now - last) / 1000
    last = now
    if (dt > 0.1) dt = 0.1
    if (dt > 0) loop.frameMs += (Math.min(dt * 1000, 250) - loop.frameMs) * 0.08
    if (!loop.paused) {
      acc += dt * loop.timeScale
      let n = 0
      const step = loop.step
      while (acc >= step && n < MAX_STEPS_PER_FRAME) {
        update(step)
        acc -= step
        n++
      }
      if (acc >= step) acc %= step // out of budget: drop the backlog rather than chase it
    }
    render(loop.paused ? 1 : acc / loop.step, dt)
    loop.workMs += (performance.now() - t0 - loop.workMs) * 0.08
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(raf)
  }
}
