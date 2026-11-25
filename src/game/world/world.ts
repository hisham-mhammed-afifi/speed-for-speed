import { CELL, LANE_OFFSET, RAMPS, SIDEWALK, SURF, TILE } from './city'
import type { City, RoadType, Tile } from './city'
import { Axis } from './layout'
import { generateTile } from './tile'
import type { Block, Building, District, Rect, StaticRec, Wall } from '../types'

export const DEFAULT_SEED = 20261123

/** Cached tiles: the window holds 9 and the prefetch queue at most 12 more. */
const MAX_TILES = 22

const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1

/** Cell key for the spatial hashes. Coordinates are absolute (they can be far from zero and negative). */
const key = (ix: number, iy: number) => (ix + 4096) * 8192 + (iy + 4096)

/** Largest index k with arr[k] <= v (clamped to 0..arr.length - 1), for a sorted array. */
function lineIdx(arr: number[], v: number): number {
  let lo = 0,
    hi = arr.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (arr[mid] <= v) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Index of the line nearest to v. */
function nearestLine(arr: number[], v: number): number {
  const k = lineIdx(arr, v)
  return k + 1 < arr.length && v - arr[k] > arr[k + 1] - v ? k + 1 : k
}

/**
 * The endless world: an infinite grid of tiles (see tile.ts), generated on demand and cached. The game only ever sees a
 * `City` "window": the tiles around the player, joined into one road grid in absolute coordinates, with the same API the
 * old finite city had. When the player crosses into another tile the window is rebuilt around it (engine.recenter).
 */
export const World = {
  seed: DEFAULT_SEED,
  axisV: new Axis(DEFAULT_SEED, 0),
  axisH: new Axis(DEFAULT_SEED, 1),
  cache: new Map<string, Tile>(),
  /** tiles waiting to be generated ahead of the player, one per pump() */
  queue: [] as [number, number][],
  generated: 0,

  /** Start (or restart) a world from a seed. Re-initialising with the same seed keeps the cache. */
  init(seed = DEFAULT_SEED): void {
    if (seed === World.seed && World.cache.size) return
    World.seed = seed
    World.axisV = new Axis(seed, 0)
    World.axisH = new Axis(seed, 1)
    World.cache.clear()
    World.queue.length = 0
  },

  tile(tx: number, ty: number): Tile {
    const k = tx + ',' + ty
    let t = World.cache.get(k)
    if (t) {
      World.cache.delete(k) // move to the end: most recently used
      World.cache.set(k, t)
      return t
    }
    t = generateTile(World.seed, tx, ty, World.axisV.lines(tx), World.axisH.lines(ty))
    World.generated++
    World.cache.set(k, t)
    while (World.cache.size > MAX_TILES) World.cache.delete(World.cache.keys().next().value as string)
    return t
  },

  has(tx: number, ty: number): boolean {
    return World.cache.has(tx + ',' + ty)
  },

  tileIndexAt(x: number, y: number): { tx: number; ty: number } {
    return { tx: World.axisV.indexAt(x), ty: World.axisH.indexAt(y) }
  },

  /**
   * Which tile the window should be centred on for a player at (x, y), given the current centre. The window only moves
   * once the player is 100 m into the next tile, so crossing a boundary back and forth doesn't make it jitter.
   */
  centerFor(x: number, y: number, cx: number, cy: number): [number, number] {
    const pick = (v: number, axis: Axis, c: number): number => {
      const t = axis.indexAt(v)
      if (t === c) return c
      if (t > c) return t > c + 1 || v > axis.originOf(c + 1) + 100 ? t : c
      return t < c - 1 || v < axis.originOf(c) - 100 ? t : c
    }
    return [pick(x, World.axisV, cx), pick(y, World.axisH, cy)]
  },

  /** Queue the tiles the next window will need, for any tile edge the player is within 700 m of. */
  prefetch(x: number, y: number, cx: number, cy: number): void {
    const dxs = [0],
      dys = [0]
    if (x > World.axisV.originOf(cx + 1) - 700) dxs.push(1)
    if (x < World.axisV.originOf(cx) + 700) dxs.push(-1)
    if (y > World.axisH.originOf(cy + 1) - 700) dys.push(1)
    if (y < World.axisH.originOf(cy) + 700) dys.push(-1)
    for (const dx of dxs)
      for (const dy of dys) {
        if (!dx && !dy) continue
        for (let ty = cy + dy - 1; ty <= cy + dy + 1; ty++)
          for (let tx = cx + dx - 1; tx <= cx + dx + 1; tx++)
            if (!World.has(tx, ty) && !World.queue.some((q) => q[0] === tx && q[1] === ty) && World.queue.length < 12) World.queue.push([tx, ty])
      }
  },

  /** Generate one queued tile (about 20 ms), so a later window rebuild has nothing left to generate. */
  pump(): boolean {
    const q = World.queue.shift()
    if (!q) return false
    World.tile(q[0], q[1])
    return true
  },

  /**
   * The window: (2 * radius + 1)^2 tiles centred on tile (cx, cy), joined into one road grid. Window line i is a highway
   * exactly when i % 16 == 0 (the shared line between two tiles), and the grid's origin is always a tile corner.
   */
  build(cx: number, cy: number, radius = 1): City {
    const n = 2 * radius + 1
    const tx0 = cx - radius,
      ty0 = cy - radius
    const tiles: Tile[] = []
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) tiles.push(World.tile(tx0 + a, ty0 + b))
    const NV = TILE * n + 1,
      NH = NV

    const vx: number[] = [],
      vw: number[] = [],
      vt: RoadType[] = []
    const hy: number[] = [],
      hw: number[] = [],
      ht: RoadType[] = []
    for (let a = 0; a < n; a++) {
      const L = World.axisV.lines(tx0 + a)
      for (let k = a === 0 ? 0 : 1; k <= TILE; k++) {
        vx.push(L.pos[k])
        vw.push(L.wid[k])
        vt.push(L.type[k])
      }
      const M = World.axisH.lines(ty0 + a)
      for (let k = a === 0 ? 0 : 1; k <= TILE; k++) {
        hy.push(M.pos[k])
        hw.push(M.wid[k])
        ht.push(M.type[k])
      }
    }
    const minX = vx[0] - vw[0] / 2,
      maxX = vx[NV - 1] + vw[NV - 1] / 2
    const minY = hy[0] - hw[0] / 2,
      maxY = hy[NH - 1] + hw[NH - 1] / 2

    const cat = <T>(f: (t: Tile) => T[]): T[] => {
      const out: T[] = []
      for (const t of tiles) for (const e of f(t)) out.push(e)
      return out
    }
    const buildings = cat((t) => t.buildings)
    const barriers = cat((t) => t.barriers)
    const waterWalls = cat((t) => t.waterWalls)
    const tunnels = cat((t) => t.tunnels)
    const gravel = cat((t) => t.gravel)
    const rivers = cat((t) => t.rivers)
    const seeds = cat((t) => t.seeds)
    const statics: StaticRec[] = cat((t) => t.statics)

    // blocks, in window order (block (i, j) lies between window lines i, i + 1 and j, j + 1)
    const BW = NV - 1
    const blocks: Block[] = new Array(BW * (NH - 1))
    for (let b = 0; b < n; b++)
      for (let a = 0; a < n; a++) {
        const t = tiles[b * n + a]
        for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) blocks[(b * TILE + j) * BW + a * TILE + i] = t.blocks[j * TILE + i]
      }

    // single-tile window (tests, legacy): the old outer boundary walls
    const walls: Wall[] = []
    if (radius === 0) {
      const wallPad = 3.5,
        big = 400
      const cxm = (minX + maxX) / 2,
        cym = (minY + maxY) / 2
      walls.push(
        { x: minX - wallPad - big, y: cym, hx: big, hy: (maxY - minY) / 2 + big * 2 },
        { x: maxX + wallPad + big, y: cym, hx: big, hy: (maxY - minY) / 2 + big * 2 },
        { x: cxm, y: minY - wallPad - big, hx: (maxX - minX) / 2 + big * 2, hy: big },
        { x: cxm, y: maxY + wallPad + big, hx: (maxX - minX) / 2 + big * 2, hy: big },
      )
      for (const w of walls) statics.push({ body: null, cx: w.x, cy: w.y, hx: w.hx, hy: w.hy, always: true, on: false })
    }

    // ---------- spatial hashes ----------
    const hash = new Map<number, Building[]>()
    for (const b of buildings) {
      for (let iy = Math.floor(b.y0 / CELL); iy <= Math.floor(b.y1 / CELL); iy++)
        for (let ix = Math.floor(b.x0 / CELL); ix <= Math.floor(b.x1 / CELL); ix++) {
          const k = key(ix, iy)
          let a = hash.get(k)
          if (!a) hash.set(k, (a = []))
          a.push(b)
        }
    }
    let stampCounter = 1
    const addRects = (map: Map<number, Rect[]>, r: Rect) => {
      for (let iy = Math.floor(r.y0 / CELL); iy <= Math.floor(r.y1 / CELL); iy++)
        for (let ix = Math.floor(r.x0 / CELL); ix <= Math.floor(r.x1 / CELL); ix++) {
          const k = key(ix, iy)
          let a = map.get(k)
          if (!a) map.set(k, (a = []))
          a.push(r)
        }
    }
    // Barriers are thin, so for line of sight and obstacle probing they get a slightly fat rectangle (>= the 4 m LOS step,
    // so a ray can't hop over one). Cops therefore route to a ramp instead of grinding against a wall they can "see" past.
    const FAT = 1.5
    const barrierHash = new Map<number, Rect[]>()
    for (const b of barriers) addRects(barrierHash, { x0: b.x - b.hx - FAT, y0: b.y - b.hy - FAT, x1: b.x + b.hx + FAT, y1: b.y + b.hy + FAT })
    const waterHash = new Map<number, Rect[]>()
    for (const w of waterWalls) addRects(waterHash, { x0: w.x - w.hx, y0: w.y - w.hy, x1: w.x + w.hx, y1: w.y + w.hy })
    const tunnelHash = new Map<number, Rect[]>()
    for (const t of tunnels) addRects(tunnelHash, t)

    // ---------- the road graph ----------
    const onRing = (i: number, j: number) => i % TILE === 0 || j % TILE === 0
    const isRamp = (i: number, j: number) => {
      const ki = i % TILE,
        kj = j % TILE
      return (ki === 0 && kj !== 0 && RAMPS.includes(kj)) || (kj === 0 && ki !== 0 && RAMPS.includes(ki))
    }
    /** the edge from window line i to i + 1 on row j crosses a river that has no bridge on that row */
    const waterBlocked = (i: number, j: number): boolean => {
      const a = Math.floor(i / TILE),
        b = Math.floor(j / TILE)
      if (a >= n || b >= n) return false
      const kj = j % TILE
      if (kj === 0) return false // the highway rows run clear of the water
      const t = tiles[b * n + a]
      return t.riverCol >= 0 && i % TILE === t.riverCol && !t.bridgeRows.includes(kj)
    }
    const nearestSeed = (x: number, y: number): District => {
      let best = seeds[0],
        bd = 1e15
      for (const s of seeds) {
        const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y)
        if (d < bd) {
          bd = d
          best = s
        }
      }
      return best.district
    }
    const colRoad = (x: number): number => {
      const k = lineIdx(vx, x)
      if (Math.abs(x - vx[k]) <= vw[k] / 2) return k
      if (k + 1 < NV && Math.abs(x - vx[k + 1]) <= vw[k + 1] / 2) return k + 1
      return -1
    }
    const rowRoad = (y: number): number => {
      const k = lineIdx(hy, y)
      if (Math.abs(y - hy[k]) <= hw[k] / 2) return k
      if (k + 1 < NH && Math.abs(y - hy[k + 1]) <= hw[k + 1] / 2) return k + 1
      return -1
    }
    const blockAt = (x: number, y: number): Block | undefined => {
      const i = Math.min(lineIdx(vx, x), NV - 2),
        j = Math.min(lineIdx(hy, y), NH - 2)
      return blocks[j * BW + i]
    }

    const city: City = {
      NV,
      NH,
      vx,
      hy,
      vw,
      hw,
      vt,
      ht,
      radius,
      tx0,
      ty0,
      tiles,
      blocks,
      buildings,
      trees: cat((t) => t.trees),
      walls,
      statics,
      barriers,
      rivers,
      river: tiles[Math.floor(tiles.length / 2)].river,
      waterWalls,
      bridges: cat((t) => t.bridges),
      tunnels,
      jumps: cat((t) => t.jumps),
      gravel,
      propSpots: cat((t) => t.propSpots),
      seeds,
      bounds: { minX, minY, maxX, maxY },

      // ----- road graph -----
      nodeCount: NV * NH,
      nodeX: (id) => vx[id % NV],
      nodeY: (id) => hy[(id / NV) | 0],
      nodeId: (i, j) => j * NV + i,
      isRamp,
      waterBlocked,
      neighbors(id) {
        const i = id % NV,
          j = (id / NV) | 0,
          out: number[] = []
        const ring = onRing(i, j)
        const add = (ni: number, nj: number) => {
          const nRing = onRing(ni, nj)
          // highway <-> street only through a ramp (the highway-side node must be a ramp)
          if (ring !== nRing && !(ring ? isRamp(i, j) : isRamp(ni, nj))) return
          // a river is crossed only by its bridge streets
          if (nj === j && waterBlocked(Math.min(i, ni), j)) return
          out.push(nj * NV + ni)
        }
        if (i > 0) add(i - 1, j)
        if (i < NV - 1) add(i + 1, j)
        if (j > 0) add(i, j - 1)
        if (j < NH - 1) add(i, j + 1)
        return out
      },
      nearestNode: (x, y) => nearestLine(hy, y) * NV + nearestLine(vx, x),
      edgeWidth: (a, b) => (((a / NV) | 0) === ((b / NV) | 0) ? hw[(a / NV) | 0] : vw[a % NV]),
      laneOffset: (a, b) => LANE_OFFSET[((a / NV) | 0) === ((b / NV) | 0) ? ht[(a / NV) | 0] : vt[a % NV]],
      nodeHalfWidth: (id) => Math.max(vw[id % NV], hw[(id / NV) | 0]) / 2,
      randomNode: () => (Math.random() * NV * NH) | 0,
      randomNodeNear(x, y, rMin, rMax) {
        const a = Math.random() * 6.2832,
          d = rMin + Math.random() * (rMax - rMin)
        return city.nearestNode(x + Math.cos(a) * d, y + Math.sin(a) * d)
      },
      centerNode: () => (TILE * radius + 8) * NV + (TILE * radius + 8),
      tileAt(x, y) {
        if (x < vx[0] || x >= vx[NV - 1] || y < hy[0] || y >= hy[NH - 1]) return null
        const a = Math.floor(lineIdx(vx, x) / TILE),
          b = Math.floor(lineIdx(hy, y) / TILE)
        return tiles[b * n + a] ?? null
      },

      // ----- queries -----
      colRoad,
      rowRoad,
      districtAt(x, y) {
        if (x < vx[0] || x > vx[NV - 1] || y < hy[0] || y > hy[NH - 1]) return 'highway'
        const ci = colRoad(x),
          ri = rowRoad(y)
        if ((ci >= 0 && vt[ci] === 'highway') || (ri >= 0 && ht[ri] === 'highway')) return 'highway'
        // inside a block: that block's district, so what you see always matches what you're told
        const b = blockAt(x, y)
        if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b.district
        return nearestSeed(x, y) // on a street between blocks
      },
      surfaceAt(x, y) {
        if (x < minX || x > maxX || y < minY || y > maxY) return SURF.lot
        if (colRoad(x) >= 0 || rowRoad(y) >= 0) {
          for (let k = 0; k < gravel.length; k++) if (inRect(gravel[k], x, y)) return SURF.gravel // construction zones
          return SURF.asphalt
        }
        const b = blockAt(x, y)
        if (!b) return SURF.lot
        if (x < b.x0 + SIDEWALK || x > b.x1 - SIDEWALK || y < b.y0 + SIDEWALK || y > b.y1 - SIDEWALK) return SURF.sidewalk
        return b.type === 'park' || b.district === 'suburbs' ? SURF.grass : SURF.lot
      },
      /** True inside a building or (a little) around a highway barrier: "something solid in the way" for AI probes and line of sight. */
      pointInBuilding(x, y) {
        const k = key(Math.floor(x / CELL), Math.floor(y / CELL))
        const a = hash.get(k)
        if (a) {
          for (let i = 0; i < a.length; i++) {
            const b = a[i]
            if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return true
          }
        }
        const bb = barrierHash.get(k)
        if (bb) {
          for (let i = 0; i < bb.length; i++) if (inRect(bb[i], x, y)) return true
        }
        return false
      },
      inWater(x, y) {
        const a = waterHash.get(key(Math.floor(x / CELL), Math.floor(y / CELL)))
        if (a) for (let i = 0; i < a.length; i++) if (inRect(a[i], x, y)) return true
        return false
      },
      isObstacle(x, y) {
        return city.pointInBuilding(x, y) || city.inWater(x, y)
      },
      inTunnel(x, y) {
        const a = tunnelHash.get(key(Math.floor(x / CELL), Math.floor(y / CELL)))
        if (a) for (let i = 0; i < a.length; i++) if (inRect(a[i], x, y)) return true
        return false
      },
      queryBuildings(x0, y0, x1, y1, out) {
        out.length = 0
        const st = ++stampCounter
        const ix0 = Math.floor(x0 / CELL),
          ix1 = Math.floor(x1 / CELL),
          iy0 = Math.floor(y0 / CELL),
          iy1 = Math.floor(y1 / CELL)
        for (let iy = iy0; iy <= iy1; iy++)
          for (let ix = ix0; ix <= ix1; ix++) {
            const a = hash.get(key(ix, iy))
            if (!a) continue
            for (let k = 0; k < a.length; k++) {
              const b = a[k]
              if (b.stamp === st) continue
              b.stamp = st
              if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue
              out.push(b)
            }
          }
        return out
      },
      hasLOS(x0, y0, x1, y1) {
        const dx = x1 - x0,
          dy = y1 - y0,
          d = Math.hypot(dx, dy)
        const steps = Math.ceil(d / 4)
        for (let k = 1; k < steps; k++) {
          const t = k / steps
          const px = x0 + dx * t,
            py = y0 + dy * t
          if (city.pointInBuilding(px, py) || city.inTunnel(px, py)) return false // buildings, barriers and tunnel roofs all block sight
        }
        return true
      },
      // lane point for travelling from node a to node b (right-hand traffic)
      lanePoint(a, b, t) {
        const ax = city.nodeX(a),
          ay = city.nodeY(a),
          bx = city.nodeX(b),
          by = city.nodeY(b)
        const len = Math.hypot(bx - ax, by - ay) || 1
        const ux = (bx - ax) / len,
          uy = (by - ay) / len
        const off = city.laneOffset(a, b)
        return { x: ax + ux * t * len - uy * off, y: ay + uy * t * len + ux * off, ux, uy, len }
      },
    }
    return city
  },
}

/**
 * A single-tile city (the home tile with its highway ring and boundary walls). The game itself uses World.build(..., 1),
 * the endless 3 x 3 window; this is what the headless tests build.
 */
export function createCity(seed = DEFAULT_SEED): City {
  World.init(seed)
  return World.build(0, 0, 0)
}
