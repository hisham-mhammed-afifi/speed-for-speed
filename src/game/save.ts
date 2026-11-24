import type { SaveData } from './types'

const KEY = 'heatline.v1'

export const DEFAULT_SAVE: SaveData = { best: 0, total: 0, longest: 0, car: 0, memory: {} }

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_SAVE, ...(JSON.parse(raw) as Partial<SaveData>) }
  } catch {
    /* private mode / blocked storage: play without saving */
  }
  return { ...DEFAULT_SAVE }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}
