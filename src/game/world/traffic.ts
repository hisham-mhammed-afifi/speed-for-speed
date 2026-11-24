import { clamp, pick } from '../core/math'
import { avoid, capForTraffic, speedTo, steerTo } from '../ai/drive'
import { TRAFFIC_CARS } from '../data/cars'
import { game } from '../state'
import { carGrid } from './carGrid'
import type { Car } from '../physics/car'
import type { City } from './city'

const nearScratch: Car[] = []

/** Follows the road graph, one lane edge at a time (right-hand traffic). Used by civilians and patrol cops. */
export class LaneDriver {
  city: City
  a: number
  b: number
  next = -1
  speedCap = 12
  stuck = 0
  turnSlow = false
  /** a siren is close: hug the kerb and slow right down */
  pullOver = false
  /** sideways shift (m, positive = right) to dodge a fast car coming up behind */
  nudge = 0

  constructor(city: City, a: number, b: number) {
    this.city = city
    this.a = a
    this.b = b
  }

  pickNext(): number {
    const city = this.city
    let nb = city.neighbors(this.b).filter((n) => n !== this.a)
    if (!nb.length) nb = [this.a]
    const ax = city.nodeX(this.a),
      ay = city.nodeY(this.a),
      bx = city.nodeX(this.b),
      by = city.nodeY(this.b)
    const straight = nb.find((n) => Math.abs((city.nodeX(n) - bx) * (by - ay) - (city.nodeY(n) - by) * (bx - ax)) < 1)
    return straight !== undefined && Math.random() < 0.55 ? straight : nb[(Math.random() * nb.length) | 0]
  }

  control(car: Car, dt: number): void {
    const city = this.city
    let pa = { x: city.nodeX(this.a), y: city.nodeY(this.a) },
      pb = { x: city.nodeX(this.b), y: city.nodeY(this.b) }
    let dx = pb.x - pa.x,
      dy = pb.y - pa.y,
      len = Math.hypot(dx, dy) || 1
    let ux = dx / len,
      uy = dy / len
    let t = (car.x - pa.x) * ux + (car.y - pa.y) * uy
    let toEnd = len - t
    if (toEnd < 45 && this.next < 0) {
      this.next = this.pickNext()
      const cx = city.nodeX(this.next) - pb.x,
        cy = city.nodeY(this.next) - pb.y
      this.turnSlow = Math.abs(cx * ux + cy * uy) < 0.5 * Math.hypot(cx, cy) // a turn, not straight on
    }
    if (toEnd < city.nodeHalfWidth(this.b) * 0.6 + 3 && this.next >= 0) {
      this.a = this.b
      this.b = this.next
      this.next = -1
      this.turnSlow = false
      pa = { x: city.nodeX(this.a), y: city.nodeY(this.a) }
      pb = { x: city.nodeX(this.b), y: city.nodeY(this.b) }
      dx = pb.x - pa.x
      dy = pb.y - pa.y
      len = Math.hypot(dx, dy) || 1
      ux = dx / len
      uy = dy / len
      t = (car.x - pa.x) * ux + (car.y - pa.y) * uy
      toEnd = len - t
    }
    const w = city.edgeWidth(this.a, this.b)
    const off = w * (this.pullOver ? 0.4 : 0.25) + this.nudge
    const la = clamp(6 + car.speed * 0.55, 7, 20)
    const tt = Math.min(Math.max(t, 0) + la, len)
    const tx = pa.x + ux * tt - uy * off,
      ty = pa.y + uy * tt + ux * off
    steerTo(car, tx, ty)
    let target = this.speedCap * (w >= 24 ? 1.3 : w <= 8 ? 0.6 : 1)
    if (this.turnSlow && toEnd < 40) target = Math.min(target, 6.5)
    if (this.pullOver) target = Math.min(target, 3)
    // cross traffic: ease off for a fast car that is about to cross our path at the next intersection
    if (toEnd > 0 && toEnd < 28) {
      const nx = city.nodeX(this.b),
        ny = city.nodeY(this.b)
      const near = carGrid.query(nx, ny, 18, nearScratch)
      for (let i = 0; i < near.length; i++) {
        const o = near[i]
        if (o === car || o.speed < 3) continue
        const along = Math.abs(Math.cos(o.theta) * ux + Math.sin(o.theta) * uy)
        if (along < 0.5) {
          target = Math.min(target, Math.max(0, (toEnd - 8) * 0.6))
          break
        }
      }
    }
    target = capForTraffic(car, target)
    speedTo(car, target)
    avoid(car, city)
    // stuck detection
    if (car.speed < 0.6 && target > 2) this.stuck += dt
    else this.stuck = Math.max(0, this.stuck - dt * 2)
  }
}

export interface Civ {
  car: Car
  driver: LaneDriver
  dead?: number
}

export const Traffic = {
  /** how many civilians to keep around the player (the engine raises/lowers this for phones) */
  target: 45,
  timer: 0,
  tick: 0,

  /** Drive every civilian, recycle far-away ones and spawn new ones near the player. */
  update(dt: number): void {
    Traffic.timer -= dt
    Traffic.tick++
    const pl = game.player.car
    const sirens = game.heat.active ? game.cops.filter((u) => u.state === 'pursue') : []
    const plFast = pl.speed > 18
    for (let i = game.civs.length - 1; i >= 0; i--) {
      const u = game.civs[i],
        car = u.car
      const d = Math.hypot(car.x - pl.x, car.y - pl.y)
      // far-away civilians only think every other step; their last controls simply carry over
      if (d > 250 && (Traffic.tick & 1) === 1 && car.health > 0) continue

      // pull over when a siren is close
      let siren = false
      for (let k = 0; k < sirens.length; k++) {
        const c = sirens[k].car
        const ddx = c.x - car.x,
          ddy = c.y - car.y
        if (ddx * ddx + ddy * ddy < 1600) {
          siren = true
          break
        }
      }
      u.driver.pullOver = siren

      // swerve away from a fast player closing in on our lane
      let wantNudge = 0
      if (plFast && d < 40) {
        const c = Math.cos(car.theta),
          s = Math.sin(car.theta)
        const rx = pl.x - car.x,
          ry = pl.y - car.y
        const ahead = rx * c + ry * s
        const lat = -rx * s + ry * c // + = player is to our right
        if (Math.abs(ahead) < 35 && Math.abs(lat) < 5) wantNudge = -Math.sign(lat || 1) * Math.min(2.2, 0.6 + ((35 - Math.abs(ahead)) / 35) * 1.6)
      }
      u.driver.nudge += (wantNudge - u.driver.nudge) * Math.min(1, 4 * dt * 2)

      u.driver.control(car, d > 250 ? dt * 2 : dt) // far civilians skip every other step, so their timers run double
      if (d > 420 || u.driver.stuck > 7 || car.health <= 0) {
        if (car.health <= 0 && d < 120) {
          car.ctrl.throttle = 0
          car.ctrl.brake = 0.4
          u.dead = (u.dead || 0) + dt
          if (u.dead < 8) continue
        }
        game.removeCar(car)
        game.civs.splice(i, 1)
      }
    }
    if (Traffic.timer <= 0 && game.civs.length < Traffic.target) {
      Traffic.timer = 0.15
      Traffic.spawn()
    }
  },

  spawn(): void {
    const city = game.city,
      pl = game.player.car
    for (let tries = 0; tries < 10; tries++) {
      const n = city.randomNode()
      const nx = city.nodeX(n),
        ny = city.nodeY(n)
      const d = Math.hypot(nx - pl.x, ny - pl.y)
      if (d < 150 || d > 360) continue
      const nb = city.neighbors(n)
      const to = nb[(Math.random() * nb.length) | 0]
      const t = 0.25 + Math.random() * 0.4
      const p = city.lanePoint(n, to, t)
      if (!game.spotFree(p.x, p.y, 12)) continue
      const spec = pick(TRAFFIC_CARS)
      const car = game.spawnCar(spec, p.x, p.y, Math.atan2(p.uy, p.ux), 'civil')
      car.setSpeed(8)
      const drv = new LaneDriver(city, n, to)
      drv.speedCap = 9 + Math.random() * 6
      game.civs.push({ car, driver: drv })
      return
    }
  },
}
