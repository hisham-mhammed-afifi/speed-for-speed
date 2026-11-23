(function () {
  const HL = window.HL;
  // A* over the road-intersection graph. Returns an array of node ids (start..goal) or null.
  HL.Nav = {
    findPath(city, start, goal) {
      if (start === goal) return [start];
      const n = city.nodeCount;
      const g = new Float32Array(n).fill(Infinity);
      const f = new Float32Array(n).fill(Infinity);
      const from = new Int16Array(n).fill(-1);
      const closed = new Uint8Array(n);
      const gx = city.nodeX(goal), gy = city.nodeY(goal);
      const h = (id) => Math.hypot(city.nodeX(id) - gx, city.nodeY(id) - gy);
      let open = [start];
      g[start] = 0; f[start] = h(start);
      while (open.length) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
        const cur = open[bi];
        open[bi] = open[open.length - 1]; open.pop();
        if (cur === goal) {
          const path = [cur];
          let c = cur;
          while (from[c] !== -1) { c = from[c]; path.push(c); }
          return path.reverse();
        }
        closed[cur] = 1;
        const nb = city.neighbors(cur);
        for (let k = 0; k < nb.length; k++) {
          const nx = nb[k];
          if (closed[nx]) continue;
          const cost = g[cur] + Math.hypot(city.nodeX(nx) - city.nodeX(cur), city.nodeY(nx) - city.nodeY(cur));
          if (cost < g[nx]) {
            if (g[nx] === Infinity) open.push(nx);
            g[nx] = cost; f[nx] = cost + h(nx); from[nx] = cur;
          }
        }
      }
      return null;
    },
  };
})();
