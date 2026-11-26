import { clamp, hyp } from '../core/math'
import { avoid, speedTo, steerTo } from './drive'
import { Difficulty } from './difficulty'
import { Memory } from './memory'
import { findPath } from './pathfind'
import { Tactics } from './tactics'
import type { Intercept } from './tactics'
import { POLICE_HEAVY, POLICE_SPEC } from '../data/cars'
import { FX } from '../render/effects'
import { game } from '../state'
import { LaneDriver } from '../world/traffic'
import type { Car } from '../physics/car'

export type PoliceState = 'patrol' | 'pursue' | 'intercept' | 'block' | 'wrecked'
export type PoliceRole = 'ram' | 'flank' | 'block'

export interface PoliceUnit {
  car: Car
  state: PoliceState
  driver: LaneDriver | null
  role: PoliceRole
  side: number
  los: boolean
  losT: number
  path: number[] | null
  pi: number
  repath: number
  goal: number | undefined
  stuckT: number
  reverseT: number
  wreckT: number
  detectT: number
  pit: boolean
  blockT: number
  /** intercept state: the spot to park at, time spent, time parked, parked yet, cooldown before the next dispatch */
  ic: Intercept | null
  icT: number
  icHold: number
  icPark: boolean
  icArrived: boolean
  icCool: number
}

export const Police = {
  ambientTarget: 8,
  ambientTimer: 0,
  /** steps counted, so police think at 60 Hz: half of the units on each step */
  tick: 0,

  spawnUnit(x: number, y: number, theta: number, state: PoliceState, heavy: boolean): PoliceUnit {
    const spec = heavy ? POLICE_HEAVY : POLICE_SPEC
    const car = game.spawnCar(spec, x, y, theta, 'police')
    car.setSpeed(state === 'block' ? 0 : 9)
    const u: PoliceUnit = {
      car,
      state,
      driver: null,
      role: 'ram',
      side: 1,
      los: false,
      losT: 0,
      path: null,
      pi: 0,
      repath: 0,
      goal: undefined,
      stuckT: 0,
      reverseT: 0,
      wreckT: 0,
      detectT: Math.random() * 0.3,
      pit: false,
      blockT: 0,
      ic: null,
      icT: 0,
      icHold: 0,
      icPark: false,
      icArrived: false,
      icCool: 0,
    }
    car.unit = u
    game.cops.push(u)
    return u
  },

  /** Put a unit back on lane-following patrol from wherever it is. */
  makePatrol(u: PoliceUnit): void {
    const city = game.city,
      car = u.car
    const a = city.nearestNode(car.x, car.y)
    const nb = city.neighbors(a)
    let best = nb[0],
      bd = -2
    const fx = Math.cos(car.theta),
      fy = Math.sin(car.theta)
    for (const n of nb) {
      const dx = city.nodeX(n) - car.x,
        dy = city.nodeY(n) - car.y
      const d = (dx * fx + dy * fy) / (hyp(dx, dy) || 1)
      if (d > bd) {
        bd = d
        best = n
      }
    }
    u.driver = new LaneDriver(city, a, best)
    u.driver.speedCap = 13
    u.state = 'patrol'
  },

  spawnAmbient(): void {
    const city = game.city,
      pl = game.player.car
    for (let tries = 0; tries < 10; tries++) {
      const n = city.randomNodeNear(pl.x, pl.y, 180, 420)
      const d = hyp(city.nodeX(n) - pl.x, city.nodeY(n) - pl.y)
      if (d < 180 || d > 420) continue
      // fewer patrols out in the suburbs, plenty downtown and on the highway
      if (city.districtAt(city.nodeX(n), city.nodeY(n)) === 'suburbs' && Math.random() < 0.6) continue
      const nb = city.neighbors(n)
      const to = nb[(Math.random() * nb.length) | 0]
      const p = city.lanePoint(n, to, 0.3)
      if (!game.spotFree(p.x, p.y, 12)) continue
      const u = Police.spawnUnit(p.x, p.y, Math.atan2(p.uy, p.ux), 'patrol', false)
      u.driver = new LaneDriver(city, n, to)
      u.driver.speedCap = 13
      return
    }
  },

  update(dt: number): void {
    const H = game.heat,
      pl = game.player.car
    let patrolCount = 0
    Police.tick++
    for (let i = game.cops.length - 1; i >= 0; i--) {
      const u = game.cops[i],
        car = u.car
      const think = ((i + Police.tick) & 1) === 0 // this unit's controls are refreshed this step (the rest carry over)
      const d = hyp(car.x - pl.x, car.y - pl.y)
      if (car.health <= 0 && u.state !== 'wrecked') {
        u.state = 'wrecked'
        u.wreckT = 0
        if (H.active) H.onCopWrecked()
      }
      switch (u.state) {
        case 'patrol': {
          patrolCount++
          if (think) u.driver!.control(car, dt * 2)
          u.detectT -= dt
          if (u.detectT <= 0 && !H.active) {
            u.detectT = 0.3
            if (d < 85 && pl.speed > 26 && game.city.hasLOS(car.x, car.y, pl.x, pl.y)) H.start('SPEEDING')
          }
          if (d > 620 || u.driver!.stuck > 8) {
            game.removeCar(car)
            game.cops.splice(i, 1)
          }
          break
        }
        case 'pursue':
          if (think) Police.pursue(u, dt * 2, d)
          // too far to matter: drop it, the heat manager respawns pursuers closer
          if (d > 420 && !u.los) {
            game.removeCar(car)
            game.cops.splice(i, 1)
          }
          break
        case 'intercept':
          if (think) Police.intercept(u, dt * 2, d)
          if (d > 600) {
            game.removeCar(car)
            game.cops.splice(i, 1)
          }
          break
        case 'block': {
          const c = car.ctrl
          c.throttle = 0
          c.brake = 1
          c.handbrake = 1
          c.steer = 0
          c.nitro = 0
          u.blockT += dt
          if (u.blockT > 8 && d > 260 && H.active) {
            u.state = 'pursue'
            u.role = 'ram'
            car.boost = 1.3
          } else if (!H.active && d > 200) {
            Police.makePatrol(u)
          }
          if (d > 700) {
            game.removeCar(car)
            game.cops.splice(i, 1)
          }
          break
        }
        case 'wrecked': {
          const c = car.ctrl
          c.throttle = 0
          c.brake = 0.4
          c.handbrake = 0
          c.steer = 0
          c.nitro = 0
          u.wreckT += dt
          if (Math.random() < dt * 14) FX.smoke(car.x, car.y, 0, 0, 2.2, 0.5, true)
          if (u.wreckT > 14 || d > 700) {
            game.removeCar(car)
            game.cops.splice(i, 1)
          }
          break
        }
      }
    }
    // ambient patrol population while no pursuit is running
    Police.ambientTimer -= dt
    if (!H.active && Police.ambientTimer <= 0 && patrolCount < Police.ambientTarget) {
      Police.ambientTimer = 0.5
      Police.spawnAmbient()
    }
  },

  pursue(u: PoliceUnit, dt: number, dist: number): void {
    if (u.icCool > 0) u.icCool -= dt
    const car = u.car,
      pl = game.player.car,
      H = game.heat,
      city = game.city
    u.losT -= dt
    if (u.losT <= 0) {
      u.losT = (0.15 + Math.random() * 0.05) * Difficulty.k.reactMul
      u.los = dist < 280 && city.hasLOS(car.x, car.y, pl.x, pl.y)
    }
    const plSp = pl.speed
    const fx = Math.cos(pl.theta),
      fy = Math.sin(pl.theta)
    const rx = -fy,
      ry = fx
    let tx: number, ty: number, tspeed: number
    car.boost = (dist > 150 ? 1.3 : 1) * Difficulty.k.boostMul
    u.pit = false
    if (u.los || H.heliLit) {
      u.goal = undefined
      const lead = clamp(dist / Math.max(18, car.speed + 8), 0, 1.3)
      let ix = pl.x + pl.wvx * lead * 0.7,
        iy = pl.y + pl.wvy * lead * 0.7
      const relF = (car.x - pl.x) * fx + (car.y - pl.y) * fy
      const relR = (car.x - pl.x) * rx + (car.y - pl.y) * ry
      const closeIn = Math.min(30, 8 + dist * 0.25) // fast when far, gentle when near (matters for a slow player)
      tspeed = Math.max(plSp * 1.12 + 5, closeIn)
      if (u.role === 'flank') {
        ix += rx * u.side * 8
        iy += ry * u.side * 8
        tspeed = Math.max(plSp * 1.06 + 3, closeIn)
      } else if (u.role === 'block' && H.level >= 2) {
        ix = pl.x + pl.wvx * 2.2 + fx * 8
        iy = pl.y + pl.wvy * 2.2 + fy * 8
        tspeed = Math.max(9, plSp * 0.95)
      }
      if (H.level >= 3 && u.role === 'ram' && dist < 18 && relF < 2) {
        const s = relR >= 0 ? 1 : -1
        ix = pl.x - fx * 1.8 + rx * s * 0.9
        iy = pl.y - fy * 1.8 + ry * s * 0.9
        tspeed = plSp + 6
        u.pit = true
      }
      if (relF > 1 && dist < 14 && u.role !== 'block') tspeed = Math.max(6, plSp * 0.75)
      tx = ix
      ty = iy
    } else {
      // no line of sight: follow the road graph to the last known position, then search nearby
      u.repath -= dt
      if (!u.path || u.repath <= 0) {
        u.repath = 1.5
        // learned hideouts: once you have been out of sight for a while, units check the places you tend to hide
        if (H.evade > 2 && u.goal === undefined && Math.random() < 0.7) {
          const t = Memory.pick(H.lastX, H.lastY)
          if (t) {
            u.goal = city.nearestNode(t.x, t.y)
            H.noteMemory(t.x, t.y)
          }
        }
        const s = city.nearestNode(car.x, car.y)
        // cops "hear" a nearby player: close ones head for the real position, far ones for the last sighting
        const g = u.goal !== undefined && dist > 220 ? u.goal : dist < 220 ? city.nearestNode(pl.x, pl.y) : city.nearestNode(H.lastX, H.lastY)
        u.path = findPath(city, s, g) || [s]
        u.pi = 0
        if (u.path.length > 1 && hyp(city.nodeX(u.path[0]) - car.x, city.nodeY(u.path[0]) - car.y) < 18) u.pi = 1
      }
      const path = u.path
      const last = path.length - 1
      let nid = path[Math.min(u.pi, last)]
      let nx = city.nodeX(nid),
        ny = city.nodeY(nid)
      const advR = 10 + car.speed * 0.45
      if (hyp(nx - car.x, ny - car.y) < advR) {
        if (u.pi < last) {
          u.pi++
          nid = path[u.pi]
          nx = city.nodeX(nid)
          ny = city.nodeY(nid)
        } else if (hyp(nx - car.x, ny - car.y) < 20) {
          // arrived: search a random node near the last known position
          const t = Math.random() < 0.7 ? Memory.pick(H.lastX, H.lastY) : null
          if (t) {
            u.goal = city.nearestNode(t.x, t.y)
            H.noteMemory(t.x, t.y)
          } else {
            u.goal = city.randomNodeNear(H.lastX, H.lastY, 0, 280)
          }
          u.repath = 0
        }
      }
      tx = nx
      ty = ny
      tspeed = 42
      if (u.pi < last) {
        const n2 = path[u.pi + 1]
        const ax = nx - car.x,
          ay = ny - car.y,
          bx = city.nodeX(n2) - nx,
          by = city.nodeY(n2) - ny
        const cosA = (ax * bx + ay * by) / (hyp(ax, ay) * hyp(bx, by) + 1e-6)
        if (cosA < 0.6) {
          // brake for the corner: v^2 = vCorner^2 + 2*a*(distance to brake)
          const dd = hyp(ax, ay)
          tspeed = Math.min(tspeed, Math.sqrt(8.5 * 8.5 + 2 * 9 * Math.max(dd - 14, 0)))
        }
      } else tspeed = 14
    }
    steerTo(car, tx, ty)
    speedTo(car, tspeed)
    avoid(car, city)
    if (car.speed < 1.2 && dist > 6 && u.reverseT <= 0) u.stuckT += dt
    else u.stuckT = Math.max(0, u.stuckT - dt)
    if (u.stuckT > 1.0) {
      u.reverseT = 1.2
      u.stuckT = 0
    }
    if (u.reverseT > 0) {
      u.reverseT -= dt
      car.ctrl.throttle = 0
      car.ctrl.brake = 1
      car.ctrl.steer *= -1
    }
  },

  /** Give up the cut-off and go back to chasing. */
  endIntercept(u: PoliceUnit, reason: string): void {
    Tactics.log.push({ reason, t: u.icT, parked: u.icPark })
    if (Tactics.log.length > 40) Tactics.log.shift()
    u.state = 'pursue'
    u.ic = null
    u.icArrived = false
    u.icCool = 10
    u.path = null
    u.role = 'flank'
    u.car.boost = 1.3
  },

  /** Drive to a predicted spot ahead of the player, park across the road there, and hold the line. */
  intercept(u: PoliceUnit, dt: number, dist: number): void {
    const car = u.car,
      pl = game.player.car,
      city = game.city,
      ic = u.ic
    if (!ic || !u.path) return Police.endIntercept(u, 'no-target')
    u.icT += dt
    const wpDist = hyp(ic.wx - car.x, ic.wy - car.y)
    // how far the player still has to go to reach the spot (negative: they got past)
    const plAhead = (ic.wx - pl.x) * ic.dx + (ic.wy - pl.y) * ic.dy
    const turnedAway = pl.speed > 8 && pl.wvx * ic.dx + pl.wvy * ic.dy < pl.speed * 0.3 && hyp(ic.wx - pl.x, ic.wy - pl.y) > 50
    if (u.icT > 28) return Police.endIntercept(u, 'timeout')
    if (plAhead < -10) return Police.endIntercept(u, 'player-passed')
    if (turnedAway) return Police.endIntercept(u, 'player-turned')
    if (u.icHold > 7) return Police.endIntercept(u, 'held')
    car.boost = 1.2
    const c = car.ctrl
    if (u.icPark) {
      u.icHold += dt
      c.throttle = 0
      c.brake = 1
      c.handbrake = 1
      c.steer = 0
      c.nitro = 0
      return
    }
    const path = u.path,
      last = path.length - 1
    let tx: number, ty: number, tspeed: number
    if (u.pi >= last && hyp(city.nodeX(path[last]) - car.x, city.nodeY(path[last]) - car.y) < 25) u.icArrived = true
    if (!u.icArrived) {
      // follow the road graph to the far end of the block
      let nid = path[Math.min(u.pi, last)]
      let nx = city.nodeX(nid),
        ny = city.nodeY(nid)
      if (hyp(nx - car.x, ny - car.y) < 10 + car.speed * 0.45 && u.pi < last) {
        u.pi++
        nid = path[u.pi]
        nx = city.nodeX(nid)
        ny = city.nodeY(nid)
      }
      tx = nx
      ty = ny
      tspeed = 38
      if (u.pi < last) {
        const n2 = path[u.pi + 1]
        const ax = nx - car.x,
          ay = ny - car.y,
          bx = city.nodeX(n2) - nx,
          by = city.nodeY(n2) - ny
        if ((ax * bx + ay * by) / (hyp(ax, ay) * hyp(bx, by) + 1e-6) < 0.6)
          tspeed = Math.min(tspeed, Math.sqrt(72 + 18 * Math.max(hyp(ax, ay) - 14, 0)))
      }
    } else {
      tx = ic.wx
      ty = ic.wy
      tspeed = Math.max(6, Math.min(26, wpDist * 0.9))
    }
    if (u.icArrived && wpDist < 18) {
      // swing across the lanes: aim at the kerb, creep, then stop
      tx = ic.wx - ic.dy * 14
      ty = ic.wy + ic.dx * 14
      tspeed = 4
      if (wpDist < 7 || car.speed < 1.5) u.icPark = true
    }
    const err = steerTo(car, tx, ty)
    if (Math.abs(err) > 0.8) tspeed = Math.min(tspeed, 12) // facing the wrong way: slow down and turn first
    speedTo(car, tspeed)
    avoid(car, city)
    if (car.speed < 1.2 && dist > 6 && u.reverseT <= 0 && !u.icPark) u.stuckT += dt
    else u.stuckT = Math.max(0, u.stuckT - dt)
    if (u.stuckT > 1.0) {
      u.reverseT = 1.2
      u.stuckT = 0
    }
    if (u.reverseT > 0) {
      u.reverseT -= dt
      c.throttle = 0
      c.brake = 1
      c.steer *= -1
    }
  },
}
