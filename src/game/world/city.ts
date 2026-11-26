import type { Block, BlockDistrict, BlockRoad, SuperBlock, Building, District, Jump, PropSpot, Rect, StaticRec, Surface, Tree, Tunnel, Wall } from '../types'
import type { LineSet } from './layout'

export const SURF: Record<'asphalt' | 'sidewalk' | 'lot' | 'grass' | 'gravel' | 'sand', Surface> = {
  asphalt: { kind: 'asphalt', grip: 1.0, roll: 1.0 },
  sidewalk: { kind: 'sidewalk', grip: 0.9, roll: 1.6 },
  lot: { kind: 'lot', grip: 0.85, roll: 1.5 },
  grass: { kind: 'grass', grip: 0.58, roll: 4.2 },
  gravel: { kind: 'gravel', grip: 0.78, roll: 2.6 },
  sand: { kind: 'sand', grip: 0.72, roll: 3.2 },
}

export type RoadType = 'highway' | 'avenue' | 'street' | 'alley'
// Road widths in metres. Lanes are about 3.6 m (a car is 4.5-5 m long and 1.9 m wide), with a parking strip on streets
// and a hard shoulder on the highway; highways have a 3 m median. Cars drive in the lane whose centre is LANE_OFFSET
// from the road's centre line (the outer lane on an avenue, the middle lane on the highway).
export const TYPES: Record<RoadType, number> = { highway: 28, avenue: 18, street: 11, alley: 6 }
export const LANE_OFFSET: Record<RoadType, number> = { highway: 6.9, avenue: 5.4, street: 1.8, alley: 1.5 }
export const SIDEWALK = 3
export const CELL = 80
/** Blocks per tile side: a tile is 16 x 16 blocks between four highways (17 road lines each way). */
export const TILE = 16
/** A highway can only be entered / left at these lines of a tile (4, 8 and 12 of 16). */
export const RAMPS = [4, 8, 12]
/** The home tile's river fills the block column between its lines RIVER_I and RIVER_I + 1; only the BRIDGES rows cross it. */
export const RIVER_I = 11
export const BRIDGES = [3, 8, 13]

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
  /** how many tiles the window spans on each side of its centre (0 = a single tile, 1 = 3 x 3) */
  radius: number
  /** tile index of the window's first tile, and the tiles themselves (row-major) */
  tx0: number
  ty0: number
  tiles: Tile[]
  blocks: Block[]
  buildings: Building[]
  trees: Tree[]
  /** the outer boundary walls: only a single-tile window (radius 0) has any, the endless world has none */
  walls: Wall[]
  /** every static collider in the window (bodies are created lazily, see physics/world.ts) */
  statics: StaticRec[]
  /** concrete barriers along the highway ring (static colliders, drawn as barriers) */
  barriers: Wall[]
  /** the rivers' rectangles (river = the first one, or an empty rectangle), the solid water strips between bridges, and the bridge decks */
  rivers: Rect[]
  river: Rect
  waterWalls: Wall[]
  bridges: Rect[]
  tunnels: Tunnel[]
  jumps: Jump[]
  gravel: Rect[]
  propSpots: PropSpot[]
  seeds: DistrictSeed[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  nodeCount: number
  nodeX(id: number): number
  nodeY(id: number): number
  nodeId(i: number, j: number): number
  neighbors(id: number): number[]
  /** like neighbors, but fills a caller-supplied array (no allocation) and returns it */
  neighborsInto(id: number, out: number[]): number[]
  isRamp(i: number, j: number): boolean
  nearestNode(x: number, y: number): number
  edgeWidth(a: number, b: number): number
  /** how far from the road's centre line the driving lane's centre is on this edge */
  laneOffset(a: number, b: number): number
  nodeHalfWidth(id: number): number
  randomNode(): number
  /** a node at a random spot between rMin and rMax metres from (x, y), for spawning near the player */
  randomNodeNear(x: number, y: number, rMin: number, rMax: number): number
  /** the middle of the window's centre tile, where the player starts */
  centerNode(): number
  /** the tile whose area contains (x, y), if it is inside the window */
  tileAt(x: number, y: number): Tile | null
  /** true if the street edge from line i to line i + 1 on row j runs into water with no bridge */
  waterBlocked(i: number, j: number): boolean
  colRoad(x: number): number
  rowRoad(y: number): number
  districtAt(x: number, y: number): District
  surfaceAt(x: number, y: number): Surface
  pointInBuilding(x: number, y: number): boolean
  /** anything a car cannot drive through: buildings, barriers, water (AI probes and spawn checks use this) */
  isObstacle(x: number, y: number): boolean
  inWater(x: number, y: number): boolean
  inTunnel(x: number, y: number): boolean
  queryBuildings(x0: number, y0: number, x1: number, y1: number, out: Building[]): Building[]
  hasLOS(x0: number, y0: number, x1: number, y1: number): boolean
  lanePoint(a: number, b: number, t: number): LanePoint
  /** a crossing that a bend park removed: it has no roads left */
  isDead(id: number): boolean
  /** if this crossing is a roundabout: its centre, island radius, outer radius and the radius cars drive at */
  roundAt(id: number): { cx: number; cy: number; ri: number; ro: number; rc: number } | undefined
  /** true for a winding road: a graph edge between two diagonal crossings that follows a curve instead of a straight line */
  isCurve(a: number, b: number): boolean
  /** the real length of the edge a -> b in metres (the curve's length for a winding road) */
  edgeLength(a: number, b: number): number
  /** how far along edge a -> b (metres from a) the point nearest (x, y) is */
  edgeProject(a: number, b: number, x: number, y: number): number
  /** the lane point s metres along edge a -> b, `off` metres to the right of its centre line; ux, uy is the direction of travel there. Writes into `out`. */
  edgePoint(a: number, b: number, s: number, off: number, out: LanePoint): LanePoint
}

export type RGB = [number, number, number]
export const PALETTES: Record<BlockDistrict, RGB[]> = {
  downtown: [[70, 82, 102], [86, 96, 116], [60, 72, 90], [96, 104, 120], [78, 88, 100], [110, 118, 132]],
  port: [[120, 118, 112], [100, 104, 108], [134, 120, 96], [90, 96, 100]],
  suburbs: [[150, 98, 78], [128, 92, 76], [110, 84, 70], [142, 110, 88], [96, 104, 84]],
}
export const CONTAINER_COLORS: RGB[] = [[176, 64, 52], [52, 96, 150], [196, 150, 50], [62, 120, 82], [140, 140, 146]]


/** One tile of the endless world (see world/tile.ts). All coordinates are absolute. */
export interface Tile {
  tx: number
  ty: number
  name: string
  /** the 17 vertical / horizontal road lines of this tile */
  V: LineSet
  H: LineSet
  /** the tile's area, from the outer edge of its highways */
  x0: number
  y0: number
  x1: number
  y1: number
  seeds: DistrictSeed[]
  blocks: Block[]
  buildings: Building[]
  trees: Tree[]
  barriers: Wall[]
  rivers: Rect[]
  river: Rect
  waterWalls: Wall[]
  bridges: Rect[]
  tunnels: Tunnel[]
  jumps: Jump[]
  gravel: Rect[]
  propSpots: PropSpot[]
  /** -1 for no river, else the river runs between this tile's lines riverCol and riverCol + 1, crossed at bridgeRows */
  /** the winding roads of this tile (each also hangs off its block as block.road) */
  curves: BlockRoad[]
  /** the tile's bend and roundabout parks */
  supers: SuperBlock[]
  /** the statue squares of the tile: roundabouts at crossings, with paved corners (see tile.ts) */
  squares: SuperBlock[]
  riverCol: number
  bridgeRows: number[]
  statics: StaticRec[]
  /** minimap prerender, built the first time the tile is drawn */
  map: HTMLCanvasElement | null
}


export function nearestIdx(arr: number[], v: number): number {
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
