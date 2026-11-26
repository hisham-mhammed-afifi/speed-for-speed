/**
 * Photo art for the city (see scripts/build-assets.mjs): top-down tree sprites, grass textures and landmark lots.
 * Everything here is optional at runtime: a missing file falls back to the old procedural drawing.
 */
import type { BlockDistrict, LotId, LotPlacement } from '../types'

export const TREE_FILES = Array.from({ length: 8 }, (_, i) => `world/trees/t${i}.webp`)
export const GRASS_FILES = { lawn: 'world/grass/lawn.webp', meadow: 'world/grass/meadow.webp' } as const
/** the sea (river water and fountains), the sand (banks and sandy lots) and the rock (hills) */
export const TEXTURE_FILES = { sea: 'world/textures/sea.webp', sand: 'world/textures/sand.webp', rock: 'world/textures/rock.webp' } as const
/** The two monuments on the statue squares' islands (made by `build-assets.mjs --only statues` from statues.jpg and fountain.jpg): round, seen from above. */
export const MONUMENT_FILES = { statue: 'world/statues/statue.webp', fountain: 'world/statues/fountain.webp' } as const
export type Monument = keyof typeof MONUMENT_FILES
/** The three squares of a town take turns: statue, fountain, statue. */
export const monumentFor = (k: number): Monument => (k % 2 === 1 ? 'fountain' : 'statue')

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
  /** real-world width in metres, measured from the cars in the photo (they are about 4.5 m long) */
  metresWide: number
  /** smallest scale it may be squeezed to when fitting a block */
  minScale: number
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
    metresWide: 55,
    minScale: 1,
    district: 'suburbs',
    count: 4,
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
    metresWide: 120,
    minScale: 0.7,
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
    metresWide: 74,
    minScale: 0.85,
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

export const WORLD_FILES: string[] = [
  ...TREE_FILES,
  GRASS_FILES.lawn,
  GRASS_FILES.meadow,
  ...Object.values(TEXTURE_FILES),
  ...Object.values(MONUMENT_FILES),
  ...Object.values(LOTS).map((l) => l.file),
]

/** Largest a lot may be scaled up from its measured real-world size. */
export const LOT_MAX_SCALE = 1.05

/** World size in metres of a lot drawn at scale s, turned a quarter or not. */
export function lotDims(art: LotArt, s: number, rot: 0 | 1): [number, number] {
  const w = art.metresWide * s,
    h = w / art.aspect
  return rot ? [h, w] : [w, h]
}

/**
 * Can one of these fit inside a w x h area at (nearly) its true size? Returns the quarter-turn and the scale to use:
 * the biggest that fits, never above LOT_MAX_SCALE, and not below the art's own minimum (so a lot is never shrunk into a toy).
 */
export function fitScale(art: LotArt, w: number, h: number): { rot: 0 | 1; s: number } | null {
  let best: { rot: 0 | 1; s: number } | null = null
  for (const rot of [0, 1] as const) {
    const [bw, bh] = lotDims(art, 1, rot)
    const s = Math.min(w / bw, h / bh, LOT_MAX_SCALE)
    if (s >= art.minScale && (!best || s > best.s)) best = { rot, s }
  }
  return best
}

/** The most tiles of this art (at true size, with a gap between them) that fit in a w x h area, in either orientation. */
export function tileGrid(art: LotArt, w: number, h: number, gap: number): { rot: 0 | 1; cols: number; rows: number; tw: number; th: number } | null {
  let best: { rot: 0 | 1; cols: number; rows: number; tw: number; th: number } | null = null
  for (const rot of [0, 1] as const) {
    const [tw, th] = lotDims(art, 1, rot)
    const cols = Math.floor((w + gap) / (tw + gap)),
      rows = Math.floor((h + gap) / (th + gap))
    if (cols < 1 || rows < 1) continue
    if (!best || cols * rows > best.cols * best.rows) best = { rot, cols, rows, tw, th }
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
