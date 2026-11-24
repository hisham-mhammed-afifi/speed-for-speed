import { useEffect } from 'react'
import { carBars, PLAYER_CARS } from '../../game/data/cars'
import { engine } from '../../game/engine'
import { useGameStore } from '../../store'

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
  const n = PLAYER_CARS.length
  const spec = PLAYER_CARS[index]
  const bars = carBars(spec)

  const step = (d: number) => setSelectedCar((index + d + n) % n)
  const drive = () => {
    engine.goFullscreen()
    engine.startGame(index)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') setSelectedCar((index - 1 + n) % n)
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') setSelectedCar((index + 1) % n)
      else if (e.code === 'Enter') {
        engine.goFullscreen()
        engine.startGame(index)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [index, n, setSelectedCar])

  return (
    <div className="screen">
      <div className="panel wide">
        <h2>Choose your ride</h2>
        <div className="carousel">
          <button className="arrow" onClick={() => step(-1)} aria-label="Previous car">
            &#8249;
          </button>
          <div className="preview">
            <img src={import.meta.env.BASE_URL + spec.file} alt={spec.name} />
          </div>
          <button className="arrow" onClick={() => step(1)} aria-label="Next car">
            &#8250;
          </button>
        </div>
        <div className="carinfo">
          <h3>{spec.name}</h3>
          <div className="sub">
            {spec.cls}
            {spec.awd ? ' - AWD' : ' - RWD'}
          </div>
          <div>
            <StatBar label="Top speed" frac={bars.speed} text={`${bars.topKmh} km/h`} />
            <StatBar label="Acceleration" frac={bars.accel} text={`${bars.t100.toFixed(1)}s 0-100`} />
            <StatBar label="Handling" frac={bars.handling} text="" />
            <StatBar label="Durability" frac={bars.durability} text="" />
            <StatBar label="Weight" frac={bars.weight} text={`${spec.mass} kg`} />
          </div>
          <div className="sub">
            {index + 1} / {n}
          </div>
        </div>
        <div className="menu row">
          <button onClick={() => setScreen('title')}>Back</button>
          <button className="primary" onClick={drive}>
            Drive
          </button>
        </div>
      </div>
    </div>
  )
}
