import { clamp } from '../core/math'
import { carGrid } from '../world/carGrid'
import type { Car } from '../physics/car'
import type { City } from '../world/city'

// Shared AI driving helpers: they write into car.ctrl just like the keyboard does for the player.

/** Steer toward a world point (heading error -> steering; the car model already limits yaw to what grip allows). */
export function steerTo(car: Car, tx: number, ty: number): number {
  const dx = tx - car.x,
    dy = ty - car.y
  const fx = Math.cos(car.theta),
    fy = Math.sin(car.theta)
  const lx = dx * fx + dy * fy,
    ly = dx * -fy + dy * fx
  const err = Math.atan2(ly, lx)
  car.ctrl.steer = clamp(err * 2.2, -1, 1)
  return err
}

/** Simple speed controller. */
export function speedTo(car: Car, target: number): void {
  const v = car.vx,
    err = target - v
  const c = car.ctrl
  c.nitro = 0
  c.handbrake = 0
  if (target < 0.2 && v < 1.5) {
    // asked to stop: hold still with the parking brake (the pedal would creep forward, or reverse)
    c.throttle = 0
    c.brake = 0
    c.handbrake = 1
    return
  }
  if (err > 0.6) {
    c.throttle = clamp(err * 0.4, 0.15, 1)
    c.brake = 0
  } else if (err < -1.2) {
    c.throttle = 0
    c.brake = clamp(-err * 0.15, 0, 1)
  } else {
    c.throttle = 0.12
    c.brake = 0
  }
}

/** Building probe: brake and steer away when the path ahead is blocked. Returns true if it intervened. */
export function avoid(car: Car, city: City): boolean {
  const sp = Math.max(car.speed, 1)
  const d = clamp(5 + sp * 0.7, 6, 34)
  const fx = Math.cos(car.theta),
    fy = Math.sin(car.theta)
  if (city.isObstacle(car.x + fx * d, car.y + fy * d) || city.isObstacle(car.x + fx * d * 0.5, car.y + fy * d * 0.5)) {
    const a = 0.55
    const lx = Math.cos(car.theta - a),
      ly = Math.sin(car.theta - a)
    const rx = Math.cos(car.theta + a),
      ry = Math.sin(car.theta + a)
    const lBlocked = city.isObstacle(car.x + lx * d, car.y + ly * d)
    const rBlocked = city.isObstacle(car.x + rx * d, car.y + ry * d)
    car.ctrl.steer = lBlocked && !rBlocked ? 1 : rBlocked && !lBlocked ? -1 : car.ctrl.steer >= 0 ? 1 : -1
    car.ctrl.throttle *= 0.3
    car.ctrl.brake = Math.max(car.ctrl.brake, clamp((sp - 10) / 30, 0, 0.8))
    return true
  }
  return false
}

const nearScratch: Car[] = []

/**
 * Slow down for cars in our way; returns a capped target speed. Only looks at nearby cars (see carGrid).
 * A car that is turning looks along the way it is steering (aimX, aimY: the vector to its steering target), not along its bonnet.
 */
export function capForTraffic(car: Car, target: number, maxLook?: number, aimX?: number, aimY?: number): number {
  let fx = Math.cos(car.theta),
    fy = Math.sin(car.theta)
  if (aimX !== undefined && aimY !== undefined) {
    const al = Math.sqrt(aimX * aimX + aimY * aimY)
    if (al > 1) {
      fx = aimX / al
      fy = aimY / al
    }
  }
  const look = maxLook || 8 + car.speed * 1.3
  const cars = carGrid.query(car.x, car.y, look + 6, nearScratch)
  for (let k = 0; k < cars.length; k++) {
    const o = cars[k]
    if (o === car) continue
    const dx = o.x - car.x,
      dy = o.y - car.y
    const ahead = dx * fx + dy * fy
    const side = dx * -fy + dy * fx // positive: the other car is on our right
    const oncoming = Math.cos(car.theta - o.theta) < -0.3
    // cars are 1.9 m wide and lanes 3.6 m apart: an oncoming car in its own lane passes with room to spare, anything else in our corridor does not
    if (ahead >= 0 && ahead <= look && (Math.abs(side) < (oncoming ? 2.0 : 2.4) || (o.speed < 1.5 && !oncoming && Math.abs(side) < 3.2))) {
      // (a stopped car counts from a little further out to the side: it may be half way through a turn)
      target = Math.min(target, Math.max(0, (ahead - 6.5) * 0.9))
      continue
    }
    // a car coming in from the side (a turn, a merge, a bend) that will reach our path within a couple of seconds
    if (ahead < -3 || o.speed < 1) continue
    if (Math.abs(Math.cos(car.theta - o.theta)) > 0.9) continue // same or opposite flow: the lane check above covers it
    const rvx = o.wvx - car.wvx,
      rvy = o.wvy - car.wvy
    const v2 = rvx * rvx + rvy * rvy
    if (v2 < 1) continue
    const tca = -(dx * rvx + dy * rvy) / v2
    if (tca < 0.1 || tca > 2.5) continue
    const mx = dx + rvx * tca,
      my = dy + rvy * tca
    if (mx * mx + my * my > 3 * 3) continue
    // priority to the right: give way to a car on our right or right ahead (or any that is very close); the one on our left goes first
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (side > -1 || dist < 9) target = Math.min(target, Math.max(0, (dist - 8) * 0.7))
  }
  return target
}
