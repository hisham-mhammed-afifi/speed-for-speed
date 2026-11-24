import { Difficulty } from './difficulty'
import { findPath } from './pathfind'
import { game } from '../state'
import type { City } from '../world/city'
import type { PoliceUnit } from './police'

/** A stretch of road ahead of the player where a unit can park across the lanes. */
export interface Intercept {
  n0: number
  n1: number
  /** where to park (mid-block, ahead of the player) */
  wx: number
  wy: number
  /** unit vector along the road, from n0 toward n1 */
  dx: number
  dy: number
  /** seconds until the player gets there at the current speed */
  eta: number
}

/** Rough cop travel speed through the streets (corners included), m/s. */
const COP_SPEED = 26

function edgeIntercept(city: City, n0: number, n1: number, alongPl: number, fromLen: number, speed: number): Intercept | null {
  const x0 = city.nodeX(n0),
    y0 = city.nodeY(n0)
  const ex = city.nodeX(n1) - x0,
    ey = city.nodeY(n1) - y0
  const len = Math.hypot(ex, ey)
  if (len < 40) return null
  const along = Math.min(len - 14, Math.max(20, Math.max(alongPl + 90, len * 0.6)))
  const ahead = along - alongPl
  if (ahead < 25) return null
  return {
    n0,
    n1,
    wx: x0 + (ex / len) * along,
    wy: y0 + (ey / len) * along,
    dx: ex / len,
    dy: ey / len,
    eta: (fromLen + ahead) / Math.max(speed, 18), // a player who is still accelerating will be fast soon
  }
}

/**
 * Where is the player probably going? The road edge they are on, and the straight continuation after the next
 * intersection (people mostly keep going straight). Empty when they are too slow to predict.
 */
export function predictRoute(city: City, px: number, py: number, vx: number, vy: number): Intercept[] {
  const speed = Math.hypot(vx, vy)
  if (speed < 8) return []
  const ux = vx / speed,
    uy = vy / speed
  const a = city.nearestNode(px, py)
  let n1 = -1,
    best = 0.6,
    alongPl = 0,
    len = 0
  for (const b of city.neighbors(a)) {
    const ex = city.nodeX(b) - city.nodeX(a),
      ey = city.nodeY(b) - city.nodeY(a)
    const l = Math.hypot(ex, ey)
    const dot = (ex * ux + ey * uy) / l
    const along = ((px - city.nodeX(a)) * ex + (py - city.nodeY(a)) * ey) / l
    if (dot > best && along < l - 15) {
      best = dot
      n1 = b
      alongPl = along
      len = l
    }
  }
  if (n1 < 0) return []
  const out: Intercept[] = []
  const e1 = edgeIntercept(city, a, n1, alongPl, 0, speed)
  if (e1) out.push(e1)
  // after n1, keep going straight for up to two more blocks
  let prev = a,
    cur = n1,
    fromLen = len - alongPl
  for (let k = 0; k < 3; k++) {
    const sx = city.nodeX(cur) - city.nodeX(prev),
      sy = city.nodeY(cur) - city.nodeY(prev)
    const sl = Math.hypot(sx, sy)
    let nxt = -1
    best = 0.85
    for (const c of city.neighbors(cur)) {
      if (c === prev) continue
      const ex = city.nodeX(c) - city.nodeX(cur),
        ey = city.nodeY(c) - city.nodeY(cur)
      const dot = (ex * sx + ey * sy) / (Math.hypot(ex, ey) * sl)
      if (dot > best) {
        best = dot
        nxt = c
      }
    }
    if (nxt < 0) break
    const e = edgeIntercept(city, cur, nxt, 0, fromLen, speed)
    if (e) out.push(e)
    fromLen += Math.hypot(city.nodeX(nxt) - city.nodeX(cur), city.nodeY(nxt) - city.nodeY(cur))
    prev = cur
    cur = nxt
  }
  return out
}

const clampUnit = (v: number) => Math.max(-1, Math.min(1, v))

function pathLength(city: City, path: number[]): number {
  let L = 0
  for (let i = 1; i < path.length; i++) L += Math.hypot(city.nodeX(path[i]) - city.nodeX(path[i - 1]), city.nodeY(path[i]) - city.nodeY(path[i - 1]))
  return L
}

/** How many units try to cut the player off, by heat level (index = level). */
const WANT = [0, 0, 1, 2, 2, 3]

export const Tactics = {
  toastT: 0,
  /** why recent interceptions ended (kept for tests and tuning) */
  log: [] as { reason: string; t: number; parked: boolean }[],

  /**
   * Pick pursuers that can reach a predicted spot ahead of the player before the player does, and send them there.
   * `units` are the current pursuers. Returns how many were dispatched.
   */
  dispatch(level: number, units: PoliceUnit[]): number {
    const city = game.city,
      pl = game.player.car
    const want = Math.max(0, WANT[Math.min(level, 5)] + Difficulty.k.tactBonus)
    let active = 0
    for (const u of game.cops) if (u.state === 'intercept') active++
    if (active >= want) return 0
    const routes = predictRoute(city, pl.x, pl.y, pl.wvx, pl.wvy)
    if (!routes.length) return 0
    // the closest pursuer keeps chasing; the rest are candidates
    const cand = units
      .filter((u) => u.state === 'pursue' && u.icCool <= 0)
      .map((u) => ({ u, d: Math.hypot(u.car.x - pl.x, u.car.y - pl.y) }))
      .sort((p, q) => p.d - q.d)
      .slice(1)
      .filter((c) => c.d > 45 && c.d < 420)
    let sent = 0
    const used = new Set<PoliceUnit>()
    // prefer the farther cut-off point first: it leaves more room for the cops to get there
    for (const r of routes.slice().reverse()) {
      if (active + sent >= want) break
      let bestU: PoliceUnit | null = null,
        bestT = 1e9,
        bestSkip = false,
        bestPath: number[] | null = null
      for (const c of cand) {
        if (used.has(c.u)) continue
        const s = city.nearestNode(c.u.car.x, c.u.car.y)
        const path = findPath(city, s, r.n1)
        if (!path) continue
        if (path.length > 1 && path.includes(r.n0)) continue // would come in from behind the player
        // the nearest node may be behind the cop: skip it (and pay for the turn-around)
        const car = c.u.car
        const behind =
          path.length > 1 &&
          ((city.nodeX(path[0]) - car.x) * Math.cos(car.theta) + (city.nodeY(path[0]) - car.y) * Math.sin(car.theta) < 0 ||
            Math.hypot(city.nodeX(path[0]) - car.x, city.nodeY(path[0]) - car.y) < 18)
        // facing away from the first node costs a slow turn-around
        const tn = behind ? path[1] : path[0]
        const hx = city.nodeX(tn) - car.x,
          hy = city.nodeY(tn) - car.y
        const ang = Math.acos(clampUnit((hx * Math.cos(car.theta) + hy * Math.sin(car.theta)) / (Math.hypot(hx, hy) || 1)))
        const t = pathLength(city, path) / COP_SPEED + 1 + (ang > 1.4 ? 6 : ang > 0.7 ? 2 : 0)
        if (t < r.eta && t < bestT) {
          bestSkip = behind
          bestT = t
          bestU = c.u
          bestPath = path
        }
      }
      if (bestU && bestPath) {
        used.add(bestU)
        bestU.state = 'intercept'
        bestU.ic = r
        bestU.path = bestPath
        bestU.pi = bestSkip ? 1 : 0
        bestU.icT = 0
        bestU.icHold = 0
        bestU.icPark = false
        bestU.icArrived = false
        sent++
      }
    }
    if (sent && Tactics.toastT <= 0) {
      Tactics.toastT = 14
      game.toast('UNITS CUTTING YOU OFF', '#ff9a3c')
    }
    return sent
  },

  tick(dt: number): void {
    if (Tactics.toastT > 0) Tactics.toastT -= dt
  },

  reset(): void {
    Tactics.toastT = 0
  },
}
