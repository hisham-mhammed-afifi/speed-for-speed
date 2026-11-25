import { rng } from '../core/math'
import { TILE, TYPES } from './city'
import type { RoadType } from './city'

/** One tile column's (or row's) 17 road lines: absolute positions in metres, road types and widths. */
export interface LineSet {
  pos: number[]
  type: RoadType[]
  wid: number[]
}

/** A small integer hash of three numbers (world seed, and two tile / axis coordinates). */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35) ^ Math.imul((c + 0x165667b1) | 0, 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return h >>> 0
}

interface Rel {
  gaps: number[]
  type: RoadType[]
  span: number
}

/**
 * The road lines of one axis of the endless world. Tile t's lines depend only on (seed, axis, t), so a road never changes
 * when the camera window moves; tile t+1 starts exactly where tile t ends (its line 0 is tile t's line 16, a highway).
 */
export class Axis {
  private rel = new Map<number, Rel>()
  private origins = new Map<number, number>([[0, 0]])
  private lo = 0
  private hi = 0
  private sets = new Map<number, LineSet>()

  constructor(
    private seed: number,
    private axis: number,
  ) {}

  private relative(t: number): Rel {
    let r = this.rel.get(t)
    if (r) return r
    const R = rng(hash3(this.seed, 0x1000 + this.axis, t))
    const type: RoadType[] = []
    const gaps: number[] = []
    let span = 0
    for (let k = 0; k <= TILE; k++) {
      if (k === 0 || k === TILE) type.push('highway')
      else if (k % 4 === 0) type.push('avenue')
      else type.push(R() < 0.15 ? 'alley' : 'street')
      if (k < TILE) {
        const g = 82 + R() * 56
        gaps.push(g)
        span += g
      }
    }
    r = { gaps, type, span }
    this.rel.set(t, r)
    return r
  }

  /** Position of tile t's line 0. */
  originOf(t: number): number {
    const known = this.origins.get(t)
    if (known !== undefined) return known
    if (t > 0) {
      for (let k = this.hi; k < t; k++) this.origins.set(k + 1, this.origins.get(k)! + this.relative(k).span)
      this.hi = Math.max(this.hi, t)
    } else {
      for (let k = this.lo; k > t; k--) this.origins.set(k - 1, this.origins.get(k)! - this.relative(k - 1).span)
      this.lo = Math.min(this.lo, t)
    }
    return this.origins.get(t)!
  }

  lines(t: number): LineSet {
    let s = this.sets.get(t)
    if (s) return s
    const r = this.relative(t)
    const o = this.originOf(t)
    const pos: number[] = []
    let p = o
    for (let k = 0; k <= TILE; k++) {
      pos.push(p)
      if (k < TILE) p += r.gaps[k]
    }
    s = { pos, type: r.type, wid: r.type.map((ty) => TYPES[ty]) }
    this.sets.set(t, s)
    return s
  }

  /** Which tile a coordinate falls in (tile t covers [origin(t), origin(t + 1))). */
  indexAt(v: number): number {
    let t = Math.round(v / 1850)
    while (this.originOf(t) > v) t--
    while (this.originOf(t + 1) <= v) t++
    return t
  }
}
