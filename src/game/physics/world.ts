import Matter from 'matter-js'
import { game } from '../state'
import type { Car } from './car'
import type { Building, Wall } from '../types'

const { Engine, Bodies, Body, Composite, Events } = Matter

/**
 * Matter.js owns all motion. World units are metres in the game; Matter works in S units per metre
 * (a car is ~47x19 units, the size range Matter's contact tolerances are tuned for).
 */
const S = 10

interface PairCollision {
  normal: { x: number; y: number }
  supports?: { x: number; y: number }[]
}

const vel = { x: 0, y: 0 }

export const Phys = {
  S,
  engine: null as Matter.Engine | null,
  cars: [] as Car[],

  init(city: { buildings: Building[]; walls: Wall[]; barriers?: Wall[] }): void {
    const engine = Engine.create({ positionIterations: 8, velocityIterations: 6, enableSleeping: false })
    engine.gravity.x = 0
    engine.gravity.y = 0
    engine.gravity.scale = 0
    Phys.engine = engine
    Phys.cars = []
    const statics: Matter.Body[] = []
    const add = (cx: number, cy: number, hx: number, hy: number) =>
      statics.push(Bodies.rectangle(cx * S, cy * S, hx * 2 * S, hy * 2 * S, { isStatic: true, friction: 0.3, restitution: 0.15, label: 'static' }))
    for (const b of city.buildings) add(b.x, b.y, b.hx, b.hy)
    for (const w of city.walls) add(w.x, w.y, w.hx, w.hy)
    for (const w of city.barriers ?? []) add(w.x, w.y, w.hx, w.hy)
    Composite.add(engine.world, statics)
    Events.on(engine, 'collisionStart', onCollisionStart)
  },

  addCar(car: Car): void {
    const s = car.spec
    const body = Bodies.rectangle(car.x * S, car.y * S, s.len * S * 0.97, s.hitW * S, {
      chamfer: { radius: 0.5 * S },
      frictionAir: 0,
      friction: 0.3,
      frictionStatic: 0.5,
      restitution: 0.15,
      label: 'car',
    })
    Body.setMass(body, s.mass)
    Body.setAngle(body, car.theta)
    body.plugin.car = car
    car.body = body
    Composite.add(Phys.engine!.world, body)
    Phys.cars.push(car)
  },

  removeCar(car: Car): void {
    if (!car.body) return
    Composite.remove(Phys.engine!.world, car.body)
    const i = Phys.cars.indexOf(car)
    if (i >= 0) Phys.cars.splice(i, 1)
    car.body = null
  },

  reset(): void {
    for (const c of Phys.cars) if (c.body) Composite.remove(Phys.engine!.world, c.body)
    Phys.cars.length = 0
  },

  setMass(car: Car, mass: number): void {
    if (car.body) Body.setMass(car.body, mass)
  },

  // ---- SI helpers ----
  // Matter: velocity += force / mass * dt_ms^2 (in units per step), so an acceleration a (m/s^2) is a force of m*a*S/1e6.
  applyAccel(body: Matter.Body, ax: number, ay: number): void {
    body.force.x += body.mass * ax * S * 1e-6
    body.force.y += body.mass * ay * S * 1e-6
  },
  applyAngAccel(body: Matter.Body, alpha: number): void {
    body.torque += body.inertia * alpha * 1e-6
  },
  setPose(body: Matter.Body, x: number, y: number, theta: number): void {
    Body.setPosition(body, { x: x * S, y: y * S })
    Body.setAngle(body, theta)
  },
  // velocities in m/s and rad/s; Matter 0.20 normalises them to a 60 Hz base step
  setVelocity(body: Matter.Body, vx: number, vy: number, w: number): void {
    Body.setVelocity(body, { x: (vx * S) / 60, y: (vy * S) / 60 })
    Body.setAngularVelocity(body, (w || 0) / 60)
  },
  getVelocity(body: Matter.Body): { x: number; y: number } {
    const v = Body.getVelocity(body)
    vel.x = (v.x * 60) / S
    vel.y = (v.y * 60) / S
    return vel
  },
  getAngularVelocity(body: Matter.Body): number {
    return Body.getAngularVelocity(body) * 60
  },

  step(dt: number): void {
    Engine.update(Phys.engine!, dt * 1000)
    // keep crash spins plausible
    for (let i = 0; i < Phys.cars.length; i++) {
      const b = Phys.cars[i].body!
      const w = Body.getAngularVelocity(b) * 60
      if (w > 6 || w < -6) Body.setAngularVelocity(b, (w > 0 ? 6 : -6) / 60)
    }
  },
}

// ---- impacts -> damage, sparks, heat ----
function onCollisionStart(ev: Matter.IEventCollision<Matter.Engine>) {
  for (let i = 0; i < ev.pairs.length; i++) {
    const pair = ev.pairs[i]
    const A = pair.bodyA,
      B = pair.bodyB
    const ca: Car | null = A.plugin.car || null
    const cb: Car | null = B.plugin.car || null
    if (!ca && !cb) continue
    const col = (pair as unknown as { collision: PairCollision }).collision
    // orient the normal from A to B, then count only the approaching speed (a bounce apart is not a new hit)
    let nx = col.normal.x,
      ny = col.normal.y
    if ((B.position.x - A.position.x) * nx + (B.position.y - A.position.y) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    const va = ca ? Phys.getVelocity(A) : { x: 0, y: 0 }
    const vax = va.x,
      vay = va.y
    const vb = cb ? Phys.getVelocity(B) : { x: 0, y: 0 }
    const closing = -((vb.x - vax) * nx + (vb.y - vay) * ny)
    if (closing <= 0.3) continue
    const mA = ca ? A.mass : Infinity,
      mB = cb ? B.mass : Infinity
    const e = 1.15 // 1 + restitution
    let dvA = 0,
      dvB = 0
    if (ca && cb) {
      dvA = (closing * e * mB) / (mA + mB)
      dvB = (closing * e * mA) / (mA + mB)
    } else if (ca) dvA = closing * e
    else dvB = closing * e
    const sp = col.supports && col.supports[0] ? col.supports[0] : A.position
    game.onImpact(ca, cb, dvA, dvB, sp.x / S, sp.y / S, nx, ny)
  }
}
