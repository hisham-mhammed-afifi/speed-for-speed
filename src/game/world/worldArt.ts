/**
 * Photo art for the city (see scripts/build-assets.mjs): top-down tree sprites, grass textures and landmark lots.
 * Everything here is optional at runtime: a missing file falls back to the old procedural drawing.
 */
import type { BlockDistrict, LotId, LotPlacement } from '../types'

export const TREE_FILES = Array.from({ length: 8 }, (_, i) => `world/trees/t${i}.webp`)
export const GRASS_FILES = { lawn: 'world/grass/lawn.webp', meadow: 'world/grass/meadow.webp' } as const

/** Which tree sprite a tree uses, from its random value c (0..1): mostly greens, some blossom trees. */
export function treeSpecies(c: number): number {
  if (c < 0.2) return 0
  if (c < 0.4) return 1
  if (c < 0.56) return 2
  if (c < 0.7) return 3
  if (c < 0.8) return 4 // yellow-green
  if (c < 0.88) return 5 // yellow
  if (c < 0.95) return 6 // pink
  return 7 // pale pink
}

export interface LotArt {
  id: LotId
  file: string
  /** width / height of the processed image */
  aspect: number
  district: BlockDistrict
  /** how many of these a city gets */
  count: number
  /** collider rects measured on the image, normalised 0..1: [x0, y0, x1, y1, height in metres] */
  parts: [number, number, number, number, number][]
}

export const LOTS: Record<LotId, LotArt> = {
  villa: {
    id: 'villa',
    file: 'world/lots/villa.webp',
    aspect: 1024 / 590,
    district: 'suburbs',
    count: 3,
    parts: [
      [0.145, 0.3, 0.32, 0.49, 7], // west wing roof
      [0.3, 0.255, 0.62, 0.56, 7.5], // main roof
      [0.44, 0.115, 0.625, 0.27, 7], // north gable
      [0.44, 0.48, 0.535, 0.655, 6.5], // front porch roof
      [0.62, 0.32, 0.775, 0.71, 4.5], // living wing
      [0.28, 0.02, 0.345, 0.095, 3], // garden shed
    ],
  },
  campus: {
    id: 'campus',
    file: 'world/lots/campus.webp',
    aspect: 1024 / 629,
    district: 'port',
    count: 1,
    parts: [
      [0.4, 0.108, 0.6, 0.3, 9], // north hall
      [0.256, 0.254, 0.35, 0.572, 8], // west wing
      [0.4, 0.572, 0.53, 0.73, 8], // south block
      [0.81, 0.318, 0.903, 0.73, 8], // east wing
      [0.693, 0.572, 0.903, 0.73, 8], // south-east wing
    ],
  },
  residence: {
    id: 'residence',
    file: 'world/lots/residence.webp',
    aspect: 1024 / 729,
    district: 'downtown',
    count: 2,
    parts: [
      [0.25, 0.0, 0.57, 0.19, 16], // rooftop plant block
      [0.265, 0.295, 0.757, 0.4, 18], // north wing
      [0.265, 0.29, 0.375, 0.79, 18], // west wing
      [0.705, 0.295, 0.76, 0.645, 18], // east wing
      [0.75, 0.048, 0.975, 0.64, 14], // north-east hip roofs
      [0.02, 0.05, 0.265, 0.79, 9], // west roof garden
    ],
  },
}

export const WORLD_FILES: string[] = [...TREE_FILES, GRASS_FILES.lawn, GRASS_FILES.meadow, ...Object.values(LOTS).map((l) => l.file)]

/** How far a lot may be stretched to fill a block before the block is not a candidate (ratio of block aspect to art aspect). */
const MIN_FIT = 0.74,
  MAX_FIT = 1.35

/** Can this art cover a block with these inner bounds? Returns the quarter-turn and how distorted it would look (1 = none). */
export function fitLot(art: LotArt, x0: number, y0: number, x1: number, y1: number): { rot: 0 | 1; distortion: number } | null {
  const w = x1 - x0,
    h = y1 - y0
  if (w < 55 || h < 45) return null
  let best: { rot: 0 | 1; distortion: number } | null = null
  for (const rot of [0, 1] as const) {
    const a = rot ? 1 / art.aspect : art.aspect
    const r = w / h / a
    if (r < MIN_FIT || r > MAX_FIT) continue
    const d = Math.max(r, 1 / r)
    if (!best || d < best.distortion) best = { rot, distortion: d }
  }
  return best
}

/** Map a rectangle in the art's own 0..1 space into world coordinates for a placed lot. */
export function lotRect(lot: LotPlacement, u0: number, v0: number, u1: number, v1: number): [number, number, number, number] {
  const rw = lot.x1 - lot.x0,
    rh = lot.y1 - lot.y0
  const pt = (u: number, v: number): [number, number] => {
    const uu = lot.flipX ? 1 - u : u,
      vv = lot.flipY ? 1 - v : v
    const X = lot.rot ? 1 - vv : uu,
      Y = lot.rot ? uu : vv
    return [lot.x0 + X * rw, lot.y0 + Y * rh]
  }
  const a = pt(u0, v0),
    b = pt(u1, v1)
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}
