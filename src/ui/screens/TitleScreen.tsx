import { useEffect } from 'react'
import { useGameStore } from '../../store'
import { DailyPanel } from '../DailyPanel'

export function TitleScreen() {
  const setScreen = useGameStore((s) => s.setScreen)
  const cash = useGameStore((s) => s.save.cash)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter') setScreen('select')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setScreen])

  return (
    <div className="screen">
      <h1>
        HEAT<span>LINE</span>
      </h1>
      <p className="sub">Open-city police pursuit. Outrun, outsmart and wreck the law.</p>
      <div className="menu">
        <button className="primary" onClick={() => setScreen('select')}>
          Play{cash > 0 ? `  ·  $${Math.floor(cash).toLocaleString()}` : ''}
        </button>
        <button onClick={() => setScreen('help')}>How to play</button>
      </div>
      <DailyPanel />
    </div>
  )
}
