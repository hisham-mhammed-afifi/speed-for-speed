import { useState } from 'react'
import { engine } from '../../game/engine'

export function PauseMenu() {
  const [cameraMode, setCameraMode] = useState(engine.cameraMode)
  const [debug, setDebug] = useState(engine.debug)
  const [wiped, setWiped] = useState(false)
  const [fixed, setFixed] = useState(engine.fixedSkill)
  const [gfx, setGfx] = useState(engine.qualityLabel)

  return (
    <div className="screen dim">
      <div className="panel">
        <h2>Paused</h2>
        <div className="menu">
          <button className="primary" onClick={() => engine.togglePause()}>
            Resume
          </button>
          <button onClick={() => setCameraMode(engine.toggleCameraMode())}>Camera: {cameraMode === 'north' ? 'North up' : 'Heading up'}</button>
          <button onClick={() => setDebug(engine.toggleDebug())}>Debug overlay: {debug ? 'On' : 'Off'}</button>
          <button onClick={() => setFixed(engine.toggleFixedSkill())}>Difficulty: {fixed ? 'Fixed' : 'Adaptive'}</button>
          <button onClick={() => setGfx(engine.cycleQuality())}>Graphics: {gfx}</button>
          <button
            onClick={() => {
              engine.resetMemory()
              setWiped(true)
            }}
            disabled={wiped}
          >
            {wiped ? 'Police memory wiped' : 'Reset police memory'}
          </button>
          <button onClick={() => engine.restart()}>Restart</button>
          <button onClick={() => engine.toCarSelect()}>Change car</button>
        </div>
      </div>
    </div>
  )
}
