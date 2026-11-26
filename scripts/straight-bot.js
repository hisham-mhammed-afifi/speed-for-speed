// Straight-line bot: holds a highway row at full throttle with heat 3 on (open /?debug first). Logs the chase every 5 s into window.__straight.
(() => {
  const H = window.__HEATLINE__
  const out = (window.__straight = { log: [], over: null })
  H.engine.startGame(0)
  const city0 = H.game.city
  let j0 = 0
  for (let k = 0; k < city0.NH; k++) if (city0.ht[k] === 'highway' && Math.abs(city0.hy[k] - city0.hy[(city0.NH / 2) | 0]) < Math.abs(city0.hy[j0] - city0.hy[(city0.NH / 2) | 0])) j0 = k
  const car = H.game.player.car
  car.place(city0.vx[(city0.NV / 2) | 0], city0.hy[j0] + 6.9, 0)
  car.setSpeed(30)
  H.heat.start('TEST', 1)
  const orig = H.input.poll.bind(H.input)
  H.input.poll = (dt) => {
    const c = orig(dt)
    const p = H.game.player?.car
    if (!p || H.game.state !== 'play') return c
    p.health = 1e6 // the bot has no collision avoidance: keep it alive so the chase rules are what get tested
    const city = H.game.city
    let j = -1
    for (let k = 0; k < city.NH; k++) if (city.ht[k] === 'highway' && (j < 0 || Math.abs(city.hy[k] - p.y) < Math.abs(city.hy[j] - p.y))) j = k
    const err = city.hy[j] + 6.9 - p.y
    let d = Math.atan2(Math.max(-20, Math.min(20, err)) * 0.5, 40) - p.theta
    d = Math.atan2(Math.sin(d), Math.cos(d))
    c.throttle = 1
    c.steer = Math.max(-1, Math.min(1, d * 2.2))
    return c
  }
  const t0 = performance.now()
  const tick = () => {
    const t = (performance.now() - t0) / 1000
    if (H.game.state !== 'play') {
      out.over = { t: +t.toFixed(1), state: H.game.state, level: H.heat.level }
      return
    }
    if (Math.floor(t / 5) > out.log.length)
      out.log.push({ t: Math.round(t), lvl: H.heat.level, evade: +H.heat.evade.toFixed(1), need: H.heat.evadeNeeded, pred: H.heat.predictable, blocks: H.heat.blocks.length, cops: H.game.cops.length, pur: H.game.cops.filter((u) => u.state === 'pursue' || u.state === 'intercept').length, spd: Math.round(p0().speed), km: +(Math.hypot(p0().x, p0().y) / 1000).toFixed(1) })
    requestAnimationFrame(tick)
  }
  const p0 = () => H.game.player.car
  requestAnimationFrame(tick)
})()
