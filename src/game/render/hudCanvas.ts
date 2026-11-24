import { clamp } from '../core/math'
import { touch } from '../core/input'
import { safe } from '../core/viewport'
import { Phys } from '../physics/world'
import { game } from '../state'
import { FX } from './effects'
import { Renderer } from './renderer'
import type { camera as Camera } from './camera'
import type { City } from '../world/city'

// Per-frame HUD pieces that are drawn on the game canvas: speedometer, minimap, phone speed panel, debug text.
// Static text (heat stars, bounty, toasts, hints) lives in React (src/ui/hud/HudOverlay.tsx).

const MAP_SCALE = 0.5
let map: HTMLCanvasElement | null = null
let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
let fps = 60

/** Pre-render the whole city once for the minimap. */
export function initHudMap(city: City): void {
  const b = city.bounds
  const k = MAP_SCALE
  const w = Math.ceil((b.maxX - b.minX) * k),
    h = Math.ceil((b.maxY - b.minY) * k)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const x = cv.getContext('2d')!
  x.fillStyle = '#4a4f58'
  x.fillRect(0, 0, w, h)
  x.scale(k, k)
  x.translate(-b.minX, -b.minY)
  for (const bl of city.blocks) {
    x.fillStyle = bl.type === 'park' ? '#25472c' : bl.type === 'plaza' ? '#3a3e45' : '#23272d'
    x.fillRect(bl.x0, bl.y0, bl.x1 - bl.x0, bl.y1 - bl.y0)
  }
  x.fillStyle = '#23272d'
  for (const bd of city.buildings) x.fillRect(bd.x0, bd.y0, bd.x1 - bd.x0, bd.y1 - bd.y0)
  map = cv
  bounds = b
}

function arc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number, lw: number, col: string): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, a0, a1)
  ctx.lineWidth = lw
  ctx.strokeStyle = col
  ctx.stroke()
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, col: string): void {
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = col
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h)
}

function gearLabel(): string {
  const pl = game.player.car
  if (pl.reversing) return 'R'
  if (pl.speed < 0.5 && pl.ctrl.throttle < 0.05) return 'N'
  return String(pl.gear)
}

function speedo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const pl = game.player.car,
    s = pl.spec
  const kmh = pl.speed * 3.6
  const A0 = Math.PI * 0.75,
    SW = Math.PI * 1.5,
    MAX = 320
  ctx.save()
  ctx.fillStyle = 'rgba(8,10,14,0.62)'
  ctx.beginPath()
  ctx.arc(cx, cy, r + 8, 0, 6.283)
  ctx.fill()
  arc(ctx, cx, cy, r, A0, A0 + SW, 5, 'rgba(255,255,255,0.15)')
  const f = clamp(kmh / MAX, 0, 1)
  arc(ctx, cx, cy, r, A0, A0 + SW * f, 5, f > 0.8 ? '#ff5a3c' : '#38d6ff')
  // ticks
  ctx.font = '600 ' + Math.round(r * 0.11) + 'px "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= MAX; v += 20) {
    const a = A0 + (SW * v) / MAX,
      big = v % 40 === 0
    const r0 = r - (big ? 14 : 9),
      r1 = r - 4
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    ctx.lineWidth = big ? 2 : 1
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.stroke()
    if (big) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.fillText(String(v), cx + Math.cos(a) * (r - 27), cy + Math.sin(a) * (r - 27))
    }
  }
  // rpm ring
  const rf = clamp(pl.rpm / s.redline, 0, 1.02)
  arc(ctx, cx, cy, r * 0.62, A0, A0 + SW, 7, 'rgba(255,255,255,0.1)')
  arc(ctx, cx, cy, r * 0.62, A0, A0 + SW * Math.min(1, rf), 7, rf > 0.88 ? '#ff3b3b' : rf > 0.72 ? '#ffb02e' : '#e9eef5')
  // needle
  const na = A0 + SW * f
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(na) * (r - 10), cy + Math.sin(na) * (r - 10))
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ff5a3c'
  ctx.stroke()
  // digits
  ctx.fillStyle = '#fff'
  ctx.font = '800 ' + Math.round(r * 0.34) + 'px "Segoe UI", sans-serif'
  ctx.fillText(String(Math.round(kmh)), cx, cy - r * 0.05)
  ctx.font = '600 ' + Math.round(r * 0.11) + 'px "Segoe UI", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText('KM/H', cx, cy + r * 0.2)
  ctx.fillStyle = pl.shiftT > 0 ? '#ffb02e' : '#fff'
  ctx.font = '800 ' + Math.round(r * 0.26) + 'px "Segoe UI", sans-serif'
  ctx.fillText(gearLabel(), cx, cy + r * 0.45)
  ctx.restore()
  // bars
  const bx = cx - r,
    by = cy + r + 16,
    bw = r * 2
  ctx.font = '700 10px "Segoe UI", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillText('NITRO', bx, by - 3)
  bar(ctx, bx + 44, by - 9, bw - 44, 7, pl.nitro, pl.nitroOn ? '#9be7ff' : '#38b6ff')
  ctx.fillText('DMG', bx, by + 14)
  bar(ctx, bx + 44, by + 8, bw - 44, 7, pl.health / 100, pl.health > 50 ? '#7be08a' : pl.health > 25 ? '#ffb02e' : '#ff4a4a')
  if (pl.flat > 0) {
    ctx.fillStyle = '#ff4a4a'
    ctx.fillText('FLAT TIRES ' + pl.flat.toFixed(0) + 's', bx, by + 32)
  }
}

/** Compact speed readout for phones (the round gauges are too big next to the touch buttons). */
function touchPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const pl = game.player.car
  const h = 58
  ctx.save()
  ctx.fillStyle = 'rgba(8,10,14,0.62)'
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 10)
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#fff'
  ctx.font = '800 28px "Segoe UI", sans-serif'
  const kmh = String(Math.round(pl.speed * 3.6))
  ctx.fillText(kmh, x + 10, y + 29)
  const tw = ctx.measureText(kmh).width
  ctx.font = '700 10px "Segoe UI", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText('KM/H', x + 14 + tw, y + 29)
  ctx.textAlign = 'right'
  ctx.fillStyle = pl.shiftT > 0 ? '#ffb02e' : '#fff'
  ctx.font = '800 22px "Segoe UI", sans-serif'
  ctx.fillText(gearLabel(), x + w - 10, y + 28)
  bar(ctx, x + 10, y + 38, w - 20, 5, pl.nitro, pl.nitroOn ? '#9be7ff' : '#38b6ff')
  bar(ctx, x + 10, y + 47, w - 20, 5, pl.health / 100, pl.health > 50 ? '#7be08a' : pl.health > 25 ? '#ffb02e' : '#ff4a4a')
  ctx.restore()
  if (pl.flat > 0) {
    ctx.fillStyle = '#ff4a4a'
    ctx.font = '700 11px "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('FLAT TIRES ' + pl.flat.toFixed(0) + 's', x, y + h + 14)
  }
}

function minimap(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cam: typeof Camera): void {
  const pl = game.player.car,
    H = game.heat
  const range = 240,
    k = r / range
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 6.283)
  ctx.clip()
  ctx.fillStyle = '#101317'
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.translate(cx, cy)
  ctx.rotate(cam.angle)
  ctx.scale(k, k)
  ctx.translate(-pl.x, -pl.y)
  const b = bounds
  if (map) ctx.drawImage(map, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
  const dot = (x: number, y: number, rad: number, col: string) => {
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(x, y, rad / k, 0, 6.283)
    ctx.fill()
  }
  if (H.active && !H.visible) {
    ctx.strokeStyle = 'rgba(255,200,60,0.8)'
    ctx.lineWidth = 1.5 / k
    ctx.setLineDash([6 / k, 5 / k])
    ctx.beginPath()
    ctx.arc(H.lastX, H.lastY, 60, 0, 6.283)
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const s of H.spikes) dot(s.x, s.y, 3, '#ffb02e')
  const blink = Math.floor(game.time * 6) % 2
  for (const u of game.cops) {
    if (u.state === 'wrecked') continue
    dot(u.car.x, u.car.y, 3.2, u.state === 'patrol' ? '#6a8fd6' : blink ? '#ff3b3b' : '#4a7dff')
  }
  if (H.heli) dot(H.heli.x, H.heli.y, 4.5, '#ffffff')
  // player arrow
  ctx.save()
  ctx.translate(pl.x, pl.y)
  ctx.rotate(pl.theta)
  ctx.fillStyle = '#ffd23f'
  ctx.beginPath()
  ctx.moveTo(7 / k, 0)
  ctx.lineTo(-5 / k, 4.5 / k)
  ctx.lineTo(-3 / k, 0)
  ctx.lineTo(-5 / k, -4.5 / k)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  ctx.restore()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 6.283)
  ctx.stroke()
}

/** Draw the canvas part of the HUD (called after the world, in screen space). */
export function drawHudCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, dt: number, cam: typeof Camera): void {
  const pl = game.player.car,
    heat = game.heat
  fps += (1 / Math.max(dt, 0.001) - fps) * 0.05
  const s = clamp(Math.min(W, H) / 760, 0.62, 1.2)
  ctx.save()
  ctx.textBaseline = 'alphabetic'

  if (touch.active) {
    // phone layout: speed panel beside the pause/reset buttons (top-left), small minimap top-right
    touchPanel(ctx, safe.l + 64, safe.t + 10, 150)
    const mr = clamp(Math.min(W, H) * 0.16, 50, 78)
    minimap(ctx, W - safe.r - mr - 10, safe.t + mr + 10, mr, cam)
  } else {
    const r = 92 * s
    speedo(ctx, W - r - 28 * s, H - r - 62 * s, r)
    const mr = 88 * s
    minimap(ctx, W - mr - 20 * s, mr + 20 * s, mr, cam)
  }

  if (Renderer.debug) {
    ctx.font = '12px Consolas, monospace'
    ctx.fillStyle = '#9f9'
    ctx.textAlign = 'left'
    const lines = [
      'fps ' + fps.toFixed(0) + '  cars ' + game.cars.length + '  parts ' + FX.parts.length,
      'v ' + pl.vx.toFixed(1) + ' / ' + pl.vy.toFixed(1) + ' m/s  yaw ' + pl.w.toFixed(2),
      'Matter.js bodies ' + Phys.engine!.world.bodies.length + '  sliding ' + (pl.sliding ? 'yes' : 'no'),
      'accel fwd ' + pl.aF.toFixed(1) + '  lat ' + pl.aL.toFixed(1) + ' m/s2  grip use ' + (pl.gripUse * 100).toFixed(0) + '%',
      'gear ' + pl.gear + '  rpm ' + pl.rpm.toFixed(0),
      'surface ' + pl.surfaceKind + '  skid ' + pl.skid.toFixed(2),
      'heat ' + heat.level + ' pts ' + heat.points.toFixed(0) + ' evade ' + heat.evade.toFixed(1),
    ]
    lines.forEach((l, i) => ctx.fillText(l, 16, 150 + i * 15))
  }
  ctx.restore()
}
