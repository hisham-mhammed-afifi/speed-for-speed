// Turns the raw art folder into the small, game-ready files in public/world/.
// Usage: node scripts/build-assets.mjs "<folder with the Gemini_Generated_Image_*.jpg files>"
//
//  - trees:  background cut out (flood fill from the edges), trimmed, squared, 192 px WebP with alpha
//  - grass:  centre crop made seamless (so it tiles), slightly desaturated, 512 px WebP
//  - lots:   top-down building plots, background cut out, compass icon dropped, 1024 px WebP with alpha
//  - bikes:  motorcycle-*.jpg (top and side views), background cut out, turned so every bike faces left, 512 px WebP -> public/bikes/
//
// `--only bikes` builds just the motorcycles (the tree, grass and lot sources are not needed then):
//   node scripts/build-assets.mjs "<folder>" --only bikes
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const src = process.argv[2]
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : ''
if (!src || !fs.existsSync(src)) {
  console.error('usage: node scripts/build-assets.mjs "<source folder>"')
  process.exit(1)
}
const out = path.resolve('public/world')
const bikesOut = path.resolve('public/bikes')
if (only !== 'bikes') for (const d of ['trees', 'grass', 'lots']) fs.mkdirSync(path.join(out, d), { recursive: true })
fs.mkdirSync(bikesOut, { recursive: true })

const file = (id) => path.join(src, `Gemini_Generated_Image_${id}.jpg`)

const TREES = [
  ['b4331yb4331yb433', 't0'], // green
  ['gf0i7kgf0i7kgf0i', 't1'], // fresh green
  ['zhngsnzhngsnzhng', 't2'], // dark green
  ['je9b95je9b95je9b', 't3'], // dark green with yellow blossom
  ['snuioosnuioosnui', 't4'], // yellow-green
  ['cm7dvucm7dvucm7d', 't5'], // yellow
  ['86ed1o86ed1o86ed', 't6'], // pink
  ['s013pvs013pvs013', 't7'], // pale pink
]
const GRASS = [
  ['poxvljpoxvljpoxv', 'lawn'],
  ['ilnv9qilnv9qilnv', 'meadow'],
]
const LOTS = [
  ['mt3go5mt3go5mt3g', 'villa'],
  ['pc3y09pc3y09pc3y', 'campus'],
  ['2hdj1o2hdj1o2hdj', 'residence'],
]

/** Load as RGBA, returning the raw pixels. */
async function loadRGBA(f) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

/** Near-white, low-chroma pixels connected to the image border are background. Returns a 1 = keep / 0 = background mask. */
function cutBackground(data, w, h, holes) {
  const isBg = (i) => {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2]
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b)
    return mn > 205 && mx - mn < 16
  }
  // grey gaps between branches (shaded white background) count too, but never dark trunks or coloured leaves
  const isHole = (i) => {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      bl = data[i * 4 + 2]
    return Math.min(r, g, bl) > 130 && Math.max(r, g, bl) - Math.min(r, g, bl) < 14
  }
  const bg = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const push = (i) => {
    if (!bg[i] && isBg(i)) {
      bg[i] = 1
      stack[sp++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (sp) {
    const i = stack[--sp]
    const x = i % w,
      y = (i / w) | 0
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  const keep = new Uint8Array(w * h)
  // holes: near-white pixels anywhere (gaps inside a tree canopy) are background too
  for (let i = 0; i < keep.length; i++) keep[i] = bg[i] || (holes && isHole(i)) ? 0 : 1
  return keep
}

/** Keep only the largest connected region of the mask (drops compass icons and stray specks). */
function largestRegion(mask, w, h) {
  const label = new Int32Array(w * h)
  let best = 0,
    bestId = 0,
    id = 0
  const stack = new Int32Array(w * h)
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue
    id++
    let sp = 0,
      n = 0
    stack[sp++] = s
    label[s] = id
    while (sp) {
      const i = stack[--sp]
      n++
      const x = i % w,
        y = (i / w) | 0
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && mask[j] && !label[j]) {
          label[j] = id
          stack[sp++] = j
        }
      }
    }
    if (n > best) {
      best = n
      bestId = id
    }
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = label[i] === bestId ? 1 : 0
  return out
}

/** One-pixel erode, so the white halo of the cut edge goes away. */
function erode(mask, w, h) {
  const o = new Uint8Array(mask.length)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      o[i] = mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w] ? 1 : 0
    }
  return o
}

/** Apply the mask as soft alpha, then trim to the content and (optionally) pad to a square. */
async function cutout(f, { square, keepLargest, size, holes }) {
  const { data, w, h } = await loadRGBA(f)
  let mask = cutBackground(data, w, h, holes)
  if (keepLargest) mask = largestRegion(mask, w, h)
  mask = erode(mask, w, h)
  // soft edge: blur the mask a little
  const soft = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: w, height: h, channels: 1 } })
    .blur(1.1)
    .extractChannel(0)
    .raw()
    .toBuffer()
  if (soft.length !== w * h) throw new Error('soft mask has ' + soft.length + ' bytes, expected ' + w * h)
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = soft[i]
  let x0 = w,
    y0 = h,
    x1 = 0,
    y1 = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (soft[y * w + x] > 24) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  const cw = x1 - x0 + 1,
    ch = y1 - y0 + 1
  let img = sharp(data, { raw: { width: w, height: h, channels: 4 } }).extract({ left: x0, top: y0, width: cw, height: ch })
  if (square) {
    const s = Math.max(cw, ch)
    img = sharp(await img.png().toBuffer()).extend({
      top: Math.floor((s - ch) / 2),
      bottom: Math.ceil((s - ch) / 2),
      left: Math.floor((s - cw) / 2),
      right: Math.ceil((s - cw) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    img = sharp(await img.png().toBuffer()).resize(size, size) // resize runs before extend in one pipeline, so do it in a second pass
  } else {
    img = img.resize({ width: cw >= ch ? size : undefined, height: ch > cw ? size : undefined })
  }
  return img
}

/** Make a square image tile seamlessly: blend it with a half-rolled copy through a soft window. */
async function seamlessTile(f, crop, size) {
  const base = await sharp(f).extract(crop).resize(768, 768).removeAlpha().raw().toBuffer()
  const N = 768
  const out = Buffer.alloc(N * N * 3)
  const win = (t) => Math.pow(Math.sin(Math.PI * (t / (N - 1))), 2) // 0 at the borders, 1 in the middle
  for (let y = 0; y < N; y++) {
    const wy = win(y)
    const ry = (y + N / 2) % N
    for (let x = 0; x < N; x++) {
      const wgt = wy * win(x)
      const rx = (x + N / 2) % N
      for (let c = 0; c < 3; c++) {
        out[(y * N + x) * 3 + c] = Math.round(base[(y * N + x) * 3 + c] * wgt + base[(ry * N + rx) * 3 + c] * (1 - wgt))
      }
    }
  }
  return sharp(out, { raw: { width: N, height: N, channels: 3 } })
    .modulate({ saturation: 0.82, brightness: 0.82 })
    .resize(size, size)
}

const report = []
const save = async (img, rel, opts) => {
  const p = path.join(out, rel)
  await img.webp(opts).toFile(p)
  report.push([rel, Math.round(fs.statSync(p).size / 1024) + ' KB'])
}

if (only !== 'bikes') {
  for (const [id, name] of TREES) await save(await cutout(file(id), { square: true, keepLargest: true, size: 192, holes: true }), `trees/${name}.webp`, { quality: 82, alphaQuality: 92 })
  for (const [id, name] of GRASS) await save(await seamlessTile(file(id), { left: 320, top: 0, width: 768, height: 768 }, 256), `grass/${name}.webp`, { quality: 80 })
  for (const [id, name] of LOTS) await save(await cutout(file(id), { square: false, keepLargest: true, size: 1024 }), `lots/${name}.webp`, { quality: 82, alphaQuality: 90 })
}

// motorcycles: [source name, output id, does the side view face right (so it must be mirrored)?]
const BIKES = [
  ['motorcycle-race', 'race', false],
  ['motorcycle-harley', 'cruiser', true],
  ['motorcycle-mountain', 'dirt', true],
]
if (!only || only === 'bikes') {
  for (const [name, id, sideFacesRight] of BIKES) {
    // top view: the photo has the front pointing up; the game's sprites face left, so turn it a quarter turn counter-clockwise
    const top = await (await cutout(path.join(src, name + '.jpg'), { square: false, keepLargest: true, size: 512 })).png().toBuffer()
    await save(sharp(top).rotate(-90), `../bikes/${id}.webp`, { quality: 84, alphaQuality: 92 })
    // side view: make every bike face left
    let side = await cutout(path.join(src, name + '-side.jpg'), { square: false, keepLargest: true, size: 512 })
    if (sideFacesRight) side = sharp(await side.png().toBuffer()).flop()
    await save(side, `../bikes/${id}-side.webp`, { quality: 84, alphaQuality: 92 })
  }
}

console.table(report)
const total = report.reduce((a, r) => a + parseInt(r[1]), 0)
console.log('total', total, 'KB')
