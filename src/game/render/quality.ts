import { loop } from '../core/loop'

/**
 * Graphics / simulation quality. Three tiers trade visual extras and simulation work for speed; in "auto" the game watches how
 * long frames take and moves between steps (a tier plus a canvas-resolution scale) on its own: down quickly when it struggles,
 * up slowly when there is plenty of headroom. Phones start in the middle.
 */
export type Tier = 'high' | 'medium' | 'low'
export type QualitySetting = 'auto' | Tier

export interface TierSpec {
  /** physics + player step, seconds (high runs at 120 Hz, the others at 60 Hz) */
  step: number
  /** building shadows and tree shadows */
  shadows: boolean
  /** additive glows: car lights, siren glow, nitro flames */
  glow: boolean
  /** trees drawn at a random angle (needs a canvas transform per tree) */
  rotateTrees: boolean
  /** share of smoke puffs that are actually spawned */
  particles: number
  /** share of the normal civilian count */
  traffic: number
  /** ambient police patrols when there is no pursuit */
  patrols: number
  /** static colliders within this many metres of the player are live */
  staticRadius: number
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { step: 1 / 120, shadows: true, glow: true, rotateTrees: true, particles: 1, traffic: 1, patrols: 8, staticRadius: 520 },
  medium: { step: 1 / 60, shadows: false, glow: true, rotateTrees: true, particles: 0.5, traffic: 0.8, patrols: 6, staticRadius: 450 },
  low: { step: 1 / 60, shadows: false, glow: false, rotateTrees: false, particles: 0.25, traffic: 0.55, patrols: 4, staticRadius: 380 },
}

/** The auto ladder, best first. Each rung is a tier and a canvas-resolution multiplier. */
export const LEVELS: { tier: Tier; dpr: number }[] = [
  { tier: 'high', dpr: 1 },
  { tier: 'high', dpr: 0.8 },
  { tier: 'medium', dpr: 1 },
  { tier: 'medium', dpr: 0.8 },
  { tier: 'low', dpr: 0.8 },
  { tier: 'low', dpr: 0.65 },
]

const DOWN_FRAME_MS = 22 // slower than ~45 fps...
const DOWN_WORK_MS = 14 // ...or the game itself needs most of a 60 fps frame
const UP_WORK_MS = 6.5 // plenty of headroom: well under half a frame of work
const DOWN_AFTER = 2 // seconds of struggling before stepping down
const UP_AFTER = 8 // seconds of headroom before stepping up
const COOLDOWN = 3
const NO_UP_AFTER_DOWN = 30

export const quality = {
  setting: 'auto' as QualitySetting,
  /** index into LEVELS (the current rung in auto; fixed tiers pin it) */
  level: 0,
  tier: 'high' as Tier,
  spec: TIERS.high as TierSpec,
  dprScale: 1,
  /** called after any change so the engine can re-apply step, density, resolution */
  onChange: null as (() => void) | null,
  slowT: 0,
  fastT: 0,
  cool: 0,
  noUp: 0,

  /** Pick the starting point: from a saved / URL setting, else by device. */
  configure(setting: QualitySetting | string | null | undefined, phone: boolean): void {
    const s: QualitySetting = setting === 'high' || setting === 'medium' || setting === 'low' ? setting : 'auto'
    quality.setting = s
    quality.slowT = quality.fastT = quality.cool = quality.noUp = 0
    quality.setLevel(s === 'auto' ? (phone ? 2 : 0) : s === 'high' ? 0 : s === 'medium' ? 2 : 4)
  },

  setLevel(i: number): void {
    quality.level = Math.max(0, Math.min(LEVELS.length - 1, i))
    const L = LEVELS[quality.level]
    quality.tier = L.tier
    quality.spec = TIERS[L.tier]
    quality.dprScale = L.dpr
    loop.step = quality.spec.step
    quality.onChange?.()
  },

  /** Run once per rendered frame while playing. `dt` in seconds. */
  update(dt: number): void {
    quality.cool = Math.max(0, quality.cool - dt)
    quality.noUp = Math.max(0, quality.noUp - dt)
    if (quality.setting !== 'auto') return
    const slow = loop.frameMs > DOWN_FRAME_MS || loop.workMs > DOWN_WORK_MS
    const fast = loop.workMs < UP_WORK_MS && loop.frameMs < 19
    if (slow) {
      quality.fastT = 0
      quality.slowT += dt
      if (quality.slowT > DOWN_AFTER && quality.cool <= 0 && quality.level < LEVELS.length - 1) {
        quality.slowT = 0
        quality.cool = COOLDOWN
        quality.noUp = NO_UP_AFTER_DOWN
        quality.setLevel(quality.level + 1)
      }
    } else if (fast) {
      quality.slowT = 0
      quality.fastT += dt
      if (quality.fastT > UP_AFTER && quality.noUp <= 0 && quality.cool <= 0 && quality.level > 0) {
        quality.fastT = 0
        quality.cool = COOLDOWN
        quality.setLevel(quality.level - 1)
      }
    } else {
      quality.slowT = quality.fastT = 0
    }
  },

  /** Menu label, e.g. "Auto (Medium)". */
  label(): string {
    const t = quality.tier[0].toUpperCase() + quality.tier.slice(1)
    return quality.setting === 'auto' ? `Auto (${t})` : t
  },

  /** Cycle Auto -> High -> Medium -> Low -> Auto. Returns the new setting. */
  cycle(phone: boolean): QualitySetting {
    const order: QualitySetting[] = ['auto', 'high', 'medium', 'low']
    const next = order[(order.indexOf(quality.setting) + 1) % order.length]
    quality.configure(next, phone)
    return next
  },
}
