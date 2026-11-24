import type { RunResult, SaveData } from '../types'

/**
 * Adaptive difficulty: a 0..1 "wanted rating" that follows how well the player does. Escaping quickly pushes it up,
 * getting busted early pulls it down, and it drives a handful of bounded knobs in the police AI. The default rating
 * (0.4) matches the game's baseline tuning; strong players get a noticeably harder pursuit, new players an easier one.
 */
export const DEFAULT_RATING = 0.4
const MIN_RATING = 0.05
const MAX_RATING = 0.95
/** largest move in one run */
const MAX_STEP = 0.1
/** how strongly a run's score pulls the rating toward it */
const GAIN = 0.25
/** runs shorter than this say nothing about skill (instant restarts) */
const MIN_RUN_SECONDS = 8

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export interface Knobs {
  /** -1 (easiest) .. 0 (baseline) .. +1 (hardest) */
  s: number
  /** pursuers added to / removed from the heat table */
  copOffset: number
  /** multiplies the cops' speed boost */
  boostMul: number
  /** multiplies how long cops take between sight checks (smaller = quicker to spot you) */
  reactMul: number
  /** how close / far new pursuers appear, metres */
  spawnMin: number
  spawnMax: number
  /** multiplies the time between roadblocks and between spike strips */
  trapMul: number
  /** added to the seconds you must stay hidden to escape */
  evadeAdd: number
  /** extra (or fewer) cut-off units, and the heat level they start at */
  tactBonus: number
  tactLevel: number
}

function knobsFor(rating: number): Knobs {
  const s = clamp(rating >= DEFAULT_RATING ? (rating - DEFAULT_RATING) / (MAX_RATING - DEFAULT_RATING) : (rating - DEFAULT_RATING) / (DEFAULT_RATING - MIN_RATING), -1, 1)
  return {
    s,
    copOffset: Math.round(s * (s > 0 ? 3 : 2)),
    boostMul: 1 + 0.12 * s,
    reactMul: 1 - 0.4 * s,
    spawnMin: 110 - 35 * s,
    spawnMax: 260 - 50 * s,
    trapMul: 1 - 0.3 * s,
    evadeAdd: Math.round(4 * s),
    tactBonus: s > 0.5 ? 1 : s < -0.5 ? -1 : 0,
    tactLevel: s < -0.5 ? 3 : 2,
  }
}

/** How well a finished run went, 0 (humiliating) .. 1 (flawless). */
export function scoreRun(kind: RunResult, time: number, copsDown: number, health: number): number {
  const surv = Math.min(time / 120, 1)
  if (kind === 'escaped') {
    const speedBonus = time < 45 ? 0.12 : time < 90 ? 0.06 : 0
    return clamp(0.72 + speedBonus + Math.min(copsDown, 5) * 0.02 - (1 - clamp(health, 0, 100) / 100) * 0.1, 0.5, 1)
  }
  return kind === 'busted' ? 0.12 + surv * 0.2 : 0.08 + surv * 0.2
}

export function ratingLabel(r: number): string {
  if (r < 0.25) return 'Rookie'
  if (r < 0.45) return 'Street racer'
  if (r < 0.65) return 'Known offender'
  if (r < 0.85) return 'Most wanted'
  return 'Public enemy'
}

export const Difficulty = {
  /** the saved rating */
  rating: DEFAULT_RATING,
  /** when true the rating no longer moves (and is not changed by runs) */
  fixed: false,
  /** dev override from `?skill=0..1`: used instead of the rating, never saved */
  override: null as number | null,
  k: knobsFor(DEFAULT_RATING),

  /** the rating the police actually play against */
  eff(): number {
    return Difficulty.override ?? Difficulty.rating
  },

  refresh(): void {
    Difficulty.k = knobsFor(Difficulty.eff())
  },

  load(save: SaveData, skillParam?: string | null): void {
    const r = save.skill
    Difficulty.rating = typeof r === 'number' && Number.isFinite(r) ? clamp(r, MIN_RATING, MAX_RATING) : DEFAULT_RATING
    Difficulty.fixed = !!save.fixedSkill
    const o = skillParam == null ? NaN : parseFloat(skillParam)
    Difficulty.override = Number.isFinite(o) ? clamp(o, 0, 1) : null
    Difficulty.refresh()
  },

  /** Fold a finished run into the rating. Returns the rating before and after. */
  update(kind: RunResult, time: number, copsDown: number, health: number): { before: number; after: number } {
    const before = Difficulty.rating
    if (Difficulty.fixed || Difficulty.override !== null || time < MIN_RUN_SECONDS) return { before, after: before }
    const score = scoreRun(kind, time, copsDown, health)
    const step = clamp(GAIN * (score - before), -MAX_STEP, MAX_STEP)
    Difficulty.rating = clamp(before + step, MIN_RATING, MAX_RATING)
    Difficulty.refresh()
    return { before, after: Difficulty.rating }
  },

  setFixed(on: boolean): void {
    Difficulty.fixed = on
  },

  reset(): void {
    Difficulty.rating = DEFAULT_RATING
    Difficulty.fixed = false
    Difficulty.override = null
    Difficulty.refresh()
  },
}
