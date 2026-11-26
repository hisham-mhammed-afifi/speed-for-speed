// Shared types for the HEATLINE engine (no React in here).

export interface Vec2 {
  x: number
  y: number
}

/** What a driver (keyboard, gamepad, touch or AI) asks a car to do. */
export interface Controls {
  throttle: number
  brake: number
  steer: number
  handbrake: number
  nitro: number
}

export type SurfaceKind = 'asphalt' | 'sidewalk' | 'lot' | 'grass' | 'gravel'

export interface Surface {
  kind: SurfaceKind
  grip: number
  roll: number
}

/**
 * Arcade car specification (see physics/car.ts).
 *   top: top speed (m/s)          accel: acceleration from standstill (m/s^2), fades to 0 at top speed
 *   grip: max lateral accel (m/s^2) before the car slides     gripRate: how fast sideways motion is cancelled (1/s)
 *   turnRadius0: turning radius at low speed (m)              steerResp: how quickly yaw follows the wheel (1/s)
 */
export interface CarSpec {
  id: string
  name: string
  cls: string
  file: string
  len: number
  hitW: number
  mass: number
  top: number
  accel: number
  brakeDecel: number
  grip: number
  gripRate: number
  turnRadius0: number
  steerResp: number
  durability: number
  nitroPower: number
  awd: boolean
  redline: number
  police?: boolean
  heavy?: boolean
  /** a lorry or pickup: only ever seen in traffic, long and heavy (the lane drivers keep more room around it) */
  truck?: boolean
  /** a motorcycle: narrow, light, leans into turns, and a hard crash throws the rider */
  bike?: boolean
  /** side-view sprite (the flank you see when the bike leans, and the garage picture) */
  side?: string
  /** height of bike plus rider in metres: how far the lean swings the top of it sideways */
  rideH?: number
  /** off-road ability: more grip and less slowdown on grass and gravel */
  offroad?: number
}

export type CarKind = 'player' | 'police' | 'civil'

export type GameState = 'loading' | 'title' | 'play' | 'paused' | 'result'

export type RunResult = 'busted' | 'escaped' | 'wrecked'

export interface RunStats {
  time: number
  level: number
  copsDown: number
  bounty: number
  best: number
  /** wanted rating before and after this run */
  skillBefore?: number
  skillAfter?: number
  /** wallet after this run, and the best combo multiplier and skill money earned during it */
  cash?: number
  bestMult?: number
  skillCash?: number
}

export interface SaveData {
  best: number
  total: number
  longest: number
  car: number
  /** where the police remember you hiding: grid cell key -> seconds hidden (see ai/memory.ts) */
  memory?: Record<string, number>
  /** adaptive-difficulty wanted rating 0..1 and whether it is frozen (see ai/difficulty.ts) */
  skill?: number
  fixedSkill?: boolean
  /** graphics setting: auto, high, medium or low (see render/quality.ts) */
  quality?: string
  /** save format: 2 = has the wallet, garage and daily challenges */
  v: number
  /** money you can spend in the garage (banked bounty and combo cash) */
  cash: number
  /** ids of the cars you own */
  owned: string[]
  /** car id -> level (0..3) of the engine, tyres, armour and nitro upgrades (see progress/economy.ts) */
  upgrades: Record<string, number[]>
  /** today's three challenges (see progress/daily.ts) */
  daily?: DailyState
  /** consecutive days with all three challenges done, and the last day that happened (YYYY-MM-DD) */
  streak: number
  lastDailyDone?: string
  /** lifetime counters */
  stats: LifetimeStats
}

export interface LifetimeStats {
  nearMisses: number
  driftSec: number
  airSec: number
  escapes: number
  bestCombo: number
}

export interface DailyState {
  date: string
  ids: string[]
  progress: number[]
  done: boolean[]
}

export interface Safe {
  t: number
  r: number
  b: number
  l: number
}

/** City areas. `highway` is the fast ring road; the other three tile the interior blocks. */
export type District = 'downtown' | 'port' | 'suburbs' | 'highway'
export type BlockDistrict = Exclude<District, 'highway'>

export const DISTRICT_NAMES: Record<District, string> = {
  downtown: 'Downtown',
  port: 'Port District',
  suburbs: 'Suburbs',
  highway: 'Highway Ring',
}

export type BuildingKind = 'tower' | 'warehouse' | 'house' | 'container'

/** Axis-aligned building collider + render data. */
export interface Building {
  kind: BuildingKind
  x: number
  y: number
  theta: number
  hx: number
  hy: number
  x0: number
  y0: number
  x1: number
  y1: number
  height: number
  roof: string
  wall: string
  props: { ox: number; oy: number; w: number; h: number }[]
  hasHeli: boolean
  stamp: number
  /** part of a landmark lot: the photo already shows its roof, so only the collider exists (nothing is drawn) */
  flat?: boolean
}

export interface Wall {
  x: number
  y: number
  hx: number
  hy: number
}

/** A winding road through a park block: a sampled centre line from crossing node (ai, aj) to (bi, bj), in tile-local line indices. */
export interface BlockRoad {
  w: number
  /** length in metres, the flat x,y centre-line points, and the arc length at each point */
  len: number
  pts: number[]
  cum: number[]
  ai: number
  aj: number
  bi: number
  bj: number
}

export interface Block {
  i: number
  j: number
  x0: number
  y0: number
  x1: number
  y1: number
  type: 'build' | 'park' | 'plaza' | 'water'
  district: BlockDistrict
  /** photo landmark lots on this block, at real-world size (see world/worldArt.ts) */
  lots?: LotPlacement[]
  /** the strips of a lot block that are left for ordinary generated buildings */
  rest?: Rect[]
  /** this block is one quarter of a bend or roundabout superblock (see SuperBlock) */
  sb?: SuperBlock
}

/**
 * A 2 x 2 block park with a road feature in the middle. 'bend': the centre crossing and its four inner streets are gone, and two
 * sweeping quarter-turn roads join the mid-side crossings. 'round': the centre crossing is a roundabout.
 * (i, j) is the top-left block, (ci, cj) the centre crossing, all tile-local; x0..y1 is the park's rectangle (inner streets included).
 */
export interface SuperBlock {
  i: number
  j: number
  kind: 'bend' | 'round'
  x0: number
  y0: number
  x1: number
  y1: number
  ci: number
  cj: number
  cx: number
  cy: number
  /** roundabout: radius of the grass island and of the whole circle (metres); bend: 0 */
  ri: number
  ro: number
  arcs: BlockRoad[]
}

export type LotId = 'villa' | 'campus' | 'residence'

/** A landmark photo laid over a block: the rectangle it covers, turned a quarter and/or mirrored. */
export interface LotPlacement {
  art: LotId
  x0: number
  y0: number
  x1: number
  y1: number
  rot: 0 | 1
  flipX: boolean
  flipY: boolean
}

export interface Tree {
  x: number
  y: number
  r: number
  c: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A covered stretch of street: blocks line of sight (and the helicopter's spotlight) while you are inside. */
export interface Tunnel extends Rect {
  horiz: boolean
}

/** A launch ramp: a car inside the rectangle, moving along (dx, dy) fast enough, is thrown into the air. */
export interface Jump {
  x: number
  y: number
  hx: number
  hy: number
  dx: number
  dy: number
}

export type PropKind = 'cone' | 'sawhorse' | 'fence' | 'crate'

/** A smashable roadside object. Spots are data; physics bodies only exist while the player is close (world/props.ts). */
export interface PropSpot {
  kind: PropKind
  x: number
  y: number
  angle: number
  gone: boolean
}

/**
 * A static collider (building, barrier, water strip). Its Matter body is created the first time it comes within range of
 * the player (physics/world.ts), so a whole tile of colliders costs nothing until you get there.
 */
export interface StaticRec {
  body: unknown
  cx: number
  cy: number
  hx: number
  hy: number
  /** never streamed out (the outer boundary walls of a single-tile window) */
  always: boolean
  on: boolean
}
