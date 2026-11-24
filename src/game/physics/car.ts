import type Matter from 'matter-js'
import { clamp } from '../core/math'
import { Phys } from './world'
import type { CarKind, CarSpec, Controls, Surface, SurfaceKind, Vec2 } from '../types'
import type { PoliceUnit } from '../ai/police'

let nextId = 1
const GEAR_BANDS = [0, 0.12, 0.25, 0.42, 0.6, 0.8, 1.0]

/**
 * Arcade car on top of a Matter.js rigid body. Each step:
 *   applyControls() turns pedals/steering into forces + torque on the body,
 *   Matter integrates and resolves collisions,
 *   readBack() copies the body state into the fields the rest of the game uses.
 * Body frame: x = forward, y = right; yaw is positive clockwise on screen (canvas y-down), same as Matter's angle.
 */
export class Car {
  spec: CarSpec
  kind: CarKind
  id: number
  body: Matter.Body | null = null
  x = 0
  y = 0
  theta = 0
  px = 0
  py = 0
  pth = 0
  vx = 0
  vy = 0
  w = 0
  wvx = 0
  wvy = 0
  speed = 0
  mass: number
  hx: number
  hy: number
  ctrl: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 }
  gear = 1
  rpm = 900
  shiftT = 0
  health = 100
  nitro = 1
  nitroOn = false
  flat = 0
  boost = 1
  skid = 0
  braking = false
  reversing = false
  sliding = false
  aF = 0
  aL = 0
  gripUse = 0
  surfaceKind: SurfaceKind = 'asphalt'
  wp: number[] = [NaN, NaN, NaN, NaN] // last skid positions (rear wheels)
  flash = Math.random() * 6
  lastHit = -1
  /** seconds of flight left (0 = on the ground); set by launch() at a jump ramp */
  air = 0
  airTotal = 0
  /** brief grip penalty after landing */
  landT = 0
  /** set for one step when a flight ends, so the engine can add dust and shake */
  justLanded = false
  /** set for police cars so the renderer can tell wrecked units from active ones */
  unit?: PoliceUnit

  constructor(spec: CarSpec, kind: CarKind = 'civil') {
    this.spec = spec
    this.kind = kind
    this.id = nextId++
    this.mass = spec.mass
    this.hx = spec.len * 0.5 * 0.97
    this.hy = spec.hitW * 0.5
  }

  place(x: number, y: number, theta: number): void {
    this.x = this.px = x
    this.y = this.py = y
    this.theta = this.pth = theta
    this.vx = this.vy = this.w = 0
    this.wvx = this.wvy = 0
    this.speed = 0
    if (this.body) {
      Phys.setPose(this.body, x, y, theta)
      Phys.setVelocity(this.body, 0, 0, 0)
    }
  }

  setSpeed(v: number): void {
    this.wvx = Math.cos(this.theta) * v
    this.wvy = Math.sin(this.theta) * v
    this.vx = v
    this.vy = 0
    this.w = 0
    this.speed = Math.abs(v)
    if (this.body) Phys.setVelocity(this.body, this.wvx, this.wvy, 0)
  }

  /** Throw the car into the air for `seconds`. Airborne cars have no grip and pass over traffic and props. */
  launch(seconds: number): void {
    this.air = this.airTotal = seconds
    Phys.setAirborne(this, true)
  }

  /** local (forward, right) offset -> world */
  toWorld(lx: number, ly: number, out: Vec2): Vec2 {
    const c = Math.cos(this.theta),
      s = Math.sin(this.theta)
    out.x = this.x + c * lx - s * ly
    out.y = this.y + s * lx + c * ly
    return out
  }

  applyControls(dt: number, surf: Surface): void {
    const s = this.spec,
      c = this.ctrl,
      body = this.body!
    this.px = this.x
    this.py = this.y
    this.pth = this.theta
    this.surfaceKind = surf.kind
    if (this.flat > 0) this.flat -= dt
    if (this.landT > 0) this.landT -= dt
    if (this.air > 0) {
      this.air -= dt
      if (this.air <= 0) {
        this.air = 0
        Phys.setAirborne(this, false)
        this.landT = 0.6
        this.justLanded = true
      } else {
        // in the air: no grip, no steering, just momentum
        this.braking = false
        this.sliding = false
        this.skid = 0
        this.aF = 0
        this.aL = 0
        this.gripUse = 0
        return
      }
    }
    const vF = this.vx,
      vL = this.vy,
      sp = this.speed
    const fx = Math.cos(this.theta),
      fy = Math.sin(this.theta),
      rx = -fy,
      ry = fx
    const sgn = clamp(vF / 0.5, -1, 1)
    const hb = c.handbrake

    // ---- pedals: S doubles as reverse once stopped ----
    let drive = 0,
      brake = 0
    const thr = c.throttle,
      brk = c.brake
    if (thr > 0.02 && brk > 0.02) {
      drive = thr
      brake = brk
    } else if (thr > 0.02) {
      if (vF < -1) brake = thr
      else drive = thr
    } else if (brk > 0.02) {
      if (vF > 1) brake = brk
      else drive = -brk
    }
    this.braking = brake > 0.05
    this.reversing = drive < 0 || vF < -0.8

    // ---- grip budget ----
    const health = this.health / 100
    const flat = this.flat > 0
    const grip = s.grip * surf.grip * (flat ? 0.65 : 1) * (this.landT > 0 ? 0.5 : 1) * (0.85 + 0.15 * health)

    // ---- longitudinal ----
    const nitroWant = c.nitro > 0.5 && this.nitro > 0.02 && drive > 0 && vF > 1
    if (nitroWant) {
      this.nitroOn = true
      this.nitro = Math.max(0, this.nitro - dt * 0.2)
    } else {
      this.nitroOn = false
      this.nitro = Math.min(1, this.nitro + dt * 0.035 * (1 + this.skid * 2))
    }
    let aF = 0,
      wheelspin = 0
    if (drive > 0) {
      const top = s.top * (nitroWant ? 1.12 : 1) * (surf.kind === 'grass' ? 0.6 : 1)
      const ratio = clamp(vF / top, 0, 1.2)
      let a = drive * s.accel * Math.max(0, 1 - ratio * ratio)
      a *= (1 - 0.4 * (1 - health)) * this.boost * (nitroWant ? s.nitroPower : 1) * (flat ? 0.7 : 1)
      const traction = grip * (s.awd ? 1 : 0.8)
      if (a > traction) {
        wheelspin = Math.min(1, (a - traction) / traction + 0.4)
        a = traction
      }
      if (drive > 0.9 && vF < 7 && !s.awd) wheelspin = Math.max(wheelspin, 0.5)
      aF += a
    } else if (drive < 0) {
      if (vF > -10) aF += drive * s.accel * 0.5
    } else {
      // coasting: engine braking + air drag + rolling
      aF -= sgn * (0.4 + 0.0006 * vF * vF)
    }
    if (brake > 0) aF -= sgn * brake * s.brakeDecel
    // handbrake: gentle at speed (so it starts a drift), a real parking brake when nearly stopped
    if (hb > 0) aF -= sgn * hb * (2.5 + 6.5 * clamp((5 - sp) / 3, 0, 1))
    aF -= sgn * 0.15 * surf.roll
    if (drive === 0 && brake === 0 && Math.abs(vF) < 0.3) aF = -vF * 5

    // ---- lateral grip: cancels sideways sliding up to the grip limit, beyond it the car drifts ----
    const latCap = Math.sqrt(Math.max(0, grip * grip - aF * aF * 0.5)) * (1 - 0.6 * hb)
    let aL = -vL * s.gripRate
    this.sliding = Math.abs(aL) > latCap
    aL = clamp(aL, -latCap, latCap)
    this.aF = aF
    this.aL = aL
    this.gripUse = latCap > 0 ? Math.abs(aL) / latCap : 1
    Phys.applyAccel(body, fx * aF + rx * aL, fy * aF + ry * aL)

    // ---- steering: torque toward a target yaw rate (kinematic at low speed, grip-limited at high speed) ----
    const av = Math.max(Math.abs(vF), 1)
    const yawMax = Math.min(Math.abs(vF) / s.turnRadius0, (grip * 1.1 * (1 + 0.6 * hb)) / av)
    const target = clamp(c.steer, -1, 1) * yawMax * (vF >= 0 ? 1 : -1)
    const alpha = clamp((target - this.w) * s.steerResp, -16, 16)
    Phys.applyAngAccel(body, alpha)

    // ---- effects / HUD ----
    const slip = Math.abs(vL) / Math.max(sp, 5)
    let sk = Math.max(
      (slip - 0.12) * 4,
      this.sliding ? 0.6 : 0,
      hb > 0.3 && sp > 6 ? 0.9 : 0,
      wheelspin * 0.8,
      brake > 0.85 && sp > 12 ? 0.4 : 0,
    )
    if (surf.kind !== 'asphalt') sk *= 0.4
    this.skid = clamp(sk, 0, 1)

    // cosmetic gearbox for the gauges
    const frac = clamp(Math.abs(vF) / s.top, 0, 1)
    let g = 1
    while (g < 6 && frac > GEAR_BANDS[g]) g++
    if (this.reversing) g = 1
    if (g !== this.gear) {
      this.gear = g
      this.shiftT = 0.25
    }
    this.shiftT = Math.max(0, this.shiftT - dt)
    const lo = GEAR_BANDS[g - 1],
      hi = GEAR_BANDS[g]
    const inBand = clamp((frac - lo) / (hi - lo), 0, 1)
    const rpmT = drive !== 0 ? s.redline * (0.35 + 0.6 * inBand) + (wheelspin > 0.3 ? 1200 : 0) : 900 + (s.redline * 0.5 - 900) * inBand
    this.rpm += (Math.min(rpmT, s.redline) - this.rpm) * Math.min(1, 12 * dt)
  }

  /** copy the Matter body's state back into the fields the rest of the game uses */
  readBack(): void {
    const b = this.body!,
      S = Phys.S
    this.x = b.position.x / S
    this.y = b.position.y / S
    this.theta = b.angle
    const v = Phys.getVelocity(b)
    this.wvx = v.x
    this.wvy = v.y
    this.w = Phys.getAngularVelocity(b)
    const c = Math.cos(this.theta),
      s = Math.sin(this.theta)
    this.vx = this.wvx * c + this.wvy * s
    this.vy = -this.wvx * s + this.wvy * c
    this.speed = Math.hypot(this.wvx, this.wvy)
  }
}
