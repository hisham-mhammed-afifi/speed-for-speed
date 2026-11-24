import { useEffect, useRef } from 'react'
import { engine } from '../game/engine'

/** Hosts the game canvas. The engine attaches once on mount and detaches on unmount (StrictMode-safe). */
export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => engine.mount(ref.current!), [])
  return <canvas ref={ref} className="game-canvas" />
}
