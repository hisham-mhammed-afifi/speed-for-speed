import { PLAYER_CARS } from '../data/cars'
import type { CarSpec, SaveData } from '../types'

// The garage: what cars cost, what upgrades do, and the (pure) purchase rules. Cash is only banked when you escape.

/** price by car id: roughly cheapest to most capable. The first car is free. */
const PRICES: Record<string, number> = {
  silver: 0,
  rose: 2500,
  bluecross: 5000,
  blacksuv: 8000,
  red: 12000,
  green: 17000,
  graphite: 24000,
  orange: 32000,
  white: 42000,
  dirt: 6000,
  cruiser: 11000,
  race: 30000,
}

export const carPrice = (id: string): number => PRICES[id] ?? 20000

export const UPGRADES = [
  { key: 'engine', label: 'Engine', note: '+4% top speed, +6% acceleration' },
  { key: 'tyres', label: 'Tyres', note: '+4% grip' },
  { key: 'armour', label: 'Armour', note: '+12% durability' },
  { key: 'nitro', label: 'Nitro', note: '+10% boost power' },
] as const

export const MAX_LEVEL = 3
const BASE_COST = [1500, 4000, 9000]

/** cost of the next level (0 -> 1, 1 -> 2, 2 -> 3), a little more on pricier cars */
export function upgradeCost(id: string, level: number): number {
  const tier = 1 + (carPrice(id) / 42000) * 0.6
  return Math.round((BASE_COST[Math.min(level, MAX_LEVEL - 1)] * tier) / 50) * 50
}

export const levelsOf = (save: Pick<SaveData, 'upgrades'>, id: string): number[] => save.upgrades[id] ?? [0, 0, 0, 0]

/** The car's specs with its upgrades applied (a copy; the catalogue is never changed). */
export function applyUpgrades(spec: CarSpec, lv: number[] | undefined): CarSpec {
  if (!lv || !lv.some((n) => n > 0)) return spec
  const [e = 0, t = 0, a = 0, n = 0] = lv
  return {
    ...spec,
    top: spec.top * (1 + 0.04 * e),
    accel: spec.accel * (1 + 0.06 * e),
    grip: spec.grip * (1 + 0.04 * t),
    durability: spec.durability * (1 + 0.12 * a),
    nitroPower: 1 + (spec.nitroPower - 1) * (1 + 0.1 * n) + 0.04 * n,
  }
}

export const owns = (save: Pick<SaveData, 'owned'>, id: string): boolean => save.owned.includes(id)

export function buyCar(save: SaveData, id: string): boolean {
  const price = carPrice(id)
  if (owns(save, id) || save.cash < price) return false
  save.cash -= price
  save.owned.push(id)
  return true
}

export function buyUpgrade(save: SaveData, id: string, track: number): boolean {
  if (!owns(save, id) || track < 0 || track >= UPGRADES.length) return false
  const lv = (save.upgrades[id] ??= [0, 0, 0, 0])
  if (lv[track] >= MAX_LEVEL) return false
  const cost = upgradeCost(id, lv[track])
  if (save.cash < cost) return false
  save.cash -= cost
  lv[track]++
  return true
}

/** The cheapest car you do not own yet, for the "$X to go" line. */
export function nextUnlock(save: Pick<SaveData, 'owned'>): { id: string; name: string; price: number } | null {
  let best: { id: string; name: string; price: number } | null = null
  for (const c of PLAYER_CARS) {
    if (owns(save, c.id)) continue
    const price = carPrice(c.id)
    if (!best || price < best.price) best = { id: c.id, name: c.name, price }
  }
  return best
}
