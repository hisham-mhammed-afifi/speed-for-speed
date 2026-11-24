import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findPath } from './ai/pathfind'
import { ALL_CAR_FILES, estimate, PLAYER_CARS, POLICE_SPEC } from './data/cars'
import { Car } from './physics/car'
import { Phys } from './physics/world'
import { game } from './state'
import { createCity, SURF } from './world/city'
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
      x: 100, y: 0, theta: 0, hx: 20, hy: 20, x0: 80, y0: -20, x1: 120, y1: 20, height: 30, roof: '', wall: '', props: [], hasHeli: false, stamp: 0,
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
