import Matter from 'matter-js'
import { game } from '../state'
import type { Car } from './car'
import type { Building, PropSpot, StaticRec, Wall } from '../types'

const { Engine, Bodies, Body, Composite, Events } = Matter

/**
 * Matter.js owns all motion. World units are metres in the game; Matter works in S units per metre
 * (a car is ~47x19 units, the size range Matter's contact tolerances are tuned for).
 */
const S = 10

/** collision categories: cars, buildings/walls, props. An airborne car only collides with statics. */
const CAT_CAR = 0x0001
const CAT_STATIC = 0x0002
const CAT_PROP = 0x0004

interface PairCollision {
  normal: { x: number; y: number }
  supports?: { x: number; y: number }[]
}

const vel = { x: 0, y: 0 }

/** The Matter body for a static collider, made the first time it is needed (a whole tile of them costs nothing until you get there). */
function staticBody(r: StaticRec): Matter.Body {
  if (!r.body)
    r.body = Bodies.rectangle(r.cx * S, r.cy * S, r.hx * 2 * S, r.hy * 2 * S, {
      isStatic: true,
      friction: 0.3,
      restitution: 0.15,
      label: 'static',
      collisionFilter: { category: CAT_STATIC, mask: 0xffff },
    })
  return r.body as Matter.Body
}

const addBuf: Matter.Body[] = []
const removeBuf: Matter.Body[] = []

/** Static colliders within this many metres of the player are live. Traffic despawns at 420 m, pursuers at 420-700 m. */
const STATIC_RADIUS = 520

export const Phys = {
  S,
  engine: null as Matter.Engine | null,
  cars: [] as Car[],

  /** every static collider in the city; only those near the player are actually in the Matter world (see streamStatics) */
  statics: [] as StaticRec[],

  init(city: { buildings: Building[]; walls: Wall[]; barriers?: Wall[]; waterWalls?: Wall[]; statics?: StaticRec[] }, stream = true): void {
    // Matter's default solver iterations (6 / 4) are plenty for arcade cars and noticeably cheaper than 8 / 6
    const engine = Engine.create({ positionIterations: 6, velocityIterations: 4, enableSleeping: false })
    engine.gravity.x = 0
    engine.gravity.y = 0
    engine.gravity.scale = 0
    Phys.engine = engine
    Phys.cars = []
    if (city.statics) Phys.statics = city.statics
    else {
      const recs: StaticRec[] = []
      const add = (cx: number, cy: number, hx: number, hy: number, always: boolean) => recs.push({ body: null, cx, cy, hx, hy, always, on: false })
      for (const b of city.buildings) add(b.x, b.y, b.hx, b.hy, false)
      for (const w of city.walls) add(w.x, w.y, w.hx, w.hy, true) // the boundary walls: always there
      for (const w of city.barriers ?? []) add(w.x, w.y, w.hx, w.hy, false)
      for (const w of city.waterWalls ?? []) add(w.x, w.y, w.hx, w.hy, false)
      Phys.statics = recs
    }
    // records may be shared with an earlier world (tile data is cached): none of their bodies are in this fresh engine
    for (const r of Phys.statics) r.on = false
    Phys.streaming = stream
    Events.on(engine, 'collisionStart', onCollisionStart)
    Phys.streamStatics(0, 0, stream ? Phys.radius : Infinity)
  },

  /**
   * The window moved: swap in the new list of colliders. Those that left the window come out of the physics world; the new
   * ones come in as streamStatics reaches them (their bodies are created then).
   */
  setStatics(next: StaticRec[], x: number, y: number): void {
    const world = Phys.engine?.world
    const keep = new Set(next)
    const out: Matter.Body[] = []
    for (const r of Phys.statics)
      if (!keep.has(r) && r.on) {
        r.on = false
        if (r.body) out.push(r.body as Matter.Body)
      }
    if (world && out.length) Composite.remove(world, out)
    Phys.statics = next
    Phys.streamStatics(x, y)
  },

  /** false in tests that want every static collider in the world at all times */
  streaming: true,
  /** metres around the player in which static colliders are live (quality tiers adjust this) */
  radius: STATIC_RADIUS,

  /**
   * Keep only the static colliders near (x, y) in the physics world. Matter sweeps every static body every step, and the whole
   * city has over a thousand of them; the moving cars are all within a few hundred metres of the player, so the rest are dead weight.
   * Colliders enter at `radius` and leave at `radius + 80` (hysteresis, so nothing flickers at the edge).
   */
  streamStatics(x: number, y: number, radius?: number): void {
    const world = Phys.engine?.world
    if (!world) return
    const R: number = radius ?? Phys.radius
    const enter = R * R,
      leave = (R + 80) * (R + 80)
    addBuf.length = 0
    removeBuf.length = 0
    const statics = Phys.statics
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i]
      const dx = Math.max(Math.abs(x - s.cx) - s.hx, 0),
        dy = Math.max(Math.abs(y - s.cy) - s.hy, 0)
      const d2 = dx * dx + dy * dy
      if (!s.on && (s.always || d2 <= enter)) {
        s.on = true
        addBuf.push(staticBody(s))
      } else if (s.on && !s.always && d2 > leave) {
        s.on = false
        removeBuf.push(s.body as Matter.Body)
      }
    }
    if (addBuf.length) Composite.add(world, addBuf)
    if (removeBuf.length) Composite.remove(world, removeBuf)
  },

  /** how many static colliders are currently in the physics world */
  staticCount(): number {
    let n = 0
    for (const s of Phys.statics) if (s.on) n++
    return n
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
      collisionFilter: { category: CAT_CAR, mask: 0xffff },
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

  /** Airborne cars only collide with buildings and walls, so they fly over traffic and props. */
  setAirborne(car: Car, on: boolean): void {
    if (car.body) car.body.collisionFilter.mask = on ? CAT_STATIC : 0xffff
  },

  /** Create the physics body for a prop spot (called when the player gets close). */
  addProp(spot: PropSpot): Matter.Body {
    const opts = { frictionAir: 0.05, friction: 0.4, restitution: 0.35, label: 'prop', collisionFilter: { category: CAT_PROP, mask: CAT_CAR | CAT_STATIC | CAT_PROP } }
    let body: Matter.Body
    switch (spot.kind) {
      case 'cone':
        body = Bodies.circle(spot.x * S, spot.y * S, 0.4 * S, opts)
        Body.setMass(body, 8)
        break
      case 'sawhorse':
        body = Bodies.rectangle(spot.x * S, spot.y * S, 1.9 * S, 0.5 * S, opts)
        Body.setMass(body, 25)
        break
      case 'crate':
        body = Bodies.rectangle(spot.x * S, spot.y * S, 1 * S, 1 * S, opts)
        Body.setMass(body, 30)
        break
      default:
        body = Bodies.rectangle(spot.x * S, spot.y * S, 3 * S, 0.35 * S, opts)
        Body.setMass(body, 35)
    }
    Body.setAngle(body, spot.angle)
    body.plugin.prop = spot
    Composite.add(Phys.engine!.world, body)
    return body
  },
  removeProp(body: Matter.Body): void {
    Composite.remove(Phys.engine!.world, body)
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
    // a car meeting a prop is a smash, not a crash: no damage, the prop just flies
    const propSpot: PropSpot | undefined = A.plugin.prop || B.plugin.prop
    if (propSpot) {
      const car = ca || cb
      if (car) game.onPropHit(car, propSpot, car.speed, (ca ? B : A).position.x / S, (ca ? B : A).position.y / S)
      continue
    }
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
