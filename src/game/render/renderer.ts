import { images } from '../core/assets'
import { wrapAngle } from '../core/math'
import { Phys } from '../physics/world'
import { game } from '../state'
import { FX } from './effects'
import type { Visible } from './effects'
import type { camera as Camera } from './camera'
import type { Car } from '../physics/car'
import { BRIDGES, RIVER_I } from '../world/city'
import { Props } from '../world/props'
import { GRASS_FILES, LOTS, TREE_FILES, treeSpecies } from '../world/worldArt'
import type { City } from '../world/city'
import type { Heli, Spike } from '../ai/heat'
import type { Building, LotPlacement, Vec2 } from '../types'

function makeTex(size: number, base: string, spread: number, count: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const x = c.getContext('2d')!
  x.fillStyle = base
  x.fillRect(0, 0, size, size)
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * spread
    const col = v > 0 ? 255 : 0
    x.fillStyle = `rgba(${col},${col},${col},${Math.abs(v) / 255})`
    x.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
  return c
}

type PatternName = 'asphalt' | 'sidewalk' | 'lot' | 'grass' | 'port' | 'lawn' | 'plaza' | 'water' | 'gravel'
const pat = {} as Record<PatternName, CanvasPattern>

// ---------------------------------------------------------------- ground
/** A landmark photo lot, stretched over its block (turned and mirrored as placed). */
function drawLot(ctx: CanvasRenderingContext2D, lot: LotPlacement): void {
  const im = images[LOTS[lot.art].file]
  if (!im) return
  const rw = lot.x1 - lot.x0,
    rh = lot.y1 - lot.y0
  ctx.save()
  ctx.translate((lot.x0 + lot.x1) / 2, (lot.y0 + lot.y1) / 2)
  if (lot.rot) ctx.rotate(Math.PI / 2)
  ctx.scale(lot.flipX ? -1 : 1, lot.flipY ? -1 : 1)
  const lw = lot.rot ? rh : rw,
    lh = lot.rot ? rw : rh
  ctx.drawImage(im, -lw / 2, -lh / 2, lw, lh)
  ctx.restore()
}

function drawGround(ctx: CanvasRenderingContext2D, city: City, vis: Visible): void {
  const b = city.bounds
  ctx.fillStyle = pat.asphalt
  ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
  const blocks = city.blocks
  for (let k = 0; k < blocks.length; k++) {
    const bl = blocks[k]
    if (bl.x1 < vis.x0 || bl.x0 > vis.x1 || bl.y1 < vis.y0 || bl.y0 > vis.y1) continue
    ctx.fillStyle = pat.sidewalk
    ctx.fillRect(bl.x0, bl.y0, bl.x1 - bl.x0, bl.y1 - bl.y0)
    // each district has its own ground: grey concrete downtown, dark port concrete, lawns in the suburbs
    ctx.fillStyle = bl.type === 'park' ? pat.grass : bl.district === 'suburbs' ? pat.lawn : bl.district === 'port' ? pat.port : bl.type === 'plaza' ? pat.plaza : pat.lot
    ctx.fillRect(bl.x0 + 3, bl.y0 + 3, bl.x1 - bl.x0 - 6, bl.y1 - bl.y0 - 6)
    if (bl.lots) for (const lot of bl.lots) drawLot(ctx, lot)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 0.3
    ctx.strokeRect(bl.x0, bl.y0, bl.x1 - bl.x0, bl.y1 - bl.y0)
  }
  // the river, with bridge decks (rails on both sides) where the bridge streets cross it
  const rv = city.river
  if (rv.x1 >= vis.x0 && rv.x0 <= vis.x1) {
    ctx.fillStyle = pat.water
    ctx.fillRect(rv.x0, rv.y0, rv.x1 - rv.x0, rv.y1 - rv.y0)
    ctx.strokeStyle = 'rgba(190,225,250,0.16)'
    ctx.lineWidth = 0.25
    for (let y = Math.max(rv.y0, vis.y0); y < Math.min(rv.y1, vis.y1); y += 9) {
      ctx.beginPath()
      ctx.moveTo(rv.x0 + 4, y)
      ctx.lineTo(rv.x1 - 4, y + 2.5)
      ctx.stroke()
    }
    for (const br of city.bridges) {
      if (br.y1 < vis.y0 || br.y0 > vis.y1) continue
      ctx.fillStyle = pat.asphalt
      ctx.fillRect(br.x0, br.y0, br.x1 - br.x0, br.y1 - br.y0)
      ctx.strokeStyle = '#cfd2d8'
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.moveTo(br.x0, br.y0 + 0.3)
      ctx.lineTo(br.x1, br.y0 + 0.3)
      ctx.moveTo(br.x0, br.y1 - 0.3)
      ctx.lineTo(br.x1, br.y1 - 0.3)
      ctx.stroke()
    }
  }
  // outer barrier
  ctx.strokeStyle = '#7b7e84'
  ctx.lineWidth = 3.5
  ctx.strokeRect(b.minX - 1.75, b.minY - 1.75, b.maxX - b.minX + 3.5, b.maxY - b.minY + 3.5)
}

function roadLine(ctx: CanvasRenderingContext2D, horiz: boolean, pos: number, a0: number, a1: number): void {
  ctx.beginPath()
  if (horiz) {
    ctx.moveTo(a0, pos)
    ctx.lineTo(a1, pos)
  } else {
    ctx.moveTo(pos, a0)
    ctx.lineTo(pos, a1)
  }
  ctx.stroke()
}

function drawRoadSeg(ctx: CanvasRenderingContext2D, horiz: boolean, c: number, w: number, type: string, a0: number, a1: number): void {
  if (type === 'alley') return
  ctx.setLineDash([])
  ctx.strokeStyle = '#e8e8e8'
  ctx.lineWidth = 0.16
  // lanes are about 3.6 m: streets mark off a parking strip, avenues a kerb lane, the highway a hard shoulder
  const edge = type === 'street' ? 3.6 : type === 'avenue' ? w / 2 - 1.8 : w / 2 - 1.7
  roadLine(ctx, horiz, c - edge, a0, a1)
  roadLine(ctx, horiz, c + edge, a0, a1)
  if (type === 'highway') {
    // 3 m median with yellow edges, then three dashed lanes each way
    ctx.strokeStyle = '#2b2d31'
    ctx.lineWidth = 3
    roadLine(ctx, horiz, c, a0, a1)
    ctx.strokeStyle = '#e0b92a'
    ctx.lineWidth = 0.18
    roadLine(ctx, horiz, c - 1.5, a0, a1)
    roadLine(ctx, horiz, c + 1.5, a0, a1)
    ctx.strokeStyle = 'rgba(240,240,240,0.85)'
    ctx.setLineDash([4, 6])
    for (const o of [5.1, 8.7]) {
      roadLine(ctx, horiz, c - o, a0, a1)
      roadLine(ctx, horiz, c + o, a0, a1)
    }
  } else if (type === 'avenue') {
    ctx.strokeStyle = '#e0b92a'
    ctx.lineWidth = 0.17
    roadLine(ctx, horiz, c - 0.25, a0, a1)
    roadLine(ctx, horiz, c + 0.25, a0, a1)
    ctx.strokeStyle = 'rgba(240,240,240,0.85)'
    ctx.setLineDash([3, 5])
    roadLine(ctx, horiz, c - 3.6, a0, a1)
    roadLine(ctx, horiz, c + 3.6, a0, a1)
  } else {
    ctx.strokeStyle = '#e0b92a'
    ctx.lineWidth = 0.17
    ctx.setLineDash([4, 6])
    roadLine(ctx, horiz, c, a0, a1)
  }
  ctx.setLineDash([])
}

function drawMarkings(ctx: CanvasRenderingContext2D, city: City, vis: Visible): void {
  ctx.lineCap = 'butt'
  for (let i = 0; i < city.NV; i++) {
    const x = city.vx[i],
      w = city.vw[i]
    if (x + w / 2 < vis.x0 || x - w / 2 > vis.x1) continue
    for (let j = 0; j < city.NH - 1; j++) {
      const y0 = city.hy[j] + city.hw[j] / 2 + 5,
        y1 = city.hy[j + 1] - city.hw[j + 1] / 2 - 5
      if (y1 < vis.y0 || y0 > vis.y1) continue
      drawRoadSeg(ctx, false, x, w, city.vt[i], y0, y1)
    }
  }
  for (let j = 0; j < city.NH; j++) {
    const y = city.hy[j],
      w = city.hw[j]
    if (y + w / 2 < vis.y0 || y - w / 2 > vis.y1) continue
    for (let i = 0; i < city.NV - 1; i++) {
      const x0 = city.vx[i] + city.vw[i] / 2 + 5,
        x1 = city.vx[i + 1] - city.vw[i + 1] / 2 - 5
      if (x1 < vis.x0 || x0 > vis.x1) continue
      if (i === RIVER_I && !BRIDGES.includes(j)) continue // water, not road
      drawRoadSeg(ctx, true, y, w, city.ht[j], x0, x1)
    }
  }
  // crosswalks
  ctx.fillStyle = 'rgba(235,235,235,0.55)'
  ctx.beginPath()
  for (let j = 0; j < city.NH; j++) {
    const y = city.hy[j]
    if (y + 40 < vis.y0 || y - 40 > vis.y1) continue
    for (let i = 0; i < city.NV; i++) {
      const x = city.vx[i]
      if (x + 40 < vis.x0 || x - 40 > vis.x1) continue
      const vw = city.vw[i],
        hw = city.hw[j]
      if (city.vt[i] === 'highway' || city.ht[j] === 'highway') continue // no zebra crossings on or beside the highway ring
      if (city.vt[i] !== 'alley') {
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const yy = y + sgn * (hw / 2 + 1.6) - 1.1
          if ((j === 0 && sgn < 0) || (j === city.NH - 1 && sgn > 0)) continue
          for (let k = x - vw / 2 + 1; k < x + vw / 2 - 1; k += 1.15) ctx.rect(k, yy, 0.6, 2.2)
        }
      }
      if (city.ht[j] !== 'alley') {
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const xx = x + sgn * (vw / 2 + 1.6) - 1.1
          if ((i === 0 && sgn < 0) || (i === city.NV - 1 && sgn > 0)) continue
          for (let k = y - hw / 2 + 1; k < y + hw / 2 - 1; k += 1.15) ctx.rect(xx, k, 2.2, 0.6)
        }
      }
    }
  }
  ctx.fill()
}

/** Gravel under construction zones (drawn over the road markings). */
function drawGravel(ctx: CanvasRenderingContext2D, city: City, vis: Visible): void {
  for (const g of city.gravel) {
    if (g.x1 < vis.x0 || g.x0 > vis.x1 || g.y1 < vis.y0 || g.y0 > vis.y1) continue
    ctx.fillStyle = pat.gravel
    ctx.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0)
    ctx.strokeStyle = 'rgba(255,140,40,0.7)'
    ctx.lineWidth = 0.22
    ctx.setLineDash([1.2, 1])
    ctx.strokeRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0)
    ctx.setLineDash([])
  }
}

/** Launch ramps: hazard-striped wedges with a chevron pointing the way. */
function drawJumps(ctx: CanvasRenderingContext2D, city: City, vis: Visible): void {
  for (const j of city.jumps) {
    if (j.x + j.hx < vis.x0 || j.x - j.hx > vis.x1 || j.y + j.hy < vis.y0 || j.y - j.hy > vis.y1) continue
    ctx.save()
    ctx.translate(j.x, j.y)
    ctx.rotate(Math.atan2(j.dy, j.dx))
    const L = Math.max(j.hx, j.hy),
      Wd = Math.min(j.hx, j.hy)
    ctx.fillStyle = '#3a3320'
    ctx.fillRect(-L, -Wd, L * 2, Wd * 2)
    ctx.fillStyle = '#e8b923'
    for (let x = -L + 1; x < L - 1; x += 3) {
      ctx.beginPath()
      ctx.moveTo(x, -Wd)
      ctx.lineTo(x + 1.4, -Wd)
      ctx.lineTo(x + 2.4, Wd)
      ctx.lineTo(x + 1, Wd)
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.moveTo(L - 1.6, -Wd * 0.7)
    ctx.lineTo(L - 0.4, 0)
    ctx.lineTo(L - 1.6, Wd * 0.7)
    ctx.stroke()
    ctx.restore()
  }
}

/** Smashable props (cones, sawhorses, park fences) that currently have a physics body. */
function drawProps(ctx: CanvasRenderingContext2D, vis: Visible): void {
  const S = Phys.S
  for (const a of Props.active) {
    const b = a.body
    const x = b.position.x / S,
      y = b.position.y / S
    if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(b.angle)
    ctx.globalAlpha = a.hitAge > 5 ? Math.max(0, 1 - (a.hitAge - 5) / 2) : 1
    switch (a.spot.kind) {
      case 'cone':
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath()
        ctx.arc(0.15, 0.2, 0.42, 0, 6.283)
        ctx.fill()
        ctx.fillStyle = '#ff7a1a'
        ctx.beginPath()
        ctx.arc(0, 0, 0.4, 0, 6.283)
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 0.12
        ctx.beginPath()
        ctx.arc(0, 0, 0.2, 0, 6.283)
        ctx.stroke()
        break
      case 'sawhorse':
        ctx.fillStyle = '#f3f3f3'
        ctx.fillRect(-0.95, -0.25, 1.9, 0.5)
        ctx.fillStyle = '#d6322b'
        for (let k = -0.8; k < 0.8; k += 0.6) ctx.fillRect(k, -0.25, 0.3, 0.5)
        break
      case 'crate':
        ctx.fillStyle = '#8a6a3c'
        ctx.fillRect(-0.5, -0.5, 1, 1)
        ctx.strokeStyle = '#5c4524'
        ctx.lineWidth = 0.1
        ctx.strokeRect(-0.45, -0.45, 0.9, 0.9)
        break
      default:
        ctx.fillStyle = '#b9b2a2'
        ctx.fillRect(-1.5, -0.18, 3, 0.36)
        ctx.fillStyle = '#7d776a'
        ctx.fillRect(-1.5, -0.04, 3, 0.08)
    }
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

/** Tunnel roofs: drawn over the cars, so the car inside fades into the dark. */
function drawTunnels(ctx: CanvasRenderingContext2D, city: City, vis: Visible): void {
  for (const t of city.tunnels) {
    if (t.x1 < vis.x0 || t.x0 > vis.x1 || t.y1 < vis.y0 || t.y0 > vis.y1) continue
    ctx.fillStyle = 'rgba(14,16,20,0.86)'
    ctx.fillRect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0)
    // ceiling lamps down the middle
    ctx.fillStyle = 'rgba(255,214,140,0.8)'
    if (t.horiz) {
      const cy = (t.y0 + t.y1) / 2
      for (let x = t.x0 + 4; x < t.x1 - 2; x += 8) ctx.fillRect(x, cy - 0.25, 1.4, 0.5)
    } else {
      const cx = (t.x0 + t.x1) / 2
      for (let y = t.y0 + 4; y < t.y1 - 2; y += 8) ctx.fillRect(cx - 0.25, y, 0.5, 1.4)
    }
    // portal frame
    ctx.strokeStyle = '#8b8f97'
    ctx.lineWidth = 0.7
    ctx.strokeRect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0)
  }
}

/** Concrete highway barriers (they are also static colliders). */
function drawBarriers(ctx: CanvasRenderingContext2D, city: City, vis: Visible): void {
  const list = city.barriers
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    if (b.x + b.hx < vis.x0 || b.x - b.hx > vis.x1 || b.y + b.hy < vis.y0 || b.y - b.hy > vis.y1) continue
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fillRect(b.x - b.hx + 0.35, b.y - b.hy + 0.45, b.hx * 2, b.hy * 2)
    ctx.fillStyle = '#5d6168'
    ctx.fillRect(b.x - b.hx, b.y - b.hy, b.hx * 2, b.hy * 2)
    ctx.strokeStyle = '#e6e9ee'
    ctx.lineWidth = 0.2
    ctx.strokeRect(b.x - b.hx + 0.1, b.y - b.hy + 0.1, b.hx * 2 - 0.2, b.hy * 2 - 0.2)
  }
}

// ---------------------------------------------------------------- cars
const lightTmp: Vec2 = { x: 0, y: 0 }

const lift = (car: Car) => (car.air > 0 ? Math.sin(Math.PI * (1 - car.air / car.airTotal)) : 0)

function drawCarShadow(ctx: CanvasRenderingContext2D, car: Car, x: number, y: number, th: number): void {
  const s = car.spec
  const up = lift(car)
  ctx.save()
  ctx.translate(x + 0.4 + up * 3.2, y + 0.5 + up * 4)
  ctx.rotate(th)
  ctx.globalAlpha = 0.32 - up * 0.14
  ctx.fillStyle = '#000'
  const l = s.len * 0.96,
    w = s.hitW * 0.98
  ctx.beginPath()
  ctx.roundRect(-l / 2, -w / 2, l, w, 0.7)
  ctx.fill()
  ctx.restore()
}

function drawCarBody(ctx: CanvasRenderingContext2D, car: Car, x: number, y: number, th: number): void {
  const s = car.spec,
    img = images[s.file]
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(th + Math.PI)
  const grow = 1 + lift(car) * 0.32 // a jumping car comes closer to the camera
  ctx.scale(grow, grow)
  const dw = s.len * (s.heavy ? 1.03 : 1)
  if (img) {
    const dh = (dw * img.height) / img.width
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  } else {
    ctx.fillStyle = '#c33'
    ctx.fillRect(-dw / 2, -s.hitW / 2, dw, s.hitW)
  }
  ctx.restore()
}

function drawCarLights(ctx: CanvasRenderingContext2D, car: Car, x: number, y: number, th: number, time: number): void {
  const s = car.spec,
    g = FX.glow
  const c = Math.cos(th),
    sn = Math.sin(th)
  const at = (lx: number, ly: number) => {
    lightTmp.x = x + c * lx - sn * ly
    lightTmp.y = y + sn * lx + c * ly
    return lightTmp
  }
  ctx.globalCompositeOperation = 'lighter'
  if (car.braking && car.vx > 0.5) {
    for (let k = -1; k <= 1; k += 2) {
      const p = at(-s.len * 0.5 + 0.25, k * 0.68)
      ctx.globalAlpha = 0.85
      ctx.drawImage(g.red, p.x - 0.8, p.y - 0.8, 1.6, 1.6)
    }
  }
  if (s.police && car.kind === 'police') {
    const u = car.unit
    if (!u || u.state !== 'wrecked') {
      const ph = Math.floor((time * 7 + car.flash) % 2)
      const k = s.len / 4.72
      const bx = -0.64 * k
      const pR = at(bx, 0.5)
      const rx = pR.x,
        ry = pR.y
      const pL = at(bx, -0.5)
      // right side / left side alternate red and blue
      const a = ph ? g.blue : g.red,
        b = ph ? g.red : g.blue
      ctx.globalAlpha = 0.8
      ctx.drawImage(a, rx - 1.1, ry - 1.1, 2.2, 2.2)
      ctx.drawImage(b, pL.x - 1.1, pL.y - 1.1, 2.2, 2.2)
      // only the active side throws light on the road, so red and blue never mix to magenta
      ctx.globalAlpha = 0.2
      if (ph) ctx.drawImage(g.blue, rx - 6, ry - 6, 12, 12)
      else ctx.drawImage(g.red, pL.x - 6, pL.y - 6, 12, 12)
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

// ---------------------------------------------------------------- buildings
function drawBuilding(ctx: CanvasRenderingContext2D, b: Building, cam: typeof Camera): void {
  if (b.flat) return // part of a photo lot: already in the picture
  const k = 0.0012 * b.height
  const sx = (b.x - cam.x) * k,
    sy = (b.y - cam.y) * k
  const x0 = b.x0,
    y0 = b.y0,
    x1 = b.x1,
    y1 = b.y1
  const rx0 = x0 + sx,
    ry0 = y0 + sy,
    rx1 = x1 + sx,
    ry1 = y1 + sy
  ctx.fillStyle = b.wall
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y0)
  ctx.lineTo(rx1, ry0)
  ctx.lineTo(rx0, ry0)
  ctx.closePath()
  ctx.moveTo(x1, y0)
  ctx.lineTo(x1, y1)
  ctx.lineTo(rx1, ry1)
  ctx.lineTo(rx1, ry0)
  ctx.closePath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x0, y1)
  ctx.lineTo(rx0, ry1)
  ctx.lineTo(rx1, ry1)
  ctx.closePath()
  ctx.moveTo(x0, y1)
  ctx.lineTo(x0, y0)
  ctx.lineTo(rx0, ry0)
  ctx.lineTo(rx0, ry1)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = b.roof
  ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0)
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 0.25
  ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fillRect(rx0 + 1.2, ry0 + 1.2, rx1 - rx0 - 2.4, ry1 - ry0 - 2.4)
  const cx = (rx0 + rx1) / 2,
    cy = (ry0 + ry1) / 2
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  for (let i = 0; i < b.props.length; i++) {
    const p = b.props[i]
    ctx.fillRect(cx + p.ox - p.w / 2, cy + p.oy - p.h / 2, p.w, p.h)
  }
  if (b.hasHeli) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.arc(cx, cy, Math.min(b.hx, b.hy) * 0.55, 0, 6.283)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '900 7px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('H', cx, cy)
  }
}

function drawShadows(ctx: CanvasRenderingContext2D, list: Building[]): void {
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  for (let i = 0; i < list.length; i++) {
    const b = list[i],
      s = b.height * 0.2
    if (b.flat) continue
    ctx.fillRect(b.x0 + s * 0.5, b.y0 + s * 0.5, b.x1 - b.x0, b.y1 - b.y0)
    ctx.fillRect(b.x0 + s, b.y0 + s, b.x1 - b.x0, b.y1 - b.y0)
  }
}

/** Soft black silhouettes of the tree sprites, baked once so the shadows match the canopy shapes. */
const treeShadow: (HTMLCanvasElement | null)[] = []

function bakeTreeShadows(): void {
  treeShadow.length = 0
  for (const f of TREE_FILES) {
    const im = images[f]
    if (!im) {
      treeShadow.push(null)
      continue
    }
    const c = document.createElement('canvas')
    c.width = c.height = 96
    const x = c.getContext('2d')!
    x.drawImage(im, 0, 0, 96, 96)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = 'rgba(0,0,0,0.34)'
    x.fillRect(0, 0, 96, 96)
    treeShadow.push(c)
  }
}

function drawTrees(ctx: CanvasRenderingContext2D, city: City, vis: Visible): void {
  const t = city.trees
  for (let i = 0; i < t.length; i++) {
    const p = t[i]
    if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue
    const k = treeSpecies(p.c)
    const sprite = images[TREE_FILES[k]]
    if (sprite) {
      const d = p.r * 2.2 // canopy diameter in metres
      const sh = treeShadow[k]
      if (sh) ctx.drawImage(sh, p.x - d / 2 + 1.6, p.y - d / 2 + 2, d, d)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.c * 97.3) // a top-down canopy can face any way: hides the repeats
      ctx.drawImage(sprite, -d / 2, -d / 2, d, d)
      ctx.restore()
      continue
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.beginPath()
    ctx.arc(p.x + 1.5, p.y + 1.8, p.r, 0, 6.283)
    ctx.fill()
    ctx.fillStyle = `rgb(${(30 + p.c * 25) | 0},${(88 + p.c * 40) | 0},${(34 + p.c * 20) | 0})`
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, 6.283)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.arc(p.x - p.r * 0.25, p.y - p.r * 0.25, p.r * 0.55, 0, 6.283)
    ctx.fill()
  }
}

function drawSpikes(ctx: CanvasRenderingContext2D, spikes: Spike[]): void {
  for (const s of spikes) {
    ctx.fillStyle = s.hit ? '#555' : '#1a1a1a'
    ctx.fillRect(s.x - s.hx, s.y - s.hy, s.hx * 2, s.hy * 2)
    ctx.fillStyle = s.hit ? '#777' : '#d6d6d6'
    const horiz = s.hx > s.hy
    const n = Math.floor(((horiz ? s.hx : s.hy) * 2) / 0.7)
    for (let i = 0; i < n; i++) {
      const o = -(horiz ? s.hx : s.hy) + 0.35 + i * 0.7
      if (horiz) ctx.fillRect(s.x + o, s.y - 0.15, 0.3, 0.3)
      else ctx.fillRect(s.x - 0.15, s.y + o, 0.3, 0.3)
    }
  }
}

function drawHeli(ctx: CanvasRenderingContext2D, h: Heli): void {
  const ang = Math.atan2(h.vy, h.vx)
  // spotlight
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, 19)
  g.addColorStop(0, 'rgba(255,255,230,0.55)')
  g.addColorStop(0.8, 'rgba(255,255,230,0.3)')
  g.addColorStop(1, 'rgba(255,255,230,0)')
  ctx.fillStyle = g
  if (h.life > 0) {
    ctx.beginPath()
    ctx.arc(h.x, h.y, 19, 0, 6.283)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  // body (floating above, shifted)
  ctx.save()
  ctx.translate(h.x + 3, h.y - 3)
  ctx.rotate(ang)
  ctx.fillStyle = '#15181c'
  ctx.beginPath()
  ctx.roundRect(-5, -1.5, 10, 3, 1.4)
  ctx.fill()
  ctx.fillRect(-9, -0.25, 5, 0.5)
  ctx.restore()
  ctx.save()
  ctx.translate(h.x + 3, h.y - 3)
  ctx.rotate(h.rot)
  ctx.strokeStyle = 'rgba(200,200,200,0.4)'
  ctx.lineWidth = 0.35
  ctx.beginPath()
  ctx.moveTo(-6.5, 0)
  ctx.lineTo(6.5, 0)
  ctx.moveTo(0, -6.5)
  ctx.lineTo(0, 6.5)
  ctx.stroke()
  ctx.restore()
}

function drawDebug(ctx: CanvasRenderingContext2D): void {
  const c = game.player.car
  ctx.lineWidth = 0.15
  for (const u of game.cops) {
    if ((u.state === 'pursue' || u.state === 'intercept') && u.path) {
      ctx.strokeStyle = 'rgba(255,80,80,0.7)'
      ctx.beginPath()
      ctx.moveTo(u.car.x, u.car.y)
      for (let i = u.pi; i < u.path.length; i++) ctx.lineTo(game.city.nodeX(u.path[i]), game.city.nodeY(u.path[i]))
      ctx.stroke()
    }
  }
  // Matter.js body outlines for every car near the player
  const S = Phys.S
  ctx.strokeStyle = '#0f0'
  ctx.lineWidth = 0.12
  for (const car of game.cars) {
    if (!car.body || Math.abs(car.x - c.x) > 80 || Math.abs(car.y - c.y) > 80) continue
    const vs = car.body.vertices
    ctx.beginPath()
    ctx.moveTo(vs[0].x / S, vs[0].y / S)
    for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x / S, vs[i].y / S)
    ctx.closePath()
    ctx.stroke()
  }
  // player's forces: longitudinal (yellow) and lateral grip (cyan)
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(c.theta)
  ctx.beginPath()
  ctx.strokeStyle = '#ff0'
  ctx.moveTo(0, 0)
  ctx.lineTo(c.aF * 0.4, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.strokeStyle = '#0ff'
  ctx.moveTo(0, 0)
  ctx.lineTo(0, c.aL * 0.4)
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------- main
const qb: Building[] = []
interface Interp {
  x: number
  y: number
  th: number
}

export const Renderer = {
  debug: false,

  /** Build the ground textures and glow sprites. Needs a canvas context, so it runs when the engine mounts. */
  init(ctx: CanvasRenderingContext2D): void {
    const mk = (tex: HTMLCanvasElement): CanvasPattern => {
      const p = ctx.createPattern(tex, 'repeat')!
      try {
        p.setTransform(new DOMMatrix([1 / 22, 0, 0, 1 / 22, 0, 0]))
      } catch {
        /* older browsers */
      }
      return p
    }
    pat.asphalt = mk(makeTex(256, '#3b3e44', 70, 3500))
    pat.sidewalk = mk(makeTex(256, '#8a8c90', 40, 1500))
    pat.lot = mk(makeTex(256, '#6f7378', 36, 1500))
    pat.grass = mk(makeTex(256, '#3f6b34', 60, 3000))
    pat.lawn = mk(makeTex(256, '#4c7a3a', 50, 2600))
    pat.port = mk(makeTex(256, '#585d63', 44, 2200))
    pat.plaza = mk(makeTex(256, '#8d9096', 30, 900))
    pat.water = mk(makeTex(256, '#2a5b86', 46, 2400))
    pat.gravel = mk(makeTex(256, '#8a7b5c', 70, 3200))
    FX.init()
  },

  /** Swap in the photo textures once the art files have loaded (the procedural ones stay if a file is missing). */
  initArt(ctx: CanvasRenderingContext2D): void {
    const photo = (file: string, metres: number): CanvasPattern | null => {
      const im = images[file]
      if (!im) return null
      const p = ctx.createPattern(im, 'repeat')
      if (!p) return null
      try {
        p.setTransform(new DOMMatrix([metres / im.width, 0, 0, metres / im.height, 0, 0]))
      } catch {
        /* older browsers */
      }
      return p
    }
    pat.grass = photo(GRASS_FILES.meadow, 4) ?? pat.grass
    pat.lawn = photo(GRASS_FILES.lawn, 4) ?? pat.lawn
    bakeTreeShadows()
  },

  drawWorld(ctx: CanvasRenderingContext2D, cam: typeof Camera, alpha: number): void {
    const city = game.city,
      vis = cam.vis
    drawGround(ctx, city, vis)
    drawMarkings(ctx, city, vis)
    drawGravel(ctx, city, vis)
    drawJumps(ctx, city, vis)
    drawBarriers(ctx, city, vis)
    FX.drawSkids(ctx, vis)
    drawProps(ctx, vis)
    drawSpikes(ctx, game.heat.spikes)
    const blds = city.queryBuildings(vis.x0, vis.y0, vis.x1, vis.y1, qb)
    drawShadows(ctx, blds)

    // cars
    const cars = game.cars
    const interp: (Interp | null)[] = new Array(cars.length)
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]
      if (c.x < vis.x0 - 6 || c.x > vis.x1 + 6 || c.y < vis.y0 - 6 || c.y > vis.y1 + 6) {
        interp[i] = null
        continue
      }
      const x = c.px + (c.x - c.px) * alpha,
        y = c.py + (c.y - c.py) * alpha
      const th = c.pth + wrapAngle(c.theta - c.pth) * alpha
      interp[i] = { x, y, th }
      drawCarShadow(ctx, c, x, y, th)
    }
    for (let i = 0; i < cars.length; i++) {
      const t = interp[i]
      if (t) drawCarBody(ctx, cars[i], t.x, t.y, t.th)
    }
    FX.drawParticles(ctx, vis, false)
    for (let i = 0; i < cars.length; i++) {
      const t = interp[i]
      if (t) drawCarLights(ctx, cars[i], t.x, t.y, t.th, game.time)
    }
    FX.drawParticles(ctx, vis, true)

    drawTunnels(ctx, city, vis)
    // buildings and trees sit above everything on the ground
    for (let i = 0; i < blds.length; i++) drawBuilding(ctx, blds[i], cam)
    drawTrees(ctx, city, vis)
    if (game.heat.heli) drawHeli(ctx, game.heat.heli)

    if (Renderer.debug) drawDebug(ctx)
  },
}
