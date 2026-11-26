import type { Car } from '../physics/car'

/**
 * Uniform spatial hash of cars, rebuilt every physics step. AI that asks "who is near me?" (traffic cones,
 * intersection checks) reads a few cells instead of looping over every car in the world, which keeps a
 * busy city (60+ cars) cheap.
 *
 * It allocates nothing per step: cells hash into a fixed table of bucket heads, and cars chain through a
 * reused `next` array. Two cells may share a bucket; that only adds candidates, and `query` filters by distance.
 */
const CELL = 24 // metres; a car is ~5 m long, so a car only ever spans two cells
const BUCKETS = 4096 // power of two

const heads = new Int32Array(BUCKETS)
const seen = new Uint32Array(BUCKETS)
let next = new Int32Array(256)
let list: Car[] = []
let stamp = 0

const bucket = (ix: number, iy: number) => (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663)) & (BUCKETS - 1)

export const carGrid = {
  rebuild(cars: readonly Car[]): void {
    heads.fill(-1)
    if (next.length < cars.length) next = new Int32Array(cars.length * 2)
    list.length = cars.length
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]
      list[i] = c
      const b = bucket(Math.floor(c.x / CELL), Math.floor(c.y / CELL))
      next[i] = heads[b]
      heads[b] = i
    }
  },

  /** Fill `out` with every car whose centre is within `r` metres of (x, y). */
  query(x: number, y: number, r: number, out: Car[]): Car[] {
    out.length = 0
    const ix0 = Math.floor((x - r) / CELL),
      ix1 = Math.floor((x + r) / CELL),
      iy0 = Math.floor((y - r) / CELL),
      iy1 = Math.floor((y + r) / CELL)
    const r2 = r * r
    const st = ++stamp >>> 0
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const b = bucket(ix, iy)
        if (seen[b] === st) continue // two of the query's cells hashed to the same bucket: its cars were already checked
        seen[b] = st
        for (let k = heads[b]; k >= 0; k = next[k]) {
          const c = list[k]
          const dx = c.x - x,
            dy = c.y - y
          if (dx * dx + dy * dy <= r2) out.push(c)
        }
      }
    return out
  },
}
