import { clamp, damp, hyp, wrapAngle } from '../core/math'
import { touch } from '../core/input'
import type { Car } from '../physics/car'
import type { Visible } from './effects'

export type CameraMode = 'north' | 'heading'

/** Smooth follow camera: velocity look-ahead, speed-based zoom, optional heading-up rotation, screen shake. */
export const camera = {
  x: 0,
  y: 0,
  view: 52,
  scale: 20,
  angle: 0,
  shake: 0,
  mode: 'north' as CameraMode,
  inited: false,
  vis: { x0: 0, y0: 0, x1: 0, y1: 0 } as Visible,

  snap(): void {
    camera.inited = false
  },

  addShake(a: number): void {
    camera.shake = Math.min(1, camera.shake + a)
  },

  update(dt: number, pl: Car, alpha: number, W: number, H: number): void {
    const px = pl.px + (pl.x - pl.px) * alpha,
      py = pl.py + (pl.y - pl.py) * alpha
    const lx = clamp(pl.wvx * 0.3, -16, 16),
      ly = clamp(pl.wvy * 0.3, -16, 16)
    const tx = px + lx,
      ty = py + ly
    // `view` = metres of road visible across the SHORTER screen side, so portrait phones see as much as landscape
    const view = (touch.active ? 30 : 34) + 36 * clamp(pl.speed / 62, 0, 1)
    const targetAngle = camera.mode === 'heading' ? -Math.PI / 2 - (pl.pth + wrapAngle(pl.theta - pl.pth) * alpha) : 0
    if (!camera.inited) {
      camera.x = tx
      camera.y = ty
      camera.view = view
      camera.angle = targetAngle
      camera.inited = true
    }
    camera.x = damp(camera.x, tx, 7, dt)
    camera.y = damp(camera.y, ty, 7, dt)
    camera.view = damp(camera.view, view, 1.4, dt)
    camera.angle += wrapAngle(targetAngle - camera.angle) * (1 - Math.exp(-5 * dt))
    camera.scale = Math.min(W, H) / camera.view
    camera.shake *= Math.exp(-5 * dt)
  },

  /** Push the world transform onto the canvas and compute the visible world rectangle. */
  begin(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.save()
    const s = camera.scale
    const sx = (Math.random() - 0.5) * camera.shake * 26,
      sy = (Math.random() - 0.5) * camera.shake * 26
    ctx.translate(W / 2 + sx, H / 2 + sy)
    ctx.rotate(camera.angle)
    ctx.scale(s, s)
    ctx.translate(-camera.x, -camera.y)
    const r = hyp(W, H) / 2 / s + 6
    const v = camera.vis
    v.x0 = camera.x - r
    v.x1 = camera.x + r
    v.y0 = camera.y - r
    v.y1 = camera.y + r
  },

  end(ctx: CanvasRenderingContext2D): void {
    ctx.restore()
  },
}
