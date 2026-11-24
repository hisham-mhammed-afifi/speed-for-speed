import { useEffect } from 'react'
import { useGameStore } from '../../store'

export function TitleScreen() {
  const setScreen = useGameStore((s) => s.setScreen)

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
          Play
        </button>
        <button onClick={() => setScreen('help')}>How to play</button>
      </div>
    </div>
  )
}
