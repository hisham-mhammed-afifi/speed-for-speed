import { useEffect } from 'react'
import { carBars, PLAYER_CARS } from '../../game/data/cars'
import { engine } from '../../game/engine'
import { applyUpgrades, carPrice, levelsOf, MAX_LEVEL, owns, UPGRADES, upgradeCost } from '../../game/progress/economy'
import { useGameStore } from '../../store'
import { WantedBar } from '../WantedBar'

const money = (n: number) => '$' + Math.floor(n).toLocaleString()

function StatBar({ label, frac, text }: { label: string; frac: number; text: string }) {
  const pct = Math.round(Math.max(0.06, Math.min(1, frac)) * 100)
  return (
    <div className="stat">
      <span>{label}</span>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <b>{text}</b>
    </div>
  )
}

export function CarSelect() {
  const index = useGameStore((s) => s.selectedCar)
  const setSelectedCar = useGameStore((s) => s.setSelectedCar)
  const setScreen = useGameStore((s) => s.setScreen)
  const save = useGameStore((s) => s.save)
  const skill = save.skill
  const n = PLAYER_CARS.length
  const base = PLAYER_CARS[index]
  const owned = owns(save, base.id)
  const lv = levelsOf(save, base.id)
  const spec = applyUpgrades(base, lv)
  const bars = carBars(spec)
  const price = carPrice(base.id)

  const step = (d: number) => setSelectedCar((index + d + n) % n)
  const drive = () => {
    if (!owned) return
    engine.goFullscreen()
    engine.startGame(index)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') setSelectedCar((index - 1 + n) % n)
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') setSelectedCar((index + 1) % n)
      else if (e.code === 'Enter' && owned) {
        engine.goFullscreen()
        engine.startGame(index)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [index, n, owned, setSelectedCar])

  return (
    <div className="screen">
      <div className="panel wide">
        <div className="garage-head">
          <h2>Garage</h2>
          <div className="wallet">{money(save.cash)}</div>
        </div>
        <div className="carousel">
          <button className="arrow" onClick={() => step(-1)} aria-label="Previous car">
            &#8249;
          </button>
          <div className={owned ? 'preview' : 'preview locked'}>
            <img src={import.meta.env.BASE_URL + (base.side ?? base.file)} alt={base.name} />
            {!owned && <div className="lock-tag">{money(price)}</div>}
          </div>
          <button className="arrow" onClick={() => step(1)} aria-label="Next car">
            &#8250;
          </button>
        </div>
        <div className="carinfo">
          <h3>{base.name}</h3>
          <div className="sub">
            {base.cls}
            {base.bike ? ' - Motorcycle' : base.awd ? ' - AWD' : ' - RWD'}
          </div>
          <div>
            <StatBar label="Top speed" frac={bars.speed} text={`${bars.topKmh} km/h`} />
            <StatBar label="Acceleration" frac={bars.accel} text={`${bars.t100.toFixed(1)}s 0-100`} />
            <StatBar label="Handling" frac={bars.handling} text="" />
            <StatBar label="Durability" frac={bars.durability} text="" />
            <StatBar label="Weight" frac={bars.weight} text={`${base.mass} kg`} />
          </div>
          <div className="sub">
            {index + 1} / {n}
          </div>
        </div>

        {owned ? (
          <div className="upgrades">
            {UPGRADES.map((u, t) => {
              const level = lv[t] ?? 0
              const maxed = level >= MAX_LEVEL
              const cost = maxed ? 0 : upgradeCost(base.id, level)
              return (
                <div key={u.key} className="upgrade" title={u.note}>
                  <span className="up-name">{u.label}</span>
                  <span className="pips">
                    {Array.from({ length: MAX_LEVEL }, (_, i) => (
                      <i key={i} className={i < level ? 'on' : ''} />
                    ))}
                  </span>
                  <button className="small" disabled={maxed || save.cash < cost} onClick={() => engine.buyUpgrade(base.id, t)}>
                    {maxed ? 'MAX' : money(cost)}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="buy">
            <div className="bar wanted-bar">
              <i style={{ width: `${Math.min(100, Math.round((save.cash / price) * 100))}%` }} />
            </div>
            {save.cash >= price ? (
              <button className="primary" onClick={() => engine.buyCar(base.id)}>
                Buy for {money(price)}
              </button>
            ) : (
              <div className="sub">{money(price - save.cash)} to go. Escape pursuits to earn it.</div>
            )}
          </div>
        )}

        <WantedBar rating={skill ?? 0.4} />
        <div className="menu row">
          <button onClick={() => setScreen('title')}>Back</button>
          <button className="primary" onClick={drive} disabled={!owned}>
            {owned ? 'Drive' : 'Locked'}
          </button>
        </div>
      </div>
    </div>
  )
}
