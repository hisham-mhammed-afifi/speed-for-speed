import { rng } from '../core/math'
import type { Block, BlockDistrict, Building, BuildingKind, District, Surface, Tree, Wall } from '../types'

export const SURF: Record<'asphalt' | 'sidewalk' | 'lot' | 'grass', Surface> = {
  asphalt: { kind: 'asphalt', grip: 1.0, roll: 1.0 },
  sidewalk: { kind: 'sidewalk', grip: 0.9, roll: 1.6 },
  lot: { kind: 'lot', grip: 0.85, roll: 1.5 },
  grass: { kind: 'grass', grip: 0.58, roll: 4.2 },
}

export type RoadType = 'highway' | 'avenue' | 'street' | 'alley'
const TYPES: Record<RoadType, number> = { highway: 36, avenue: 24, street: 15, alley: 8 }
const SIDEWALK = 3
const CELL = 80
/** The ring highway can only be entered / left at these grid lines. */
export const RAMPS = [4, 8, 12]

export interface LanePoint {
  x: number
  y: number
  ux: number
  uy: number
  len: number
}

export interface DistrictSeed {
  x: number
  y: number
  district: BlockDistrict
}

export interface City {
  NV: number
  NH: number
  vx: number[]
  hy: number[]
  vw: number[]
  hw: number[]
  vt: RoadType[]
  ht: RoadType[]
  blocks: Block[]
  buildings: Building[]
  trees: Tree[]
  walls: Wall[]
  /** concrete barriers along the highway ring (static colliders, drawn as barriers) */
  barriers: Wall[]
  seeds: DistrictSeed[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  nodeCount: number
  nodeX(id: number): number
  nodeY(id: number): number
  nodeId(i: number, j: number): number
  neighbors(id: number): number[]
  isRamp(i: number, j: number): boolean
  nearestNode(x: number, y: number): number
  edgeWidth(a: number, b: number): number
  nodeHalfWidth(id: number): number
  randomNode(): number
  colRoad(x: number): number
  rowRoad(y: number): number
  districtAt(x: number, y: number): District
  surfaceAt(x: number, y: number): Surface
  pointInBuilding(x: number, y: number): boolean
  queryBuildings(x0: number, y0: number, x1: number, y1: number, out: Building[]): Building[]
  hasLOS(x0: number, y0: number, x1: number, y1: number): boolean
  lanePoint(a: number, b: number, t: number): LanePoint
}

type RGB = [number, number, number]
const PALETTES: Record<BlockDistrict, RGB[]> = {
  downtown: [[70, 82, 102], [86, 96, 116], [60, 72, 90], [96, 104, 120], [78, 88, 100], [110, 118, 132]],
  port: [[120, 118, 112], [100, 104, 108], [134, 120, 96], [90, 96, 100]],
  suburbs: [[150, 98, 78], [128, 92, 76], [110, 84, 70], [142, 110, 88], [96, 104, 84]],
}
const CONTAINER_COLORS: RGB[] = [[176, 64, 52], [52, 96, 150], [196, 150, 50], [62, 120, 82], [140, 140, 146]]

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

/** Procedural city on a road grid. Same seed -> same city. */
export function createCity(seed = 20261123): City {
  const R = rng(seed)
  const NV = 17,
    NH = 17
  const onRingV = (i: number) => i === 0 || i === NV - 1
  const onRingH = (j: number) => j === 0 || j === NH - 1
  const isRamp = (i: number, j: number) => (onRingV(i) && !onRingH(j) && RAMPS.includes(j)) || (onRingH(j) && !onRingV(i) && RAMPS.includes(i))

  function makeLines(n: number) {
    const pos: number[] = [],
      type: RoadType[] = [],
      wid: number[] = []
    let p = 0
    for (let k = 0; k < n; k++) {
      let t: RoadType
      if (k === 0 || k === n - 1) t = 'highway'
      else if (k % 4 === 0) t = 'avenue'
      else t = R() < 0.15 ? 'alley' : 'street'
      type.push(t)
      wid.push(TYPES[t])
      pos.push(p)
      p += 82 + R() * 56
    }
    return { pos, type, wid }
  }
  const V = makeLines(NV),
    H = makeLines(NH)
  const vx = V.pos,
    vw = V.wid,
    hy = H.pos,
    hw = H.wid

  const minX = vx[0] - vw[0] / 2,
    maxX = vx[NV - 1] + vw[NV - 1] / 2
  const minY = hy[0] - hw[0] / 2,
    maxY = hy[NH - 1] + hw[NH - 1] / 2

  // ---------- districts: a seeded Voronoi over a handful of seed points ----------
  const fx = (f: number) => vx[0] + f * (vx[NV - 1] - vx[0])
  const fy = (f: number) => hy[0] + f * (hy[NH - 1] - hy[0])
  const seeds: DistrictSeed[] = [
    { x: fx(0.5 + (R() - 0.5) * 0.06), y: fy(0.5 + (R() - 0.5) * 0.06), district: 'downtown' }, // the spawn point is downtown
    { x: fx(0.3), y: fy(0.64), district: 'downtown' },
    { x: fx(0.82), y: fy(0.8), district: 'port' },
    { x: fx(0.18), y: fy(0.2), district: 'suburbs' },
    { x: fx(0.82), y: fy(0.2), district: 'suburbs' },
  ]
  const nearestSeed = (x: number, y: number): BlockDistrict => {
    let best = seeds[0],
      bd = 1e12
    for (const s of seeds) {
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best.district
  }
  const PARK_P: Record<BlockDistrict, number> = { downtown: 0.04, port: 0, suburbs: 0.22 }
  const PLAZA_P: Record<BlockDistrict, number> = { downtown: 0.1, port: 0.06, suburbs: 0.04 }

  // ---------- blocks ----------
  const blocks: Block[] = []
  for (let j = 0; j < NH - 1; j++) {
    for (let i = 0; i < NV - 1; i++) {
      const x0 = vx[i] + vw[i] / 2,
        x1 = vx[i + 1] - vw[i + 1] / 2,
        y0 = hy[j] + hw[j] / 2,
        y1 = hy[j + 1] - hw[j + 1] / 2
      const district = nearestSeed((x0 + x1) / 2, (y0 + y1) / 2)
      const b: Block = { i, j, x0, x1, y0, y1, type: 'build', district }
      const w = x1 - x0,
        h = y1 - y0
      const r = R()
      if (w > 50 && h > 50 && r < PARK_P[district]) b.type = 'park'
      else if (w > 40 && h > 40 && r < PARK_P[district] + PLAZA_P[district]) b.type = 'plaza'
      blocks.push(b)
    }
  }

  // ---------- buildings ----------
  const buildings: Building[] = []
  const trees: Tree[] = []

  function push(kind: BuildingKind, district: BlockDistrict, x0: number, y0: number, x1: number, y1: number, height: number, color: RGB, roofProps: boolean): void {
    const w = x1 - x0,
      h = y1 - y0
    const k = 0.85 + Math.min(height / 95, 1) * 0.35
    const props: Building['props'] = []
    if (roofProps) {
      const np = (R() * 4) | 0
      for (let q = 0; q < np; q++) {
        const pw = 2 + R() * 4,
          ph = 2 + R() * 4
        props.push({ ox: (R() - 0.5) * (w - pw - 3), oy: (R() - 0.5) * (h - ph - 3), w: pw, h: ph })
      }
    }
    buildings.push({
      kind,
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      theta: 0,
      hx: w / 2,
      hy: h / 2,
      x0,
      y0,
      x1,
      y1,
      height,
      roof: `rgb(${(color[0] * k) | 0},${(color[1] * k) | 0},${(color[2] * k) | 0})`,
      wall: `rgb(${(color[0] * k * 0.55) | 0},${(color[1] * k * 0.55) | 0},${(color[2] * k * 0.55) | 0})`,
      props,
      hasHeli: kind === 'tower' && R() < 0.05 && w > 25 && h > 25,
      stamp: 0,
    })
    void district
  }

  // downtown: tall towers split into narrow slabs with alleys between some of them
  function towerSplit(x0: number, y0: number, x1: number, y1: number, depth: number): void {
    const w = x1 - x0,
      h = y1 - y0
    if (depth < 3 && Math.max(w, h) > 55 && R() < 0.9) {
      const gap = R() < 0.5 ? 8 : 0
      if (w >= h) {
        const cut = x0 + w * (0.35 + R() * 0.3)
        towerSplit(x0, y0, cut - gap / 2, y1, depth + 1)
        towerSplit(cut + gap / 2, y0, x1, y1, depth + 1)
      } else {
        const cut = y0 + h * (0.35 + R() * 0.3)
        towerSplit(x0, y0, x1, cut - gap / 2, depth + 1)
        towerSplit(x0, cut + gap / 2, x1, y1, depth + 1)
      }
      return
    }
    const m = R() < 0.4 ? 0 : R() * 2
    const bx0 = x0 + m,
      by0 = y0 + m,
      bx1 = x1 - m,
      by1 = y1 - m
    if (bx1 - bx0 < 9 || by1 - by0 < 9) return
    const height = 25 + Math.pow(R(), 1.6) * 120
    push('tower', 'downtown', bx0, by0, bx1, by1, height, PALETTES.downtown[(R() * PALETTES.downtown.length) | 0], true)
  }

  // port: container yards (stacks with aisles between them) or big low warehouses
  function genPort(x0: number, y0: number, x1: number, y1: number): void {
    const w = x1 - x0,
      h = y1 - y0
    if (R() < 0.55 && w > 60 && h > 40) {
      for (let cy = y0 + 7; cy < y1 - 14; cy += 25) {
        for (let cx = x0 + 7; cx < x1 - 26; cx += 28) {
          if (R() < 0.25) continue
          const cols = 1 + ((R() * 2) | 0),
            rows = 2 + ((R() * 2) | 0)
          for (let c = 0; c < cols; c++)
            for (let r = 0; r < rows; r++) {
              const px = cx + c * 13,
                py = cy + r * 3.1
              push('container', 'port', px, py, px + 12, py + 2.7, R() < 0.35 ? 5.4 : 2.7, CONTAINER_COLORS[(R() * CONTAINER_COLORS.length) | 0], false)
            }
        }
      }
    } else {
      const m = 2 + R() * 4
      const splitX = w > 110 && R() < 0.7
      const parts: [number, number, number, number][] = splitX
        ? [[x0 + m, y0 + m, x0 + w / 2 - 5, y1 - m], [x0 + w / 2 + 5, y0 + m, x1 - m, y1 - m]]
        : [[x0 + m, y0 + m, x1 - m, y1 - m]]
      for (const p of parts) if (p[2] - p[0] > 12 && p[3] - p[1] > 12) push('warehouse', 'port', p[0], p[1], p[2], p[3], 6 + R() * 10, PALETTES.port[(R() * PALETTES.port.length) | 0], true)
    }
  }

  // suburbs: a grid of small houses with gardens (the lot between them is lawn) and a few trees
  function genSuburbs(x0: number, y0: number, x1: number, y1: number): void {
    const w = x1 - x0,
      h = y1 - y0
    const nx = Math.max(1, Math.floor(w / 28)),
      ny = Math.max(1, Math.floor(h / 32))
    const lw = w / nx,
      lh = h / ny
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const cx = x0 + (ix + 0.5) * lw + (R() - 0.5) * 3,
          cy = y0 + (iy + 0.5) * lh + (R() - 0.5) * 3
        if (R() < 0.15) continue // an empty plot
        const hw2 = 5.5 + R() * 2,
          hh2 = 6 + R() * 2
        push('house', 'suburbs', cx - hw2, cy - hh2, cx + hw2, cy + hh2, 5 + R() * 4, PALETTES.suburbs[(R() * PALETTES.suburbs.length) | 0], false)
        const nt = (R() * 3) | 0
        for (let q = 0; q < nt; q++) trees.push({ x: cx + (R() - 0.5) * lw * 0.9, y: cy + (R() - 0.5) * lh * 0.9, r: 2 + R() * 1.6, c: R() })
      }
  }

  for (const b of blocks) {
    const x0 = b.x0 + SIDEWALK,
      y0 = b.y0 + SIDEWALK,
      x1 = b.x1 - SIDEWALK,
      y1 = b.y1 - SIDEWALK
    if (b.type === 'build') {
      if (x1 - x0 < 12 || y1 - y0 < 12) {
        b.type = 'plaza'
        continue
      }
      if (b.district === 'downtown') towerSplit(x0, y0, x1, y1, 0)
      else if (b.district === 'port') genPort(x0, y0, x1, y1)
      else genSuburbs(x0, y0, x1, y1)
    } else if (b.type === 'park') {
      for (let ty = y0 + 8; ty < y1 - 4; ty += 13) {
        for (let tx = x0 + 8; tx < x1 - 4; tx += 13) {
          if (R() < 0.7) trees.push({ x: tx + (R() - 0.5) * 8, y: ty + (R() - 0.5) * 8, r: 3 + R() * 2.5, c: R() })
        }
      }
    }
  }

  // spatial hash of buildings
  const hash = new Map<number, Building[]>()
  const key = (ix: number, iy: number) => (ix + 4) * 64 + (iy + 4)
  for (const b of buildings) {
    const ix0 = Math.floor(b.x0 / CELL),
      ix1 = Math.floor(b.x1 / CELL)
    const iy0 = Math.floor(b.y0 / CELL),
      iy1 = Math.floor(b.y1 / CELL)
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const k = key(ix, iy)
        let a = hash.get(k)
        if (!a) hash.set(k, (a = []))
        a.push(b)
      }
  }
  let stampCounter = 1

  // boundary walls (turned into static Matter.js bodies by physics/world.ts)
  const wallPad = 3.5,
    big = 400
  const cxm = (minX + maxX) / 2,
    cym = (minY + maxY) / 2
  const walls: Wall[] = [
    { x: minX - wallPad - big, y: cym, hx: big, hy: (maxY - minY) / 2 + big * 2 },
    { x: maxX + wallPad + big, y: cym, hx: big, hy: (maxY - minY) / 2 + big * 2 },
    { x: cxm, y: minY - wallPad - big, hx: (maxX - minX) / 2 + big * 2, hy: big },
    { x: cxm, y: maxY + wallPad + big, hx: (maxX - minX) / 2 + big * 2, hy: big },
  ]

  // ---------- highway barriers: a continuous concrete wall along the ring's inner edge, open only at the ramps ----------
  const barriers: Wall[] = []
  const BT = 0.6 // half thickness
  /** split [a, b] around the given gaps and emit one barrier rect per remaining piece */
  function strip(vertical: boolean, pos: number, a: number, b: number, gaps: [number, number][]): void {
    const cuts = gaps.slice().sort((p, q) => p[0] - q[0])
    let from = a
    const emit = (s: number, e: number) => {
      if (e - s < 0.5) return
      const mid = (s + e) / 2,
        half = (e - s) / 2
      barriers.push(vertical ? { x: pos, y: mid, hx: BT, hy: half } : { x: mid, y: pos, hx: half, hy: BT })
    }
    for (const [g0, g1] of cuts) {
      emit(from, g0)
      from = g1
    }
    emit(from, b)
  }
  const gapsH = RAMPS.map((j): [number, number] => [hy[j] - hw[j] / 2 - 2, hy[j] + hw[j] / 2 + 2]) // openings for the left/right highways
  const gapsV = RAMPS.map((i): [number, number] => [vx[i] - vw[i] / 2 - 2, vx[i] + vw[i] / 2 + 2]) // openings for the top/bottom highways
  strip(true, vx[0] + vw[0] / 2 + BT, minY, maxY, gapsH)
  strip(true, vx[NV - 1] - vw[NV - 1] / 2 - BT, minY, maxY, gapsH)
  strip(false, hy[0] + hw[0] / 2 + BT, minX, maxX, gapsV)
  strip(false, hy[NH - 1] - hw[NH - 1] / 2 - BT, minX, maxX, gapsV)

  // Barriers are thin, so for line of sight and obstacle probing they get a slightly fat rectangle (>= the 4 m LOS step,
  // so a ray can't hop over one). Cops therefore route to a ramp instead of grinding against a wall they can "see" past.
  const FAT = 1.5
  const barrierHash = new Map<number, { x0: number; y0: number; x1: number; y1: number }[]>()
  for (const b of barriers) {
    const r = { x0: b.x - b.hx - FAT, y0: b.y - b.hy - FAT, x1: b.x + b.hx + FAT, y1: b.y + b.hy + FAT }
    for (let iy = Math.floor(r.y0 / CELL); iy <= Math.floor(r.y1 / CELL); iy++)
      for (let ix = Math.floor(r.x0 / CELL); ix <= Math.floor(r.x1 / CELL); ix++) {
        const k = key(ix, iy)
        let a = barrierHash.get(k)
        if (!a) barrierHash.set(k, (a = []))
        a.push(r)
      }
  }

  const city: City = {
    NV,
    NH,
    vx,
    hy,
    vw,
    hw,
    vt: V.type,
    ht: H.type,
    blocks,
    buildings,
    trees,
    walls,
    barriers,
    seeds,
    bounds: { minX, minY, maxX, maxY },

    // ----- road graph -----
    nodeCount: NV * NH,
    nodeX: (id) => vx[id % NV],
    nodeY: (id) => hy[(id / NV) | 0],
    nodeId: (i, j) => j * NV + i,
    isRamp,
    neighbors(id) {
      const i = id % NV,
        j = (id / NV) | 0,
        out: number[] = []
      const ring = onRingV(i) || onRingH(j)
      const add = (ni: number, nj: number) => {
        const nRing = onRingV(ni) || onRingH(nj)
        // ring <-> interior only through a ramp (the ring-side node must be a ramp)
        if (ring !== nRing && !(ring ? isRamp(i, j) : isRamp(ni, nj))) return
        out.push(nj * NV + ni)
      }
      if (i > 0) add(i - 1, j)
      if (i < NV - 1) add(i + 1, j)
      if (j > 0) add(i, j - 1)
      if (j < NH - 1) add(i, j + 1)
      return out
    },
    nearestNode: (x, y) => nearestIdx(hy, y) * NV + nearestIdx(vx, x),
    edgeWidth: (a, b) => (((a / NV) | 0) === ((b / NV) | 0) ? hw[(a / NV) | 0] : vw[a % NV]),
    nodeHalfWidth: (id) => Math.max(vw[id % NV], hw[(id / NV) | 0]) / 2,
    randomNode: () => (Math.random() * NV * NH) | 0,

    // ----- queries -----
    colRoad(x) {
      for (let k = 0; k < NV; k++) if (Math.abs(x - vx[k]) <= vw[k] / 2) return k
      return -1
    },
    rowRoad(y) {
      for (let k = 0; k < NH; k++) if (Math.abs(y - hy[k]) <= hw[k] / 2) return k
      return -1
    },
    districtAt(x, y) {
      if (x < vx[0] + vw[0] / 2 || x > vx[NV - 1] - vw[NV - 1] / 2 || y < hy[0] + hw[0] / 2 || y > hy[NH - 1] - hw[NH - 1] / 2) return 'highway'
      // inside a block: that block's district, so what you see always matches what you're told
      let i = 0
      while (i < NV - 2 && x >= vx[i + 1]) i++
      let j = 0
      while (j < NH - 2 && y >= hy[j + 1]) j++
      const b = blocks[j * (NV - 1) + i]
      if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b.district
      return nearestSeed(x, y) // on a street between blocks
    },
    surfaceAt(x, y) {
      if (x < minX || x > maxX || y < minY || y > maxY) return SURF.lot
      if (city.colRoad(x) >= 0 || city.rowRoad(y) >= 0) return SURF.asphalt
      let i = 0
      while (i < NV - 2 && x >= vx[i + 1]) i++
      let j = 0
      while (j < NH - 2 && y >= hy[j + 1]) j++
      const b = blocks[j * (NV - 1) + i]
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
        for (let i = 0; i < bb.length; i++) {
          const b = bb[i]
          if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return true
        }
      }
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
      const n = Math.ceil(d / 4)
      for (let k = 1; k < n; k++) {
        const t = k / n
        if (city.pointInBuilding(x0 + dx * t, y0 + dy * t)) return false
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
      const off = city.edgeWidth(a, b) * 0.25
      return { x: ax + ux * t * len - uy * off, y: ay + uy * t * len + ux * off, ux, uy, len }
    },
  }
  return city
}
