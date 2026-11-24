import type { Safe } from '../types'

/** Notch / home-bar insets in CSS px (the engine refreshes them on resize). */
export const safe: Safe = { t: 0, r: 0, b: 0, l: 0 }

let probe: HTMLDivElement | null = null

/** Read the CSS env(safe-area-inset-*) values back as pixels so canvas drawing can stay clear of them. */
export function readSafeArea(): void {
  if (!probe) {
    probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
    document.body.appendChild(probe)
  }
  const cs = getComputedStyle(probe)
  safe.t = parseFloat(cs.paddingTop) || 0
  safe.r = parseFloat(cs.paddingRight) || 0
  safe.b = parseFloat(cs.paddingBottom) || 0
  safe.l = parseFloat(cs.paddingLeft) || 0
}
