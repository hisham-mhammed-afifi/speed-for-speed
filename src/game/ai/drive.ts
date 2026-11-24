import { clamp } from '../core/math'
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
  if (city.pointInBuilding(car.x + fx * d, car.y + fy * d) || city.pointInBuilding(car.x + fx * d * 0.5, car.y + fy * d * 0.5)) {
    const a = 0.55
    const lx = Math.cos(car.theta - a),
      ly = Math.sin(car.theta - a)
    const rx = Math.cos(car.theta + a),
      ry = Math.sin(car.theta + a)
    const lBlocked = city.pointInBuilding(car.x + lx * d, car.y + ly * d)
    const rBlocked = city.pointInBuilding(car.x + rx * d, car.y + ry * d)
    car.ctrl.steer = lBlocked && !rBlocked ? 1 : rBlocked && !lBlocked ? -1 : car.ctrl.steer >= 0 ? 1 : -1
    car.ctrl.throttle *= 0.3
    car.ctrl.brake = Math.max(car.ctrl.brake, clamp((sp - 10) / 30, 0, 0.8))
    return true
  }
  return false
}

/** Slow down for cars directly ahead; returns a capped target speed. */
export function capForTraffic(car: Car, cars: Car[], target: number, maxLook?: number): number {
  const fx = Math.cos(car.theta),
    fy = Math.sin(car.theta)
  const look = maxLook || 8 + car.speed * 1.3
  for (let k = 0; k < cars.length; k++) {
    const o = cars[k]
    if (o === car) continue
    const dx = o.x - car.x,
      dy = o.y - car.y
    if (Math.abs(dx) > look + 6 || Math.abs(dy) > look + 6) continue
    const ahead = dx * fx + dy * fy
    if (ahead < 0 || ahead > look) continue
    const lat = Math.abs(dx * -fy + dy * fx)
    if (lat < 2.4) target = Math.min(target, Math.max(0, (ahead - 6.5) * 0.9))
  }
  return target
}
