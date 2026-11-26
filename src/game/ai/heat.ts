import { clamp, hyp, wrapAngle } from '../core/math'
import { Phys } from '../physics/world'
import { game } from '../state'
import { Difficulty } from './difficulty'
import { Memory } from './memory'
import { Police } from './police'
import { Tactics } from './tactics'
import { DISTRICT_NAMES } from '../types'
import type { PoliceUnit } from './police'

const THRESH = [0, 45, 110, 190, 290]
const COPS = [0, 4, 6, 8, 10, 12]

export interface Spike {
  x: number
  y: number
  hx: number
  hy: number
  hit: boolean
}

export interface Roadblock {
  x: number
  y: number
  units: PoliceUnit[]
  t: number
}

export interface Heli {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  rot: number
}

function nearestIdx(arr: number[], v: number): number {
  let bi = 0,
    bd = 1e9
  for (let k = 0; k < arr.length; k++) {
    const d = Math.abs(arr[k] - v)
    if (d < bd) {
      bd = d
      bi = k
    }
  }
  return bi
}

interface AheadSpot {
  x: number
  y: number
  horiz: boolean
  w: number
}

/** Find a spot on the road ahead of the player, mid-block, plus the road axis there. */
function aheadSpot(dist: number): AheadSpot | null {
  const city = game.city,
    pl = game.player.car
  if (pl.speed < 8) return null
  const horiz = Math.abs(pl.wvx) > Math.abs(pl.wvy)
  if (horiz) {
    let x = pl.x + Math.sign(pl.wvx) * dist
    const j = nearestIdx(city.hy, pl.y)
    x = clamp(x, city.vx[0] + 40, city.vx[city.NV - 1] - 40)
    let k = 0
    while (k < city.NV - 2 && x >= city.vx[k + 1]) k++
    if (!city.neighbors(city.nodeId(k, j)).includes(city.nodeId(k + 1, j))) return null // that stretch is blocked (river without a bridge, ...)
    return { x: (city.vx[k] + city.vx[k + 1]) / 2, y: city.hy[j], horiz: true, w: city.hw[j] }
  }
  let y = pl.y + Math.sign(pl.wvy) * dist
  const i = nearestIdx(city.vx, pl.x)
  y = clamp(y, city.hy[0] + 40, city.hy[city.NH - 1] - 40)
  let k = 0
  while (k < city.NH - 2 && y >= city.hy[k + 1]) k++
  if (!city.neighbors(city.nodeId(i, k)).includes(city.nodeId(i, k + 1))) return null
  return { x: city.vx[i], y: (city.hy[k] + city.hy[k + 1]) / 2, horiz: false, w: city.vw[i] }
}

/**
 * The police pursuit: heat level, bounty, bust / evade meters, roadblocks, spike strips and the helicopter.
 * One instance (`heat`) lives for the whole session; reset() clears it between runs.
 */
export class HeatManager {
  active = false
  level = 0
  points = 0
  bounty = 0
  time = 0
  bust = 0
  evade = 0
  evadeNeeded = 12
  lastX = 0
  lastY = 0
  visible = false
  heliLit = false
  nearCount = 0
  spawnT = 0
  roleT = 0
  tacticsT = 0
  memToastT = 0
  /** coordinated tactics (interceptors); switchable so the AI can be compared with and without */
  tactics = true
  blockT = 0
  spikeT = 0
  heliT = 0
  grace = 0
  /** how long you have held (nearly) one heading at speed, the heading itself, and whether the dispatch has worked out where you are going */
  straightT = 0
  headRef = 0
  predictable = false
  /** seconds on the highway, and the countdown to the next highway roadblock */
  hwyT = 0
  hwyBlockT = 0
  blocks: Roadblock[] = []
  spikes: Spike[] = []
  heli: Heli | null = null
  copsDown = 0
  reason = ''

  reset(): void {
    this.active = false
    this.level = 0
    this.points = 0
    this.bounty = 0
    this.time = 0
    this.bust = 0
    this.evade = 0
    this.visible = false
    this.heliLit = false
    this.nearCount = 0
    this.spawnT = 0
    this.roleT = 0
    this.tacticsT = 0
    this.memToastT = 0
    Tactics.reset()
    this.blockT = 20
    this.spikeT = 25
    this.straightT = 0
    this.predictable = false
    this.hwyT = 0
    this.hwyBlockT = 8
    this.heliT = 0
    this.grace = 0
    this.copsDown = 0
    this.reason = ''
    this.blocks = []
    this.spikes = []
    this.heli = null
  }

  start(reason: string, level?: number): void {
    if (this.active) return
    this.reset()
    this.active = true
    this.reason = reason
    this.grace = 10
    this.points = level ? THRESH[level - 1] : 0
    this.level = level || 1
    const pl = game.player.car
    this.lastX = pl.x
    this.lastY = pl.y
    this.evadeNeeded = Math.max(8, 12 + this.level * 3 + Difficulty.k.evadeAdd)
    game.toast('PURSUIT: ' + reason, '#ff4d4d')
    if (Difficulty.k.s > 0.6) game.toast('MOST WANTED: EXTRA UNITS', '#ff9a3c')
    for (const u of game.cops) {
      if (u.state === 'patrol' && hyp(u.car.x - pl.x, u.car.y - pl.y) < 420) {
        u.state = 'pursue'
        u.role = 'ram'
        u.path = null
        u.los = false
      }
    }
  }

  stop(): void {
    this.active = false
    for (const u of game.cops) {
      if (u.state === 'pursue' || u.state === 'block' || u.state === 'intercept') Police.makePatrol(u)
    }
    this.blocks = []
    this.spikes = []
    this.heli = null
    this.heliLit = false
    this.bust = 0
    this.evade = 0
  }

  onCopWrecked(): void {
    this.bounty += 500
    this.points += 14
    this.copsDown++
    game.toast('COP DOWN  +$500', '#ffd23f')
  }

  onCivilCrash(): void {
    this.bounty += 40
    this.points += 2.5
  }

  /** Radio chatter when the police act on what they remember about your hideouts (rate-limited). */
  noteMemory(x: number, y: number): void {
    if (this.memToastT > 0) return
    this.memToastT = 25
    game.toast('Dispatch: covering ' + DISTRICT_NAMES[game.city.districtAt(x, y)], '#6ab7ff')
  }

  /**
   * Where to set a trap: on the street leading into a remembered hideout that lies roughly ahead of the player,
   * otherwise a plain spot down the road ahead.
   */
  private trapSpot(dist: number): AheadSpot | null {
    const city = game.city,
      pl = game.player.car
    if (pl.speed >= 8) {
      const hx = pl.wvx / pl.speed,
        hy = pl.wvy / pl.speed
      let best: { x: number; y: number } | null = null,
        bs = 0
      for (const c of Memory.hot()) {
        const dx = c.x - pl.x,
          dy = c.y - pl.y,
          d = hyp(dx, dy)
        if (d < 120 || d > 420) continue
        const dot = (dx * hx + dy * hy) / d
        if (dot < 0.6) continue
        const sc = (c.w * dot) / (1 + d / 300)
        if (sc > bs) {
          bs = sc
          best = c
        }
      }
      if (best) {
        const n = city.nearestNode(best.x, best.y)
        let to = -1,
          bd = 1e9
        for (const m of city.neighbors(n)) {
          if (city.isCurve(n, m)) continue // traps go on straight streets
          const d = hyp(city.nodeX(m) - pl.x, city.nodeY(m) - pl.y)
          if (d < bd) {
            bd = d
            to = m
          }
        }
        if (to >= 0) {
          const x0 = city.nodeX(n),
            y0 = city.nodeY(n),
            x1 = city.nodeX(to),
            y1 = city.nodeY(to)
          const horiz = Math.abs(x1 - x0) > Math.abs(y1 - y0)
          const w = horiz ? city.hw[nearestIdx(city.hy, y0)] : city.vw[nearestIdx(city.vx, x0)]
          this.noteMemory(best.x, best.y)
          return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, horiz, w }
        }
      }
    }
    return aheadSpot(dist)
  }

  private placeRoadblock(dist = 220 + Math.random() * 60, cars = 2): void {
    const s = this.trapSpot(dist)
    if (!s) return
    const heavy = this.level >= 4
    const base = s.horiz ? Math.PI / 2 : 0
    const blk: Roadblock = { x: s.x, y: s.y, units: [], t: 0 }
    for (const side of cars === 3 ? [-1, 0, 1] : [-1, 1]) {
      const off = side * s.w * (cars === 3 ? 0.35 : 0.2)
      const x = s.horiz ? s.x : s.x + off,
        y = s.horiz ? s.y + off : s.y
      if (!game.spotFree(x, y, 5)) continue
      const u = Police.spawnUnit(x, y, base + (side || 0.3) * 0.45 + (Math.random() - 0.5) * 0.2, 'block', heavy)
      Phys.setMass(u.car, u.car.spec.mass * 1.6)
      blk.units.push(u)
    }
    if (blk.units.length) {
      this.blocks.push(blk)
      game.toast('ROADBLOCK AHEAD', '#ff9a3c')
    }
  }

  private placeSpikes(): void {
    const s = this.trapSpot(150 + Math.random() * 50)
    if (!s) return
    const hx = s.horiz ? 0.8 : s.w * 0.45,
      hy = s.horiz ? s.w * 0.45 : 0.8
    this.spikes.push({ x: s.x, y: s.y, hx, hy, hit: false })
    game.toast('SPIKE STRIPS AHEAD', '#ff9a3c')
  }

  private spawnPursuer(): void {
    const city = game.city,
      pl = game.player.car
    let pick: number | null = null
    // most of the time, send the next unit to meet you head on: out in front, inside a cone around your heading
    const ahead = pl.speed > 12 && Math.random() < 0.6
    for (let tries = 0; tries < 20; tries++) {
      let n: number
      if (ahead && tries < 12) {
        const a = Math.atan2(pl.wvy, pl.wvx) + (Math.random() - 0.5) * 1.7,
          r = 200 + Math.random() * 180
        n = city.nearestNode(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r)
        const d = hyp(city.nodeX(n) - pl.x, city.nodeY(n) - pl.y)
        if (d < 170 || d > 420) continue
        pick = n
        break
      }
      n = city.randomNodeNear(pl.x, pl.y, Difficulty.k.spawnMin, Difficulty.k.spawnMax)
      const nx = city.nodeX(n),
        ny = city.nodeY(n)
      const d = hyp(nx - pl.x, ny - pl.y)
      if (d < Difficulty.k.spawnMin || d > Difficulty.k.spawnMax) continue
      const hidden = !city.hasLOS(nx, ny, pl.x, pl.y)
      if (!hidden && tries < 14) continue
      pick = n
      break
    }
    if (pick === null) return
    const nb = city.neighbors(pick).filter((m) => !city.isCurve(pick, m)) // straight streets only
    let to = nb[0],
      bd = 1e9
    for (const n of nb) {
      const d = hyp(city.nodeX(n) - pl.x, city.nodeY(n) - pl.y)
      if (d < bd) {
        bd = d
        to = n
      }
    }
    const p = city.lanePoint(pick, to, 0.3)
    if (!game.spotFree(p.x, p.y, 10)) return
    const heavy = this.level >= 4 && Math.random() < 0.4
    const u = Police.spawnUnit(p.x, p.y, Math.atan2(p.uy, p.ux), 'pursue', heavy)
    u.car.setSpeed(10)
    u.role = 'ram'
  }

  update(dt: number): void {
    if (!this.active) return
    const pl = game.player.car
    this.time += dt
    this.points += dt
    let lvl = 1
    for (let i = 1; i < THRESH.length; i++) if (this.points >= THRESH[i]) lvl = i + 1
    if (lvl > this.level) {
      this.level = lvl
      game.toast('HEAT LEVEL ' + lvl, '#ff4d4d')
    }
    this.evadeNeeded = Math.max(8, 12 + this.level * 3 + Difficulty.k.evadeAdd)
    this.bounty += dt * (8 + this.level * 6)

    // visibility / busted
    let visible = false,
      near = 0,
      pursuers = 0
    for (const u of game.cops) {
      if (u.state !== 'pursue' && u.state !== 'intercept') continue
      pursuers++
      const d = hyp(u.car.x - pl.x, u.car.y - pl.y)
      if ((u.state === 'pursue' && u.los && d < 130) || d < 70) visible = true // a cop right beside you counts even without line of sight
      if (d < 14) near++
    }
    this.nearCount = near

    // helicopter
    if (this.level >= 5 && !this.heli) {
      this.heliT -= dt
      if (this.heliT <= 0) {
        const a = Math.random() * 6.28
        this.heli = { x: pl.x + Math.cos(a) * 380, y: pl.y + Math.sin(a) * 380, vx: 0, vy: 0, life: 60, rot: 0 }
        game.toast('HELICOPTER INBOUND', '#6ab7ff')
      }
    }
    this.heliLit = false
    const h = this.heli
    if (h) {
      h.rot += dt * 30
      h.life -= dt
      let tx = pl.x + pl.wvx * 0.6,
        ty = pl.y + pl.wvy * 0.6
      if (h.life <= 0) {
        tx = h.x + (h.x - pl.x) * 4
        ty = h.y + (h.y - pl.y) * 4
      }
      const dx = tx - h.x,
        dy = ty - h.y,
        d = hyp(dx, dy) || 1
      const sp = Math.min(h.life > 0 ? 44 : 60, d * 1.4)
      h.vx += ((dx / d) * sp - h.vx) * Math.min(1, dt * 1.6)
      h.vy += ((dy / d) * sp - h.vy) * Math.min(1, dt * 1.6)
      h.x += h.vx * dt
      h.y += h.vy * dt
      if (h.life > 0 && hyp(h.x - pl.x, h.y - pl.y) < 20 && !game.city.inTunnel(pl.x, pl.y)) this.heliLit = true // a tunnel hides you from the spotlight
      if (h.life <= 0 && hyp(h.x - pl.x, h.y - pl.y) > 700) {
        this.heli = null
        this.heliT = 40
      }
    }
    if (this.heliLit) visible = true
    // grace period: the cops are still converging, so you cannot slip away yet
    if (this.grace > 0) {
      this.grace -= dt
      visible = true
    }
    this.visible = visible
    if (!visible) Memory.recordHidden(pl.x, pl.y, dt)
    if (this.memToastT > 0) this.memToastT -= dt
    // Holding one heading at speed makes you predictable: the dispatch works out where you are going, and being out of sight stops helping
    if (pl.speed > 30 && !game.city.inTunnel(pl.x, pl.y)) {
      const dh = Math.abs(wrapAngle(pl.theta - this.headRef))
      if (this.straightT <= 0 || dh > 0.87) {
        this.headRef = pl.theta // a real turn (more than 50 degrees): start again
        this.straightT = 0.001
        this.predictable = false
      } else this.straightT += dt
      if (this.straightT > 6 && !this.predictable) {
        this.predictable = true
        game.toast('THEY KNOW WHERE YOU ARE HEADING: TURN OFF', '#ff9a3c')
      }
    } else {
      this.straightT = 0
      this.predictable = false
    }
    const onHighway = game.city.districtAt(pl.x, pl.y) === 'highway'
    this.hwyT = onHighway ? this.hwyT + dt : 0
    if (visible) {
      this.lastX = pl.x
      this.lastY = pl.y
      this.evade = Math.max(0, this.evade - dt * 2.5)
    } else if (!this.predictable) this.evade += dt * (onHighway ? 0.5 : 1) // traffic cameras watch the highway

    const slow = pl.speed < 7
    if (slow && near > 0) this.bust += dt * (0.28 + 0.18 * Math.min(near, 3))
    else this.bust = Math.max(0, this.bust - dt * 0.5)
    if (this.bust >= 1) {
      game.endRun('busted')
      return
    }
    if (this.evade >= this.evadeNeeded) {
      game.endRun('escaped')
      return
    }

    // keep the right number of pursuers
    this.spawnT -= dt
    if (pursuers < Math.max(2, COPS[this.level] + Difficulty.k.copOffset) && this.spawnT <= 0) {
      this.spawnT = this.level >= 3 ? 1.6 : 2.4
      this.spawnPursuer()
    }
    // roles
    this.roleT -= dt
    if (this.roleT <= 0) {
      this.roleT = 1
      const list = game.cops.filter((u) => u.state === 'pursue')
      list.sort((a, b) => hyp(a.car.x - pl.x, a.car.y - pl.y) - hyp(b.car.x - pl.x, b.car.y - pl.y))
      let side = 1
      list.forEach((u, i) => {
        if (i === 0) u.role = 'ram'
        else if (i % 4 === 3 && this.level >= 2) u.role = 'block'
        else {
          u.role = 'flank'
          u.side = side
          side = -side
        }
      })
      // a crawling player gets boxed in: the second-closest unit takes the spot in front
      if (list.length >= 2 && pl.speed < 10 && this.level >= 2) list[1].role = 'block'
    }
    // coordinated tactics: send a few units to park across the road ahead of the player
    Tactics.tick(dt)
    this.tacticsT -= dt
    if (this.tactics && this.tacticsT <= 0 && this.grace <= 0 && this.level >= Difficulty.k.tactLevel) {
      this.tacticsT = 1.5
      Tactics.dispatch(
        this.level,
        game.cops.filter((u) => u.state === 'pursue'),
      )
    }
    // roadblocks & spikes
    if (this.level >= 2) {
      this.blockT -= dt
      if (this.blockT <= 0) {
        this.blockT = 24 * Difficulty.k.trapMul
        this.placeRoadblock()
      }
    }
    // a long run down the highway gets a wall of cars across it, well ahead
    if (this.hwyT > 10 && this.grace <= 0) {
      this.hwyBlockT -= dt
      if (this.hwyBlockT <= 0) {
        this.hwyBlockT = 16 * Difficulty.k.trapMul
        this.placeRoadblock(300 + Math.random() * 100, 3)
      }
    }
    if (this.level >= 3) {
      this.spikeT -= dt
      if (this.spikeT <= 0) {
        this.spikeT = 30 * Difficulty.k.trapMul
        this.placeSpikes()
      }
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i]
      if (!s.hit && Math.abs(pl.x - s.x) < s.hx + 1.2 && Math.abs(pl.y - s.y) < s.hy + 1.2) {
        s.hit = true
        pl.flat = 15
        game.toast('TIRES SHREDDED', '#ff4d4d')
        game.shake(0.5)
      }
      if (hyp(pl.x - s.x, pl.y - s.y) > 600) this.spikes.splice(i, 1)
    }
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (!this.blocks[i].units.some((u) => game.cops.includes(u))) this.blocks.splice(i, 1)
    }
  }
}

export const heat = new HeatManager()
