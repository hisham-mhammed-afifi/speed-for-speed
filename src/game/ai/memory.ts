/**
 * Police memory: where you tend to hide. A coarse grid counts the seconds you spent out of sight in each cell; runs
 * that end add to it, old knowledge fades a little every run, and the table is saved with the player's progress.
 * During a pursuit the search and the traps lean toward the hottest cells, so a favourite hiding spot stops working.
 */
export const CELL = 80
/** weight (seconds hidden) a cell needs before the police take it seriously */
export const HOT = 5
const DECAY = 0.85
const MAX_CELLS = 80
/** most weight one run can add to a single cell (so one long hide doesn't dominate everything) */
const RUN_CAP = 30

export interface HotCell {
  key: string
  x: number
  y: number
  w: number
}

const cellKey = (cx: number, cy: number) => cx + ',' + cy

export const Memory = {
  cells: new Map<string, number>(),
  /** seconds hidden per cell during the current run */
  run: new Map<string, number>(),

  keyAt(x: number, y: number): string {
    return cellKey(Math.floor(x / CELL), Math.floor(y / CELL))
  },

  centre(key: string): { x: number; y: number } {
    const [cx, cy] = key.split(',').map(Number)
    return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL }
  },

  startRun(): void {
    Memory.run.clear()
  },

  /** The player is out of sight at (x, y) for dt seconds. */
  recordHidden(x: number, y: number, dt: number): void {
    const k = Memory.keyAt(x, y)
    Memory.run.set(k, (Memory.run.get(k) ?? 0) + dt)
  },

  /** Fold this run into the long-term table. An escape teaches the most; a bust or wreck teaches half as much. */
  endRun(escaped: boolean): void {
    for (const [k, v] of Memory.cells) Memory.cells.set(k, v * DECAY)
    for (const [k, v] of Memory.run) Memory.cells.set(k, (Memory.cells.get(k) ?? 0) + Math.min(v, RUN_CAP) * (escaped ? 1 : 0.5))
    Memory.run.clear()
    for (const [k, v] of Memory.cells) if (v < 0.5) Memory.cells.delete(k)
    if (Memory.cells.size > MAX_CELLS) {
      const keep = [...Memory.cells].sort((a, b) => b[1] - a[1]).slice(0, MAX_CELLS)
      Memory.cells = new Map(keep)
    }
  },

  /** The remembered cells that matter, hottest first. */
  hot(minWeight = HOT): HotCell[] {
    const out: HotCell[] = []
    for (const [key, w] of Memory.cells) {
      if (w < minWeight) continue
      const c = Memory.centre(key)
      out.push({ key, x: c.x, y: c.y, w })
    }
    return out.sort((a, b) => b.w - a.w)
  },

  /**
   * A hideout to check, near (x, y): cells score by weight and nearness, and one of the best three is picked at random
   * so a group of units spreads over several places instead of all driving to the same one.
   */
  pick(x: number, y: number, maxDist = 400): HotCell | null {
    const scored: { c: HotCell; s: number }[] = []
    for (const c of Memory.hot()) {
      const d = Math.hypot(c.x - x, c.y - y)
      if (d > maxDist) continue
      scored.push({ c, s: c.w / (1 + d / 200) })
    }
    if (!scored.length) return null
    scored.sort((a, b) => b.s - a.s)
    return scored[Math.floor(Math.random() * Math.min(3, scored.length))].c
  },

  /** Compact form for the save file (weights rounded to one decimal). */
  save(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, v] of Memory.cells) out[k] = Math.round(v * 10) / 10
    return out
  },

  load(data: Record<string, number> | undefined): void {
    Memory.cells = new Map()
    Memory.run.clear()
    if (!data) return
    for (const [k, v] of Object.entries(data)) {
      if (/^-?\d+,-?\d+$/.test(k) && Number.isFinite(v) && v > 0) Memory.cells.set(k, v)
    }
  },

  clear(): void {
    Memory.cells = new Map()
    Memory.run.clear()
  },
}
