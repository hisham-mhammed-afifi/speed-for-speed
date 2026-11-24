import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { touch } from '../../game/core/input'
import { clamp } from '../../game/core/math'
import { engine } from '../../game/engine'
import type { Controls } from '../../game/types'

const STEER_RANGE = 70 // px of thumb travel for full lock

const capture = (e: ReactPointerEvent<HTMLElement>) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* synthetic or already released pointer */
  }
}

/** A button that is "held" while at least one finger is on it. */
function HoldButton({ className, field, children }: { className: string; field: keyof Controls; children: ReactNode }) {
  const held = useRef(new Set<number>())
  const [down, setDown] = useState(false)

  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    capture(e)
    held.current.add(e.pointerId)
    touch.state[field] = 1
    setDown(true)
  }
  const release = (e: ReactPointerEvent<HTMLButtonElement>) => {
    held.current.delete(e.pointerId)
    if (!held.current.size) {
      touch.state[field] = 0
      setDown(false)
    }
  }

  return (
    <button
      className={`tbtn ${className}${down ? ' down' : ''}`}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {children}
    </button>
  )
}

/**
 * On-screen controls for phones: a drag-to-steer pad (left thumb) and GAS / BRAKE / DRIFT / NITRO (right thumb),
 * plus pause and reset buttons. Everything writes into `touch.state`, which `input.poll()` merges with the keyboard.
 * Each finger is tracked by pointer id, so steering and pedals work together.
 */
export function TouchControls() {
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const padId = useRef<number | null>(null)
  const x0 = useRef(0)

  // controls only exist while driving: let go of everything when they go away (pause, results, ...)
  useEffect(() => () => touch.release(), [])

  const padDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (padId.current !== null) return
    e.preventDefault()
    padId.current = e.pointerId
    x0.current = e.clientX
    capture(e)
    for (const el of [baseRef.current, knobRef.current]) {
      if (!el) continue
      el.style.left = e.clientX + 'px'
      el.style.top = e.clientY + 'px'
      el.classList.add('on')
    }
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%,-50%)'
  }
  const padMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== padId.current) return
    const dx = e.clientX - x0.current
    touch.state.steer = clamp(dx / STEER_RANGE, -1, 1)
    if (knobRef.current) knobRef.current.style.transform = `translate(calc(-50% + ${clamp(dx, -STEER_RANGE, STEER_RANGE)}px),-50%)`
  }
  const padUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== padId.current) return
    padId.current = null
    touch.state.steer = 0
    baseRef.current?.classList.remove('on')
    knobRef.current?.classList.remove('on')
  }

  return (
    <div className="touch-layer" onContextMenu={(e) => e.preventDefault()}>
      <div className="t-pad" onPointerDown={padDown} onPointerMove={padMove} onPointerUp={padUp} onPointerCancel={padUp} onLostPointerCapture={padUp}>
        <div className="t-hint">&#8249; steer &#8250;</div>
      </div>
      <div ref={baseRef} className="t-base" />
      <div ref={knobRef} className="t-knob" />
      <button className="tsmall t-pause" aria-label="Pause" onClick={() => engine.togglePause()}>
        II
      </button>
      <button className="tsmall t-reset" aria-label="Reset car" onClick={() => engine.resetCar()}>
        &#8634;
      </button>
      <HoldButton className="t-nitro" field="nitro">
        NITRO
      </HoldButton>
      <HoldButton className="t-drift" field="handbrake">
        DRIFT
      </HoldButton>
      <HoldButton className="t-brake" field="brake">
        BRAKE<small>REV</small>
      </HoldButton>
      <HoldButton className="t-gas" field="throttle">
        GAS
      </HoldButton>
    </div>
  )
}
