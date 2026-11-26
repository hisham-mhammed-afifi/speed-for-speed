import type { CarSpec } from '../types'

// Arcade specs for the Matter.js car model (physics/car.ts). See CarSpec for what each field means.
const base: Omit<CarSpec, 'id' | 'name' | 'cls' | 'file'> = {
  len: 4.72,
  hitW: 1.86,
  mass: 1700,
  top: 70,
  accel: 6.8,
  brakeDecel: 11,
  grip: 11.5,
  gripRate: 12,
  turnRadius0: 5.5,
  steerResp: 9,
  durability: 1,
  nitroPower: 1.4,
  awd: false,
  redline: 7000,
}
type CarDef = Partial<CarSpec> & Pick<CarSpec, 'id' | 'name' | 'cls' | 'file'>
const mk = (o: CarDef): CarSpec => ({ ...base, ...o })
const kmh = (v: number) => v / 3.6

export const PLAYER_CARS: CarSpec[] = [
  mk({ id: 'silver', name: 'Silver GT', cls: 'Grand Tourer', file: 'cars/LS20261123150654.png', mass: 1740, top: kmh(256), accel: 6.8, grip: 11.5 }),
  mk({ id: 'rose', name: 'Rose Coupe', cls: 'Coupe', file: 'cars/LS20261123150716.png', mass: 1700, top: kmh(241), accel: 6.6, grip: 11.2 }),
  mk({
    id: 'blacksuv', name: 'Black Enforcer SUV', cls: 'Heavy SUV', file: 'cars/LS20261123150746.png', len: 4.95, hitW: 1.98,
    mass: 2150, top: kmh(209), accel: 6.9, grip: 10, turnRadius0: 6.2, steerResp: 7.5, awd: true, durability: 1.45, redline: 6500,
  }),
  mk({
    id: 'bluecross', name: 'Blue Crossover', cls: 'Crossover', file: 'cars/LS20261123150828.png', len: 4.85, hitW: 1.94,
    mass: 2000, top: kmh(216), accel: 7.0, grip: 10.4, turnRadius0: 6, steerResp: 8, awd: true, durability: 1.3, redline: 6600,
  }),
  mk({ id: 'red', name: 'Red Fury', cls: 'Sport Coupe', file: 'cars/LS20261123150904.png', mass: 1600, top: kmh(266), accel: 7.1, grip: 12, durability: 0.9 }),
  mk({ id: 'green', name: 'Green Apex', cls: 'Sport Coupe', file: 'cars/LS20261123150914.png', mass: 1620, top: kmh(245), accel: 7.1, grip: 12.5, steerResp: 10, durability: 0.95 }),
  mk({
    id: 'white', name: 'White Lightning', cls: 'Rear-Engine Sport', file: 'cars/LS20261123150933.png', len: 4.55, hitW: 1.84,
    mass: 1550, top: kmh(270), accel: 7.5, grip: 12.3, turnRadius0: 5.2, steerResp: 10, durability: 0.9,
  }),
  mk({
    id: 'orange', name: 'Orange Blaze', cls: 'Rear-Engine Sport', file: 'cars/LS20261123150943.png', len: 4.55, hitW: 1.84,
    mass: 1580, top: kmh(266), accel: 7.2, grip: 11.8, turnRadius0: 5.2, steerResp: 10.5, durability: 0.9,
  }),
  mk({ id: 'graphite', name: 'Graphite GT', cls: 'Grand Tourer', file: 'cars/LS20261123150955.png', mass: 1800, top: kmh(238), accel: 6.4, grip: 11, durability: 1.1 }),
  // motorcycles: narrow and light, they lean into turns (see render/renderer.ts drawBikeBody) and a hard crash throws the rider
  mk({
    id: 'dirt', name: 'Orange Scrambler', cls: 'Dirt Bike', file: 'bikes/dirt.webp', side: 'bikes/dirt-side.webp', bike: true, len: 2.15, hitW: 0.85, rideH: 1.3,
    mass: 330, top: kmh(165), accel: 7.6, brakeDecel: 10, grip: 11, turnRadius0: 3.2, steerResp: 13, durability: 0.6, nitroPower: 1.35, redline: 9000, offroad: 1.6,
  }),
  mk({
    id: 'cruiser', name: 'Maroon Cruiser', cls: 'Cruiser', file: 'bikes/cruiser.webp', side: 'bikes/cruiser-side.webp', bike: true, len: 2.3, hitW: 0.9, rideH: 1.3,
    mass: 360, top: kmh(190), accel: 6.4, brakeDecel: 9, grip: 10.5, turnRadius0: 4.4, steerResp: 9, durability: 0.7, nitroPower: 1.3, redline: 6000,
  }),
  mk({
    id: 'race', name: 'Red Fireblade', cls: 'Sport Bike', file: 'bikes/race.webp', side: 'bikes/race-side.webp', bike: true, len: 2.1, hitW: 0.8, rideH: 1.3,
    mass: 310, top: kmh(299), accel: 9, brakeDecel: 11, grip: 12.5, turnRadius0: 3.6, steerResp: 13, durability: 0.5, nitroPower: 1.35, redline: 12000,
  }),
]

/**
 * Civilian traffic: the same nine bodies, but tuned like everyday cars (slower, softer, less grip) so they read as
 * traffic rather than rival racers. Their speed is set by the lane driver, so this mostly affects crashes and recovery.
 */
const everyday = (c: CarSpec): CarSpec => ({
  ...c,
  id: c.id + '_traffic',
  top: c.top * 0.5,
  accel: c.accel * 0.55,
  grip: c.grip * 0.88,
  durability: c.durability * 0.8,
})
export const TRAFFIC_CARS: CarSpec[] = PLAYER_CARS.filter((c) => !c.bike).map(everyday)
/** the motorcycles on the road (about one vehicle in ten) */
export const TRAFFIC_BIKES: CarSpec[] = PLAYER_CARS.filter((c) => c.bike).map(everyday)

/** Lorries and a pickup: they only ever drive around in traffic (never in the garage or the save), slower and much heavier than the cars. */
export const TRAFFIC_TRUCKS: CarSpec[] = [
  mk({
    id: 'pickup', name: 'Silver Pickup', cls: 'Truck', file: 'trucks/pickup.webp', truck: true, len: 5.4, hitW: 2.0,
    mass: 2600, top: kmh(150), accel: 3.6, brakeDecel: 10, grip: 9.5, turnRadius0: 5.5, steerResp: 9, durability: 2, redline: 5500,
  }),
  mk({
    id: 'box', name: 'Box Truck', cls: 'Truck', file: 'trucks/box.webp', truck: true, len: 7, hitW: 2.35,
    mass: 6500, top: kmh(115), accel: 2.4, brakeDecel: 10, grip: 9, turnRadius0: 5.7, steerResp: 9, durability: 3, redline: 4500,
  }),
  mk({
    id: 'container', name: 'Container Truck', cls: 'Truck', file: 'trucks/container.webp', truck: true, len: 9, hitW: 2.45,
    mass: 12000, top: kmh(100), accel: 1.8, brakeDecel: 10, grip: 8.5, turnRadius0: 6, steerResp: 9, durability: 4, redline: 4000,
  }),
]

export const POLICE_SPEC: CarSpec = mk({
  id: 'police', name: 'Interceptor', cls: 'Police', file: 'cars/1795439954041.png', mass: 1750, top: kmh(256), accel: 6.9, grip: 11.6, durability: 1.15, police: true,
})
export const POLICE_HEAVY: CarSpec = mk({
  id: 'police_heavy', name: 'Heavy Interceptor', cls: 'Police', file: 'cars/1795439954041.png', len: 4.9, mass: 2000, top: kmh(240), accel: 6.6, grip: 11,
  durability: 1.6, police: true, heavy: true,
})

export const ALL_CAR_FILES: string[] = Array.from(
  new Set(
    PLAYER_CARS.flatMap((c) => (c.side ? [c.file, c.side] : [c.file]))
      .concat(TRAFFIC_TRUCKS.map((c) => c.file))
      .concat([POLICE_SPEC.file]),
  ),
)

/** Stats for the car-select screen: integrate the same drive formula the car uses. */
export function estimate(s: CarSpec): { top: number; t100: number } {
  const traction = s.grip * (s.awd ? 1 : 0.8)
  let v = 0
  let t = 0
  while (v < 27.8 && t < 20) {
    const r = v / s.top
    v += Math.min(traction, s.accel * Math.max(0, 1 - r * r)) * 0.01
    t += 0.01
  }
  return { top: s.top, t100: t }
}

/** 0..1 bars for the car-select screen. */
export function carBars(spec: CarSpec) {
  const e = estimate(spec)
  return {
    topKmh: Math.round(e.top * 3.6),
    t100: e.t100,
    speed: (e.top - 45) / 28,
    accel: (7.5 - e.t100) / 4,
    handling: (spec.grip - 9.5) / 3, // grip is 10..12.5 across the roster
    durability: (spec.durability - 0.7) / 0.9,
    weight: (spec.mass - 1400) / 900,
  }
}
