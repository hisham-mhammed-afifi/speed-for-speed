import type { Car } from './physics/car'
import type { City } from './world/city'
import type { Civ } from './world/traffic'
import type { PoliceUnit } from './ai/police'
import type { HeatManager } from './ai/heat'
import type { CarKind, CarSpec, GameState, RunResult } from './types'

/**
 * The shared game context every engine module reads (the old global `HL.G`).
 * Data fields are filled in by the engine when a game starts; the function members are
 * implemented in engine.ts. Modules import this tiny file instead of each other, which keeps
 * the import graph free of cycles.
 */
export interface Game {
  state: GameState
  time: number
  cars: Car[]
  civs: Civ[]
  cops: PoliceUnit[]
  city: City
  player: { car: Car; spec: CarSpec }
  heat: HeatManager

  spawnCar(spec: CarSpec, x: number, y: number, theta: number, kind: CarKind): Car
  removeCar(car: Car): void
  spotFree(x: number, y: number, r: number): boolean
  toast(text: string, color?: string): void
  shake(amount: number): void
  endRun(kind: RunResult): void
  onImpact(a: Car | null, b: Car | null, dvA: number, dvB: number, x: number, y: number, nx: number, ny: number): void
  resetCar(): void
}

const notReady = (): never => {
  throw new Error('HEATLINE engine is not mounted yet')
}

export const game: Game = {
  state: 'loading',
  time: 0,
  cars: [],
  civs: [],
  cops: [],
  city: null as unknown as City,
  player: null as unknown as Game['player'],
  heat: null as unknown as HeatManager,
  spawnCar: notReady,
  removeCar: notReady,
  spotFree: notReady,
  toast: () => {},
  shake: () => {},
  endRun: () => {},
  onImpact: () => {},
  resetCar: () => {},
}
