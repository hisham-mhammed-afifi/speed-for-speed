import type { City } from '../world/city'

// Reused search state: A* runs for every pursuing cop every 1.5 s, and the endless world's window has 2,401 nodes, so
// allocating five typed arrays per call (as before) was a steady source of garbage. A generation stamp replaces clearing.
let cap = 0
let gScore = new Float32Array(0)
let from = new Int32Array(0)
let gGen = new Uint32Array(0)
let closedGen = new Uint32Array(0)
let gen = 0
let heapNode = new Int32Array(1024)
let heapKey = new Float32Array(1024)
let heapSize = 0
const nb: number[] = []

function heapPush(node: number, key: number): void {
  if (heapSize === heapNode.length) {
    const n = new Int32Array(heapSize * 2),
      k = new Float32Array(heapSize * 2)
    n.set(heapNode)
    k.set(heapKey)
    heapNode = n
    heapKey = k
  }
  let i = heapSize++
  while (i > 0) {
    const p = (i - 1) >> 1
    if (heapKey[p] <= key) break
    heapNode[i] = heapNode[p]
    heapKey[i] = heapKey[p]
    i = p
  }
  heapNode[i] = node
  heapKey[i] = key
}

function heapPop(): number {
  const top = heapNode[0]
  const node = heapNode[--heapSize],
    key = heapKey[heapSize]
  let i = 0
  for (;;) {
    let c = 2 * i + 1
    if (c >= heapSize) break
    if (c + 1 < heapSize && heapKey[c + 1] < heapKey[c]) c++
    if (heapKey[c] >= key) break
    heapNode[i] = heapNode[c]
    heapKey[i] = heapKey[c]
    i = c
  }
  heapNode[i] = node
  heapKey[i] = key
  return top
}

/** A* over the road-intersection graph. Returns node ids (start..goal) or null if unreachable. */
export function findPath(city: City, start: number, goal: number): number[] | null {
  if (start === goal) return [start]
  const n = city.nodeCount
  if (n > cap) {
    cap = n
    gScore = new Float32Array(n)
    from = new Int32Array(n)
    gGen = new Uint32Array(n)
    closedGen = new Uint32Array(n)
    gen = 0
  }
  gen = (gen + 1) >>> 0
  if (gen === 0) {
    gGen.fill(0)
    closedGen.fill(0)
    gen = 1
  }
  const gx = city.nodeX(goal),
    gy = city.nodeY(goal)
  heapSize = 0
  gScore[start] = 0
  gGen[start] = gen
  from[start] = -1
  heapPush(start, Math.hypot(city.nodeX(start) - gx, city.nodeY(start) - gy))
  while (heapSize > 0) {
    const cur = heapPop()
    if (closedGen[cur] === gen) continue // a stale duplicate entry
    closedGen[cur] = gen
    if (cur === goal) {
      const path = [cur]
      let c = cur
      while (from[c] !== -1) {
        c = from[c]
        path.push(c)
      }
      return path.reverse()
    }
    city.neighborsInto(cur, nb)
    const cx = city.nodeX(cur),
      cy = city.nodeY(cur)
    for (let k = 0; k < nb.length; k++) {
      const nx = nb[k]
      if (closedGen[nx] === gen) continue
      const px = city.nodeX(nx),
        py = city.nodeY(nx)
      const cost = gScore[cur] + Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy))
      if (gGen[nx] !== gen || cost < gScore[nx]) {
        gGen[nx] = gen
        gScore[nx] = cost
        from[nx] = cur
        heapPush(nx, cost + Math.sqrt((px - gx) * (px - gx) + (py - gy) * (py - gy)))
      }
    }
  }
  return null
}
