import { create } from 'zustand'
import { DEFAULT_SAVE } from './game/save'
import type { RunResult, RunStats, SaveData } from './game/types'

/**
 * The bridge between the imperative game engine and the React UI.
 * The engine writes here on discrete events (screen changes, results, toasts) and a ~10 Hz HUD snapshot;
 * React components read it. Per-frame data (speed, minimap, world) stays on the canvas.
 */

export type Screen = 'loading' | 'title' | 'help' | 'select' | 'playing' | 'paused' | 'result'

export interface Toast {
  id: number
  text: string
  color: string
}

export interface HudSnapshot {
  active: boolean
  level: number
  bounty: number
  /** a cop sees you (or is right beside you) */
  visible: boolean
  evadeLeft: number
  evadeFrac: number
  bust: number
  hint: boolean
  /** skill combo: money waiting to be banked, the multiplier and how much time is left (0..1) */
  combo: number
  mult: number
  comboT: number
}

export interface ResultState {
  kind: RunResult
  stats: RunStats
}

interface GameStore {
  screen: Screen
  loadProgress: number
  selectedCar: number
  result: ResultState | null
  save: SaveData
  hud: HudSnapshot
  toasts: Toast[]
  touchActive: boolean

  setScreen(screen: Screen): void
  setLoadProgress(p: number): void
  setSelectedCar(i: number): void
  setResult(r: ResultState | null): void
  setSave(s: SaveData): void
  setHud(h: HudSnapshot): void
  setTouchActive(on: boolean): void
  pushToast(text: string, color?: string): void
  clearToasts(): void
}

export const EMPTY_HUD: HudSnapshot = { active: false, level: 0, bounty: 0, visible: false, evadeLeft: 0, evadeFrac: 0, bust: 0, hint: true, combo: 0, mult: 1, comboT: 0 }

const TOAST_MS = 4000
let toastId = 1

export const useGameStore = create<GameStore>()((set) => ({
  screen: 'loading',
  loadProgress: 0,
  selectedCar: 0,
  result: null,
  save: DEFAULT_SAVE,
  hud: EMPTY_HUD,
  toasts: [],
  touchActive: false,

  setScreen: (screen) => set({ screen }),
  setLoadProgress: (loadProgress) => set({ loadProgress }),
  setSelectedCar: (selectedCar) => set({ selectedCar }),
  setResult: (result) => set({ result }),
  setSave: (save) => set({ save }),
  setHud: (hud) => set({ hud }),
  setTouchActive: (touchActive) => set({ touchActive }),
  pushToast: (text, color = '#fff') => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, text, color }].slice(-5) }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_MS)
  },
  clearToasts: () => set({ toasts: [] }),
}))
