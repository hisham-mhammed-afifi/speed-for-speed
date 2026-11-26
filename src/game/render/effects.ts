import { CPU_CANVAS } from '../core/canvas'
import { quality } from './quality'
import type { Car } from '../physics/car'
import type { Vec2 } from '../types'

function glowSprite(r: number, g: number, b: number, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const x = c.getContext('2d', CPU_CANVAS)!
  const h = c.width / 2
  const gr = x.createRadialGradient(h, h, 0, h, h, h)
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`)
  gr.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`)
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`)
  x.fillStyle = gr
  x.fillRect(0, 0, c.width, c.width)
  return c
}

type GlowName = 'red' | 'blue' | 'orange' | 'white' | 'smoke' | 'dark'

// particle kinds: 0 smoke, 1 spark, 2 flame, 3 debris
interface Particle {
  type: number
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  grow: number
  a: number
  sprite: GlowName | null
}

interface SkidChunk {
  cv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  cx: number
  cy: number
}

export interface Visible {
  x0: number
  y0: number
  x1: number
  y1: number
}

// Skid marks live in a few small canvases. Canvas memory is not in the JS heap and phones cap it hard, so it must stay bounded:
// at most MAX_CHUNKS chunks of 256 x 256 px (about 0.26 MB each), and the one farthest from where marks are being laid is recycled.
const CH = 128 // metres per skid-mark chunk
const PPM = 2 // skid-mark pixels per metre
const MAX_CHUNKS = 12
const MAX = 800

const parts: Particle[] = []
const free: Particle[] = []
const skids = new Map<string, SkidChunk>()
const tmp: Vec2 = { x: 0, y: 0 }

function emit(type: number, x: number, y: number, vx: number, vy: number, life: number, size: number, grow: number, a: number, sprite: GlowName | null): void {
  if (parts.length >= MAX) return
  const p: Particle = free.pop() || { type: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, size: 0, grow: 0, a: 0, sprite: null }
  p.type = type
  p.x = x
  p.y = y
  p.vx = vx
  p.vy = vy
  p.life = life
  p.max = life
  p.size = size
  p.grow = grow
  p.a = a
  p.sprite = sprite
  parts.push(p)
}

function chunk(cx: number, cy: number, create: boolean): SkidChunk | undefined {
  const k = cx + ',' + cy
  let c = skids.get(k)
  if (!c && create) {
    if (skids.size >= MAX_CHUNKS) {
      // recycle the farthest chunk: wipe its canvas and re-key it, instead of creating (and later leaking) another canvas
      let fk = '',
        fd = -1
      for (const [kk, v] of skids) {
        const d = (v.cx - cx) * (v.cx - cx) + (v.cy - cy) * (v.cy - cy)
        if (d > fd) {
          fd = d
          fk = kk
        }
      }
      c = skids.get(fk)!
      skids.delete(fk)
      c.ctx.clearRect(0, 0, c.cv.width, c.cv.height)
      c.cx = cx
      c.cy = cy
    } else {
      const cv = document.createElement('canvas')
      cv.width = cv.height = Math.round(CH * PPM)
      const ctx = cv.getContext('2d', CPU_CANVAS)!
      ctx.lineCap = 'round'
      c = { cv, ctx, cx, cy }
    }
    skids.set(k, c)
  }
  return c
}

function addSeg(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number, w: number, a: number): void {
  const c = chunk(cx, cy, true)!
  const ox = cx * CH,
    oy = cy * CH
  c.ctx.strokeStyle = `rgba(8,8,8,${a})`
  c.ctx.lineWidth = w * PPM
  c.ctx.beginPath()
  c.ctx.moveTo((x0 - ox) * PPM, (y0 - oy) * PPM)
  c.ctx.lineTo((x1 - ox) * PPM, (y1 - oy) * PPM)
  c.ctx.stroke()
}

/** Particles (smoke, sparks, flames, debris) and persistent skid marks. */
export const FX = {
  parts,
  glow: {} as Record<GlowName, HTMLCanvasElement>,

  /** Build the glow sprites. Needs a DOM, so it runs when the engine mounts, not at import. */
  init(): void {
    FX.glow = {
      red: glowSprite(255, 40, 40),
      blue: glowSprite(60, 120, 255),
      orange: glowSprite(255, 150, 40),
      white: glowSprite(255, 255, 255),
      smoke: glowSprite(170, 170, 170),
      dark: glowSprite(35, 35, 35),
    }
  },

  smoke(x: number, y: number, vx: number, vy: number, size: number, alpha: number, dark = false): void {
    if (quality.spec.particles < 1 && Math.random() > quality.spec.particles) return
    emit(0, x, y, vx + (Math.random() - 0.5) * 1.2, vy + (Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.8, size, 2.2, alpha, dark ? 'dark' : 'smoke')
  },
  spark(x: number, y: number, vx: number, vy: number): void {
    emit(1, x, y, vx, vy, 0.25 + Math.random() * 0.35, 0.12, 0, 1, null)
  },
  flame(x: number, y: number, vx: number, vy: number): void {
    emit(2, x, y, vx, vy, 0.18 + Math.random() * 0.12, 0.9, -2.5, 0.9, 'orange')
  },
  debris(x: number, y: number, vx: number, vy: number): void {
    emit(3, x, y, vx, vy, 0.8 + Math.random() * 0.8, 0.12 + Math.random() * 0.15, 0, 1, null)
  },

  update(dt: number): void {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.life -= dt
      if (p.life <= 0) {
        free.push(p)
        parts[i] = parts[parts.length - 1]
        parts.pop()
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      const damp = Math.exp(-(p.type === 0 ? 1.6 : 2.4) * dt)
      p.vx *= damp
      p.vy *= damp
      p.size = Math.max(0.01, p.size + p.grow * dt)
    }
  },

  drawParticles(ctx: CanvasRenderingContext2D, vis: Visible, additiveOnly: boolean): void {
    if (!additiveOnly) {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        if (p.type !== 0 && p.type !== 3) continue
        if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue
        const t = p.life / p.max
        if (p.type === 0) {
          ctx.globalAlpha = p.a * t * 0.8
          const s = p.size * 2
          ctx.drawImage(FX.glow[p.sprite!], p.x - s, p.y - s, s * 2, s * 2)
        } else {
          ctx.globalAlpha = Math.min(1, t * 2)
          ctx.fillStyle = '#555'
          ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2)
        }
      }
      ctx.globalAlpha = 1
      return
    }
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p.type !== 1 && p.type !== 2) continue
      if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue
      const t = p.life / p.max
      if (p.type === 1) {
        ctx.globalAlpha = Math.min(1, t * 2)
        ctx.strokeStyle = '#ffb347'
        ctx.lineWidth = 0.14
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05)
        ctx.stroke()
      } else {
        ctx.globalAlpha = p.a * t
        const s = p.size * 1.6
        ctx.drawImage(FX.glow[p.sprite!], p.x - s, p.y - s, s * 2, s * 2)
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  },

  // ---- persistent skid marks (chunked canvases, created on demand) ----
  skid(x0: number, y0: number, x1: number, y1: number, w: number, a: number): void {
    const c0x = Math.floor(x0 / CH),
      c0y = Math.floor(y0 / CH)
    const c1x = Math.floor(x1 / CH),
      c1y = Math.floor(y1 / CH)
    addSeg(c1x, c1y, x0, y0, x1, y1, w, a)
    if (c0x !== c1x || c0y !== c1y) addSeg(c0x, c0y, x0, y0, x1, y1, w, a)
  },

  clearSkids(): void {
    for (const c of skids.values()) c.cv.width = c.cv.height = 0 // release the backing store now, not whenever the GC gets to it
    skids.clear()
    parts.length = 0
  },

  /** Pixels of live offscreen canvas memory owned by the effects (4 bytes each); for the debug overlay and the soak test. */
  canvasPixels(): number {
    let n = 0
    for (const c of skids.values()) n += c.cv.width * c.cv.height
    return n
  },

  drawSkids(ctx: CanvasRenderingContext2D, vis: Visible): void {
    const x0 = Math.floor(vis.x0 / CH),
      x1 = Math.floor(vis.x1 / CH)
    const y0 = Math.floor(vis.y0 / CH),
      y1 = Math.floor(vis.y1 / CH)
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const c = chunk(cx, cy, false)
        if (c) ctx.drawImage(c.cv, cx * CH, cy * CH, CH, CH)
      }
  },

  /** Per-car effects (skid marks, tire smoke, nitro flames, damage smoke), run for cars near the player. */
  carEffects(car: Car, dt: number): void {
    const s = car.spec
    const sk = car.skid
    const marks = quality.spec.skidsAll || car.kind === 'player' // on the low tier only the player leaves skid marks
    if (sk > 0.12) {
      for (let w = 0; w < 2; w++) {
        const ly = (w ? 1 : -1) * 0.82
        car.toWorld(-s.len * 0.3, ly, tmp)
        const px = car.wp[w * 2],
          py = car.wp[w * 2 + 1]
        if (marks && !isNaN(px)) FX.skid(px, py, tmp.x, tmp.y, 0.3, 0.12 + sk * 0.38)
        car.wp[w * 2] = tmp.x
        car.wp[w * 2 + 1] = tmp.y
        if (Math.random() < dt * 70 * sk) FX.smoke(tmp.x, tmp.y, car.wvx * 0.25, car.wvy * 0.25, 0.7 + sk * 0.6, 0.45 * sk + 0.1)
      }
    } else {
      car.wp[0] = car.wp[1] = car.wp[2] = car.wp[3] = NaN
    }
    if (car.nitroOn) {
      for (let w = -1; w <= 1; w += 2) {
        car.toWorld(-s.len * 0.5 - 0.1, w * 0.45, tmp)
        FX.flame(tmp.x, tmp.y, car.wvx * 0.6 - Math.cos(car.theta) * 8, car.wvy * 0.6 - Math.sin(car.theta) * 8)
      }
    }
    if (car.health < 45) {
      const rate = (50 - car.health) * 0.4
      if (Math.random() < dt * rate) {
        car.toWorld(s.len * 0.3, (Math.random() - 0.5) * 0.8, tmp)
        FX.smoke(tmp.x, tmp.y, car.wvx * 0.4, car.wvy * 0.4, 0.8, 0.5, car.health < 25)
      }
      if (car.health < 15 && Math.random() < dt * 20) {
        car.toWorld(s.len * 0.3, (Math.random() - 0.5) * 0.8, tmp)
        FX.flame(tmp.x, tmp.y, car.wvx * 0.5, car.wvy * 0.5 - 1)
      }
    }
  },

  /** Sparks, debris and smoke at a crash. */
  impact(x: number, y: number, nx: number, ny: number, strength: number): void {
    const n = Math.min(24, 3 + Math.floor(strength * 1.2))
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.4
      const v = 4 + Math.random() * 12 * Math.min(1.5, strength / 8)
      FX.spark(x, y, Math.cos(a) * v, Math.sin(a) * v)
      if (i % 3 === 0) FX.debris(x, y, Math.cos(a) * v * 0.5, Math.sin(a) * v * 0.5)
    }
    if (strength > 6) for (let i = 0; i < 3; i++) FX.smoke(x, y, nx * 2, ny * 2, 1.2, 0.5)
  },
}
