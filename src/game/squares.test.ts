import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { avoid, speedTo, steerTo } from './ai/drive'
import { ringAim, ringSpeed } from './ai/police'
import { POLICE_SPEC, TRAFFIC_CARS, TRAFFIC_TRUCKS } from './data/cars'
import { Car } from './physics/car'
import { Phys } from './physics/world'
import { game } from './state'
import { seedRandom, stubCanvas } from './testkit'
import type { SuperBlock } from './types'
import { carGrid } from './world/carGrid'
import { TILE } from './world/city'
import type { City, Tile } from './world/city'
import { LaneDriver, Traffic } from './world/traffic'
import { World } from './world/world'

// The statue squares sit ON crossings of two roads: a roundabout with the statue on its island and paved plaza corners around it.
// Geometry, then traffic and police driving through every route, then a busy squares simulation.

let restore: (() => void) | null = null
beforeEach(() => {
  stubCanvas()
  World.init()
})
afterEach(() => {
  restore?.()
  restore = null
})

/** every tile of a few windows, with the window's node numbering for it */
function windows(centres: [number, number][]): { city: City; t: Tile; a: number; b: number }[] {
  const out: { city: City; t: Tile; a: number; b: number }[] = []
  for (const [cx, cy] of centres) {
    const city = World.build(cx, cy, 1)
    city.tiles.forEach((t, k) => out.push({ city, t, a: k % 3, b: Math.floor(k / 3) }))
  }
  return out
}
const nodeOf = (city: City, a: number, b: number, sq: SuperBlock) => city.nodeId(a * TILE + sq.ci, b * TILE + sq.cj)
const CENTRES: [number, number][] = [[0, 0], [3, 2], [-4, 5], [7, -6], [-9, -3], [12, 12], [-15, 8]]

describe('statue squares: geometry', () => {
  it('there are exactly three in each of 60+ towns, on crossings, apart from each other and from bends and roundabouts', () => {
    const ws = windows(CENTRES)
    expect(new Set(ws.map((w) => w.t)).size).toBeGreaterThan(60)
    const seen = new Set<Tile>()
    for (const { city, t, a, b } of ws) {
      if (seen.has(t)) continue
      seen.add(t)
      expect(t.squares).toHaveLength(3)
      const used = new Set<string>()
      for (const s of t.supers) for (let dj = 0; dj < 3; dj++) for (let di = 0; di < 3; di++) used.add(s.i + di + ',' + (s.j + dj))
      for (const q of t.squares) {
        const node = nodeOf(city, a, b, q)
        expect(city.neighbors(node), 'a square needs all four roads').toHaveLength(4)
        expect(city.roundAt(node), 'cars drive round it like a roundabout').toBeDefined()
        expect(city.isDead(node)).toBe(false)
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) expect(used.has(q.ci + di + ',' + (q.cj + dj))).toBe(false)
        for (const o of t.squares) if (o !== q) expect(Math.max(Math.abs(o.ci - q.ci), Math.abs(o.cj - q.cj))).toBeGreaterThanOrEqual(3)
        expect(q.ci).toBeGreaterThanOrEqual(2)
        expect(q.ci).toBeLessThanOrEqual(TILE - 2)
        expect(q.cj).toBeGreaterThanOrEqual(2)
        expect(q.cj).toBeLessThanOrEqual(TILE - 2)
        if (t.riverCol >= 0) expect(Math.abs(q.ci - t.riverCol)).toBeGreaterThan(2)
      }
    }
  })

  it('nothing is built on a ring or a plaza corner, and the ring is clear all the way round', () => {
    const seen = new Set<Tile>()
    for (const { city, t } of windows(CENTRES)) {
      if (seen.has(t)) continue
      seen.add(t)
      for (const q of t.squares) {
        // buildings keep out of the whole circle
        for (const bd of t.buildings) {
          if (bd.kind === 'statue') continue
          const dx = Math.max(bd.x0 - q.cx, 0, q.cx - bd.x1),
            dy = Math.max(bd.y0 - q.cy, 0, q.cy - bd.y1)
          expect(Math.hypot(dx, dy), `a ${bd.kind} is on a ring`).toBeGreaterThanOrEqual(q.ro - 0.01)
        }
        // the lane circle (and a metre either side of it) is free to drive on, the island is solid
        const rc = (q.ri + q.ro) / 2
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2
          for (const r of [rc - 2, rc, rc + 2]) {
            expect(city.isObstacle(q.cx + Math.cos(a) * r, q.cy + Math.sin(a) * r)).toBe(false)
            expect(city.surfaceAt(q.cx + Math.cos(a) * r, q.cy + Math.sin(a) * r).kind).toBe('asphalt')
          }
        }
        expect(city.isObstacle(q.cx, q.cy)).toBe(true)
        expect(city.surfaceAt(q.cx, q.cy).kind).toBe('lot') // paved island
      }
      // the four corner plazas: paved, with nothing on them
      for (const bl of t.blocks) {
        const c = bl.corner
        if (!c) continue
        expect(c.x1 - c.x0).toBeGreaterThan(15)
        expect(c.y1 - c.y0).toBeGreaterThan(15)
        expect(city.surfaceAt((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2).kind).toBe('lot')
        for (const bd of t.buildings) {
          if (bd.kind === 'statue') continue
          expect(bd.x1 <= c.x0 + 1e-6 || bd.x0 >= c.x1 - 1e-6 || bd.y1 <= c.y0 + 1e-6 || bd.y0 >= c.y1 - 1e-6, `a ${bd.kind} stands on a plaza corner`).toBe(true)
        }
        expect(bl.lots === undefined || bl.lots.length === 0).toBe(true)
      }
      const corners = t.blocks.filter((b) => b.corner).length
      expect(corners).toBe(12)
    }
  }, 60_000)

  it("the home town's three are the ones nearest the start, and everything is reproducible", () => {
    const city = World.build(0, 0, 1)
    const n = city.centerNode()
    const sx = city.nodeX(n),
      sy = city.nodeY(n)
    const home = city.tileAt(sx, sy)!
    for (const q of home.squares) expect(Math.hypot(q.cx - sx, q.cy - sy)).toBeLessThan(700)
    const sig = () => windows(CENTRES).map((w) => w.t.squares.map((q) => `${q.ci},${q.cj},${q.k}`).join(';')).join('|')
    const first = sig()
    World.cache.clear()
    expect(sig()).toBe(first)
  })
})

/** the first square of the home town, with its node and its four neighbours */
function homeSquare(idx = 0): { city: City; sq: SuperBlock; node: number; arms: number[] } {
  const city = World.build(0, 0, 1)
  const home = city.tileAt(city.nodeX(city.centerNode()), city.nodeY(city.centerNode()))!
  const k = city.tiles.indexOf(home)
  const sq = home.squares[idx]
  const node = nodeOf(city, k % 3, Math.floor(k / 3), sq)
  return { city, sq, node, arms: city.neighbors(node) }
}

describe('statue squares: vehicles drive through them', () => {
  /** a car (driven by `drive`) starts 55 m up the `from` arm and leaves by `to`; returns what happened */
  function through(
    city: City,
    node: number,
    from: number,
    to: number,
    spec: (typeof TRAFFIC_CARS)[number],
    drive: (car: Car, drv: LaneDriver | null, dt: number) => void,
    drv: LaneDriver | null,
  ): { ok: boolean; hits: number; badSurface: string | null; secs: number; end: string } {
    Phys.reset()
    Traffic.clearHolds()
    const car = new Car(spec, spec === POLICE_SPEC ? 'police' : 'civil')
    Phys.addCar(car)
    const len = city.edgeLength(from, node)
    const p = city.lanePoint(from, node, 1 - 55 / len)
    car.place(p.x, p.y, Math.atan2(p.uy, p.ux))
    car.setSpeed(8)
    Phys.streamStatics(city.nodeX(node), city.nodeY(node), 300)
    let hits = 0
    const was = game.onImpact
    game.onImpact = (a, b, dvA, dvB) => {
      if (a === car && !b && dvA > 0.5) hits++
      if (b === car && !a && dvB > 0.5) hits++
    }
    let badSurface: string | null = null
    let secs = 0
    let ok = false
    const trail: string[] = [] // a position every half second, for the failure message
    for (let step = 0; step < 60 * 40; step++) {
      carGrid.rebuild([car])
      Traffic.advance(1 / 60)
      drive(car, drv, 1 / 60)
      car.applyControls(1 / 60, city.surfaceAt(car.x, car.y))
      Phys.step(1 / 60)
      car.readBack()
      const kind = city.surfaceAt(car.x, car.y).kind
      if ((kind === 'lot' || kind === 'sidewalk' || kind === 'grass') && !badSurface) badSurface = kind
      secs = step / 60
      if (step % 30 === 0) trail.push(`${secs.toFixed(1)}s ${car.x.toFixed(0)},${car.y.toFixed(0)} v${car.speed.toFixed(1)} h${car.theta.toFixed(2)} ${kind}`)
      if (Math.hypot(car.x - city.nodeX(to), car.y - city.nodeY(to)) < 25 && secs > 3) {
        ok = true
        break
      }
    }
    game.onImpact = was
    return { ok, hits, badSurface, secs, end: `trail ${trail.slice(0, 40).join(' | ')}; car at ${car.x.toFixed(0)},${car.y.toFixed(0)} speed ${car.speed.toFixed(1)} heading ${car.theta.toFixed(2)}; node ${city.nodeX(node).toFixed(0)},${city.nodeY(node).toFixed(0)}; target ${city.nodeX(to).toFixed(0)},${city.nodeY(to).toFixed(0)}` }
  }

  it('a car comes in by each arm and leaves by each of the others, never touching the statue or leaving the asphalt', () => {
    restore = seedRandom(4)
    let runs = 0
    for (const idx of [0, 1, 2]) {
      const { city, node, arms } = homeSquare(idx)
      Phys.init(city)
      for (const spec of [TRAFFIC_CARS[0], TRAFFIC_CARS[3]]) {
        for (const from of arms) {
          for (const to of arms) {
            if (to === from) continue
            const drv = new LaneDriver(city, from, node)
            drv.next = to
            const tag = `${spec.id}, square ${idx}, from ${arms.indexOf(from)} to ${arms.indexOf(to)}`
            const r = through(city, node, from, to, spec, (car, d, dt) => d!.control(car, dt), drv)
            expect(r.ok, `${tag} did not get out (${r.secs.toFixed(0)} s): ${r.end}`).toBe(true)
            expect(r.hits, `${tag} hit something`).toBe(0)
            expect(r.badSurface, `${tag} left the road`).toBeNull()
            runs++
          }
        }
      }
    }
    expect(runs).toBe(72)
  })

  it('so does a container truck, the longest thing on the road', () => {
    restore = seedRandom(5)
    for (const idx of [0, 1, 2]) {
      const { city, node, arms } = homeSquare(idx)
      Phys.init(city)
      for (const spec of TRAFFIC_TRUCKS) {
        for (const from of arms) {
          for (const to of arms) {
            if (to === from) continue
            const drv = new LaneDriver(city, from, node)
            drv.next = to
            const tag = `${spec.id}, square ${idx}, from ${arms.indexOf(from)} to ${arms.indexOf(to)}`
            const r = through(city, node, from, to, spec, (car, d, dt) => d!.control(car, dt), drv)
            expect(r.ok, `${tag} did not get out: ${r.end}`).toBe(true)
            expect(r.hits, `${tag} hit something`).toBe(0)
          }
        }
      }
    }
  })

  it('a police car chasing through goes round the island, on any route, without touching the statue', () => {
    restore = seedRandom(6)
    const aim = { x: 0, y: 0 }
    for (const idx of [0, 1, 2]) {
    const { city, node, arms } = homeSquare(idx)
    Phys.init(city)
    for (const from of arms) {
      for (const to of arms) {
        if (to === from) continue
        const path = [from, node, to]
        let pi = 1
        const r = through(
          city,
          node,
          from,
          to,
          POLICE_SPEC,
          (car) => {
            // the pursuit steering of police.ts: aim at the next node, round the ring when it is a roundabout, brake for the corner
            const last = path.length - 1
            let nx = city.nodeX(path[Math.min(pi, last)]),
              ny = city.nodeY(path[Math.min(pi, last)])
            if (pi < last && Math.hypot(nx - car.x, ny - car.y) < 10 + car.speed * 0.45) {
              pi++
              nx = city.nodeX(path[pi])
              ny = city.nodeY(path[pi])
            }
            let tx = nx,
              ty = ny,
              speed = 40
            if (ringAim(city, path, pi, car, aim)) {
              tx = aim.x
              ty = aim.y
            }
            speed = Math.min(speed, ringSpeed(city, path, pi, car))
            steerTo(car, tx, ty)
            speedTo(car, speed)
            avoid(car, city)
          },
          null,
        )
        expect(r.ok, `cop, square ${idx}, from ${arms.indexOf(from)} to ${arms.indexOf(to)} did not get out (${r.secs.toFixed(0)} s): ${r.end}`).toBe(true)
        expect(r.hits, `cop from ${arms.indexOf(from)} to ${arms.indexOf(to)} hit the statue or a wall`).toBe(0)
      }
    }
    }
  })
})

describe('statue squares: busy', () => {
  it('48 vehicles on the roads round the home town squares drive for 90 s with no collision, no hit on a statue, and nobody stuck', () => {
    restore = seedRandom(21)
    const city = World.build(0, 0, 1)
    const home = city.tileAt(city.nodeX(city.centerNode()), city.nodeY(city.centerNode()))!
    const k = city.tiles.indexOf(home)
    Phys.init(city)
    const cars: Car[] = []
    const drivers: LaneDriver[] = []
    let n = 0
    for (const sq of home.squares) {
      const node = nodeOf(city, k % 3, Math.floor(k / 3), sq)
      Phys.streamStatics(sq.cx, sq.cy, 400)
      for (const arm of city.neighbors(node)) {
        for (let q = 0; q < 4; q++) {
          const spec = n % 8 === 5 ? TRAFFIC_TRUCKS[n % 3] : TRAFFIC_CARS[n % TRAFFIC_CARS.length]
          const car = new Car(spec, 'civil')
          Phys.addCar(car)
          // spread along the arm, heading in or out
          const inbound = q % 2 === 0
          const t = 0.15 + (q / 4) * 0.7
          const p = city.lanePoint(inbound ? arm : node, inbound ? node : arm, t)
          car.place(p.x, p.y, Math.atan2(p.uy, p.ux))
          car.setSpeed(6)
          const d = inbound ? new LaneDriver(city, arm, node) : new LaneDriver(city, node, arm)
          d.speedCap = (9 + (n % 7)) * (spec.truck ? 0.8 : 1)
          cars.push(car)
          drivers.push(d)
          n++
        }
      }
    }
    expect(cars.length).toBe(48)
    let carCrashes = 0,
      staticHits = 0
    const was = game.onImpact
    game.onImpact = (a, b, dvA, dvB) => {
      if (a && b) carCrashes++
      else if (Math.max(dvA, dvB) > 1) staticHits++
    }
    const stuckFor = new Array(cars.length).fill(0)
    let worst = 0
    for (let step = 0; step < 90 * 60; step++) {
      Traffic.advance(1 / 60)
      carGrid.rebuild(cars)
      for (let i = 0; i < cars.length; i++) drivers[i].control(cars[i], 1 / 60)
      for (const c of cars) c.applyControls(1 / 60, city.surfaceAt(c.x, c.y))
      Phys.step(1 / 60)
      for (const c of cars) c.readBack()
      for (let i = 0; i < cars.length; i++) {
        stuckFor[i] = cars[i].speed < 0.5 ? stuckFor[i] + 1 / 60 : 0
        worst = Math.max(worst, stuckFor[i])
      }
    }
    game.onImpact = was
    expect(carCrashes).toBe(0)
    expect(staticHits).toBe(0)
    expect(worst).toBeLessThan(25)
  }, 60_000)
})
