import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useGameStore } from '../../store'

/** Scale factor for the HUD text, matching what the canvas HUD uses (smaller screens get a smaller HUD). */
function useHudScale(): number {
  const calc = () => Math.min(1.2, Math.max(0.62, Math.min(window.innerWidth, window.innerHeight) / 760))
  const [s, setS] = useState(calc)
  useEffect(() => {
    const onResize = () => setS(calc())
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])
  return s
}

/** 5-point star: alternating outer / inner radius, like the canvas version this replaces. */
const STAR_POINTS = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5
  const r = i % 2 ? 6.3 : 14
  return `${(16 + Math.cos(a) * r).toFixed(2)},${(16 + Math.sin(a) * r).toFixed(2)}`
}).join(' ')

function Star({ lit }: { lit: boolean }) {
  return (
    <svg className={lit ? 'star lit' : 'star'} viewBox="0 0 32 32" aria-hidden>
      <polygon points={STAR_POINTS} />
    </svg>
  )
}

/**
 * Heat stars, bounty, pursuit status, bust / evade meters, event toasts and the first-seconds hint.
 * Fed by the ~10 Hz HUD snapshot in the store; the speedometer and minimap stay on the game canvas.
 */
export function HudOverlay() {
  const hud = useGameStore((s) => s.hud)
  const toasts = useGameStore((s) => s.toasts)
  const touch = useGameStore((s) => s.touchActive)
  const s = useHudScale()

  const status = !hud.active ? 'free' : hud.visible ? 'pursuit' : 'evading'
  const statusText = status === 'free' ? 'FREE ROAM' : status === 'pursuit' ? 'PURSUIT' : `EVADING ${hud.evadeLeft.toFixed(1)}s`

  return (
    <div className={touch ? 'hud touch' : 'hud'} style={{ '--s': s } as CSSProperties}>
      <div className="hud-heat">
        <div className="hud-stars">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} lit={hud.active && i < hud.level} />
          ))}
        </div>
        <div className="hud-bounty">${hud.bounty.toLocaleString()}</div>
        <div className={`hud-status ${status}`}>{statusText}</div>
        {hud.active && hud.evadeFrac > 0.02 && (
          <div className="hud-meter evade">
            <i style={{ width: `${Math.min(100, hud.evadeFrac * 100)}%` }} />
          </div>
        )}
        {hud.bust > 0.01 && (
          <>
            <div className="hud-bust">BUSTED</div>
            <div className="hud-meter bust">
              <i style={{ width: `${Math.min(100, hud.bust * 100)}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="hud-toasts">
        {toasts.map((t) => (
          <div key={t.id} className="hud-toast" style={{ color: t.color }}>
            {t.text}
          </div>
        ))}
      </div>

      {hud.hint &&
        (touch ? (
          <div className="hud-hint touch">
            <div>Left thumb: drag to steer</div>
            <div>Right thumb: GAS / BRAKE / DRIFT / NITRO</div>
            <div className="accent">Speed past a cop or ram one to start a pursuit</div>
          </div>
        ) : (
          <div className="hud-hint">
            <div>W/S throttle-brake &nbsp; A/D steer &nbsp; SPACE handbrake &nbsp; SHIFT nitro</div>
            <div className="accent">Speed past a cop, ram one, or press H to start a pursuit</div>
          </div>
        ))}
    </div>
  )
}
