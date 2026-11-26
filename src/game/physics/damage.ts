// How crashes hurt the player. Deliberately forgiving: light bumps are free, free roam can never wreck you, and the car repairs itself
// after a quiet spell. (Cops and civilians keep the harsher formula in engine.ts, so wrecking a cop is still worth the same.)

/** a change of speed (m/s) below this costs nothing: scrapes, nudges and kerbs */
export const LIGHT_BUMP_DV = 5
/** in free roam health never drops below this, so a drive through town can't end in a wreck */
export const FREE_ROAM_FLOOR = 25
/** a crash this hard (m/s, about 80 km/h) throws a motorcycle rider, but only in a pursuit */
export const BIKE_THROW_DV = 22
/** a combo survives anything lighter than this */
export const COMBO_BREAK_DV = 6

/** Health lost in one crash (before the free-roam floor). */
export function playerDamage(dv: number, durability: number): number {
  return dv < LIGHT_BUMP_DV ? 0 : ((dv - LIGHT_BUMP_DV) * 1.2) / durability
}

/** Health after a crash: never below the floor in free roam (and a car already below it is not lifted by the rule). */
export function healthAfterHit(health: number, dv: number, durability: number, pursuit: boolean): number {
  const h = health - playerDamage(dv, durability)
  return pursuit ? Math.max(0, h) : Math.max(h, Math.min(health, FREE_ROAM_FLOOR))
}

/** Health after `dt` seconds, `sinceHit` seconds after the last crash: nothing for a while, then it comes back (faster in free roam). */
export function repair(health: number, sinceHit: number, dt: number, pursuit: boolean): number {
  const delay = pursuit ? 5 : 2.5
  if (health >= 100 || sinceHit < delay) return health
  return Math.min(100, health + (pursuit ? 1.5 : 6) * dt)
}

/** Does this crash throw a motorcycle rider off? */
export function bikeThrown(dv: number, pursuit: boolean): boolean {
  return pursuit && dv >= BIKE_THROW_DV
}
