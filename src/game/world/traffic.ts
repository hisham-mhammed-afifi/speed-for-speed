import { clamp, hyp, pick } from '../core/math'
import { avoid, capForTraffic, speedTo, steerTo } from '../ai/drive'
import { TRAFFIC_BIKES, TRAFFIC_CARS, TRAFFIC_TRUCKS } from '../data/cars'
import { game } from '../state'
import { carGrid } from './carGrid'
import type { Car } from '../physics/car'
import type { District } from '../types'
import type { City } from './city'
import type { LanePoint } from './city'

const nearScratch: Car[] = []
const lp: LanePoint = { x: 0, y: 0, ux: 0, uy: 0, len: 0 }
/** the cars of units with sirens on, rebuilt each step (no per-step allocation) */
const sirenScratch: Car[] = []

/** How likely a candidate spawn point is accepted, per district (1 = always). */
const TRAFFIC_WEIGHT: Record<District, number> = { downtown: 1, port: 0.55, suburbs: 0.45, highway: 1 }

// ---------- right of way ----------
// Every car that is about to enter a junction (three or more roads meeting) books it first. A booking is only granted when it
// does not cross the path of a booking that already holds the junction (or that has been waiting longer), so two cars never
// enter the same junction on crossing paths: one waits at the line. Roundabouts have their own rule (yield to the ring).
interface Hold {
  drv: LaneDriver
  node: number
  /** the direction we arrive in and the direction we leave in (unit vectors) */
  inX: number
  inY: number
  outX: number
  outY: number
  /** 0 straight on, 1 right turn, 2 left turn or U-turn */
  turn: 0 | 1 | 2
  since: number
  granted: boolean
  grantedAt: number
  seen: number
  dead: boolean
}
const holds = new Map<number, Hold[]>()
let clock = 0

/** Two cars can share a junction when they follow one another, or pass head on without either turning across. */
function compatible(a: Hold, b: Hold): boolean {
  const d = a.inX * b.inX + a.inY * b.inY
  if (d > 0.85) return true
  if (d < -0.85) return a.turn < 2 && b.turn < 2
  return false
}

function dropHold(h: Hold): void {
  h.dead = true
  const list = holds.get(h.node)
  if (!list) return
  const k = list.indexOf(h)
  if (k >= 0) list.splice(k, 1)
  if (!list.length) holds.delete(h.node)
}

const TWO_PI = Math.PI * 2
const wrapPi = (a: number): number => {
  a = (a + Math.PI) % TWO_PI
  if (a < 0) a += TWO_PI
  return a - Math.PI
}
const wrapPos = (a: number): number => {
  a %= TWO_PI
  return a < 0 ? a + TWO_PI : a
}

/** A car going round a roundabout: how far round it has to go, and how far it has come. */
interface Ring {
  cx: number
  cy: number
  rc: number
  need: number
  travel: number
  last: number
  /** leaving: the car is following the curve out to its exit road (connX / connY) */
  exiting: boolean
}

const nbBuf: number[] = []

/** Follows the road graph, one lane edge at a time (right-hand traffic). Used by civilians and patrol cops. */
export class LaneDriver {
  city: City
  a: number
  b: number
  next = -1
  speedCap = 12
  stuck = 0
  turnSlow = false
  /** a siren is close: hug the kerb and slow right down */
  pullOver = false
  /** sideways shift (m, positive = right) to dodge a fast car coming up behind */
  nudge = 0
  /** which of the highway's three lanes this driver uses, as a shift from the middle lane's centre (m, positive = right) */
  hwyLane = [-3.6, 0, 3.6][(Math.random() * 3) | 0]
  /** the booking for the junction ahead (or the one just behind), and the node known to be a plain road with nothing to book */
  hold: Hold | null = null
  plain = -1
  plainCity: City | null = null
  ring: Ring | null = null
  /** the path through the junction ahead (a smooth curve from our lane on the way in to our lane on the way out) and our progress along it */
  connNode = -1
  connNext = -1
  connX: number[] = []
  connY: number[] = []
  connI = 0
  connStep = 1

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
    // winding roads are a draw: take one more often, and keep following a bend once on it
    const bends = nb.filter((n) => city.isCurve(this.b, n))
    if (bends.length && Math.random() < (city.isCurve(this.a, this.b) ? 0.7 : 0.3)) return bends[(Math.random() * bends.length) | 0]
    const grid = nb.filter((n) => !city.isCurve(this.b, n))
    if (!grid.length) return nb[(Math.random() * nb.length) | 0]
    const straight = grid.find((n) => Math.abs((city.nodeX(n) - bx) * (by - ay) - (city.nodeY(n) - by) * (bx - ax)) < 1)
    return straight !== undefined && Math.random() < 0.55 ? straight : grid[(Math.random() * grid.length) | 0]
  }

  /** Lay out the curve through the junction ahead, so a turn stays in its own lanes instead of cutting the corner. */
  private buildConn(len: number, hwn: number): void {
    const city = this.city
    const offIn = city.laneOffset(this.a, this.b) + (city.edgeWidth(this.a, this.b) >= 28 ? this.hwyLane : 0)
    const offOut = city.laneOffset(this.b, this.next) + (city.edgeWidth(this.b, this.next) >= 28 ? this.hwyLane : 0)
    city.edgePoint(this.a, this.b, Math.max(0, len - hwn - 3), offIn, lp)
    const x0 = lp.x,
      y0 = lp.y,
      tx0 = lp.ux,
      ty0 = lp.uy
    city.edgePoint(this.b, this.next, Math.min(city.edgeLength(this.b, this.next), hwn + 6), offOut, lp)
    const x1 = lp.x,
      y1 = lp.y,
      tx1 = lp.ux,
      ty1 = lp.uy
    const chord = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) || 1
    const N = 12
    this.connX.length = 0
    this.connY.length = 0
    for (let k = 0; k <= N; k++) {
      const u = k / N,
        u2 = u * u,
        u3 = u2 * u
      const h00 = 2 * u3 - 3 * u2 + 1,
        h10 = u3 - 2 * u2 + u,
        h01 = -2 * u3 + 3 * u2,
        h11 = u3 - u2
      this.connX.push(h00 * x0 + h10 * tx0 * chord + h01 * x1 + h11 * tx1 * chord)
      this.connY.push(h00 * y0 + h10 * ty0 * chord + h01 * y1 + h11 * ty1 * chord)
    }
    this.connStep = chord / N
    this.connNode = this.b
    this.connNext = this.next
    this.connI = 0
  }

  /** Forget any booking (the car is leaving the simulation, or the node ids are about to change). */
  release(): void {
    if (this.hold) dropHold(this.hold)
    this.hold = null
  }

  /** The junction ahead: book it, and return the speed we may carry to it (Infinity once the booking is granted). */
  private junction(car: Car, len: number, toEnd: number, hwn: number, extra: number): number {
    const city = this.city
    if (this.plain === this.b && this.plainCity === city) return Infinity
    let h = this.hold
    if (!h || h.node !== this.b) {
      this.release()
      if (city.neighborsInto(this.b, nbBuf).length < 3) {
        this.plain = this.b // a straight road or a bend: nothing to give way to
        this.plainCity = city
        return Infinity
      }
      city.edgePoint(this.a, this.b, len, 0, lp)
      const ix = lp.ux,
        iy = lp.uy
      city.edgePoint(this.b, this.next, 0, 0, lp)
      const dot = ix * lp.ux + iy * lp.uy,
        cross = ix * lp.uy - iy * lp.ux
      h = {
        drv: this,
        node: this.b,
        inX: ix,
        inY: iy,
        outX: lp.ux,
        outY: lp.uy,
        turn: dot > 0.8 ? 0 : cross > 0 && dot > -0.8 ? 1 : 2,
        since: clock,
        granted: false,
        grantedAt: 0,
        seen: clock,
        dead: false,
      }
      let list = holds.get(this.b)
      if (!list) holds.set(this.b, (list = []))
      list.push(h)
      this.hold = h
    }
    h.seen = clock
    if (!h.granted && (toEnd < hwn - 1 || this.canGo(car, h, hwn, extra))) {
      h.granted = true // (a car already in the box can't stop there: it goes)
      h.grantedAt = clock
    }
    if (h.granted) return Infinity
    return Math.max(0, (toEnd - (hwn + 8 + extra)) * 0.8) // the stop line is well back, so cars leaving the junction have straightened up by the time they pass the queue
  }

  private canGo(car: Car, h: Hold, hwn: number, extra: number): boolean {
    for (const o of holds.get(h.node)!) {
      if (o === h || o.dead || compatible(h, o)) continue
      if (o.granted || o.since < h.since) return false // someone is in the junction on a crossing path, or was here first
    }
    // never drive into the junction if the road out of it is full: that is how a junction jams. (Only a very long wait overrides.)
    return clock - h.since > 25 || !this.exitBlocked(car, h, hwn, extra)
  }

  /** A stopped or crawling car on the first stretch of the road we are about to leave by. */
  private exitBlocked(car: Car, h: Hold, hwn: number, extra: number): boolean {
    const city = this.city
    const nx = city.nodeX(this.b),
      ny = city.nodeY(this.b)
    city.edgePoint(this.b, this.next, hwn + 8, city.laneOffset(this.b, this.next), lp)
    const near = carGrid.query(lp.x, lp.y, 9, nearScratch)
    for (let i = 0; i < near.length; i++) {
      const o = near[i]
      if (o === car || o.speed > 2.5) continue
      const rx = o.x - nx,
        ry = o.y - ny
      const along = rx * h.outX + ry * h.outY
      const lat = Math.abs(rx * -h.outY + ry * h.outX - city.laneOffset(this.b, this.next))
      if (along > hwn - 1 && along < hwn + 16 + 2 * extra + Math.max(0, o.hx - 2.4) && lat < 2.6 + Math.max(0, o.hy - 1)) return true
    }
    return false
  }

  /** Roundabout entry: true when no car on the ring will arrive at our entry point before we are on it. */
  private ringClear(car: Car, cx: number, cy: number, ro: number): boolean {
    const phi0 = Math.atan2(car.y - cy, car.x - cx)
    const near = carGrid.query(cx, cy, ro + 3, nearScratch)
    for (let i = 0; i < near.length; i++) {
      const o = near[i]
      if (o === car) continue
      const dx = o.x - cx,
        dy = o.y - cy
      if (dx * dx + dy * dy > (ro + 0.5) * (ro + 0.5)) continue // waiting in an arm is not on the ring
      const dl = wrapPi(Math.atan2(dy, dx) - phi0) // positive: upstream of us, still to pass our entry
      if (dl > -0.35 && dl < 1.4) return false
    }
    return true
  }

  private controlRing(car: Car, dt: number): void {
    const r = this.ring!
    const phi = Math.atan2(car.y - r.cy, car.x - r.cx)
    const d = wrapPi(r.last - phi) // positive going the right way round (counter-clockwise on the map)
    if (d > 0 && d < 1) r.travel += d
    r.last = phi
    if (!r.exiting && (r.travel >= r.need - 0.45 || r.travel > 7)) {
      // time to leave: a curve from where we are, along the way we are heading, out to our lane on the exit road
      const city = this.city
      const ro = city.roundAt(this.b)?.ro ?? r.rc + 4
      city.edgePoint(this.b, this.next, ro + 7, city.laneOffset(this.b, this.next), lp)
      const x1 = lp.x,
        y1 = lp.y,
        tx1 = lp.ux,
        ty1 = lp.uy
      const chord = Math.sqrt((x1 - car.x) * (x1 - car.x) + (y1 - car.y) * (y1 - car.y)) || 1
      const tx0 = Math.cos(car.theta),
        ty0 = Math.sin(car.theta)
      const N = 12
      this.connX.length = 0
      this.connY.length = 0
      for (let k = 0; k <= N; k++) {
        const u = k / N,
          u2 = u * u,
          u3 = u2 * u
        const h00 = 2 * u3 - 3 * u2 + 1,
          h10 = u3 - 2 * u2 + u,
          h01 = -2 * u3 + 3 * u2,
          h11 = u3 - u2
        this.connX.push(h00 * car.x + h10 * tx0 * chord + h01 * x1 + h11 * tx1 * chord)
        this.connY.push(h00 * car.y + h10 * ty0 * chord + h01 * y1 + h11 * ty1 * chord)
      }
      this.connStep = chord / N
      this.connI = 0
      r.exiting = true
    }
    if (r.exiting) {
      const n = this.connX.length - 1
      const sq = (k: number) => (car.x - this.connX[k]) * (car.x - this.connX[k]) + (car.y - this.connY[k]) * (car.y - this.connY[k])
      let i = this.connI
      while (i < n && sq(i + 1) < sq(i)) i++
      this.connI = i
      if (i >= n - 1 && sq(n) < 25) {
        this.a = this.b // our exit: from here it is an ordinary road again
        this.b = this.next
        this.next = -1
        this.ring = null
        this.turnSlow = false
        this.plain = -1
        this.connNode = -1
        return
      }
      const k = Math.min(n, i + Math.max(1, Math.ceil((3 + car.speed * 0.4) / this.connStep)))
      steerTo(car, this.connX[k], this.connY[k])
      const target = capForTraffic(car, Math.min(this.speedCap, 7), undefined, this.connX[k] - car.x, this.connY[k] - car.y)
      speedTo(car, target)
      if (car.speed < 0.6 && target > 2) this.stuck += dt
      else this.stuck = Math.max(0, this.stuck - dt * 2)
      return
    }
    const la = clamp(6 + car.speed * 0.5, 7, 13) / r.rc
    steerTo(car, r.cx + Math.cos(phi - la) * r.rc, r.cy + Math.sin(phi - la) * r.rc)
    const rtx = r.cx + Math.cos(phi - la) * r.rc,
      rty = r.cy + Math.sin(phi - la) * r.rc
    const target = capForTraffic(car, Math.min(this.speedCap, 7), undefined, rtx - car.x, rty - car.y)
    speedTo(car, target)
    if (car.speed < 0.6 && target > 2) this.stuck += dt
    else this.stuck = Math.max(0, this.stuck - dt * 2)
  }

  control(car: Car, dt: number): void {
    const city = this.city
    if (this.ring) {
      this.controlRing(car, dt)
      return
    }
    let len = city.edgeLength(this.a, this.b)
    let t = city.edgeProject(this.a, this.b, car.x, car.y)
    let toEnd = len - t
    if (this.hold) this.hold.seen = clock
    if (toEnd < 45 && this.next < 0) {
      this.next = this.pickNext()
      city.edgePoint(this.a, this.b, len, 0, lp) // the way we leave this edge...
      const ex = lp.ux,
        ey = lp.uy
      city.edgePoint(this.b, this.next, 0, 0, lp) // ...and the way the next one starts
      this.turnSlow = Math.abs(ex * lp.ux + ey * lp.uy) < 0.5 // a turn, not straight on
    }
    const rd = city.roundAt(this.b)
    const hwn = city.nodeHalfWidth(this.b)
    const extra = Math.max(0, car.hx - 2.4) // how much longer than a car this vehicle is (a lorry needs room to clear a junction)
    let cap = Infinity
    let inConn = false
    if (rd && this.next >= 0) {
      // a roundabout: slow down, give way to the ring, then go round it
      cap = 9
      if (toEnd < rd.ro + 6 + extra) {
        if (!this.ringClear(car, rd.cx, rd.cy, rd.ro)) cap = Math.max(0, (toEnd - (rd.ro + 2 + extra)) * 0.8)
        else if (toEnd <= rd.ro + 3 + extra) {
          city.edgePoint(this.b, this.next, 0, 0, lp)
          const phi0 = Math.atan2(car.y - rd.cy, car.x - rd.cx)
          const phiExit = Math.atan2(lp.uy, lp.ux) + city.laneOffset(this.b, this.next) / rd.rc // where our exit lane leaves the circle
          this.ring = { cx: rd.cx, cy: rd.cy, rc: rd.rc, need: wrapPos(phi0 - phiExit), travel: 0, last: phi0, exiting: false }
          this.release()
          this.controlRing(car, dt)
          return
        }
      }
    } else if (this.next >= 0 && toEnd <= hwn + 3) {
      // inside the junction: follow the curve from our lane in to our lane out, and hand over to the next road at its end
      if (this.connNode !== this.b || this.connNext !== this.next) this.buildConn(len, hwn)
      const n = this.connX.length - 1
      const sq = (k: number) => (car.x - this.connX[k]) * (car.x - this.connX[k]) + (car.y - this.connY[k]) * (car.y - this.connY[k])
      let i = this.connI
      while (i < n && sq(i + 1) < sq(i)) i++
      this.connI = i
      if (i >= n - 1 && sq(n) < 25) {
        this.a = this.b
        this.b = this.next
        this.next = -1
        this.turnSlow = false
        this.connNode = -1
        len = city.edgeLength(this.a, this.b)
        t = city.edgeProject(this.a, this.b, car.x, car.y)
        toEnd = len - t
      } else inConn = true
    }
    // through the junction we booked: let go of it once we are clear
    if (this.hold && this.hold.node !== this.b && (this.hold.node !== this.a || t > city.nodeHalfWidth(this.hold.node) + 4 + 2 * extra)) this.release()
    else if (this.hold?.dead) this.hold = null
    if (!rd && this.next >= 0 && toEnd < hwn + Math.max(20, 12 + car.speed * 1.4)) cap = this.junction(car, len, toEnd, hwn, extra)
    const w = city.edgeWidth(this.a, this.b)
    const lane = city.laneOffset(this.a, this.b)
    // pulling over means into the parking strip / shoulder, not the middle of the road
    // a lorry swings wider than a car as it straightens up after a turn, so it keeps a little closer to its own kerb
    const kerb = car.spec.truck && w >= 10 && w < 28 ? 0.45 : 0
    const off = (this.pullOver ? Math.min(w / 2 - 1.3, lane + 1.8) : lane) + this.nudge + kerb + (w >= 28 ? this.hwyLane : 0)
    const la = clamp(6 + car.speed * 0.55, 7, 20)
    const tt = Math.min(Math.max(t, 0) + la, len)
    city.edgePoint(this.a, this.b, tt, off, lp)
    const ux = lp.ux,
      uy = lp.uy
    let aimX: number, aimY: number
    if (inConn) {
      const k = Math.min(this.connX.length - 1, this.connI + Math.max(1, Math.ceil((3 + car.speed * 0.4) / this.connStep)))
      aimX = this.connX[k]
      aimY = this.connY[k]
    } else {
      aimX = lp.x
      aimY = lp.y
    }
    steerTo(car, aimX, aimY)
    let target = this.speedCap * (w >= 28 ? 2 : w >= 18 ? 1.3 : w <= 6 ? 0.6 : 1) // the highway ring is fast
    if (city.isCurve(this.a, this.b)) target = Math.min(target, 10) // ease through the bends
    if (this.turnSlow && toEnd < 40) target = Math.min(target, car.spec.truck ? 5 : 6.5)
    // a siren: slow down, but never stop in the middle of a junction
    if (this.pullOver) target = Math.min(target, this.next >= 0 && toEnd < hwn + 20 ? 6 : 3)
    target = Math.min(target, cap)
    // cross traffic: ease off for a fast car that is about to cross our path at the next intersection
    if (toEnd > 0 && toEnd < 28) {
      const nx = city.nodeX(this.b),
        ny = city.nodeY(this.b)
      const near = carGrid.query(nx, ny, 18, nearScratch)
      for (let i = 0; i < near.length; i++) {
        const o = near[i]
        if (o === car || o.speed < 3) continue
        const along = Math.abs(Math.cos(o.theta) * ux + Math.sin(o.theta) * uy)
        if (along < 0.5) {
          target = Math.min(target, Math.max(0, (toEnd - 8) * 0.6))
          break
        }
      }
    }
    target = capForTraffic(car, target, undefined, aimX - car.x, aimY - car.y)
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
  /** seconds spent (nearly) motionless: a car that has been wedged for a long time, out of sight, is recycled */
  still?: number
}

export const Traffic = {
  /** how many civilians to keep around the player (the engine raises/lowers this for phones) */
  target: 45,
  timer: 0,
  tick: 0,

  /** Drive every civilian, recycle far-away ones and spawn new ones near the player. */
  /** Forget every junction booking (node ids change when the world window moves, and a new run starts clean). */
  clearHolds(): void {
    for (const list of holds.values()) for (const h of list) h.dead = true
    holds.clear()
  },

  /** The bookings at a junction (for tests and the debug view). */
  holdsAt(node: number): readonly { granted: boolean }[] {
    return holds.get(node) ?? []
  },

  /** Advance the junction clock and cancel bookings of cars that went away or have been stuck in a junction for far too long. */
  advance(dt: number): void {
    clock += dt
    for (const [node, list] of holds) {
      for (let k = list.length - 1; k >= 0; k--) {
        const h = list[k]
        if (clock - h.seen > 1.5 || (h.granted && clock - h.grantedAt > 14)) {
          h.dead = true
          list.splice(k, 1)
        }
      }
      if (!list.length) holds.delete(node)
    }
  },

  update(dt: number): void {
    Traffic.advance(dt)
    Traffic.timer -= dt
    Traffic.tick++
    const pl = game.player.car
    sirenScratch.length = 0
    if (game.heat.active) for (const u of game.cops) if (u.state === 'pursue' || u.state === 'intercept') sirenScratch.push(u.car)
    const plFast = pl.speed > 18
    for (let i = game.civs.length - 1; i >= 0; i--) {
      const u = game.civs[i],
        car = u.car
      const d = hyp(car.x - pl.x, car.y - pl.y)
      // civilians think at 60 Hz (every other step), far ones at 30 Hz; their last controls simply carry over
      const far = d > 250
      if (((i + Traffic.tick) & (far ? 3 : 1)) !== 0 && car.health > 0) continue
      const mult = far ? 4 : 2 // timers inside the driver run in 'think' time

      // pull over when a siren is close
      let siren = false
      for (let k = 0; k < sirenScratch.length; k++) {
        const c = sirenScratch[k]
        const ddx = c.x - car.x,
          ddy = c.y - car.y
        if (ddx * ddx + ddy * ddy < 1600) {
          siren = true
          break
        }
      }
      u.driver.pullOver = siren

      // swerve away from a fast player closing in on our lane
      let wantNudge = 0
      if (plFast && d < 40) {
        const c = Math.cos(car.theta),
          s = Math.sin(car.theta)
        const rx = pl.x - car.x,
          ry = pl.y - car.y
        const ahead = rx * c + ry * s
        const lat = -rx * s + ry * c // + = player is to our right
        if (Math.abs(ahead) < 35 && Math.abs(lat) < 5) wantNudge = -Math.sign(lat || 1) * Math.min(2.2, 0.6 + ((35 - Math.abs(ahead)) / 35) * 1.6)
      }
      u.driver.nudge += (wantNudge - u.driver.nudge) * Math.min(1, 4 * dt * mult)

      u.driver.control(car, dt * mult)
      u.still = car.speed < 0.5 ? (u.still ?? 0) + dt * mult : 0
      if (d > 360 || u.driver.stuck > 7 || (u.still > 25 && d > 90) || car.health <= 0) {
        if (car.health <= 0 && d < 120) {
          car.ctrl.throttle = 0
          car.ctrl.brake = 0.4
          u.dead = (u.dead || 0) + dt * mult
          if (u.dead < 8) continue
        }
        u.driver.release()
        game.removeCar(car)
        game.civs.splice(i, 1)
      }
    }
    if (Traffic.timer <= 0 && game.civs.length < Traffic.target) {
      Traffic.timer = 0.08
      Traffic.spawn()
    }
  },

  spawn(): void {
    const city = game.city,
      pl = game.player.car
    // on the highway, half the tries put cars on the highway itself, mostly ahead of you
    const hwy = pl.speed > 15 && city.districtAt(pl.x, pl.y) === 'highway'
    for (let tries = 0; tries < 10; tries++) {
      let n: number
      if (hwy && tries % 2 === 0) {
        const r = 100 + Math.random() * 220,
          a = Math.atan2(pl.wvy, pl.wvx) + (Math.random() < 0.3 ? Math.PI : 0)
        n = city.nearestNode(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r)
      } else n = city.randomNodeNear(pl.x, pl.y, 90, 330) // the world is endless: pick near the player, not anywhere
      const nx = city.nodeX(n),
        ny = city.nodeY(n)
      const d = hyp(nx - pl.x, ny - pl.y)
      if (d < 90 || d > 340) continue // never inside the camera's view, so cars don't pop in
      const dist = city.districtAt(nx, ny)
      if (Math.random() > TRAFFIC_WEIGHT[dist]) continue // busy downtown, sparse suburbs
      let nb = city.neighbors(n)
      if (dist === 'highway') {
        const along = nb.filter((m) => city.districtAt(city.nodeX(m), city.nodeY(m)) === 'highway')
        if (along.length) nb = along
      }
      const to = nb[(Math.random() * nb.length) | 0]
      const t = 0.25 + Math.random() * 0.4
      const p = city.lanePoint(n, to, t)
      // one vehicle in ten is a motorcycle, one in eight a lorry or pickup (mostly pickups), the rest cars
      const r = Math.random()
      const spec = r < 0.1 ? pick(TRAFFIC_BIKES) : r < 0.22 ? TRAFFIC_TRUCKS[Math.random() * 13 < 6 ? 0 : Math.random() * 7 < 4 ? 1 : 2] : pick(TRAFFIC_CARS)
      if (!game.spotFree(p.x, p.y, 12 + 2 * Math.max(0, spec.len * 0.485 - 2.4))) continue
      const car = game.spawnCar(spec, p.x, p.y, Math.atan2(p.uy, p.ux), 'civil')
      car.setSpeed(8)
      const drv = new LaneDriver(city, n, to)
      drv.speedCap = (9 + Math.random() * 6) * (spec.truck ? 0.8 : 1) // lorries are the slow ones
      game.civs.push({ car, driver: drv })
      return
    }
  },
}
