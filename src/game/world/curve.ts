import type { BlockRoad } from '../types'

/** Width of a winding road, and how far from its centre line the driving lane's centre is. */
export const CURVE_W = 11
export const CURVE_LANE = 1.8

const SAMPLES = 36

/** A cubic Hermite path from A to B with the given end tangents (angles in radians, magnitudes in metres), sampled into a polyline. */
export function hermite(ax: number, ay: number, bx: number, by: number, angA: number, angB: number, magA: number, magB: number): BlockRoad {
  const m0x = Math.cos(angA) * magA,
    m0y = Math.sin(angA) * magA,
    m1x = Math.cos(angB) * magB,
    m1y = Math.sin(angB) * magB
  const pts: number[] = []
  const cum: number[] = []
  let len = 0
  for (let k = 0; k <= SAMPLES; k++) {
    const t = k / SAMPLES,
      t2 = t * t,
      t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1,
      h10 = t3 - 2 * t2 + t,
      h01 = -2 * t3 + 3 * t2,
      h11 = t3 - t2
    const x = h00 * ax + h10 * m0x + h01 * bx + h11 * m1x,
      y = h00 * ay + h10 * m0y + h01 * by + h11 * m1y
    if (k > 0) len += Math.sqrt((x - pts[2 * k - 2]) * (x - pts[2 * k - 2]) + (y - pts[2 * k - 1]) * (y - pts[2 * k - 1]))
    pts.push(x, y)
    cum.push(len)
  }
  return { w: CURVE_W, len, pts, cum, ai: 0, aj: 0, bi: 0, bj: 0 }
}

/** Squared distance from (x, y) to the road's centre line. */
export function roadDist2(r: BlockRoad, x: number, y: number): number {
  const p = r.pts
  let best = Infinity
  for (let k = 0; k < p.length - 2; k += 2) {
    const sx = p[k + 2] - p[k],
      sy = p[k + 3] - p[k + 1]
    const l2 = sx * sx + sy * sy || 1
    const t = Math.max(0, Math.min(1, ((x - p[k]) * sx + (y - p[k + 1]) * sy) / l2))
    const dx = x - (p[k] + sx * t),
      dy = y - (p[k + 1] + sy * t)
    const d = dx * dx + dy * dy
    if (d < best) best = d
  }
  return best
}

/** Arc length (from the road's start) of the point nearest to (x, y). */
export function roadProject(r: BlockRoad, x: number, y: number): number {
  const p = r.pts
  let best = Infinity,
    arc = 0
  for (let k = 0; k < p.length - 2; k += 2) {
    const sx = p[k + 2] - p[k],
      sy = p[k + 3] - p[k + 1]
    const l2 = sx * sx + sy * sy || 1
    const t = Math.max(0, Math.min(1, ((x - p[k]) * sx + (y - p[k + 1]) * sy) / l2))
    const dx = x - (p[k] + sx * t),
      dy = y - (p[k + 1] + sy * t)
    const d = dx * dx + dy * dy
    if (d < best) {
      best = d
      arc = r.cum[k >> 1] + t * (r.cum[(k >> 1) + 1] - r.cum[k >> 1])
    }
  }
  return arc
}

/** Position and unit tangent (in the direction of increasing arc length) at arc length s. Writes into `out`. */
export function roadAt(r: BlockRoad, s: number, out: { x: number; y: number; ux: number; uy: number }): void {
  const c = r.cum,
    p = r.pts
  const q = Math.max(0, Math.min(r.len, s))
  let lo = 0,
    hi = c.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (c[mid] <= q) lo = mid
    else hi = mid - 1
  }
  const sx = p[2 * lo + 2] - p[2 * lo],
    sy = p[2 * lo + 3] - p[2 * lo + 1]
  const sl = c[lo + 1] - c[lo] || 1
  const t = (q - c[lo]) / sl
  out.x = p[2 * lo] + sx * t
  out.y = p[2 * lo + 1] + sy * t
  out.ux = sx / sl
  out.uy = sy / sl
}
