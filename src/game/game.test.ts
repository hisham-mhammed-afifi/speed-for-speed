import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findPath } from './ai/pathfind'
import { DEFAULT_RATING, Difficulty, scoreRun } from './ai/difficulty'
import { CELL, HOT, Memory } from './ai/memory'
import { predictRoute } from './ai/tactics'
import { fitScale, LOT_MAX_SCALE, LOTS, lotDims, lotRect, tileGrid, treeSpecies, WORLD_FILES } from './world/worldArt'
import { ALL_CAR_FILES, estimate, PLAYER_CARS, POLICE_SPEC, TRAFFIC_CARS } from './data/cars'
import { Car } from './physics/car'
import { Phys } from './physics/world'
import { game } from './state'
import { carGrid } from './world/carGrid'
import { BRIDGES, createCity, LANE_OFFSET, RAMPS, RIVER_I, SURF } from './world/city'
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
    expect(city.vw[0]).toBe(28)
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

describe('living map features (plan 6)', () => {
  const city = createCity()

  it('splits the city with a river crossed only by the bridge streets', () => {
    const id = (i: number, j: number) => city.nodeId(i, j)
    for (let j = 1; j < city.NH - 1; j++) {
      const crosses = city.neighbors(id(RIVER_I, j)).includes(id(RIVER_I + 1, j))
      expect(crosses).toBe(BRIDGES.includes(j))
    }
    expect(city.bridges).toHaveLength(BRIDGES.length)
    // every intersection stays reachable (through the bridges)
    const from = id(8, 8)
    for (let n = 0; n < city.nodeCount; n += 7) expect(findPath(city, from, n)).not.toBeNull()
    // west-to-east trips have to use a bridge
    const path = findPath(city, id(2, 6), id(RIVER_I + 3, 6))!
    const hop = path.findIndex((n, k) => k > 0 && path[k - 1] % city.NV === RIVER_I && n % city.NV === RIVER_I + 1)
    expect(hop).toBeGreaterThan(0)
    expect(BRIDGES).toContain(((path[hop] / city.NV) | 0))
  })

  it('makes the water solid and keeps bridge decks open', () => {
    const mx = (city.river.x0 + city.river.x1) / 2
    const waterY = (city.hy[5] + city.hy[6]) / 2 // between two streets, nowhere near a bridge
    expect(city.inWater(mx, waterY)).toBe(true)
    expect(city.isObstacle(mx, waterY)).toBe(true)
    for (const j of BRIDGES) expect(city.inWater(mx, city.hy[j])).toBe(false)
    expect(city.waterWalls.length).toBeGreaterThan(0)
  })

  it('has tunnels that block line of sight and hide you from the helicopter', () => {
    expect(city.tunnels.length).toBeGreaterThan(3)
    const t = city.tunnels[0]
    const cx = (t.x0 + t.x1) / 2,
      cy = (t.y0 + t.y1) / 2
    expect(city.inTunnel(cx, cy)).toBe(true)
    const outsideX = t.horiz ? t.x0 - 12 : cx,
      outsideY = t.horiz ? cy : t.y0 - 12
    expect(city.hasLOS(outsideX, outsideY, cx, cy)).toBe(false)
  })

  it('places ramps, construction gravel and props deterministically', () => {
    const again = createCity()
    expect(again.jumps).toEqual(city.jumps)
    expect(again.propSpots.length).toBe(city.propSpots.length)
    expect(city.jumps.length).toBeGreaterThan(2)
    expect(city.gravel.length).toBeGreaterThan(3)
    const kinds = new Set(city.propSpots.map((p) => p.kind))
    expect([...kinds].sort()).toEqual(['cone', 'fence', 'sawhorse'])
    const g = city.gravel[0]
    expect(city.surfaceAt((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2).kind).toBe('gravel')
  })

  it('launches an airborne car over another car and lands it with less grip', () => {
    Phys.init({ buildings: [], walls: [] }) // open ground, so only the thing under test can be hit
    const a = new Car(PLAYER_CARS[0], 'player')
    Phys.addCar(a)
    a.place(0, 0, 0)
    const b = new Car(PLAYER_CARS[1], 'civil')
    Phys.addCar(b)
    b.place(30, 0, 0)
    a.setSpeed(30)
    a.launch(1.2)
    let hits = 0
    const oi = game.onImpact
    game.onImpact = () => {
      hits++
    }
    let landed = false
    for (let i = 0; i < 240; i++) {
      a.ctrl.throttle = 0
      a.applyControls(DT, SURF.asphalt)
      b.applyControls(DT, SURF.asphalt)
      Phys.step(DT)
      a.readBack()
      b.readBack()
      if (a.justLanded) landed = true
    }
    game.onImpact = oi
    expect(a.x).toBeGreaterThan(b.x) // flew past it...
    expect(hits).toBe(0) // ...without touching it
    expect(landed).toBe(true)
    expect(a.air).toBe(0)
  })

  it('a prop hit is a smash, not a crash', () => {
    Phys.init({ buildings: [], walls: [] }) // open ground, so only the thing under test can be hit
    const car = new Car(PLAYER_CARS[0], 'player')
    Phys.addCar(car)
    car.place(0, 0, 0)
    const spot = { kind: 'cone' as const, x: 20, y: 0, angle: 0, gone: false }
    const body = Phys.addProp(spot)
    const oi = game.onImpact,
      op = game.onPropHit
    let crashes = 0,
      smashes = 0
    game.onImpact = () => {
      crashes++
    }
    game.onPropHit = () => {
      smashes++
    }
    car.setSpeed(15)
    for (let i = 0; i < 240; i++) {
      car.applyControls(DT, SURF.asphalt)
      Phys.step(DT)
      car.readBack()
    }
    game.onImpact = oi
    game.onPropHit = op
    expect(smashes).toBeGreaterThan(0)
    expect(crashes).toBe(0)
    expect(car.speed).toBeGreaterThan(12) // a cone barely slows a car
    expect(body.position.x / Phys.S).toBeGreaterThan(20.5) // and it got knocked down the road
  })
})


describe('coordinated police tactics (plan 1)', () => {
  const city = createCity()
  // an interior intersection with a straight street through it
  const i0 = 6,
    j0 = 6
  const n = city.nodeId(i0, j0)
  const sx = city.nodeX(n),
    sy = city.nodeY(n)

  it('predicts the road ahead of a fast player, and nothing for a slow one', () => {
    expect(predictRoute(city, sx + 30, sy, 3, 0)).toEqual([])
    const r = predictRoute(city, sx + 30, sy, 28, 0)
    expect(r.length).toBeGreaterThan(0)
    for (const e of r) {
      expect(e.dx).toBeGreaterThan(0.99) // along +x
      expect(e.wy).toBeCloseTo(sy, 0) // on the street the player is on
      expect(e.wx).toBeGreaterThan(sx + 30 + 24) // clearly ahead of the player
      expect(e.eta).toBeGreaterThan(0.5)
    }
  })

  it('later cut-off points have later arrival times', () => {
    const r = predictRoute(city, sx + 30, sy, 28, 0)
    if (r.length === 2) {
      expect(r[1].eta).toBeGreaterThan(r[0].eta)
      expect(r[1].wx).toBeGreaterThan(r[0].wx)
    }
  })

  it('predicts in every direction and always lands on a drivable edge', () => {
    for (const [vx, vy] of [
      [28, 0],
      [-28, 0],
      [0, 28],
      [0, -28],
    ]) {
      const r = predictRoute(city, sx + vx, sy + vy, vx, vy)
      for (const e of r) {
        expect(city.neighbors(e.n0)).toContain(e.n1)
        expect(e.dx * vx + e.dy * vy).toBeGreaterThan(0)
      }
    }
  })
})

describe('police memory (plan 2)', () => {
  beforeEach(() => Memory.clear())

  it('records hidden time per cell and learns from a finished run', () => {
    Memory.startRun()
    Memory.recordHidden(100, 100, 6)
    Memory.recordHidden(110, 90, 4) // same cell
    Memory.recordHidden(500, 500, 2)
    Memory.endRun(true)
    expect(Memory.cells.get(Memory.keyAt(100, 100))).toBeCloseTo(10)
    expect(Memory.cells.get(Memory.keyAt(500, 500))).toBeCloseTo(2)
    expect(Memory.hot().map((c) => c.key)).toEqual([Memory.keyAt(100, 100)]) // only the 10 s cell is "hot"
  })

  it('learns half as much from a bust, and fades old knowledge each run', () => {
    Memory.startRun()
    Memory.recordHidden(100, 100, 10)
    Memory.endRun(false)
    expect(Memory.cells.get(Memory.keyAt(100, 100))).toBeCloseTo(5)
    Memory.endRun(true) // nothing new: just decays
    expect(Memory.cells.get(Memory.keyAt(100, 100))).toBeCloseTo(5 * 0.85)
    for (let i = 0; i < 30; i++) Memory.endRun(true)
    expect(Memory.cells.size).toBe(0) // forgotten
  })

  it('repeated escapes to the same spot make it hotter than a one-off', () => {
    for (let r = 0; r < 3; r++) {
      Memory.startRun()
      Memory.recordHidden(300, 300, 8)
      if (r === 2) Memory.recordHidden(900, 900, 8)
      Memory.endRun(true)
    }
    const hot = Memory.hot()
    expect(hot[0].key).toBe(Memory.keyAt(300, 300))
    expect(hot[0].w).toBeGreaterThan(hot[hot.length - 1].w)
  })

  it('round-trips through the save format and ignores junk', () => {
    Memory.startRun()
    Memory.recordHidden(200, 400, 12)
    Memory.endRun(true)
    const saved = JSON.parse(JSON.stringify(Memory.save())) as Record<string, number>
    Memory.clear()
    Memory.load({ ...saved, 'bogus': 5, '1,2': -3, '3,4': NaN })
    expect([...Memory.cells.keys()]).toEqual([Memory.keyAt(200, 400)])
    expect(Memory.cells.get(Memory.keyAt(200, 400))).toBeCloseTo(12, 0)
  })

  it('picks a nearby hideout, ignores far ones, and the cell centre lies inside its cell', () => {
    Memory.cells.set(Memory.keyAt(1000, 1000), 20)
    Memory.cells.set(Memory.keyAt(5000, 5000), 50)
    const t = Memory.pick(1100, 1050)
    expect(t).not.toBeNull()
    expect(Math.abs(t!.x - 1000)).toBeLessThan(CELL)
    expect(Memory.pick(3000, 3000, 400)).toBeNull() // nothing within 400 m
    Memory.cells.set(Memory.keyAt(2000, 2000), HOT - 1)
    expect(Memory.pick(2000, 2000)).toBeNull() // too cold to matter
  })

  it('keeps the table bounded', () => {
    Memory.startRun()
    for (let i = 0; i < 300; i++) Memory.recordHidden(i * CELL, 0, 1 + (i % 7))
    Memory.endRun(true)
    expect(Memory.cells.size).toBeLessThanOrEqual(80)
  })
})

describe('adaptive difficulty (plan 3)', () => {
  beforeEach(() => {
    Difficulty.reset()
  })

  it('the default rating is the baseline tuning', () => {
    expect(Difficulty.rating).toBe(DEFAULT_RATING)
    const k = Difficulty.k
    expect(k.copOffset).toBe(0)
    expect(k.boostMul).toBe(1)
    expect(k.reactMul).toBe(1)
    expect(k.spawnMin).toBe(110)
    expect(k.spawnMax).toBe(260)
    expect(k.trapMul).toBe(1)
    expect(k.evadeAdd).toBe(0)
    expect(k.tactBonus).toBe(0)
  })

  it('escaping raises the rating, getting busted early lowers it', () => {
    const up = Difficulty.update('escaped', 40, 2, 90)
    expect(up.after).toBeGreaterThan(up.before)
    Difficulty.reset()
    const down = Difficulty.update('busted', 15, 0, 100)
    expect(down.after).toBeLessThan(down.before)
  })

  it('scores: fast clean escapes beat slow ones, long busts beat short ones', () => {
    expect(scoreRun('escaped', 30, 3, 100)).toBeGreaterThan(scoreRun('escaped', 120, 0, 40))
    expect(scoreRun('busted', 100, 0, 0)).toBeGreaterThan(scoreRun('busted', 10, 0, 0))
    expect(scoreRun('escaped', 200, 0, 0)).toBeGreaterThan(scoreRun('busted', 200, 0, 0))
  })

  it('moves a bounded amount per run and stays within 0.05..0.95', () => {
    const r = Difficulty.update('escaped', 30, 5, 100)
    expect(Math.abs(r.after - r.before)).toBeLessThanOrEqual(0.1 + 1e-9)
    for (let i = 0; i < 80; i++) Difficulty.update('escaped', 30, 5, 100)
    expect(Difficulty.rating).toBeLessThanOrEqual(0.95)
    expect(Difficulty.rating).toBeGreaterThan(0.8)
    for (let i = 0; i < 200; i++) Difficulty.update('busted', 9, 0, 0)
    expect(Difficulty.rating).toBeGreaterThanOrEqual(0.05)
    expect(Difficulty.rating).toBeLessThan(0.15)
  })

  it('ignores instant restarts, fixed difficulty and the dev override', () => {
    expect(Difficulty.update('busted', 3, 0, 100).after).toBe(DEFAULT_RATING)
    Difficulty.setFixed(true)
    expect(Difficulty.update('escaped', 40, 3, 100).after).toBe(DEFAULT_RATING)
    Difficulty.setFixed(false)
    Difficulty.load({ best: 0, total: 0, longest: 0, car: 0 }, '0.9')
    expect(Difficulty.eff()).toBe(0.9)
    expect(Difficulty.update('escaped', 40, 3, 100).after).toBe(DEFAULT_RATING) // override: nothing is saved
  })

  it('the knobs grow monotonically with the rating', () => {
    const at = (r: number) => {
      Difficulty.load({ best: 0, total: 0, longest: 0, car: 0, skill: r }, null)
      return { ...Difficulty.k }
    }
    const ks = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map(at)
    for (let i = 1; i < ks.length; i++) {
      expect(ks[i].copOffset).toBeGreaterThanOrEqual(ks[i - 1].copOffset)
      expect(ks[i].boostMul).toBeGreaterThan(ks[i - 1].boostMul)
      expect(ks[i].reactMul).toBeLessThan(ks[i - 1].reactMul)
      expect(ks[i].spawnMin).toBeLessThan(ks[i - 1].spawnMin)
      expect(ks[i].trapMul).toBeLessThan(ks[i - 1].trapMul)
      expect(ks[i].evadeAdd).toBeGreaterThanOrEqual(ks[i - 1].evadeAdd)
      expect(ks[i].tactBonus).toBeGreaterThanOrEqual(ks[i - 1].tactBonus)
    }
    expect(ks[0].copOffset).toBeLessThan(0) // easier than baseline
    expect(ks[5].copOffset).toBeGreaterThan(0) // harder than baseline
    expect(ks[5].boostMul).toBeLessThan(1.2) // but bounded
  })

  it('loads a saved rating and survives junk', () => {
    Difficulty.load({ best: 0, total: 0, longest: 0, car: 0, skill: 0.7, fixedSkill: true }, null)
    expect(Difficulty.rating).toBe(0.7)
    expect(Difficulty.fixed).toBe(true)
    Difficulty.load({ best: 0, total: 0, longest: 0, car: 0, skill: Number.NaN }, 'abc')
    expect(Difficulty.rating).toBe(DEFAULT_RATING)
    expect(Difficulty.override).toBeNull()
  })
})

describe('photo art, lanes and landmark lots at real-world scale', () => {
  const city = createCity()
  const lotBlocks = city.blocks.filter((b) => b.lots && b.lots.length)
  const allLots = lotBlocks.flatMap((b) => b.lots!.map((l) => ({ b, l })))

  it('every art file the game loads exists in public/', () => {
    const found = Object.keys(import.meta.glob('/public/world/**/*.webp'))
    for (const f of WORLD_FILES) expect(found, f).toContain('/public/' + f)
  })

  it('every tree value maps to one of the 8 sprites, and all of them get used', () => {
    const used = new Set<number>()
    for (let i = 0; i <= 1000; i++) used.add(treeSpecies(i / 1000))
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('lanes are about 3.6 m: the lane centre sits inside its half of every road, with room for a car', () => {
    for (const t of ['highway', 'avenue', 'street', 'alley'] as const) {
      const w = { highway: 28, avenue: 18, street: 11, alley: 6 }[t]
      const lane = LANE_OFFSET[t]
      expect(lane).toBeGreaterThan(0.9) // a 1.9 m car doesn't straddle the centre line
      expect(lane + 0.95).toBeLessThan(w / 2) // and doesn't hang over the kerb
    }
    // laneOffset follows the edge's road type
    const a = city.nodeId(3, 4),
      b = city.nodeId(4, 4)
    expect(city.laneOffset(a, b)).toBe(LANE_OFFSET[city.ht[4]])
    expect(city.laneOffset(city.nodeId(4, 3), city.nodeId(4, 4))).toBe(LANE_OFFSET[city.vt[4]])
  })

  it('lane points are on the right-hand side of the road, inside it', () => {
    for (let k = 0; k < 40; k++) {
      const n = city.randomNode()
      for (const m of city.neighbors(n)) {
        const p = city.lanePoint(n, m, 0.5)
        expect(city.laneOffset(n, m)).toBeLessThan(city.edgeWidth(n, m) / 2)
        // offset is to the right of the direction of travel (y down): (-uy, ux)
        const cx = (city.nodeX(n) + city.nodeX(m)) / 2,
          cy = (city.nodeY(n) + city.nodeY(m)) / 2
        const side = (p.x - cx) * -p.uy + (p.y - cy) * p.ux
        expect(side).toBeGreaterThan(0)
      }
    }
  })

  it('places each kind of lot in its own district, deterministically', () => {
    expect(allLots.length).toBeGreaterThan(0)
    for (const art of Object.values(LOTS)) {
      const mine = lotBlocks.filter((b) => b.lots![0].art === art.id)
      expect(mine.length).toBeGreaterThan(0)
      expect(mine.length).toBeLessThanOrEqual(art.count)
      for (const b of mine) expect(b.district).toBe(art.district)
    }
    const sig = (c: ReturnType<typeof createCity>) => c.blocks.filter((b) => b.lots).map((b) => [b.i, b.j, b.lots!.map((l) => [l.art, l.rot, l.flipX, l.flipY, Math.round(l.x0), Math.round(l.y0)])])
    expect(sig(createCity())).toEqual(sig(city))
  })

  it('lots are drawn at their real-world size, never stretched', () => {
    for (const { l } of allLots) {
      const art = LOTS[l.art]
      const w = l.x1 - l.x0,
        h = l.y1 - l.y0
      const [rw, rh] = l.rot ? [h, w] : [w, h]
      expect(rw / rh).toBeCloseTo(art.aspect, 3) // aspect ratio untouched
      const s = rw / art.metresWide
      expect(s).toBeGreaterThanOrEqual(art.minScale - 1e-6)
      expect(s).toBeLessThanOrEqual(LOT_MAX_SCALE + 1e-6)
    }
  })

  it('lots stay inside their block, off the roads, and never overlap each other', () => {
    for (const { b, l } of allLots) {
      expect(l.x0).toBeGreaterThanOrEqual(b.x0 + 3 - 1e-6)
      expect(l.y0).toBeGreaterThanOrEqual(b.y0 + 3 - 1e-6)
      expect(l.x1).toBeLessThanOrEqual(b.x1 - 3 + 1e-6)
      expect(l.y1).toBeLessThanOrEqual(b.y1 - 3 + 1e-6)
    }
    for (const b of lotBlocks) {
      const ls = b.lots!
      for (let i = 0; i < ls.length; i++)
        for (let j = i + 1; j < ls.length; j++) {
          const p = ls[i],
            q = ls[j]
          expect(p.x1 <= q.x0 + 1e-6 || q.x1 <= p.x0 + 1e-6 || p.y1 <= q.y0 + 1e-6 || q.y1 <= p.y0 + 1e-6).toBe(true)
        }
    }
  })

  it('villa blocks hold several villas (a street of them), all the same way round', () => {
    const villaBlocks = lotBlocks.filter((b) => b.lots![0].art === 'villa')
    expect(villaBlocks.some((b) => b.lots!.length >= 2)).toBe(true)
    for (const b of villaBlocks) expect(new Set(b.lots!.map((l) => l.rot)).size).toBe(1)
  })

  it('leftover strips of a lot block get ordinary buildings that do not overlap the lots', () => {
    for (const b of lotBlocks) {
      const mine = city.buildings.filter((q) => q.x0 >= b.x0 && q.x1 <= b.x1 && q.y0 >= b.y0 && q.y1 <= b.y1)
      const flat = mine.filter((q) => q.flat)
      expect(flat.length).toBe(b.lots!.reduce((n, l) => n + LOTS[l.art].parts.length, 0))
      for (const q of mine.filter((x) => !x.flat))
        for (const l of b.lots!) expect(q.x1 <= l.x0 + 1e-6 || q.x0 >= l.x1 - 1e-6 || q.y1 <= l.y0 + 1e-6 || q.y0 >= l.y1 - 1e-6, 'building overlaps a lot').toBe(true)
    }
    for (const q of city.buildings.filter((x) => x.flat)) expect(lotBlocks.some((b) => q.x0 >= b.x0 && q.x1 <= b.x1 && q.y0 >= b.y0 && q.y1 <= b.y1)).toBe(true)
  })

  it('fitScale / tileGrid only return sizes that really fit', () => {
    const v = LOTS.villa
    expect(fitScale(v, 40, 40)).toBeNull() // smaller than a villa: not squeezed into a toy
    const f = fitScale(LOTS.campus, 100, 100)
    if (f) {
      const [w, h] = lotDims(LOTS.campus, f.s, f.rot)
      expect(w).toBeLessThanOrEqual(100 + 1e-6)
      expect(h).toBeLessThanOrEqual(100 + 1e-6)
    }
    const g = tileGrid(v, 120, 100, 2)!
    expect(g.cols * g.tw + (g.cols - 1) * 2).toBeLessThanOrEqual(120 + 1e-6)
    expect(g.rows * g.th + (g.rows - 1) * 2).toBeLessThanOrEqual(100 + 1e-6)
    expect(tileGrid(v, 30, 30, 2)).toBeNull()
  })

  it('lotRect honours turning and mirroring (the corners land on the right corners)', () => {
    const base = { art: 'villa' as const, x0: 0, y0: 0, x1: 200, y1: 100, rot: 0 as const, flipX: false, flipY: false }
    expect(lotRect(base, 0, 0, 0.5, 0.5)).toEqual([0, 0, 100, 50])
    expect(lotRect({ ...base, flipX: true }, 0, 0, 0.5, 0.5)).toEqual([100, 0, 200, 50])
    expect(lotRect({ ...base, flipY: true }, 0, 0, 0.5, 0.5)).toEqual([0, 50, 100, 100])
    // quarter turn: the art's top-left corner ends up at the block's top-right
    expect(lotRect({ ...base, rot: 1 }, 0, 0, 0.5, 0.5)).toEqual([100, 0, 200, 50])
  })

  it('the road graph is still fully connected', () => {
    const n = city.nodeCount
    const seen = new Uint8Array(n)
    const stack = [0]
    seen[0] = 1
    while (stack.length) {
      const c = stack.pop()!
      for (const nb of city.neighbors(c))
        if (!seen[nb]) {
          seen[nb] = 1
          stack.push(nb)
        }
    }
    expect(seen.every((v) => v === 1)).toBe(true)
  })
})
