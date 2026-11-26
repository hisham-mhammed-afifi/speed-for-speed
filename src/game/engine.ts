import { useGameStore, EMPTY_HUD } from '../store'
import { heat } from './ai/heat'
import { Police } from './ai/police'
import { loadImages } from './core/assets'
import { input, touch } from './core/input'
import { loop, startLoop } from './core/loop'
import { clamp, hyp } from './core/math'
import { readSafeArea } from './core/viewport'
import { ALL_CAR_FILES, PLAYER_CARS } from './data/cars'
import { WORLD_FILES } from './world/worldArt'
import { Car } from './physics/car'
import { Phys } from './physics/world'
import { camera } from './render/camera'
import { FX } from './render/effects'
import { drawHudCanvas } from './render/hudCanvas'
import { Renderer } from './render/renderer'
import { loadSave, writeSave } from './save'
import { game } from './state'
import { carGrid } from './world/carGrid'
import { Props } from './world/props'
import { MAIN_CANVAS } from './core/canvas'
import { LANE_OFFSET, TILE } from './world/city'
import type { City } from './world/city'
import { World } from './world/world'
import { Traffic } from './world/traffic'
import { Difficulty } from './ai/difficulty'
import { quality } from './render/quality'
import { Memory } from './ai/memory'
import { DISTRICT_NAMES } from './types'
import type { CarKind, CarSpec, District, RunResult, RunStats, SaveData } from './types'
import type { CameraMode } from './render/camera'

const store = () => useGameStore.getState()

/**
 * Owns the canvas, the fixed-step loop and the game flow (start, pause, results).
 * React never touches the simulation directly: components call the methods below and read the zustand store.
 */
class GameEngine {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private W = 800
  private H = 600
  private dpr = 1
  private titleT = 0
  private hudT = 0
  private districtT = 0
  private propT = 0
  private streamT = 0
  /** tile the world window is centred on, and a timer for checking whether to move it */
  private cx = 0
  private cy = 0
  private worldT = 0
  private lastTile = ''
  /** frames drawn since the game froze (pause / result screens): the picture no longer changes, so stop redrawing it */
  private idleFrames = 0
  private lastDistrict: District | null = null
  private carIndex = 0
  private saveData: SaveData = loadSave()
  private params = new URLSearchParams()
  private assets: Promise<void> | null = null

  /** Attach to a canvas and start the loop. Returns a function that detaches again (safe under React StrictMode). */
  mount(canvas: HTMLCanvasElement): () => void {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', MAIN_CANVAS)!
    this.params = new URLSearchParams(location.search)
    let stopLoop: (() => void) | null = null
    let detached = false

    const onResize = () => this.resize()
    const onVisibility = () => {
      // a phone call or app switch must not leave you driving blind into a bust
      if (document.hidden && game.state === 'play') this.togglePause()
    }
    addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    const detachInput = input.attach()
    touch.onChange = () => {
      store().setTouchActive(touch.active)
      this.applyDensity()
      this.resize() // switching between touch and keyboard changes the resolution cap
    }
    store().setTouchActive(touch.active)
    this.applyDensity()

    this.resize()
    Renderer.init(this.ctx)
    this.installGameHooks()

    this.assets ??= loadImages([...ALL_CAR_FILES, ...WORLD_FILES], (p) => store().setLoadProgress(p)).then(() => {
      if (this.ctx) Renderer.initArt(this.ctx)
      World.init()
      this.cx = this.cy = 0
      game.city = World.build(0, 0, 1) // the endless world, seen through a 3 x 3 tile window around the player
      Phys.init(game.city)
    })
    void this.assets.then(() => {
      if (detached) return
      game.heat = heat
      heat.reset()
      this.saveData = loadSave()
      this.carIndex = Math.min(this.saveData.car, PLAYER_CARS.length - 1)
      Memory.load(this.saveData.memory)
      Difficulty.load(this.saveData, this.params.get('skill'))
      quality.onChange = () => this.applyQuality()
      quality.configure(this.params.get('quality') ?? this.saveData.quality, touch.active)
      store().setSave(this.saveData)
      store().setSelectedCar(this.carIndex)
      game.state = 'title'
      stopLoop = startLoop((dt) => this.update(dt), (alpha, dt) => this.render(alpha, dt))
      if (this.params.has('auto')) {
        const ci = parseInt(this.params.get('car') ?? '', 10)
        this.startGame(Number.isNaN(ci) ? this.carIndex : Math.max(0, Math.min(PLAYER_CARS.length - 1, ci)))
      } else {
        store().setScreen('title')
      }
    })

    return () => {
      detached = true
      stopLoop?.()
      removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      detachInput()
      touch.onChange = null
    }
  }

  /** Busy roads on desktop, a lighter city on phones so they keep 60 FPS. */
  private applyDensity(): void {
    Traffic.target = Math.round((touch.active ? 30 : 45) * quality.spec.traffic)
    Police.ambientTarget = quality.spec.patrols
  }

  /** Re-apply everything the quality tier controls (called when the tier changes). */
  private applyQuality(): void {
    Phys.radius = quality.spec.staticRadius
    this.applyDensity()
    this.resize()
  }

  /** Cycle the graphics setting (Auto > High > Medium > Low) and remember it. */
  cycleQuality(): string {
    quality.cycle(touch.active)
    this.saveData.quality = quality.setting
    writeSave(this.saveData)
    return quality.label()
  }

  get qualityLabel(): string {
    return quality.label()
  }

  // ---------------------------------------------------------------- world helpers (the `game` context)
  private installGameHooks(): void {
    game.spawnCar = (spec: CarSpec, x: number, y: number, theta: number, kind: CarKind) => {
      const car = new Car(spec, kind)
      Phys.addCar(car)
      car.place(x, y, theta)
      game.cars.push(car)
      return car
    }
    game.removeCar = (car) => {
      const i = game.cars.indexOf(car)
      if (i >= 0) game.cars.splice(i, 1)
      Phys.removeCar(car)
    }
    game.spotFree = (x, y, r) => {
      for (let i = 0; i < game.cars.length; i++) if (hyp(game.cars[i].x - x, game.cars[i].y - y) < r) return false
      return !game.city.isObstacle(x, y)
    }
    game.onPropHit = (car, spot, speed, x, y) => {
      if (speed < 1.5) return
      const first = Props.hit(spot)
      if (first) {
        for (let i = 0; i < 4; i++) FX.debris(x, y, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8)
        if (car === game.player?.car && heat.active) heat.bounty += 10 // smash bonus
      }
      if (car === game.player?.car) camera.addShake(Math.min(0.2, speed / 90))
    }
    game.toast = (text, color) => store().pushToast(text, color)
    game.shake = (a) => camera.addShake(a)
    game.endRun = (kind) => this.endRun(kind)
    game.resetCar = () => this.resetCar()
    game.onImpact = (a, b, dvA, dvB, x, y, nx, ny) => {
      if (game.state !== 'play') return
      const worst = Math.max(dvA, dvB)
      if (worst > 1.5) FX.impact(x, y, nx, ny, worst)
      // short per-car cooldown so one crash (contact, bounce, re-contact) only damages once
      const hurt = (car: Car | null, dv: number) => {
        if (!car || dv <= 3 || game.time - car.lastHit < 0.25) return
        car.lastHit = game.time
        car.health = Math.max(0, car.health - ((dv - 3) * 2.2) / car.spec.durability)
      }
      hurt(a, dvA)
      hurt(b, dvB)
      const pl = game.player.car
      if (a === pl || b === pl) {
        const dv = a === pl ? dvA : dvB
        if (dv > 2) camera.addShake(Math.min(0.9, dv / 20))
        const other = a === pl ? b : a
        if (!other) return
        if (other.kind === 'police' && !heat.active && dv > 1) heat.start('COLLISION')
        else if (other.kind === 'civil' && dv > 3) {
          if (heat.active) heat.onCivilCrash()
          else if (game.cops.some((u) => u.state === 'patrol' && hyp(u.car.x - pl.x, u.car.y - pl.y) < 140 && game.city.hasLOS(u.car.x, u.car.y, pl.x, pl.y)))
            heat.start('RECKLESS DRIVING')
        }
      }
    }
  }

  // ---------------------------------------------------------------- run control (called from React)
  startGame(idx: number): void {
    this.carIndex = idx
    this.saveData.car = idx
    writeSave(this.saveData)
    store().setSave({ ...this.saveData })
    store().setSelectedCar(idx)
    game.cars.length = 0
    game.civs.length = 0
    game.cops.length = 0
    Props.reset()
    Phys.reset()
    FX.clearSkids()
    heat.reset()
    if (this.cx !== 0 || this.cy !== 0) this.setWindow(0, 0) // every run starts in the home tile
    const city = game.city
    const n = city.centerNode(),
      nb = city.neighbors(n)
    const to = nb[0]
    const p = city.lanePoint(n, to, 0.5)
    const spec = PLAYER_CARS[idx]
    const car = game.spawnCar(spec, p.x, p.y, Math.atan2(p.uy, p.ux), 'player')
    game.player = { car, spec }
    if (Phys.streaming) Phys.streamStatics(p.x, p.y)
    game.time = 0
    this.lastDistrict = null
    this.lastTile = ''
    this.districtT = 0
    store().clearToasts()
    camera.snap()
    for (let i = 0; i < 160 && game.civs.length < Math.floor(Traffic.target * 0.7); i++) Traffic.spawn()
    for (let i = 0; i < 20; i++) Police.spawnAmbient()
    carGrid.rebuild(game.cars)
    Memory.startRun()
    game.state = 'play'
    loop.paused = false
    input.clearOnce()
    this.hudT = 0
    store().setHud(EMPTY_HUD)
    store().setScreen('playing')
    const lvl = parseInt(this.params.get('heat') ?? '', 10)
    if (lvl >= 1) heat.start('DEBUG', Math.min(5, lvl))
  }

  private endRun(kind: RunResult): void {
    if (game.state !== 'play') return
    const stats: RunStats = { time: heat.time, level: heat.level, copsDown: heat.copsDown, bounty: heat.bounty, best: this.saveData.best }
    if (kind === 'escaped') {
      this.saveData.total += Math.floor(heat.bounty)
      this.saveData.best = Math.max(this.saveData.best, Math.floor(heat.bounty))
      this.saveData.longest = Math.max(this.saveData.longest, Math.floor(heat.time))
      stats.best = this.saveData.best
    }
    // the police learn from every run: where you hid, and how well it worked
    Memory.endRun(kind === 'escaped')
    this.saveData.memory = Memory.save()
    const sk = Difficulty.update(kind, heat.time, heat.copsDown, game.player.car.health)
    stats.skillBefore = sk.before
    stats.skillAfter = sk.after
    this.saveData.skill = Difficulty.rating
    this.saveData.fixedSkill = Difficulty.fixed
    writeSave(this.saveData)
    store().setSave({ ...this.saveData })
    game.state = 'result'
    loop.paused = true
    this.pushHud(true)
    store().setResult({ kind, stats })
    store().setScreen('result')
  }

  /** Freeze or unfreeze the adaptive difficulty. Returns the new state. */
  toggleFixedSkill(): boolean {
    Difficulty.setFixed(!Difficulty.fixed)
    this.saveData.fixedSkill = Difficulty.fixed
    writeSave(this.saveData)
    store().setSave({ ...this.saveData })
    return Difficulty.fixed
  }

  get fixedSkill(): boolean {
    return Difficulty.fixed
  }

  /** Forget everything the police have learned about your hiding places. */
  resetMemory(): void {
    Memory.clear()
    this.saveData.memory = {}
    writeSave(this.saveData)
    store().setSave({ ...this.saveData })
    game.toast('Police memory wiped', '#9ec5ff')
  }

  continueAfterEscape(): void {
    const pl = game.player.car
    heat.stop()
    pl.health = 100
    pl.flat = 0
    pl.nitro = 1
    game.state = 'play'
    loop.paused = false
    store().setScreen('playing')
    game.toast('You lost them. Drive on.', '#7be08a')
  }

  togglePause(): void {
    if (game.state === 'play') {
      game.state = 'paused'
      loop.paused = true
      store().setScreen('paused')
    } else if (game.state === 'paused') {
      game.state = 'play'
      loop.paused = false
      store().setScreen('playing')
    }
  }

  /** Back to the car-select screen (from the pause or result screen). */
  toCarSelect(): void {
    game.state = 'title'
    game.player = null as unknown as typeof game.player
    loop.paused = false
    store().setScreen('select')
  }

  restart(): void {
    this.startGame(this.carIndex)
  }

  toggleCameraMode(): CameraMode {
    camera.mode = camera.mode === 'north' ? 'heading' : 'north'
    return camera.mode
  }

  toggleDebug(): boolean {
    Renderer.debug = !Renderer.debug
    return Renderer.debug
  }

  get cameraMode(): CameraMode {
    return camera.mode
  }

  get debug(): boolean {
    return Renderer.debug
  }

  /** Snap the car onto the nearest road lane, facing along it. */
  resetCar(): void {
    const c = game.player.car,
      city = game.city
    const horiz = Math.abs(Math.cos(c.theta)) > Math.abs(Math.sin(c.theta))
    if (horiz) {
      let bj = 0,
        bd = 1e9
      for (let j = 0; j < city.NH; j++) {
        const d = Math.abs(city.hy[j] - c.y)
        if (d < bd) {
          bd = d
          bj = j
        }
      }
      c.place(c.x, city.hy[bj] + (Math.cos(c.theta) > 0 ? 1 : -1) * LANE_OFFSET[city.ht[bj]], Math.cos(c.theta) > 0 ? 0 : Math.PI)
    } else {
      let bi = 0,
        bd = 1e9
      for (let i = 0; i < city.NV; i++) {
        const d = Math.abs(city.vx[i] - c.x)
        if (d < bd) {
          bd = d
          bi = i
        }
      }
      const down = Math.sin(c.theta) > 0
      c.place(city.vx[bi] - (down ? 1 : -1) * LANE_OFFSET[city.vt[bi]], c.y, down ? Math.PI / 2 : -Math.PI / 2)
    }
    camera.snap()
  }

  /** Free the minimap images of tiles that left the window (canvas memory is outside the JS heap, so it needs freeing by hand). */
  private releaseMaps(old: City, next: City): void {
    for (const t of old.tiles)
      if (t.map && !next.tiles.includes(t)) {
        t.map.width = t.map.height = 0
        t.map = null
      }
  }

  /** Put the world window around tile (cx, cy) with nothing on the road (a fresh run). */
  private setWindow(cx: number, cy: number): void {
    const next = World.build(cx, cy, 1)
    this.releaseMaps(game.city, next)
    game.city = next
    this.cx = cx
    this.cy = cy
    Phys.setStatics(game.city.statics, 0, 0)
  }

  /**
   * The player has moved into another tile: rebuild the window around it. Tiles are cached, so this is cheap. Node ids are
   * window-relative, so every car's route is shifted to the new window (or the car dropped if it falls outside, which
   * only happens to cars far from the player that would despawn anyway).
   */
  private recenter(ncx: number, ncy: number): void {
    const old = game.city
    const next = World.build(ncx, ncy, 1)
    this.releaseMaps(old, next)
    const di = (old.tx0 - next.tx0) * TILE,
      dj = (old.ty0 - next.ty0) * TILE
    const map = (id: number): number => {
      if (id < 0) return id
      const i = (id % old.NV) + di,
        j = ((id / old.NV) | 0) + dj
      return i < 0 || j < 0 || i >= next.NV || j >= next.NH ? -2 : j * next.NV + i
    }
    for (let k = game.civs.length - 1; k >= 0; k--) {
      const u = game.civs[k],
        d = u.driver
      const a = map(d.a),
        b = map(d.b)
      if (a < 0 || b < 0) {
        game.removeCar(u.car)
        game.civs.splice(k, 1)
        continue
      }
      d.a = a
      d.b = b
      if (d.next >= 0) d.next = Math.max(-1, map(d.next))
      d.city = next
    }
    for (let k = game.cops.length - 1; k >= 0; k--) {
      const u = game.cops[k],
        d = u.driver
      if (d) {
        const a = map(d.a),
          b = map(d.b)
        if (a < 0 || b < 0) {
          game.removeCar(u.car)
          game.cops.splice(k, 1)
          continue
        }
        d.a = a
        d.b = b
        if (d.next >= 0) d.next = Math.max(-1, map(d.next))
        d.city = next
      }
      u.path = null // routes are re-planned in the new window
      u.goal = undefined
      if (u.state === 'intercept') {
        u.state = 'pursue'
        u.ic = null
        u.icArrived = false
        u.icCool = 10
      }
    }
    game.city = next
    this.cx = ncx
    this.cy = ncy
    const pl = game.player.car
    Phys.setStatics(next.statics, pl.x, pl.y)
  }

  // ---------------------------------------------------------------- main update (fixed 120 Hz)
  update(dt: number): void {
    if (game.state !== 'play') return
    game.time += dt
    // the endless world: keep the window around the player, and generate tiles ahead of them
    this.worldT += dt
    if (this.worldT >= 0.25) {
      this.worldT = 0
      const p = game.player.car
      const [ncx, ncy] = World.centerFor(p.x, p.y, this.cx, this.cy)
      if (ncx !== this.cx || ncy !== this.cy) this.recenter(ncx, ncy)
      World.prefetch(p.x, p.y, this.cx, this.cy)
      World.pump()
    }
    const pl = game.player.car,
      city = game.city
    const ctl = input.poll(dt)
    const pc = pl.ctrl
    pc.throttle = ctl.throttle
    pc.brake = ctl.brake
    pc.steer = ctl.steer
    pc.handbrake = ctl.handbrake
    pc.nitro = ctl.nitro
    // Matter.js step: controls -> forces, integrate + resolve collisions, read state back
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i]
      c.applyControls(dt, city.surfaceAt(c.x, c.y))
    }
    Phys.step(dt)
    for (let i = 0; i < game.cars.length; i++) game.cars[i].readBack()
    if (game.state !== 'play') return // an impact may have ended the run
    carGrid.rebuild(game.cars)
    this.updateJumps()
    this.streamT += dt
    if (this.streamT >= 0.5 && Phys.streaming) {
      this.streamT = 0
      Phys.streamStatics(pl.x, pl.y)
    }
    this.propT += dt
    if (this.propT >= 0.4) {
      Props.update(this.propT)
      this.propT = 0
    }
    Traffic.update(dt)
    Police.update(dt)
    heat.update(dt)
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i]
      if (Math.abs(c.x - pl.x) < 90 && Math.abs(c.y - pl.y) < 90) FX.carEffects(c, dt)
    }
    FX.update(dt)
    if (pl.health <= 0 && game.state === 'play') this.endRun('wrecked')
    this.districtT += dt
    if (this.districtT >= 0.5) {
      this.districtT = 0
      const tile = city.tileAt(pl.x, pl.y)
      if (tile && tile.name !== this.lastTile) {
        if (this.lastTile) game.toast(tile.name, '#ffd23f')
        this.lastTile = tile.name
      }
      const d = city.districtAt(pl.x, pl.y)
      if (d !== this.lastDistrict) {
        if (this.lastDistrict !== null) game.toast('Entering: ' + DISTRICT_NAMES[d], '#9ec5ff')
        this.lastDistrict = d
      }
    }
  }

  /** Launch cars that hit a ramp fast enough, and add dust/shake when a flight ends. */
  private updateJumps(): void {
    const jumps = game.city.jumps
    const pl = game.player.car
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i]
      if (c.justLanded) {
        c.justLanded = false
        for (let k = 0; k < 6; k++) FX.smoke(c.x, c.y, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 1.3, 0.55)
        if (c === pl) camera.addShake(0.4)
      }
      if (c.air > 0 || c.speed < 13) continue
      for (let k = 0; k < jumps.length; k++) {
        const j = jumps[k]
        if (Math.abs(c.x - j.x) > j.hx || Math.abs(c.y - j.y) > j.hy) continue
        const along = c.wvx * j.dx + c.wvy * j.dy
        if (along < 13) continue
        c.launch(clamp(0.25 + (along - 13) * 0.035, 0.3, 1.3))
        if (c === pl) game.toast('AIRBORNE!', '#ffd23f')
        break
      }
    }
  }

  private handleKeys(): void {
    if (input.pressed('KeyP') || input.pressed('Escape')) this.togglePause()
    if (input.pressed('F3')) Renderer.debug = !Renderer.debug
    if (game.state !== 'play') {
      input.clearOnce()
      return
    }
    if (input.pressed('KeyC')) this.toggleCameraMode()
    if (input.pressed('KeyR')) this.resetCar()
    if (input.pressed('KeyH') && !heat.active) heat.start('MANUAL', 1)
    for (let n = 1; n <= 5; n++) {
      if (input.pressed('Digit' + n) && this.params.has('debug')) {
        if (heat.active) heat.points = [0, 45, 110, 190, 290][n - 1] + 0.01
        else heat.start('DEBUG', n)
      }
    }
  }

  /** Push the heat / bounty numbers to React (about 10 times a second, and only when they changed). */
  private pushHud(force = false): void {
    const next = {
      active: heat.active,
      level: heat.level,
      bounty: Math.floor(heat.active ? heat.bounty : 0),
      visible: heat.visible,
      evadeLeft: Math.round(Math.max(0, heat.evadeNeeded - heat.evade) * 10) / 10,
      evadeFrac: heat.evadeNeeded ? Math.round((heat.evade / heat.evadeNeeded) * 100) / 100 : 0,
      bust: Math.round(heat.bust * 100) / 100,
      hint: game.time < 14 && !heat.active,
    }
    const cur = store().hud
    if (force || (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== cur[k])) store().setHud(next)
  }

  private render(alpha: number, dt: number): void {
    const ctx = this.ctx!
    this.handleKeys()
    if (game.state === 'play') quality.update(dt)
    if (game.state === 'paused' || game.state === 'result') {
      if (this.idleFrames++ > 3) return // a frozen world under a blurred menu: redrawing it every frame only costs battery
    } else this.idleFrames = 0
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = '#0d0f12'
    ctx.fillRect(0, 0, this.W, this.H)
    if (game.player && (game.state === 'play' || game.state === 'paused' || game.state === 'result')) {
      camera.update(dt, game.player.car, alpha, this.W, this.H)
      camera.begin(ctx, this.W, this.H)
      Renderer.drawWorld(ctx, camera, alpha)
      camera.end(ctx)
      drawHudCanvas(ctx, this.W, this.H, dt, camera)
      this.hudT += dt
      if (this.hudT >= 0.2) {
        this.hudT = 0
        this.pushHud()
      }
    } else if (game.city) {
      // menu backdrop: slow flyover
      this.titleT += dt
      camera.x = 900 + Math.cos(this.titleT * 0.05) * 500
      camera.y = 900 + Math.sin(this.titleT * 0.04) * 400
      camera.angle = 0
      camera.view = 110
      camera.scale = Math.min(this.W, this.H) / camera.view
      camera.shake = 0
      camera.begin(ctx, this.W, this.H)
      game.time += dt
      Renderer.drawWorld(ctx, camera, 1)
      camera.end(ctx)
      ctx.fillStyle = 'rgba(5,7,10,0.55)'
      ctx.fillRect(0, 0, this.W, this.H)
    }
  }

  private resize(): void {
    const canvas = this.canvas
    if (!canvas) return
    // phones are often 3x DPR; 1.5x looks the same in motion for a fraction of the pixels
    this.dpr = Math.min(window.devicePixelRatio || 1, touch.active ? 1.5 : 2) * quality.dprScale
    this.W = window.innerWidth
    this.H = window.innerHeight
    readSafeArea()
    canvas.width = Math.round(this.W * this.dpr)
    canvas.height = Math.round(this.H * this.dpr)
    canvas.style.width = this.W + 'px'
    canvas.style.height = this.H + 'px'
    this.idleFrames = 0 // resizing clears the canvas, so draw again
  }

  /** Ask for fullscreen + landscape on phones (Android honours it, iOS ignores it and still plays fine). */
  goFullscreen(): void {
    if (!touch.active) return
    try {
      const el = document.documentElement
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null
      if (p?.then) {
        p.then(() => {
          try {
            const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
            o?.lock?.('landscape').catch(() => {})
          } catch {
            /* ignore */
          }
        }).catch(() => {})
      }
    } catch {
      /* ignore */
    }
  }
}

export const engine = new GameEngine()
