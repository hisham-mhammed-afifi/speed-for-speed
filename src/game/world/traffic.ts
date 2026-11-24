import { clamp, pick } from '../core/math'
import { avoid, capForTraffic, speedTo, steerTo } from '../ai/drive'
import { PLAYER_CARS } from '../data/cars'
import { game } from '../state'
import type { Car } from '../physics/car'
import type { City } from './city'

/** Follows the road graph, one lane edge at a time (right-hand traffic). Used by civilians and patrol cops. */
export class LaneDriver {
  city: City
  a: number
  b: number
  next = -1
  speedCap = 12
  stuck = 0
  turnSlow = false

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

  control(car: Car, dt: number, cars: Car[]): void {
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
    const off = w * 0.25
    const la = clamp(6 + car.speed * 0.55, 7, 20)
    const tt = Math.min(Math.max(t, 0) + la, len)
    const tx = pa.x + ux * tt - uy * off,
      ty = pa.y + uy * tt + ux * off
    steerTo(car, tx, ty)
    let target = this.speedCap * (w >= 24 ? 1.3 : w <= 8 ? 0.6 : 1)
    if (this.turnSlow && toEnd < 40) target = Math.min(target, 6.5)
    target = capForTraffic(car, cars, target)
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
  target: 22,
  timer: 0,

  /** Drive every civilian, recycle far-away ones and spawn new ones near the player. */
  update(dt: number): void {
    Traffic.timer -= dt
    const pl = game.player.car
    for (let i = game.civs.length - 1; i >= 0; i--) {
      const u = game.civs[i],
        car = u.car
      u.driver.control(car, dt, game.cars)
      const d = Math.hypot(car.x - pl.x, car.y - pl.y)
      if (d > 560 || u.driver.stuck > 7 || car.health <= 0) {
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
      Traffic.timer = 0.25
      Traffic.spawn()
    }
  },

  spawn(): void {
    const city = game.city,
      pl = game.player.car
    for (let tries = 0; tries < 8; tries++) {
      const n = city.randomNode()
      const nx = city.nodeX(n),
        ny = city.nodeY(n)
      const d = Math.hypot(nx - pl.x, ny - pl.y)
      if (d < 200 || d > 430) continue
      const nb = city.neighbors(n)
      const to = nb[(Math.random() * nb.length) | 0]
      const t = 0.25 + Math.random() * 0.4
      const p = city.lanePoint(n, to, t)
      if (!game.spotFree(p.x, p.y, 12)) continue
      const spec = pick(PLAYER_CARS)
      const car = game.spawnCar(spec, p.x, p.y, Math.atan2(p.uy, p.ux), 'civil')
      car.setSpeed(8)
      const drv = new LaneDriver(city, n, to)
      drv.speedCap = 9 + Math.random() * 6
      game.civs.push({ car, driver: drv })
      return
    }
  },
}
