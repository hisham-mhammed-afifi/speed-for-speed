import { CPU_CANVAS } from '../core/canvas'
import { clamp } from '../core/math'
import { Memory } from '../ai/memory'
import { touch } from '../core/input'
import { safe } from '../core/viewport'
import { Phys } from '../physics/world'
import { game } from '../state'
import { FX } from './effects'
import { Renderer } from './renderer'
import type { camera as Camera } from './camera'
import type { Tile } from '../world/city'

// Per-frame HUD pieces that are drawn on the game canvas: speedometer, minimap, phone speed panel, debug text.
// Static text (heat stars, bounty, toasts, hints) lives in React (src/ui/hud/HudOverlay.tsx).

const MAP_SCALE = 0.2
let fps = 60

/** The minimap picture of one tile (blocks tinted by district, buildings, water, bridges, tunnels, highways), made the first time it is drawn. */
function tileMap(t: Tile): HTMLCanvasElement {
  if (t.map) return t.map
  const k = MAP_SCALE
  const cv = document.createElement('canvas')
  cv.width = Math.ceil((t.x1 - t.x0) * k)
  cv.height = Math.ceil((t.y1 - t.y0) * k)
  const x = cv.getContext('2d', CPU_CANVAS)!
  x.fillStyle = '#4a4f58'
  x.fillRect(0, 0, cv.width, cv.height)
  x.scale(k, k)
  x.translate(-t.x0, -t.y0)
  // a tint per district so you can tell where you are at a glance
  const tint = { downtown: '#222833', port: '#2d2a25', suburbs: '#24302a' } as const
  for (const bl of t.blocks) {
    x.fillStyle =
      bl.type === 'park'
        ? '#25472c'
        : bl.type === 'plaza'
          ? '#3a3e45'
          : bl.type === 'sand'
            ? '#8a7548'
            : tint[bl.district]
    x.fillRect(bl.x0, bl.y0, bl.x1 - bl.x0, bl.y1 - bl.y0)
  }
  // bend parks (lawn over the removed streets) and roundabouts
  for (const sb of t.supers.concat(t.squares)) {
    if (sb.kind === 'bend') {
      x.fillStyle = '#25472c'
      x.fillRect(sb.x0, sb.y0, sb.x1 - sb.x0, sb.y1 - sb.y0)
    } else {
      x.fillStyle = '#4a4f58'
      x.beginPath()
      x.arc(sb.cx, sb.cy, sb.ro, 0, 6.2832)
      x.fill()
      x.fillStyle = sb.kind === 'square' ? '#9a9da6' : '#25472c'
      x.beginPath()
      x.arc(sb.cx, sb.cy, sb.ri, 0, 6.2832)
      x.fill()
    }
  }
  // winding roads
  x.strokeStyle = '#4a4f58'
  x.lineWidth = 10
  x.lineJoin = 'round'
  for (const r of t.curves) {
    x.beginPath()
    for (let q = 0; q < r.pts.length; q += 2) {
      if (q) x.lineTo(r.pts[q], r.pts[q + 1])
      else x.moveTo(r.pts[q], r.pts[q + 1])
    }
    x.stroke()
  }
  for (const bd of t.buildings) {
    x.fillStyle =
      bd.kind === 'container'
        ? '#3b2f2b'
        : bd.kind === 'house'
          ? '#2f3a30'
          : bd.kind === 'tower'
            ? '#1c2029'
            : bd.kind === 'rock'
              ? '#5b5750'
              : bd.kind === 'statue'
                ? '#d6d9df'
                : '#26231f'
    x.fillRect(bd.x0, bd.y0, bd.x1 - bd.x0, bd.y1 - bd.y0)
  }
  // the river, its bridges and the tunnels (a dark line so you can plan an escape route)
  x.fillStyle = '#1f4e7a'
  for (const r of t.rivers) x.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
  x.fillStyle = '#4a4f58'
  for (const br of t.bridges) x.fillRect(br.x0, br.y0, br.x1 - br.x0, br.y1 - br.y0)
  x.fillStyle = '#0c0d10'
  for (const tn of t.tunnels) x.fillRect(tn.x0, tn.y0, tn.x1 - tn.x0, tn.y1 - tn.y0)
  // the four highways around the tile, in amber
  x.fillStyle = '#7a6a3a'
  for (const i of [0, 16]) x.fillRect(t.V.pos[i] - t.V.wid[i] / 2, t.y0, t.V.wid[i], t.y1 - t.y0)
  for (const j of [0, 16]) x.fillRect(t.x0, t.H.pos[j] - t.H.wid[j] / 2, t.x1 - t.x0, t.H.wid[j])
  t.map = cv
  return cv
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

// ---- small cache helpers: HUD text and gauges are the slowest things on the canvas, so draw them rarely --------------------------

interface Layer {
  cv: HTMLCanvasElement
  c: CanvasRenderingContext2D
  w: number
  h: number
  dpr: number
  key: string
}

/** An offscreen canvas of w x h CSS pixels at the given device-pixel ratio (reused while the size stays the same). */
function layer(old: Layer | null, w: number, h: number, dpr: number): Layer {
  if (old && old.w === w && old.h === h && old.dpr === dpr) return old
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.ceil(w * dpr))
  cv.height = Math.max(1, Math.ceil(h * dpr))
  const c = cv.getContext('2d', CPU_CANVAS)!
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { cv, c, w, h, dpr, key: '' }
}

const deviceScale = (ctx: CanvasRenderingContext2D) => ctx.getTransform().a

/** The bar's moving part only (its track lives in a cached layer). */
function barFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, col: string): void {
  ctx.fillStyle = col
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h)
}

// ---- speedometer: the dial (ticks, numbers, labels) is drawn once; every frame only the moving parts -------------------------
let dialLayer: Layer | null = null

function drawDial(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const A0 = Math.PI * 0.75,
    SW = Math.PI * 1.5,
    MAX = 320
  c.fillStyle = 'rgba(8,10,14,0.62)'
  c.beginPath()
  c.arc(cx, cy, r + 8, 0, 6.283)
  c.fill()
  arc(c, cx, cy, r, A0, A0 + SW, 5, 'rgba(255,255,255,0.15)')
  c.font = '600 ' + Math.round(r * 0.11) + 'px "Segoe UI", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  for (let v = 0; v <= MAX; v += 20) {
    const a = A0 + (SW * v) / MAX,
      big = v % 40 === 0
    const r0 = r - (big ? 14 : 9),
      r1 = r - 4
    c.beginPath()
    c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    c.lineWidth = big ? 2 : 1
    c.strokeStyle = 'rgba(255,255,255,0.55)'
    c.stroke()
    if (big) {
      c.fillStyle = 'rgba(255,255,255,0.6)'
      c.fillText(String(v), cx + Math.cos(a) * (r - 27), cy + Math.sin(a) * (r - 27))
    }
  }
  arc(c, cx, cy, r * 0.62, A0, A0 + SW, 7, 'rgba(255,255,255,0.1)')
  c.font = '600 ' + Math.round(r * 0.11) + 'px "Segoe UI", sans-serif'
  c.fillStyle = 'rgba(255,255,255,0.6)'
  c.fillText('KM/H', cx, cy + r * 0.2)
  // the nitro / damage bars: labels and tracks
  const bx = cx - r,
    by = cy + r + 16,
    bw = r * 2
  c.font = '700 10px "Segoe UI", sans-serif'
  c.textAlign = 'left'
  c.textBaseline = 'alphabetic'
  c.fillStyle = 'rgba(255,255,255,0.7)'
  c.fillText('NITRO', bx, by - 3)
  c.fillText('DMG', bx, by + 14)
  c.fillStyle = 'rgba(255,255,255,0.12)'
  c.fillRect(bx + 44, by - 9, bw - 44, 7)
  c.fillRect(bx + 44, by + 8, bw - 44, 7)
}

function speedo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const pl = game.player.car,
    s = pl.spec
  const kmh = pl.speed * 3.6
  const A0 = Math.PI * 0.75,
    SW = Math.PI * 1.5,
    MAX = 320
  // the static dial, from the cache
  const pad = 10
  dialLayer = layer(dialLayer, Math.ceil(2 * r + 2 * pad), Math.ceil(2 * r + 2 * pad + 50), deviceScale(ctx))
  if (dialLayer.key !== String(r)) {
    dialLayer.key = String(r)
    dialLayer.c.clearRect(0, 0, dialLayer.w, dialLayer.h)
    drawDial(dialLayer.c, r + pad, r + pad, r)
  }
  ctx.drawImage(dialLayer.cv, cx - r - pad, cy - r - pad, dialLayer.w, dialLayer.h)
  // the moving parts
  ctx.save()
  const f = clamp(kmh / MAX, 0, 1)
  arc(ctx, cx, cy, r, A0, A0 + SW * f, 5, f > 0.8 ? '#ff5a3c' : '#38d6ff')
  const rf = clamp(pl.rpm / s.redline, 0, 1.02)
  arc(ctx, cx, cy, r * 0.62, A0, A0 + SW * Math.min(1, rf), 7, rf > 0.88 ? '#ff3b3b' : rf > 0.72 ? '#ffb02e' : '#e9eef5')
  const na = A0 + SW * f
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(na) * (r - 10), cy + Math.sin(na) * (r - 10))
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ff5a3c'
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.font = '800 ' + Math.round(r * 0.34) + 'px "Segoe UI", sans-serif'
  ctx.fillText(String(Math.round(kmh)), cx, cy - r * 0.05)
  ctx.fillStyle = pl.shiftT > 0 ? '#ffb02e' : '#fff'
  ctx.font = '800 ' + Math.round(r * 0.26) + 'px "Segoe UI", sans-serif'
  ctx.fillText(gearLabel(), cx, cy + r * 0.45)
  ctx.restore()
  const bx = cx - r,
    by = cy + r + 16,
    bw = r * 2
  barFill(ctx, bx + 44, by - 9, bw - 44, 7, pl.nitro, pl.nitroOn ? '#9be7ff' : '#38b6ff')
  barFill(ctx, bx + 44, by + 8, bw - 44, 7, pl.health / 100, pl.health > 50 ? '#7be08a' : pl.health > 25 ? '#ffb02e' : '#ff4a4a')
  if (pl.flat > 0) {
    ctx.fillStyle = '#ff4a4a'
    ctx.font = '700 10px "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('FLAT TIRES ' + pl.flat.toFixed(0) + 's', bx, by + 32)
  }
}

// ---- phone speed panel: redrawn only when something it shows changed -----------------------------------------------------------
let panelLayer: Layer | null = null

/** Compact speed readout for phones (the round gauges are too big next to the touch buttons). */
function touchPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const pl = game.player.car
  const h = 58
  panelLayer = layer(panelLayer, w, h, deviceScale(ctx))
  const kmh = Math.round(pl.speed * 3.6)
  const g = gearLabel()
  const nitro = Math.round(pl.nitro * 50) // 2% steps are invisible on a 130 px bar
  const hp = Math.round(pl.health / 2)
  const key = [kmh, g, pl.shiftT > 0 ? 1 : 0, nitro, pl.nitroOn ? 1 : 0, hp].join('|')
  if (panelLayer.key !== key) {
    panelLayer.key = key
    const c = panelLayer.c
    c.clearRect(0, 0, w, h)
    c.fillStyle = 'rgba(8,10,14,0.62)'
    c.beginPath()
    c.roundRect(0, 0, w, h, 10)
    c.fill()
    c.textBaseline = 'alphabetic'
    c.textAlign = 'left'
    c.fillStyle = '#fff'
    c.font = '800 28px "Segoe UI", sans-serif'
    const txt = String(kmh)
    c.fillText(txt, 10, 29)
    const tw = c.measureText(txt).width
    c.font = '700 10px "Segoe UI", sans-serif'
    c.fillStyle = 'rgba(255,255,255,0.6)'
    c.fillText('KM/H', 14 + tw, 29)
    c.textAlign = 'right'
    c.fillStyle = pl.shiftT > 0 ? '#ffb02e' : '#fff'
    c.font = '800 22px "Segoe UI", sans-serif'
    c.fillText(g, w - 10, 28)
    bar(c, 10, 38, w - 20, 5, pl.nitro, pl.nitroOn ? '#9be7ff' : '#38b6ff')
    bar(c, 10, 47, w - 20, 5, pl.health / 100, pl.health > 50 ? '#7be08a' : pl.health > 25 ? '#ffb02e' : '#ff4a4a')
  }
  ctx.drawImage(panelLayer.cv, x, y, w, h)
  if (pl.flat > 0) {
    ctx.fillStyle = '#ff4a4a'
    ctx.font = '700 11px "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('FLAT TIRES ' + pl.flat.toFixed(0) + 's', x, y + h + 14)
  }
}

// ---- minimap: the map and dots are redrawn 20 times a second into a cache; the player arrow and ring stay live -----------------
let miniLayer: Layer | null = null
let miniAge = 1

/** The map, pursuit markers and units (everything except the player arrow), centred on (cx, cy) with radius r. */
function miniContent(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cam: typeof Camera): void {
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
  for (const t of game.city.tiles) {
    if (t.x1 < pl.x - 320 || t.x0 > pl.x + 320 || t.y1 < pl.y - 320 || t.y0 > pl.y + 320) continue // not in the minimap's range
    ctx.drawImage(tileMap(t), t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0)
  }
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
  if (H.active) {
    // hideouts the police remember: faint rings
    ctx.strokeStyle = 'rgba(106,183,255,0.45)'
    ctx.lineWidth = 1.2 / k
    for (const c of Memory.hot().slice(0, 6)) {
      ctx.beginPath()
      ctx.arc(c.x, c.y, 34, 0, 6.283)
      ctx.stroke()
    }
  }
  for (const s of H.spikes) dot(s.x, s.y, 3, '#ffb02e')
  const blink = Math.floor(game.time * 6) % 2
  for (const u of game.cops) {
    if (u.state === 'wrecked') continue
    if (u.state === 'intercept') dot(u.car.x, u.car.y, 4, blink ? '#ffb02e' : '#ff3b3b') // cutting you off: amber blink
    else dot(u.car.x, u.car.y, 3.2, u.state === 'patrol' ? '#6a8fd6' : blink ? '#ff3b3b' : '#4a7dff')
  }
  if (H.heli) dot(H.heli.x, H.heli.y, 4.5, '#ffffff')
  ctx.restore()
}

function minimap(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cam: typeof Camera, dt: number): void {
  const pl = game.player.car
  const size = Math.ceil(r * 2 + 4)
  const fresh = !miniLayer || miniLayer.w !== size || miniLayer.dpr !== deviceScale(ctx)
  miniLayer = layer(miniLayer, size, size, deviceScale(ctx))
  miniAge += dt
  if (fresh || miniAge >= 0.05) {
    miniAge = 0
    miniLayer.c.clearRect(0, 0, size, size)
    miniContent(miniLayer.c, size / 2, size / 2, r, cam)
  }
  ctx.drawImage(miniLayer.cv, cx - size / 2, cy - size / 2, size, size)
  // player arrow (always live): the map is rotated by the camera, the arrow by the car, so on screen it turns by both
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(cam.angle + pl.theta)
  ctx.fillStyle = '#ffd23f'
  ctx.beginPath()
  ctx.moveTo(7, 0)
  ctx.lineTo(-5, 4.5)
  ctx.lineTo(-3, 0)
  ctx.lineTo(-5, -4.5)
  ctx.closePath()
  ctx.fill()
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
    minimap(ctx, W - safe.r - mr - 10, safe.t + mr + 10, mr, cam, dt)
  } else {
    const r = 92 * s
    speedo(ctx, W - r - 28 * s, H - r - 62 * s, r)
    const mr = 88 * s
    minimap(ctx, W - mr - 20 * s, mr + 20 * s, mr, cam, dt)
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
      'surface ' + pl.surfaceKind + '  skid ' + pl.skid.toFixed(2) + '  district ' + game.city.districtAt(pl.x, pl.y),
      'heat ' + heat.level + ' pts ' + heat.points.toFixed(0) + ' evade ' + heat.evade.toFixed(1),
    ]
    lines.forEach((l, i) => ctx.fillText(l, 16, 150 + i * 15))
  }
  ctx.restore()
}
