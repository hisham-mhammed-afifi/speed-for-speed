import { afterEach, describe, expect, it, vi } from 'vitest'
import { heat } from './ai/heat'
import { playerDamage } from './physics/damage'
import { Combo } from './progress/combo'
import { game } from './state'
import { bootEngine, recklessDriver, recordPlayerHits, seedRandom } from './testkit'

// The real engine, headless: how the new damage rules play out over whole drives through a busy town.

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
  vi.restoreAllMocks()
})

/** the old rules, for comparison: every bump over 3 m/s cost (dv - 3) * 2.2 / durability */
const oldDamage = (hits: number[], durability: number) => hits.reduce((s, dv) => s + (dv > 3 ? ((dv - 3) * 2.2) / durability : 0), 0)

describe('damage over whole drives (the real engine)', () => {
  it('free roam: three minutes of reckless driving through the busy town never wrecks the car, and it repairs itself afterwards', () => {
    let totalHits = 0
    for (const seed of [1, 2, 3]) {
      restore = seedRandom(seed)
      const sim = bootEngine(0)
      vi.spyOn(heat, 'start').mockImplementation(() => {}) // no cop gets involved: pure free roam
      const hits = recordPlayerHits()
      sim.drive = recklessDriver
      let minHealth = 100
      for (let s = 0; s < 180; s++) {
        sim.run(1)
        minHealth = Math.min(minHealth, game.player.car.health)
        expect(game.state, `seed ${seed}: the run ended at ${s}s`).toBe('play')
      }
      totalHits += hits.filter((dv) => dv >= 5).length
      console.log(`free roam seed ${seed}: ${hits.length} impacts, ${hits.filter((dv) => dv >= 5).length} real ones, lowest health ${minHealth.toFixed(0)}`)
      expect(minHealth).toBeGreaterThanOrEqual(25) // the free-roam floor
      // stop driving: the car repairs itself
      sim.drive = () => ({ brake: 1 })
      sim.run(30)
      expect(game.state).toBe('play')
      expect(game.player.car.health).toBe(100)
      restore()
      restore = null
      vi.restoreAllMocks()
    }
    expect(totalHits, 'the test drives must actually crash, or they prove nothing').toBeGreaterThan(5)
  }, 120_000)

  it('a pursuit: the same crashes cost clearly less than the old rules took, and the health the car loses never exceeds what the rules say', () => {
    let newRules = 0,
      oldRules = 0,
      hitCount = 0
    const seeds = [1, 2, 3, 4, 5]
    for (const seed of seeds) {
      restore = seedRandom(seed)
      const sim = bootEngine(0)
      const hits = recordPlayerHits()
      heat.start('TEST', 3)
      sim.drive = recklessDriver
      const dur = game.player.spec.durability
      sim.run(60)
      // the same hits, priced by each set of rules (uncapped, so one huge crash cannot hide the difference)
      const real = hits.filter((dv) => dv >= 5)
      hitCount += real.length
      const priced = real.reduce((sum, dv) => sum + playerDamage(dv, dur), 0)
      newRules += priced
      oldRules += oldDamage(hits, dur)
      expect(100 - game.player.car.health, `seed ${seed}`).toBeLessThanOrEqual(Math.max(priced, 0) + 1e-6)
      restore()
      restore = null
      vi.restoreAllMocks()
    }
    console.log(`pursuit, ${seeds.length} drives of 60 s, ${hitCount} real crashes: the rules cost ${newRules.toFixed(0)} health in total, the old rules ${oldRules.toFixed(0)}`)
    expect(hitCount).toBeGreaterThan(5)
    expect(newRules).toBeLessThan(oldRules * 0.65)
  }, 120_000)
})

describe('motorcycle crashes and combos use the forgiving rules (the real hooks)', () => {
  it('a rider is thrown off only in a pursuit, at about 80 km/h or more', () => {
    restore = seedRandom(7)
    bootEngine(11) // the race bike
    const pl = game.player.car
    expect(pl.spec.bike).toBe(true)
    // free roam: even a violent crash does not throw you
    vi.spyOn(heat, 'start').mockImplementation(() => {})
    game.onImpact(pl, null, 24, 0, pl.x, pl.y, 1, 0)
    expect(game.state).toBe('play')
    expect(pl.health).toBeGreaterThanOrEqual(25)
    vi.restoreAllMocks()
    // pursuit: 18 m/s is survivable, 23 m/s is not
    pl.health = 100
    heat.start('TEST', 2)
    game.time += 1
    game.onImpact(pl, null, 18, 0, pl.x, pl.y, 1, 0)
    expect(game.state).toBe('play')
    game.time += 1
    game.onImpact(pl, null, 23, 0, pl.x, pl.y, 1, 0)
    expect(game.state).toBe('result')
  })

  it('a scrape keeps your combo, a real crash loses it', () => {
    restore = seedRandom(8)
    bootEngine(0)
    const pl = game.player.car
    vi.spyOn(heat, 'start').mockImplementation(() => {})
    Combo.add(100, 'TEST')
    game.time += 1
    game.onImpact(pl, null, 5.5, 0, pl.x, pl.y, 1, 0)
    expect(Combo.pending).toBeGreaterThan(0)
    game.time += 1
    game.onImpact(pl, null, 8, 0, pl.x, pl.y, 1, 0)
    expect(Combo.pending).toBe(0)
  })

  it('light bumps are free, a hard hit hurts, and the car says so while it repairs', () => {
    restore = seedRandom(9)
    const sim = bootEngine(0)
    vi.spyOn(heat, 'start').mockImplementation(() => {})
    const toasts: string[] = []
    const realToast = game.toast
    game.toast = (t, c) => {
      toasts.push(t)
      realToast(t, c)
    }
    const pl = game.player.car
    game.time += 1
    game.onImpact(pl, null, 4.5, 0, pl.x, pl.y, 1, 0)
    expect(pl.health).toBe(100)
    game.time += 1
    game.onImpact(pl, null, 25, 0, pl.x, pl.y, 1, 0)
    expect(pl.health).toBeLessThan(100)
    expect(pl.health).toBeGreaterThanOrEqual(25)
    const hurt = pl.health
    sim.run(6)
    expect(pl.health).toBeGreaterThan(hurt)
    sim.run(15)
    expect(pl.health).toBe(100)
    expect(toasts).toContain('REPAIRING')
  })
})
