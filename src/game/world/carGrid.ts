import type { Car } from '../physics/car'

/**
 * Uniform spatial grid of cars, rebuilt every physics step. AI that asks "who is near me?" (traffic cones,
 * intersection checks) reads a few cells instead of looping over every car in the world, which keeps a
 * busy city (60+ cars) cheap.
 */
const CELL = 24 // metres; a car is ~5 m long, so a car only ever spans two cells

const index = new Map<number, number>() // cell key -> slot in `cells`
const cells: Car[][] = []
let used = 0

const key = (ix: number, iy: number) => (ix + 1000) * 4096 + (iy + 1000)

export const carGrid = {
  rebuild(cars: readonly Car[]): void {
    index.clear()
    used = 0
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]
      const k = key(Math.floor(c.x / CELL), Math.floor(c.y / CELL))
      let slot = index.get(k)
      if (slot === undefined) {
        slot = used++
        if (!cells[slot]) cells[slot] = []
        cells[slot].length = 0
        index.set(k, slot)
      }
      cells[slot].push(c)
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
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const slot = index.get(key(ix, iy))
        if (slot === undefined) continue
        const list = cells[slot]
        for (let k = 0; k < list.length; k++) {
          const c = list[k]
          const dx = c.x - x,
            dy = c.y - y
          if (dx * dx + dy * dy <= r2) out.push(c)
        }
      }
    return out
  },
}
