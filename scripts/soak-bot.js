// Soak-test bot, pasted into the page (open /?debug&heat=3 first). It drives the player along the road grid with
// a little slalom and handbrake so tyres leave marks, restarts after a bust, and samples frame time, work time,
// canvas memory and heap every 10 s into window.__soak. Usage: evaluate(soakBot()) then read window.__soak.
(() => {
  const H = window.__HEATLINE__
  const out = (window.__soak = { samples: [], frames: 0, restarts: 0 })
  H.engine.startGame(0)
  const orig = H.input.poll.bind(H.input)
  let t = 0
  H.input.poll = (dt) => {
    const c = orig(dt)
    const car = H.game.player?.car
    if (!car || H.game.state !== 'play') return c
    t += dt
    const city = H.game.city
    let j = 0
    for (let k = 1; k < city.NH; k++) if (Math.abs(city.hy[k] - car.y) < Math.abs(city.hy[j] - car.y)) j = k
    const err = city.hy[j] + 2 - car.y
    const want = Math.atan2(Math.max(-30, Math.min(30, err)) * 0.6, 40)
    let d = want - car.theta
    d = Math.atan2(Math.sin(d), Math.cos(d))
    c.throttle = 1
    c.steer = Math.max(-1, Math.min(1, d * 2.2 + 0.35 * Math.sin(t * 1.7)))
    c.handbrake = Math.sin(t * 0.9) > 0.92 ? 1 : 0
    return c
  }
  let last = performance.now(),
    acc = 0,
    n = 0,
    mark = last
  const tick = (now) => {
    acc += now - last
    n++
    last = now
    out.frames++
    if (H.game.state === 'result' || H.game.state === 'over') {
      out.restarts++
      H.engine.startGame(0)
    }
    if (now - mark >= 10000) {
      out.samples.push({
        s: Math.round((now - out.t0) / 1000),
        fps: +((n * 1000) / (now - mark)).toFixed(1),
        frameMs: +(acc / n).toFixed(2),
        workMs: +H.loop.workMs.toFixed(2),
        canvasMB: H.canvasMB(),
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null,
        km: +(Math.hypot(H.game.player.car.x, H.game.player.car.y) / 1000).toFixed(1),
        heat: H.heat.level,
        cars: H.game.cars.length,
        tier: H.quality.tier ?? H.quality.name,
      })
      acc = 0
      n = 0
      mark = now
    }
    requestAnimationFrame(tick)
  }
  out.t0 = performance.now()
  requestAnimationFrame(tick)
})()
