(function () {
  const HL = window.HL;

  const SURF = (HL.SURF = {
    asphalt: { kind: 'asphalt', grip: 1.0, roll: 1.0 },
    sidewalk: { kind: 'sidewalk', grip: 0.9, roll: 1.6 },
    lot: { kind: 'lot', grip: 0.85, roll: 1.5 },
    grass: { kind: 'grass', grip: 0.58, roll: 4.2 },
  });

  const TYPES = { avenue: 24, street: 15, alley: 8 };
  const SIDEWALK = 3;
  const CELL = 80;

  HL.City = function (seed) {
    const R = HL.rng(seed || 20261123);
    const NV = 17, NH = 17;

    function makeLines(n) {
      const pos = [], type = [], wid = [];
      let p = 0;
      for (let k = 0; k < n; k++) {
        let t;
        if (k === 0 || k === n - 1 || k % 4 === 0) t = 'avenue';
        else t = R() < 0.15 ? 'alley' : 'street';
        type.push(t); wid.push(TYPES[t]); pos.push(p);
        p += 82 + R() * 56;
      }
      return { pos, type, wid };
    }
    const V = makeLines(NV), H = makeLines(NH);
    const vx = V.pos, vw = V.wid, hy = H.pos, hw = H.wid;

    const minX = vx[0] - vw[0] / 2, maxX = vx[NV - 1] + vw[NV - 1] / 2;
    const minY = hy[0] - hw[0] / 2, maxY = hy[NH - 1] + hw[NH - 1] / 2;

    // ---------- blocks ----------
    const blocks = [];
    for (let j = 0; j < NH - 1; j++) {
      for (let i = 0; i < NV - 1; i++) {
        const b = {
          i, j,
          x0: vx[i] + vw[i] / 2, x1: vx[i + 1] - vw[i + 1] / 2,
          y0: hy[j] + hw[j] / 2, y1: hy[j + 1] - hw[j + 1] / 2,
          type: 'build',
        };
        const w = b.x1 - b.x0, h = b.y1 - b.y0;
        const r = R();
        if (w > 50 && h > 50 && r < 0.11) b.type = 'park';
        else if (w > 40 && h > 40 && r < 0.18) b.type = 'plaza';
        blocks.push(b);
      }
    }

    // ---------- buildings ----------
    const buildings = [];
    const trees = [];
    const palette = [
      [86, 92, 104], [104, 100, 96], [120, 112, 98], [78, 88, 100], [96, 84, 80], [110, 116, 124], [70, 76, 86], [128, 120, 108],
    ];
    function addBuilding(x0, y0, x1, y1) {
      const m = R() < 0.5 ? 0 : R() * 2.5;
      x0 += m; y0 += m; x1 -= m; y1 -= m;
      const w = x1 - x0, h = y1 - y0;
      if (w < 9 || h < 9) return;
      const height = 10 + Math.pow(R(), 2) * 85;
      const base = palette[(R() * palette.length) | 0];
      const k = 0.85 + Math.min(height / 95, 1) * 0.35;
      const props = [];
      const np = (R() * 4) | 0;
      for (let q = 0; q < np; q++) {
        const pw = 2 + R() * 4, ph = 2 + R() * 4;
        props.push({ ox: (R() - 0.5) * (w - pw - 3), oy: (R() - 0.5) * (h - ph - 3), w: pw, h: ph });
      }
      buildings.push({
        x: (x0 + x1) / 2, y: (y0 + y1) / 2, theta: 0, hx: w / 2, hy: h / 2,
        x0, y0, x1, y1, height,
        roof: `rgb(${(base[0] * k) | 0},${(base[1] * k) | 0},${(base[2] * k) | 0})`,
        wall: `rgb(${(base[0] * k * 0.55) | 0},${(base[1] * k * 0.55) | 0},${(base[2] * k * 0.55) | 0})`,
        props, hasHeli: R() < 0.05 && w > 25 && h > 25,
        stamp: 0,
      });
    }
    function split(x0, y0, x1, y1, depth) {
      const w = x1 - x0, h = y1 - y0;
      if (depth < 2 && Math.max(w, h) > 75 && R() < 0.85) {
        const gap = R() < 0.35 ? 8 : 0;
        if (w >= h) {
          const cut = x0 + w * (0.35 + R() * 0.3);
          split(x0, y0, cut - gap / 2, y1, depth + 1);
          split(cut + gap / 2, y0, x1, y1, depth + 1);
        } else {
          const cut = y0 + h * (0.35 + R() * 0.3);
          split(x0, y0, x1, cut - gap / 2, depth + 1);
          split(x0, cut + gap / 2, x1, y1, depth + 1);
        }
      } else addBuilding(x0, y0, x1, y1);
    }
    for (const b of blocks) {
      const x0 = b.x0 + SIDEWALK, y0 = b.y0 + SIDEWALK, x1 = b.x1 - SIDEWALK, y1 = b.y1 - SIDEWALK;
      if (b.type === 'build') {
        if (x1 - x0 >= 12 && y1 - y0 >= 12) split(x0, y0, x1, y1, 0);
        else b.type = 'plaza';
      } else if (b.type === 'park') {
        for (let ty = y0 + 8; ty < y1 - 4; ty += 13) {
          for (let tx = x0 + 8; tx < x1 - 4; tx += 13) {
            if (R() < 0.7) trees.push({ x: tx + (R() - 0.5) * 8, y: ty + (R() - 0.5) * 8, r: 3 + R() * 2.5, c: R() });
          }
        }
      }
    }

    // spatial hash of buildings
    const hash = new Map();
    const key = (ix, iy) => (ix + 4) * 64 + (iy + 4);
    for (const b of buildings) {
      const ix0 = Math.floor(b.x0 / CELL), ix1 = Math.floor(b.x1 / CELL);
      const iy0 = Math.floor(b.y0 / CELL), iy1 = Math.floor(b.y1 / CELL);
      for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
        const k = key(ix, iy);
        let a = hash.get(k);
        if (!a) hash.set(k, (a = []));
        a.push(b);
      }
    }
    let stampCounter = 1;

    // world boundary walls
    const wallPad = 3.5, big = 400;
    const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2;
    // boundary walls (turned into static Matter.js bodies by js/physics/world.js)
    const walls = [
      { x: minX - wallPad - big, y: cym, hx: big, hy: (maxY - minY) / 2 + big * 2 },
      { x: maxX + wallPad + big, y: cym, hx: big, hy: (maxY - minY) / 2 + big * 2 },
      { x: cxm, y: minY - wallPad - big, hx: (maxX - minX) / 2 + big * 2, hy: big },
      { x: cxm, y: maxY + wallPad + big, hx: (maxX - minX) / 2 + big * 2, hy: big },
    ];

    function nearestIdx(arr, v) {
      let bi = 0, bd = 1e9;
      for (let k = 0; k < arr.length; k++) { const d = Math.abs(arr[k] - v); if (d < bd) { bd = d; bi = k; } }
      return bi;
    }

    const city = {
      NV, NH, vx, hy, vw, hw, vt: V.type, ht: H.type, blocks, buildings, trees, walls,
      bounds: { minX, minY, maxX, maxY },

      // ----- road graph -----
      nodeCount: NV * NH,
      nodeX(id) { return vx[id % NV]; },
      nodeY(id) { return hy[(id / NV) | 0]; },
      nodeId(i, j) { return j * NV + i; },
      neighbors(id) {
        const i = id % NV, j = (id / NV) | 0, out = [];
        if (i > 0) out.push(id - 1);
        if (i < NV - 1) out.push(id + 1);
        if (j > 0) out.push(id - NV);
        if (j < NH - 1) out.push(id + NV);
        return out;
      },
      nearestNode(x, y) { return nearestIdx(hy, y) * NV + nearestIdx(vx, x); },
      edgeWidth(a, b) { return (a / NV | 0) === (b / NV | 0) ? hw[(a / NV) | 0] : vw[a % NV]; },
      nodeHalfWidth(id) { return Math.max(vw[id % NV], hw[(id / NV) | 0]) / 2; },
      randomNode() { return (Math.random() * NV * NH) | 0; },

      // ----- queries -----
      colRoad(x) { for (let k = 0; k < NV; k++) if (Math.abs(x - vx[k]) <= vw[k] / 2) return k; return -1; },
      rowRoad(y) { for (let k = 0; k < NH; k++) if (Math.abs(y - hy[k]) <= hw[k] / 2) return k; return -1; },
      surfaceAt(x, y) {
        if (x < minX || x > maxX || y < minY || y > maxY) return SURF.lot;
        if (city.colRoad(x) >= 0 || city.rowRoad(y) >= 0) return SURF.asphalt;
        let i = 0; while (i < NV - 2 && x >= vx[i + 1]) i++;
        let j = 0; while (j < NH - 2 && y >= hy[j + 1]) j++;
        const b = blocks[j * (NV - 1) + i];
        if (!b) return SURF.lot;
        if (x < b.x0 + SIDEWALK || x > b.x1 - SIDEWALK || y < b.y0 + SIDEWALK || y > b.y1 - SIDEWALK) return SURF.sidewalk;
        return b.type === 'park' ? SURF.grass : SURF.lot;
      },
      pointInBuilding(x, y) {
        const a = hash.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
        if (!a) return false;
        for (let k = 0; k < a.length; k++) {
          const b = a[k];
          if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return true;
        }
        return false;
      },
      queryBuildings(x0, y0, x1, y1, out) {
        out.length = 0;
        const st = ++stampCounter;
        const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL), iy0 = Math.floor(y0 / CELL), iy1 = Math.floor(y1 / CELL);
        for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
          const a = hash.get(key(ix, iy));
          if (!a) continue;
          for (let k = 0; k < a.length; k++) {
            const b = a[k];
            if (b.stamp === st) continue;
            b.stamp = st;
            if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
            out.push(b);
          }
        }
        return out;
      },
      hasLOS(x0, y0, x1, y1) {
        const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
        const n = Math.ceil(d / 4);
        for (let k = 1; k < n; k++) {
          const t = k / n;
          if (city.pointInBuilding(x0 + dx * t, y0 + dy * t)) return false;
        }
        return true;
      },
      // lane point for travelling from node a to node b (right-hand traffic)
      lanePoint(a, b, t) {
        const ax = city.nodeX(a), ay = city.nodeY(a), bx = city.nodeX(b), by = city.nodeY(b);
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        const off = city.edgeWidth(a, b) * 0.25;
        return { x: ax + ux * t * len - uy * off, y: ay + uy * t * len + ux * off, ux, uy, len };
      },
    };
    return city;
  };
})();
