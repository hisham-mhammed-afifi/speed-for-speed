import type { DailyState, SaveData } from '../types'

// Three challenges a day, the same for everybody on a given date, and a streak for finishing all three.

export type StatKey = 'near' | 'drift' | 'air' | 'escape3' | 'cops' | 'mult3' | 'bank5k' | 'km' | 'fastEscape' | 'escapes'

export interface ChallengeDef {
  id: string
  text: string
  stat: StatKey
  goal: number
  reward: number
}

export const CHALLENGES: ChallengeDef[] = [
  { id: 'near15', text: 'Squeeze past traffic 15 times', stat: 'near', goal: 15, reward: 1500 },
  { id: 'near30', text: 'Squeeze past traffic 30 times', stat: 'near', goal: 30, reward: 2500 },
  { id: 'drift20', text: 'Drift for 20 seconds in total', stat: 'drift', goal: 20, reward: 1500 },
  { id: 'drift45', text: 'Drift for 45 seconds in total', stat: 'drift', goal: 45, reward: 2500 },
  { id: 'air5', text: 'Spend 5 seconds in the air', stat: 'air', goal: 5, reward: 1500 },
  { id: 'esc3', text: 'Escape a heat level 3 pursuit', stat: 'escape3', goal: 1, reward: 2500 },
  { id: 'cops4', text: 'Wreck 4 police cars', stat: 'cops', goal: 4, reward: 2000 },
  { id: 'mult3', text: 'Reach a x3 combo', stat: 'mult3', goal: 1, reward: 1500 },
  { id: 'bank5k', text: 'Bank $5,000 in one escape', stat: 'bank5k', goal: 1, reward: 2500 },
  { id: 'km8', text: 'Drive 8 km', stat: 'km', goal: 8, reward: 1500 },
  { id: 'fast', text: 'Escape within 90 seconds', stat: 'fastEscape', goal: 1, reward: 2000 },
  { id: 'esc2', text: 'Escape 2 pursuits', stat: 'escapes', goal: 2, reward: 2000 },
]

const byId = new Map(CHALLENGES.map((c) => [c.id, c]))
export const challengeById = (id: string): ChallengeDef | undefined => byId.get(id)

const pad = (n: number) => (n < 10 ? '0' : '') + n
/** local calendar date, YYYY-MM-DD */
export const dateKey = (d: Date = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function yesterdayKey(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d - 1))
}

/** small deterministic hash -> unsigned int */
function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Pick three challenges for a date, never two of the same kind. */
export function pickDaily(date: string): string[] {
  let seed = hash('heatline:' + date)
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const pool = CHALLENGES.slice()
  const out: ChallengeDef[] = []
  while (out.length < 3 && pool.length) {
    const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0]
    if (out.some((o) => o.stat === c.stat)) continue
    out.push(c)
  }
  return out.map((c) => c.id)
}

/** Make sure the save holds today's challenges (a new day starts fresh). Returns the state. */
export function ensureDaily(save: SaveData, today: string = dateKey()): DailyState {
  if (!save.daily || save.daily.date !== today) {
    const ids = pickDaily(today)
    save.daily = { date: today, ids, progress: ids.map(() => 0), done: ids.map(() => false) }
  }
  return save.daily
}

/** The streak as it stands today: it only counts if the last finished day was today or yesterday. */
export function activeStreak(save: Pick<SaveData, 'streak' | 'lastDailyDone'>, today: string = dateKey()): number {
  return save.lastDailyDone === today || save.lastDailyDone === yesterdayKey(today) ? save.streak : 0
}

export const rewardFor = (c: ChallengeDef, streak: number): number => Math.round(c.reward * (1 + 0.1 * Math.min(streak, 5)))

export interface DailyEvent {
  challenge: ChallengeDef
  reward: number
  /** all three are done now (the streak went up) */
  allDone: boolean
  streak: number
}

/**
 * Add progress for a stat. A completed challenge pays once (straight into the wallet) and is returned so the caller can announce it.
 */
export function trackDaily(save: SaveData, stat: StatKey, amount: number, today: string = dateKey()): DailyEvent[] {
  const d = ensureDaily(save, today)
  const events: DailyEvent[] = []
  for (let i = 0; i < d.ids.length; i++) {
    const c = byId.get(d.ids[i])
    if (!c || c.stat !== stat || d.done[i]) continue
    d.progress[i] += amount
    if (d.progress[i] < c.goal) continue
    d.progress[i] = c.goal
    d.done[i] = true
    const allDone = d.done.every(Boolean)
    if (allDone && save.lastDailyDone !== today) {
      save.streak = save.lastDailyDone === yesterdayKey(today) ? save.streak + 1 : 1
      save.lastDailyDone = today
    }
    const reward = rewardFor(c, activeStreak(save, today))
    save.cash += reward
    events.push({ challenge: c, reward, allDone, streak: save.streak })
  }
  return events
}

/** Seconds until the local date changes. */
export function secondsToReset(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000))
}
