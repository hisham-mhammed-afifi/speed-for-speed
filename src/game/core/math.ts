export const TAU = Math.PI * 2

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= TAU
  while (a < -Math.PI) a += TAU
  return a
}

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))

/** Small seeded PRNG (mulberry32) so the city is identical every run. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rand = (a: number, b: number): number => a + Math.random() * (b - a)

export const pick = <T,>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0]
