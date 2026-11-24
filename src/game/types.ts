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

export type SurfaceKind = 'asphalt' | 'sidewalk' | 'lot' | 'grass'

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
}

export interface SaveData {
  best: number
  total: number
  longest: number
  car: number
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
}

export interface Wall {
  x: number
  y: number
  hx: number
  hy: number
}

export interface Block {
  i: number
  j: number
  x0: number
  y0: number
  x1: number
  y1: number
  type: 'build' | 'park' | 'plaza'
  district: BlockDistrict
}

export interface Tree {
  x: number
  y: number
  r: number
  c: number
}
