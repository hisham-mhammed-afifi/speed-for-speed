import { rng } from '../core/math'
import { CURVE_W, hermite, roadDist2 } from './curve'
import { BRIDGES, CONTAINER_COLORS, LANE_OFFSET, PALETTES, RAMPS, RIVER_I, SIDEWALK, TILE } from './city'
import type { DistrictSeed, RGB, Tile } from './city'
import { hash3 } from './layout'
import type { LineSet } from './layout'
import { fitScale, LOTS, lotDims, lotRect, tileGrid } from './worldArt'
import type { Block, BlockDistrict, BlockRoad, Building, BuildingKind, Jump, LotPlacement, PropSpot, Rect, StaticRec, Tree, Tunnel, Wall } from '../types'

const NAME_A = ['Port', 'North', 'East', 'West', 'South', 'Old', 'New', 'Fort', 'Lake', 'Mount', 'Cape', 'Grand', 'Iron', 'Silver', 'Red', 'Stone']
const NAME_B = ['Ashford', 'Brook', 'Cove', 'Dale', 'Ridge', 'Haven', 'Mill', 'Point', 'Shore', 'Vale', 'Harbor', 'Heights', 'Crossing', 'Park', 'Bridge', 'Falls']

/** A tile's name, from its coordinates (the home tile is always "Central City"). */
export function tileName(seed: number, tx: number, ty: number): string {
  if (tx === 0 && ty === 0) return 'Central City'
  const h = hash3(seed ^ 0xabc, tx, ty)
  return NAME_A[h & 15] + ' ' + NAME_B[(h >>> 8) & 15]
}

const rec = (cx: number, cy: number, hx: number, hy: number): StaticRec => ({ body: null, cx, cy, hx, hy, always: false, on: false })

/**
 * One tile of the endless world: a 16 x 16 block town between four highways. Everything is a pure function of
 * (seed, tx, ty), in absolute world coordinates, so the same tile always looks the same whichever window it is seen through.
 * The home tile (0, 0) always has its river at column RIVER_I with bridges on BRIDGES, as the original city did.
 */
export function generateTile(seed: number, tx: number, ty: number, V: LineSet, H: LineSet): Tile {
  const R = rng(hash3(seed ^ 0x51ed, tx, ty))
  const NV = TILE + 1,
    NH = TILE + 1
  const vx = V.pos,
    vw = V.wid,
    hy = H.pos,
    hw = H.wid
  const home = tx === 0 && ty === 0

  // ---------- districts: a seeded Voronoi over a handful of seed points ----------
  const fx = (f: number) => vx[0] + f * (vx[NV - 1] - vx[0])
  const fy = (f: number) => hy[0] + f * (hy[NH - 1] - hy[0])
  const J = (m: number) => (R() - 0.5) * m
  let seeds: DistrictSeed[]
  if (home) {
    seeds = [
      { x: fx(0.5 + J(0.06)), y: fy(0.5 + J(0.06)), district: 'downtown' }, // the spawn point is downtown
      { x: fx(0.3), y: fy(0.64), district: 'downtown' },
      { x: fx(0.82), y: fy(0.8), district: 'port' },
      { x: fx(0.18), y: fy(0.2), district: 'suburbs' },
      { x: fx(0.82), y: fy(0.2), district: 'suburbs' },
    ]
  } else {
    // every other town has its own mix: some mostly suburbs, some port-heavy, some all downtown
    const pickD = (): BlockDistrict => {
      const r = R()
      return r < 0.4 ? 'downtown' : r < 0.7 ? 'suburbs' : 'port'
    }
    seeds = [
      { x: fx(0.5 + J(0.2)), y: fy(0.5 + J(0.2)), district: pickD() },
      { x: fx(0.3 + J(0.2)), y: fy(0.64 + J(0.2)), district: pickD() },
      { x: fx(0.82 + J(0.14)), y: fy(0.8 + J(0.14)), district: pickD() },
      { x: fx(0.18 + J(0.14)), y: fy(0.2 + J(0.14)), district: pickD() },
      { x: fx(0.82 + J(0.14)), y: fy(0.2 + J(0.14)), district: pickD() },
    ]
  }
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

  // ---------- the river: some towns have one, crossed only at its bridges ----------
  let riverCol = -1
  let bridgeRows: number[] = []
  if (home) {
    riverCol = RIVER_I
    bridgeRows = BRIDGES.slice()
  } else if (R() < 0.4) {
    riverCol = 3 + ((R() * 9) | 0)
    bridgeRows = [2 + ((R() * 3) | 0), 7 + ((R() * 3) | 0), 12 + ((R() * 3) | 0)]
  }

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
      if (i === riverCol) {
        b.type = 'water'
        blocks.push(b)
        continue
      }
      const w = x1 - x0,
        h = y1 - y0
      const r = R()
      if (w > 50 && h > 50 && r < PARK_P[district]) b.type = 'park'
      else if (w > 40 && h > 40 && r < PARK_P[district] + PLAZA_P[district]) b.type = 'plaza'
      blocks.push(b)
    }
  }

  // ---------- winding roads: chains of park blocks, each crossed by a curve from one crossing to the opposite corner ----------
  // (their own random stream, like the lots, so the rest of the town doesn't depend on them)
  const curves: BlockRoad[] = []
  {
    const RC = rng(hash3(seed ^ 0x2c0ffee, tx, ty))
    const D2R = Math.PI / 180
    let amp = 1
    const jit = (deg: number) => (RC() * 2 - 1) * deg * D2R * amp
    const chains = 4 + ((RC() * 3) | 0)
    for (let c = 0; c < chains; c++) {
      for (let attempt = 0; attempt < 16; attempt++) {
        amp = attempt < 5 ? 1 : attempt < 10 ? 0.55 : 0.25 // bend less when the first tries don't fit the block
        const steps = 3 + ((RC() * 4) | 0) // blocks in the chain
        const i0 = 1 + ((RC() * (14 - steps + 1)) | 0)
        // the nodes' rows: a random walk, one row per column step, kept on lines 1..15 (never touching the highway ring)
        const nj: number[] = [1 + ((RC() * 15) | 0)]
        const dir: number[] = []
        for (let k = 0; k < steps; k++) {
          const cur = nj[k]
          const d = cur <= 1 ? 1 : cur >= 15 ? -1 : k > 0 && RC() < 0.75 ? -dir[k - 1] : RC() < 0.5 ? 1 : -1 // mostly weave up and down
          dir.push(d)
          nj.push(cur + d)
        }
        const idx = nj.slice(0, -1).map((j, k) => Math.min(j, nj[k + 1]) * TILE + i0 + k)
        if (idx.some((q) => blocks[q].road || blocks[q].type === 'water' || blocks[q].i === riverCol)) continue
        // tangent angle at each node: along the chord when both neighbours bend the same way, nearly level when the road zigzags
        const chord = dir.map((_d, k) => Math.atan2(hy[nj[k + 1]] - hy[nj[k]], vx[i0 + k + 1] - vx[i0 + k]))
        const th: number[] = []
        for (let k = 0; k <= steps; k++) {
          if (k === 0) th.push(chord[0] + jit(35))
          else if (k === steps) th.push(chord[steps - 1] + jit(35))
          else th.push(dir[k - 1] === dir[k] ? (chord[k - 1] + chord[k]) / 2 + (k % 2 ? 1 : -1) * (14 + RC() * 24) * D2R * amp : jit(8)) // weave left and right
        }
        const roads: BlockRoad[] = []
        let ok = true
        for (let k = 0; k < steps && ok; k++) {
          const ax = vx[i0 + k],
            ay = hy[nj[k]],
            bx = vx[i0 + k + 1],
            by = hy[nj[k + 1]]
          const chordLen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))
          const mag = chordLen * (0.4 + RC() * 0.35)
          const r = hermite(ax, ay, bx, by, th[k], th[k + 1], mag, mag)
          r.ai = i0 + k
          r.aj = nj[k]
          r.bi = i0 + k + 1
          r.bj = nj[k + 1]
          // beyond the crossings, the road must stay inside its block (inset by its own half width and a sidewalk)
          const b = blocks[idx[k]]
          const inset = CURVE_W / 2 + 1.5
          for (let q = 0; q < r.pts.length && ok; q += 2) {
            const x = r.pts[q],
              y = r.pts[q + 1]
            const nearA = (x - ax) * (x - ax) + (y - ay) * (y - ay) < 32 * 32,
              nearB = (x - bx) * (x - bx) + (y - by) * (y - by) < 32 * 32
            if (!nearA && !nearB && (x < b.x0 + inset || x > b.x1 - inset || y < b.y0 + inset || y > b.y1 - inset)) ok = false
          }
          roads.push(r)
        }
        if (!ok) continue
        roads.forEach((r, k) => {
          const b = blocks[idx[k]]
          b.type = 'park'
          b.road = r
          curves.push(r)
        })
        break
      }
    }
  }

  // ---------- landmark lots: photo set pieces at their real-world size ----------
  // (a separate generator, so the rest of the city doesn't depend on how many lots there are)
  // A lot is anchored in one corner of its block; the strips left over get ordinary generated buildings (block.rest).
  {
    const RL = rng(hash3(seed ^ 0x5bd1e995, tx, ty))
    const LOT_GAP = 3
    const inner = (b: Block): Rect => ({ x0: b.x0 + SIDEWALK, y0: b.y0 + SIDEWALK, x1: b.x1 - SIDEWALK, y1: b.y1 - SIDEWALK })
    /** put a w x h box in one corner of `r` and return it plus the leftover strips beside and behind it */
    const anchored = (r: Rect, w: number, h: number, right: boolean, bottom: boolean): { box: Rect; rest: Rect[] } => {
      const bx0 = right ? r.x1 - w : r.x0,
        by0 = bottom ? r.y1 - h : r.y0
      const box: Rect = { x0: bx0, y0: by0, x1: bx0 + w, y1: by0 + h }
      const rest: Rect[] = []
      const sx0 = right ? r.x0 : box.x1 + LOT_GAP,
        sx1 = right ? box.x0 - LOT_GAP : r.x1
      if (sx1 > sx0) rest.push({ x0: sx0, y0: r.y0, x1: sx1, y1: r.y1 })
      const sy0 = bottom ? r.y0 : box.y1 + LOT_GAP,
        sy1 = bottom ? box.y0 - LOT_GAP : r.y1
      if (sy1 > sy0) rest.push({ x0: box.x0, y0: sy0, x1: box.x1, y1: sy1 })
      return { box, rest }
    }
    // single landmarks: the campus in the port, residences downtown
    for (const art of [LOTS.campus, LOTS.residence]) {
      const cands: { b: Block; rot: 0 | 1; s: number; score: number }[] = []
      for (const b of blocks) {
        if (b.type !== 'build' || b.lots || b.district !== art.district) continue
        const r = inner(b)
        const f = fitScale(art, r.x1 - r.x0, r.y1 - r.y0)
        if (f) cands.push({ b, rot: f.rot, s: f.s, score: Math.abs(f.s - 1) + RL() * 0.1 })
      }
      cands.sort((p, q) => p.score - q.score)
      for (const c of cands.slice(0, art.count)) {
        const [w, h] = lotDims(art, c.s, c.rot)
        const { box, rest } = anchored(inner(c.b), w, h, RL() < 0.5, RL() < 0.5)
        c.b.lots = [{ art: art.id, ...box, rot: c.rot, flipX: RL() < 0.5, flipY: RL() < 0.5 }]
        c.b.rest = rest
      }
    }
    // villas: a street of them, as many as fit in a suburbs block
    {
      const art = LOTS.villa
      const VILLA_GAP = 2
      const cands: { b: Block; g: NonNullable<ReturnType<typeof tileGrid>>; score: number }[] = []
      for (const b of blocks) {
        if (b.type !== 'build' || b.lots || b.district !== art.district) continue
        const r = inner(b)
        const g = tileGrid(art, r.x1 - r.x0, r.y1 - r.y0, VILLA_GAP)
        if (g) cands.push({ b, g, score: g.cols * g.rows + RL() * 1.5 })
      }
      cands.sort((p, q) => q.score - p.score)
      for (const c of cands.slice(0, art.count)) {
        const { cols, rows, tw, th, rot } = c.g
        const gw = cols * tw + (cols - 1) * VILLA_GAP,
          gh = rows * th + (rows - 1) * VILLA_GAP
        const { box, rest } = anchored(inner(c.b), gw, gh, RL() < 0.5, RL() < 0.5)
        const lots: LotPlacement[] = []
        for (let rr = 0; rr < rows; rr++)
          for (let cc = 0; cc < cols; cc++) {
            const x0 = box.x0 + cc * (tw + VILLA_GAP),
              y0 = box.y0 + rr * (th + VILLA_GAP)
            lots.push({ art: art.id, x0, y0, x1: x0 + tw, y1: y0 + th, rot, flipX: RL() < 0.5, flipY: RL() < 0.5 })
          }
        c.b.lots = lots
        c.b.rest = rest
      }
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
    if (depth < 3 && Math.max(w, h) > 55 && (R() < 0.9 || Math.max(w, h) > 80)) {
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
    if (b.type === 'build' && b.lots) {
      // colliders for the photos' roofs (the pictures themselves are drawn by the renderer)...
      for (const lot of b.lots) {
        const art = LOTS[lot.art]
        const kind: BuildingKind = art.id === 'villa' ? 'house' : art.id === 'campus' ? 'warehouse' : 'tower'
        for (const [u0, v0, u1, v1, height] of art.parts) {
          const [rx0, ry0, rx1, ry1] = lotRect(lot, u0, v0, u1, v1)
          push(kind, b.district, rx0, ry0, rx1, ry1, height, [90, 90, 96], false)
          const nb = buildings[buildings.length - 1]
          nb.flat = true
          nb.hasHeli = false
        }
      }
      // ...and ordinary buildings on whatever is left of the block
      for (const r of b.rest ?? []) {
        const min = b.district === 'suburbs' ? 20 : 14
        if (r.x1 - r.x0 < min || r.y1 - r.y0 < min) continue
        if (b.district === 'downtown') towerSplit(r.x0, r.y0, r.x1, r.y1, 0)
        else if (b.district === 'port') genPort(r.x0, r.y0, r.x1, r.y1)
        else genSuburbs(r.x0, r.y0, r.x1, r.y1)
      }
    } else if (b.type === 'build') {
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
          if (R() < 0.7) {
            const t: Tree = { x: tx + (R() - 0.5) * 8, y: ty + (R() - 0.5) * 8, r: 3 + R() * 2.5, c: R() }
            const clear = b.road ? CURVE_W / 2 + t.r + 1.5 : 0 // no canopy over a winding road
            if (!b.road || roadDist2(b.road, t.x, t.y) > clear * clear) trees.push(t)
          }
        }
      }
    }
  }


  // ---------- highway barriers: a concrete wall along this tile's side of each of its four highways, open only at the ramps ----------
  // (the neighbouring tile adds the wall on the other side of the shared highway; the strips stop at the crossing highway, so the
  // interchange at each tile corner stays open)
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
  const yMin = hy[0] + hw[0] / 2,
    yMax = hy[NH - 1] - hw[NH - 1] / 2
  const xMin = vx[0] + vw[0] / 2,
    xMax = vx[NV - 1] - vw[NV - 1] / 2
  const gapsH = RAMPS.map((j): [number, number] => [hy[j] - hw[j] / 2 - 2, hy[j] + hw[j] / 2 + 2]) // openings for the left/right highways
  const gapsV = RAMPS.map((i): [number, number] => [vx[i] - vw[i] / 2 - 2, vx[i] + vw[i] / 2 + 2]) // openings for the top/bottom highways
  strip(true, vx[0] + vw[0] / 2 + BT, yMin, yMax, gapsH)
  strip(true, vx[NV - 1] - vw[NV - 1] / 2 - BT, yMin, yMax, gapsH)
  strip(false, hy[0] + hw[0] / 2 + BT, xMin, xMax, gapsV)
  strip(false, hy[NH - 1] - hw[NH - 1] / 2 - BT, xMin, xMax, gapsV)

  // ---------- the river (if any): a column of water crossed only at the bridge rows ----------
  const rivers: Rect[] = []
  const bridges: Rect[] = []
  const waterWalls: Wall[] = []
  let river: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }
  if (riverCol >= 0) {
    const waterX0 = vx[riverCol] + vw[riverCol] / 2,
      waterX1 = vx[riverCol + 1] - vw[riverCol + 1] / 2
    const riverY0 = hy[0] + hw[0] / 2,
      riverY1 = hy[NH - 1] - hw[NH - 1] / 2
    river = { x0: waterX0, x1: waterX1, y0: riverY0, y1: riverY1 }
    rivers.push(river)
    for (const j of bridgeRows) bridges.push({ x0: waterX0, x1: waterX1, y0: hy[j] - hw[j] / 2, y1: hy[j] + hw[j] / 2 })
    let from = riverY0
    const emit = (a: number, b: number) => {
      if (b - a < 0.5) return
      waterWalls.push({ x: (waterX0 + waterX1) / 2, y: (a + b) / 2, hx: (waterX1 - waterX0) / 2, hy: (b - a) / 2 })
    }
    for (const br of bridges) {
      emit(from, br.y0)
      from = br.y1
    }
    emit(from, riverY1)
  }

  // ---------- street features: tunnels, jump ramps, construction zones ----------
  interface Edge {
    i: number
    j: number
    horiz: boolean
  }
  const edges: Edge[] = []
  for (let j = 1; j < NH - 1; j++)
    for (let i = 1; i < NV - 2; i++) if (i !== riverCol && !bridgeRows.includes(j) && H.type[j] !== 'alley') edges.push({ i, j, horiz: true })
  for (let i = 1; i < NV - 1; i++)
    for (let j = 1; j < NH - 2; j++) if (i !== riverCol && i !== riverCol + 1 && V.type[i] !== 'alley') edges.push({ i, j, horiz: false })
  for (let k = edges.length - 1; k > 0; k--) {
    const r = (R() * (k + 1)) | 0
    ;[edges[k], edges[r]] = [edges[r], edges[k]]
  }
  const usedNodes = new Set<number>()
  const takeEdge = (): Edge | null => {
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k]
      const a = e.j * NV + e.i,
        b = e.horiz ? a + 1 : a + NV
      if (usedNodes.has(a) || usedNodes.has(b)) continue
      usedNodes.add(a)
      usedNodes.add(b)
      edges.splice(k, 1)
      return e
    }
    return null
  }
  const edgeGeo = (e: Edge) => {
    const ax = vx[e.i],
      ay = hy[e.j]
    const bx = e.horiz ? vx[e.i + 1] : ax,
      by = e.horiz ? ay : hy[e.j + 1]
    const len = Math.hypot(bx - ax, by - ay)
    return { ax, ay, ux: (bx - ax) / len, uy: (by - ay) / len, len, w: e.horiz ? hw[e.j] : vw[e.i], lane: LANE_OFFSET[e.horiz ? H.type[e.j] : V.type[e.i]] }
  }

  const tunnels: Tunnel[] = []
  for (let n = 0; n < 8; n++) {
    const e = takeEdge()
    if (!e) break
    tunnels.push(
      e.horiz
        ? { horiz: true, x0: vx[e.i] + vw[e.i] / 2, x1: vx[e.i + 1] - vw[e.i + 1] / 2, y0: hy[e.j] - hw[e.j] / 2, y1: hy[e.j] + hw[e.j] / 2 }
        : { horiz: false, x0: vx[e.i] - vw[e.i] / 2, x1: vx[e.i] + vw[e.i] / 2, y0: hy[e.j] + hw[e.j] / 2, y1: hy[e.j + 1] - hw[e.j + 1] / 2 },
    )
  }

  const jumps: Jump[] = []
  for (let n = 0; n < 6; n++) {
    const e = takeEdge()
    if (!e) break
    const g = edgeGeo(e)
    const off = g.lane
    const cx = g.ax + g.ux * g.len * 0.42 - g.uy * off,
      cy = g.ay + g.uy * g.len * 0.42 + g.ux * off
    const lat = Math.max(2.2, g.w * 0.1)
    jumps.push({ x: cx, y: cy, hx: e.horiz ? 7 : lat, hy: e.horiz ? lat : 7, dx: g.ux, dy: g.uy })
  }

  const gravel: Rect[] = []
  const propSpots: PropSpot[] = []
  const addProp = (kind: PropSpot['kind'], x: number, y: number, angle: number) => propSpots.push({ kind, x, y, angle, gone: false })
  for (let n = 0; n < 10; n++) {
    const e = takeEdge()
    if (!e) break
    const g = edgeGeo(e)
    const off = g.lane
    const zone = Math.min(42, g.len * 0.45)
    const d0 = g.len * 0.28,
      d1 = d0 + zone
    const lane = (d: number) => ({ x: g.ax + g.ux * d - g.uy * off, y: g.ay + g.uy * d + g.ux * off })
    for (let d = d0; d <= d1; d += 5) {
      const p = lane(d)
      addProp('cone', p.x + (R() - 0.5) * 0.5, p.y + (R() - 0.5) * 0.5, 0)
    }
    const perp = Math.atan2(g.ux, -g.uy) // across the lane
    for (const d of [d0 - 3, d1 + 3]) {
      const p = lane(d)
      addProp('sawhorse', p.x, p.y, perp)
    }
    const c0 = lane(d0 - 2),
      c1 = lane(d1 + 2)
    const lat = g.w * 0.12 + 1.2
    gravel.push(
      e.horiz
        ? { x0: Math.min(c0.x, c1.x), x1: Math.max(c0.x, c1.x), y0: c0.y - lat, y1: c0.y + lat }
        : { x0: c0.x - lat, x1: c0.x + lat, y0: Math.min(c0.y, c1.y), y1: Math.max(c0.y, c1.y) },
    )
  }
  // park fences: a row of light panels along one roadside edge of each park (smash through for a shortcut)
  for (const b of blocks) {
    if (b.type !== 'park') continue
    const side = (R() * 4) | 0
    const horizEdge = side < 2
    const from = (horizEdge ? b.x0 : b.y0) + 6,
      to = (horizEdge ? b.x1 : b.y1) - 6
    for (let t = from; t < to; t += 3.2) {
      if (R() < 0.12) continue
      const fx = horizEdge ? t : side === 2 ? b.x0 + 1.5 : b.x1 - 1.5,
        fy = horizEdge ? (side === 0 ? b.y0 + 1.5 : b.y1 - 1.5) : t
      if (b.road && roadDist2(b.road, fx, fy) < (CURVE_W / 2 + 2) * (CURVE_W / 2 + 2)) continue // the road passes through the fence line
      addProp('fence', fx, fy, horizEdge ? 0 : Math.PI / 2)
    }
  }

  const statics: StaticRec[] = []
  for (const b of buildings) statics.push(rec(b.x, b.y, b.hx, b.hy))
  for (const w of barriers) statics.push(rec(w.x, w.y, w.hx, w.hy))
  for (const w of waterWalls) statics.push(rec(w.x, w.y, w.hx, w.hy))

  return {
    tx,
    ty,
    name: tileName(seed, tx, ty),
    V,
    H,
    x0: vx[0] - vw[0] / 2,
    y0: hy[0] - hw[0] / 2,
    x1: vx[NV - 1] + vw[NV - 1] / 2,
    y1: hy[NH - 1] + hw[NH - 1] / 2,
    seeds,
    blocks,
    buildings,
    trees,
    barriers,
    rivers,
    river,
    waterWalls,
    bridges,
    tunnels,
    jumps,
    gravel,
    propSpots,
    curves,
    riverCol,
    bridgeRows,
    statics,
    map: null,
  }
}
