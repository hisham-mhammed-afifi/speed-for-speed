import { PLAYER_CARS } from './data/cars'
import type { SaveData } from './types'

const KEY = 'heatline.v1'

export const DEFAULT_SAVE: SaveData = {
  best: 0,
  total: 0,
  longest: 0,
  car: 0,
  memory: {},
  v: 2,
  cash: 0,
  owned: [PLAYER_CARS[0].id],
  upgrades: {},
  streak: 0,
  stats: { nearMisses: 0, driftSec: 0, airSec: 0, escapes: 0, bestCombo: 0 },
}

const fresh = (): SaveData => ({ ...DEFAULT_SAVE, owned: [...DEFAULT_SAVE.owned], upgrades: {}, stats: { ...DEFAULT_SAVE.stats }, memory: {} })

/** Fill in anything an older save is missing. A save from before the garage existed turns its banked bounty into cash. */
export function migrateSave(raw: Partial<SaveData>): SaveData {
  const s = { ...fresh(), ...raw }
  if (!raw.v || raw.v < 2) {
    const total = Math.max(0, Math.floor(raw.total ?? 0))
    s.cash = total
    const last = PLAYER_CARS[Math.max(0, Math.min(PLAYER_CARS.length - 1, raw.car ?? 0))].id
    s.owned = Array.from(new Set([PLAYER_CARS[0].id, last]))
    s.upgrades = {}
    s.streak = 0
    s.v = 2
  }
  s.stats = { ...DEFAULT_SAVE.stats, ...(raw.stats ?? {}) }
  s.owned = Array.isArray(s.owned) && s.owned.length ? s.owned : [PLAYER_CARS[0].id]
  s.upgrades = s.upgrades && typeof s.upgrades === 'object' ? s.upgrades : {}
  s.cash = Number.isFinite(s.cash) ? Math.max(0, s.cash) : 0
  return s
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return migrateSave(JSON.parse(raw) as Partial<SaveData>)
  } catch {
    /* private mode / blocked storage: play without saving */
  }
  return fresh()
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}
