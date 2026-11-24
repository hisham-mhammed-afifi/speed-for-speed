import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findPath } from './ai/pathfind'
import { ALL_CAR_FILES, estimate, PLAYER_CARS, POLICE_SPEC, TRAFFIC_CARS } from './data/cars'
import { Car } from './physics/car'
import { Phys } from './physics/world'
import { game } from './state'
import { carGrid } from './world/carGrid'
import { createCity, RAMPS, SURF } from './world/city'
import type { Building } from './types'

const DT = 1 / 120

describe('car data', () => {
  it('has nine player cars plus a police car, all with sprites', () => {
    expect(PLAYER_CARS).toHaveLength(9)
    expect(POLICE_SPEC.police).toBe(true)
    expect(ALL_CAR_FILES).toContain(POLICE_SPEC.file)
    expect(new Set(PLAYER_CARS.map((c) => c.id)).size).toBe(9)
  })

  it('Silver GT does 0-100 km/h in about 4.4 s', () => {
    const silver = PLAYER_CARS.find((c) => c.id === 'silver')!
    expect(estimate(silver).t100).toBeGreaterThan(4.2)
    expect(estimate(silver).t100).toBeLessThan(4.7)
  })

  it('spreads top speed across the roster (SUV slowest, White Lightning fastest)', () => {
    const top = (id: string) => PLAYER_CARS.find((c) => c.id === id)!.top * 3.6
    expect(top('blacksuv')).toBeLessThan(215)
    expect(top('white')).toBeGreaterThan(265)
  })
})

describe('city', () => {
  it('is deterministic for a given seed and differs between seeds', () => {
    const a = createCity(123),
      b = createCity(123),
      c = createCity(456)
    expect(a.buildings.length).toBe(b.buildings.length)
    expect(a.buildings[0].x).toBe(b.buildings[0].x)
    expect(a.vx).toEqual(b.vx)
    expect(c.vx).not.toEqual(a.vx)
  })

  it('classifies roads, sidewalks and parks, and blocks line of sight through buildings', () => {
    const city = createCity()
    const road = city.nodeX(city.nodeId(8, 8))
    expect(city.surfaceAt(road, city.nodeY(city.nodeId(8, 8))).kind).toBe('asphalt')
    const b = city.buildings[0]
    expect(city.pointInBuilding(b.x, b.y)).toBe(true)
    expect(city.hasLOS(b.x0 - 20, b.y, b.x1 + 20, b.y)).toBe(false)
  })
})

describe('pathfinding', () => {
  it('finds a connected path across the city', () => {
    const city = createCity()
    const start = city.nodeId(0, 0),
      goal = city.nodeId(city.NV - 1, city.NH - 1)
    const path = findPath(city, start, goal)!
    expect(path[0]).toBe(start)
    expect(path[path.length - 1]).toBe(goal)
    for (let i = 1; i < path.length; i++) expect(city.neighbors(path[i - 1])).toContain(path[i])
    // Manhattan-style grid: no shorter route than (NV-1)+(NH-1) hops
    expect(path.length - 1).toBe(city.NV - 1 + city.NH - 1)
  })

  it('returns a single node when start equals goal', () => {
    expect(findPath(createCity(), 5, 5)).toEqual([5])
  })
})

describe('Matter.js car physics (headless)', () => {
  const impact = vi.fn()

  beforeEach(() => {
    impact.mockClear()
    game.onImpact = impact
  })

  function spawn(spec = PLAYER_CARS[0], x = 0, y = 0, theta = 0): Car {
    const car = new Car(spec, 'player')
    Phys.addCar(car)
    car.place(x, y, theta)
    return car
  }
  function drive(car: Car, seconds: number, ctrl: Partial<Car['ctrl']>): void {
    Object.assign(car.ctrl, { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 }, ctrl)
    for (let i = 0; i < seconds / DT; i++) {
      car.applyControls(DT, SURF.asphalt)
      Phys.step(DT)
      car.readBack()
    }
  }

  it('accelerates to 100 km/h in about 4.4 s and keeps going toward top speed', () => {
    Phys.init({ buildings: [], walls: [] })
    const car = spawn()
    let t = 0
    car.ctrl.throttle = 1
    while (car.speed * 3.6 < 100 && t < 10) {
      car.applyControls(DT, SURF.asphalt)
      Phys.step(DT)
      car.readBack()
      t += DT
    }
    expect(t).toBeGreaterThan(4.0)
    expect(t).toBeLessThan(4.9)
    drive(car, 20, { throttle: 1 })
    expect(car.speed * 3.6).toBeGreaterThan(200)
    expect(car.speed).toBeLessThanOrEqual(car.spec.top * 1.01)
  })

  it('brakes to a stop and then reverses', () => {
    Phys.init({ buildings: [], walls: [] })
    const car = spawn()
    car.setSpeed(30)
    drive(car, 6, { brake: 1 })
    expect(car.vx).toBeLessThan(0) // held S: stopped, then backing up
  })

  it('steers without spinning out at speed, and a handbrake drift produces sideslip', () => {
    Phys.init({ buildings: [], walls: [] })
    const car = spawn()
    car.setSpeed(28)
    drive(car, 3, { throttle: 1, steer: 1 })
    expect(Math.abs(car.w)).toBeLessThan(1.2)
    const drift = spawn(PLAYER_CARS[0], 5000, 5000)
    drift.setSpeed(22)
    drive(drift, 0.5, { throttle: 1, steer: 1, handbrake: 1 })
    expect(Math.abs(Math.atan2(drift.vy, drift.vx))).toBeGreaterThan(0.15)
  })

  it('stops at a building without tunnelling and reports the impact', () => {
    const wall: Building = {
      x: 100, y: 0, theta: 0, hx: 20, hy: 20, kind: 'tower', x0: 80, y0: -20, x1: 120, y1: 20, height: 30, roof: '', wall: '', props: [], hasHeli: false, stamp: 0,
    }
    Phys.init({ buildings: [wall], walls: [] })
    const car = spawn(PLAYER_CARS[0], 40, 0, 0)
    car.setSpeed(100 / 3.6)
    drive(car, 3, {})
    expect(car.x + car.hx).toBeLessThanOrEqual(wall.x0 + 0.5) // never inside the building
    expect(car.speed).toBeLessThan(2)
    expect(impact).toHaveBeenCalled()
    // Matter may report the static building as bodyA or bodyB; the engine handles both orders
    const [a, b, dvA, dvB] = impact.mock.calls[0]
    expect([a, b]).toContain(car)
    expect([a, b]).toContain(null)
    const carDv = a === car ? dvA : dvB
    expect(carDv).toBeGreaterThan(25) // ~100 km/h crash
  })

  it('removing a car takes its body out of the world', () => {
    Phys.init({ buildings: [], walls: [] })
    const car = spawn()
    const before = Phys.engine!.world.bodies.length
    Phys.removeCar(car)
    expect(Phys.engine!.world.bodies.length).toBe(before - 1)
    expect(car.body).toBeNull()
  })
})

describe('busy roads (plan 4)', () => {
  it('civilian cars are slower, softer variants of the nine bodies', () => {
    expect(TRAFFIC_CARS).toHaveLength(PLAYER_CARS.length)
    TRAFFIC_CARS.forEach((t, i) => {
      expect(t.file).toBe(PLAYER_CARS[i].file)
      expect(t.top).toBeLessThan(PLAYER_CARS[i].top)
      expect(t.accel).toBeLessThan(PLAYER_CARS[i].accel)
    })
  })

  it('spatial grid query matches a brute-force search', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    const cars = Array.from({ length: 80 }, () => {
      const c = new Car(PLAYER_CARS[0], 'civil')
      c.x = rnd() * 1800
      c.y = rnd() * 1800
      return c
    })
    carGrid.rebuild(cars)
    const out: Car[] = []
    for (let k = 0; k < 40; k++) {
      const x = rnd() * 1800,
        y = rnd() * 1800,
        r = 10 + rnd() * 120
      const expected = cars.filter((c) => Math.hypot(c.x - x, c.y - y) <= r).map((c) => c.id).sort()
      const got = carGrid.query(x, y, r, out).map((c) => c.id).sort()
      expect(got).toEqual(expected)
    }
  })

  it('stays cheap with 60 cars in the Matter world', () => {
    Phys.init({ buildings: [], walls: [] })
    const cars: Car[] = []
    for (let i = 0; i < 60; i++) {
      const c = new Car(TRAFFIC_CARS[i % 9], 'civil')
      Phys.addCar(c)
      c.place((i % 10) * 40, Math.floor(i / 10) * 40, 0)
      c.setSpeed(10)
      cars.push(c)
    }
    for (let i = 0; i < 120; i++) {
      for (const c of cars) c.applyControls(DT, SURF.asphalt)
      Phys.step(DT)
      for (const c of cars) c.readBack()
    }
    const t0 = performance.now()
    const N = 600
    for (let i = 0; i < N; i++) {
      for (const c of cars) {
        c.ctrl.throttle = 0.3
        c.applyControls(DT, SURF.asphalt)
      }
      Phys.step(DT)
      for (const c of cars) c.readBack()
      carGrid.rebuild(cars)
    }
    const ms = (performance.now() - t0) / N
    expect(ms).toBeLessThan(3) // ~0.3 ms in practice; this guards against accidental O(n^2) blow-ups
  })
})

describe('city districts (plan 5)', () => {
  const city = createCity()

  it('has downtown, port and suburbs, and the spawn point is downtown', () => {
    const present = new Set(city.blocks.map((b) => b.district))
    expect([...present].sort()).toEqual(['downtown', 'port', 'suburbs'])
    expect(city.districtAt(city.nodeX(city.nodeId(8, 8)), city.nodeY(city.nodeId(8, 8)))).toBe('downtown')
    expect(city.districtAt(city.vx[0], 300)).toBe('highway')
  })

  it('is deterministic for a seed (districts and buildings)', () => {
    const again = createCity()
    expect(again.blocks.map((b) => b.district)).toEqual(city.blocks.map((b) => b.district))
    expect(again.buildings.length).toBe(city.buildings.length)
    expect(createCity(99).blocks.map((b) => b.district)).not.toEqual(city.blocks.map((b) => b.district))
  })

  it('puts the right buildings in the right district', () => {
    for (const b of city.buildings) {
      const d = city.districtAt(b.x, b.y)
      if (b.kind === 'house') expect(d).toBe('suburbs')
      if (b.kind === 'container' || b.kind === 'warehouse') expect(d).toBe('port')
      if (b.kind === 'tower') expect(d).toBe('downtown')
    }
    const kinds = new Set(city.buildings.map((b) => b.kind))
    expect([...kinds].sort()).toEqual(['container', 'house', 'tower', 'warehouse'])
  })

  it('never builds on a road', () => {
    for (const b of city.buildings) {
      for (let i = 0; i < city.NV; i++) expect(b.x1 <= city.vx[i] - city.vw[i] / 2 || b.x0 >= city.vx[i] + city.vw[i] / 2).toBe(true)
      for (let j = 0; j < city.NH; j++) expect(b.y1 <= city.hy[j] - city.hw[j] / 2 || b.y0 >= city.hy[j] + city.hw[j] / 2).toBe(true)
    }
  })

  it('makes the ring a wide highway that is entered only through the ramps', () => {
    expect(city.vw[0]).toBe(36)
    expect(city.vt[0]).toBe('highway')
    const ring = (i: number, j: number) => city.nodeId(i, j)
    for (let j = 1; j < city.NH - 1; j++) {
      const toInterior = city.neighbors(ring(0, j)).includes(ring(1, j))
      expect(toInterior).toBe(RAMPS.includes(j))
      expect(city.neighbors(ring(1, j)).includes(ring(0, j))).toBe(RAMPS.includes(j)) // and the same in reverse
    }
    // ring nodes always connect along the ring
    expect(city.neighbors(ring(0, 3))).toContain(ring(0, 2))
    expect(city.neighbors(ring(0, 3))).toContain(ring(0, 4))
  })

  it('keeps every intersection reachable from the centre, highway included', () => {
    const from = city.nodeId(8, 8)
    let reachable = 0
    for (let id = 0; id < city.nodeCount; id++) if (findPath(city, from, id)) reachable++
    expect(reachable).toBe(city.nodeCount)
    // a trip to a far ring corner must go via a ramp
    const path = findPath(city, from, city.nodeId(0, 0))!
    const entry = path.find((n, k) => k > 0 && (city.nodeId(0, 0) === n ? false : (n % city.NV === 0 || n % city.NV === city.NV - 1 || ((n / city.NV) | 0) === 0 || ((n / city.NV) | 0) === city.NH - 1)))!
    expect(city.isRamp(entry % city.NV, (entry / city.NV) | 0)).toBe(true)
  })

  it('barricades the highway except at the ramps', () => {
    const px = city.vx[0] + city.vw[0] / 2 + 0.6 // the barrier line along the left highway
    const covers = (y: number) => city.barriers.some((b) => Math.abs(b.x - px) < 0.01 && Math.abs(y - b.y) <= b.hy)
    expect(covers(city.hy[3])).toBe(true) // a plain street mouth is walled off
    for (const j of RAMPS) expect(covers(city.hy[j])).toBe(false) // a ramp is open
  })

  it('barriers block line of sight (so cops route to a ramp) but ramps do not', () => {
    const y3 = city.hy[3],
      y4 = city.hy[4]
    const xIn = city.vx[0] + city.vw[0] / 2 + 12 // inside the first block column
    const xHwy = city.vx[0] + 6
    expect(city.hasLOS(xHwy, y3, xIn, y3)).toBe(false) // across a plain street mouth: walled off
    expect(city.hasLOS(xHwy, y4, xIn, y4)).toBe(true) // through the ramp opening: clear
  })
})
