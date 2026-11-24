import { useEffect } from 'react'
import { touch } from '../../game/core/input'

/**
 * Turns on-screen controls on for touch devices. A finger on a hybrid device switches them on;
 * a physical key press switches them off again (unless the device is touch-only).
 */
export function useTouchMode(): void {
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
    if (coarse) touch.setActive(true)
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') touch.setActive(true)
    }
    const onKey = () => {
      if (!coarse) touch.setActive(false)
    }
    // iOS Safari: stop the pinch-zoom gesture
    const onGesture = (e: Event) => e.preventDefault()
    addEventListener('pointerdown', onPointer, { passive: true })
    addEventListener('keydown', onKey)
    document.addEventListener('gesturestart', onGesture)
    document.addEventListener('gesturechange', onGesture)
    return () => {
      removeEventListener('pointerdown', onPointer)
      removeEventListener('keydown', onKey)
      document.removeEventListener('gesturestart', onGesture)
      document.removeEventListener('gesturechange', onGesture)
    }
  }, [])
}
