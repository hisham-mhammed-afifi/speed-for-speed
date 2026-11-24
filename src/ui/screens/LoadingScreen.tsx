import { useGameStore } from '../../store'

export function LoadingScreen() {
  const progress = useGameStore((s) => s.loadProgress)
  return (
    <div className="screen">
      <h1>HEATLINE</h1>
      <div className="loadwrap">
        <div className="load-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="sub">Loading cars...</p>
    </div>
  )
}
