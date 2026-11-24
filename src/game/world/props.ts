import type Matter from 'matter-js'
import { Phys } from '../physics/world'
import { game } from '../state'
import type { PropSpot } from '../types'

const SPAWN_R = 170 // props closer than this get a physics body
const DESPAWN_R = 260
const SMASHED_LIFE = 7 // seconds a smashed prop lies around before it is gone for good

interface Active {
  spot: PropSpot
  body: Matter.Body
  /** time since first hit, or -1 while untouched */
  hitAge: number
}

const active = new Map<PropSpot, Active>()

/**
 * Smashable roadside props (cones, sawhorses, park fences). The city only stores their spots; a physics body exists
 * while the player is within a few hundred metres, so thousands of fence panels cost nothing.
 */
export const Props = {
  /** bodies currently in the world (for rendering) */
  get active(): IterableIterator<Active> {
    return active.values()
  },

  count(): number {
    return active.size
  },

  /** Stream props in and out around the player and retire smashed ones. */
  update(dt: number): void {
    const pl = game.player.car
    const spots = game.city.propSpots
    for (const a of active.values()) {
      if (a.hitAge >= 0) a.hitAge += dt
      const dx = a.body.position.x / Phys.S - pl.x,
        dy = a.body.position.y / Phys.S - pl.y
      if (a.hitAge > SMASHED_LIFE || dx * dx + dy * dy > DESPAWN_R * DESPAWN_R) {
        if (a.hitAge > SMASHED_LIFE) a.spot.gone = true
        Phys.removeProp(a.body)
        active.delete(a.spot)
      }
    }
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i]
      if (sp.gone || active.has(sp)) continue
      const dx = sp.x - pl.x,
        dy = sp.y - pl.y
      if (dx * dx + dy * dy < SPAWN_R * SPAWN_R) active.set(sp, { spot: sp, body: Phys.addProp(sp), hitAge: -1 })
    }
  },

  /** A car hit this prop: start its lifetime. Returns true the first time. */
  hit(spot: PropSpot): boolean {
    const a = active.get(spot)
    if (!a || a.hitAge >= 0) return false
    a.hitAge = 0
    return true
  },

  /** Remove every prop body (new run) and bring smashed props back. */
  reset(): void {
    for (const a of active.values()) Phys.removeProp(a.body)
    active.clear()
    for (const sp of game.city?.propSpots ?? []) sp.gone = false
  },
}
