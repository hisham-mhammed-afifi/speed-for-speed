/**
 * Context options for every offscreen canvas the game draws FROM (glow sprites, tree shadows, texture patterns, skid chunks, minimap
 * and HUD caches). `willReadFrequently` keeps those canvases in CPU memory.
 *
 * Why it matters: once the browser moves the main canvas to software rendering (it does under GPU-memory pressure, which phones hit
 * quickly, and in long sessions), drawing a GPU-backed canvas onto it makes the browser read the pixels back from the GPU *every
 * time*. We measured about 90 blocking GPU readbacks per frame and a main thread that was 100% busy with only 4% of it in our own code.
 * CPU-backed sources never need a readback, whichever way the main canvas is rendered.
 */
export const CPU_CANVAS: CanvasRenderingContext2DSettings = { willReadFrequently: true }

/** The visible game canvas: opaque (the frame always starts with a full fill), which lets the browser skip blending it with the page. */
export const MAIN_CANVAS: CanvasRenderingContext2DSettings = { alpha: false }
