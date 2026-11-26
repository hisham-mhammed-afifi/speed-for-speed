import { carGrid } from '../world/carGrid'
import type { Car } from '../physics/car'
import { game } from '../state'
import type { StatKey } from './daily'

// Skill combos: near misses, drifts, big air and cop takedowns build a multiplier that pays out when the chain ends.
// In a pursuit the money goes onto your bounty (so it is at risk until you escape); in free roam half of it goes straight to the wallet.

export interface ComboSinks {
  /** money banked straight into the wallet (free roam) */
  cash(n: number): void
  /** a skill event, for lifetime stats and the daily challenges */
  stat(stat: StatKey, amount: number): void
}

const MULT_STEP = 0.25
const MULT_MAX = 5
const CHAIN_TIME = 4

/** centre-to-centre distance that counts as "close", and how far away the other car must get for the pass to be over */
const NEAR_D = 3.2
const NEAR_FAR = 7
const NEAR_MIN_SPEED = 14
const NEAR_MIN_REL = 10

interface Near {
  hit: boolean
  cop: boolean
  stamp: number
}

const scratch: Car[] = []
const noSinks: ComboSinks = { cash: () => {}, stat: () => {} }

const fmt = (m: number) => m.toFixed(2).replace(/\.?0+$/, '')

export const Combo = {
  /** money waiting to be banked, the multiplier and seconds left on the chain */
  pending: 0,
  mult: 1,
  timer: 0,
  /** highest multiplier and skill money banked since the run started */
  bestMult: 1,
  earned: 0,
  sinks: noSinks as ComboSinks,

  near: new Map<number, Near>(),
  tick: 0,
  acc: 0,
  driftT: 0,
  airT: 0,
  distM: 0,

  reset(): void {
    this.pending = 0
    this.mult = 1
    this.timer = 0
    this.bestMult = 1
    this.earned = 0
    this.near.clear()
    this.driftT = 0
    this.airT = 0
    this.acc = 0
    this.distM = 0
  },

  /** A skill event: `base` money times the combo so far, and the chain gets longer. */
  add(base: number, label: string): void {
    const m = this.mult
    const amount = Math.round(base * m)
    this.pending += amount
    this.timer = CHAIN_TIME
    if (this.mult < MULT_MAX) this.mult = Math.min(MULT_MAX, this.mult + MULT_STEP)
    if (this.mult > this.bestMult) {
      if (this.bestMult < 3 && this.mult >= 3) this.sinks.stat('mult3', 1) // once per run
      this.bestMult = this.mult
    }
    game.toast(amount > 0 ? `${label}  +$${amount}  x${fmt(this.mult)}` : label, '#7be0ff')
  },

  /** Pay out what is pending. */
  bank(): void {
    const n = this.pending
    this.pending = 0
    this.mult = 1
    this.timer = 0
    if (n <= 0) return
    const heat = game.heat
    let gain: number
    if (heat?.active) {
      gain = Math.round(n * (1 + 0.25 * heat.level))
      heat.bounty += gain
    } else {
      gain = Math.round(n * 0.5)
      this.sinks.cash(gain)
    }
    this.earned += gain
    game.toast(`COMBO BANKED  +$${gain}`, '#ffd23f')
  },

  /** You crashed: the chain and its money are gone. */
  lose(): void {
    if (this.pending > 0 || this.mult > 1) game.toast('COMBO LOST', '#ff4d4d')
    this.pending = 0
    this.mult = 1
    this.timer = 0
  },

  /** The player touched this car, so passing it was not a near miss. */
  markHit(other: Car | null): void {
    if (!other) return
    const e = this.near.get(other.id)
    if (e) e.hit = true
    else this.near.set(other.id, { hit: true, cop: other.kind === 'police', stamp: this.tick })
  },

  /** A police car was wrecked: no money of its own (the bounty pays that), but it feeds the chain. */
  takedown(): void {
    this.add(0, 'TAKEDOWN')
    this.sinks.stat('cops', 1)
  },

  /** Called every physics step; the checks themselves run at 30 Hz. */
  update(dt: number, pl: Car): void {
    if (this.timer > 0) {
      this.timer -= dt
      if (this.timer <= 0) this.bank()
    }
    this.acc += dt
    if (this.acc < 1 / 30) return
    const step = this.acc
    this.acc = 0
    this.tick++

    // distance, reported to the daily challenges in tenths of a km
    this.distM += pl.speed * step
    if (this.distM >= 100) {
      this.distM -= 100
      this.sinks.stat('km', 0.1)
    }

    // drifting: a held slide on tarmac
    const slip = pl.speed > 1 ? Math.abs(Math.atan2(pl.vy, Math.abs(pl.vx))) : 0
    if (pl.air <= 0 && pl.speed > 12 && slip > 0.3 && pl.surfaceKind === 'asphalt') this.driftT += step
    else if (this.driftT > 0 && (slip < 0.18 || pl.speed < 8 || pl.air > 0)) {
      if (this.driftT >= 0.6) {
        this.sinks.stat('drift', this.driftT)
        this.add(Math.round(this.driftT * 40), 'DRIFT')
      }
      this.driftT = 0
    }

    // jumps
    if (pl.air > 0) this.airT += step
    else if (this.airT > 0) {
      if (this.airT >= 0.4) {
        this.sinks.stat('air', this.airT)
        this.add(Math.round(this.airT * 150), 'BIG AIR')
      }
      this.airT = 0
    }

    // near misses: a fast pass close to another car without touching it
    if (pl.speed >= NEAR_MIN_SPEED || this.near.size) {
      const cars = carGrid.query(pl.x, pl.y, NEAR_FAR + 2, scratch)
      for (let i = 0; i < cars.length; i++) {
        const o = cars[i]
        if (o === pl || o.air > 0) continue
        const d = Math.hypot(o.x - pl.x, o.y - pl.y)
        const e = this.near.get(o.id)
        if (e) {
          if (d <= NEAR_FAR) e.stamp = this.tick
        } else if (d < NEAR_D && pl.speed >= NEAR_MIN_SPEED && Math.hypot(o.wvx - pl.wvx, o.wvy - pl.wvy) >= NEAR_MIN_REL) {
          this.near.set(o.id, { hit: false, cop: o.kind === 'police', stamp: this.tick })
        }
      }
      for (const [id, e] of this.near) {
        if (e.stamp === this.tick) continue // still beside us
        this.near.delete(id)
        if (!e.hit) {
          this.sinks.stat('near', 1)
          this.add(e.cop ? 120 : 60, e.cop ? 'CLOSE CALL' : 'NEAR MISS')
        }
      }
    }
  },
}
