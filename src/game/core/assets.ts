/** Loaded car sprites, keyed by CarSpec.file (e.g. "cars/xyz.png"). */
export const images: Record<string, HTMLImageElement> = {}

export function loadImages(files: string[], onProgress?: (p: number) => void): Promise<void> {
  let done = 0
  const base = import.meta.env.BASE_URL
  return Promise.all(
    files.map(
      (f) =>
        new Promise<void>((resolve) => {
          const im = new Image()
          im.onload = () => {
            images[f] = im
            onProgress?.(++done / files.length)
            resolve()
          }
          im.onerror = () => {
            console.warn('missing image', f)
            onProgress?.(++done / files.length)
            resolve()
          }
          im.src = base + f
        }),
    ),
  ).then(() => undefined)
}
