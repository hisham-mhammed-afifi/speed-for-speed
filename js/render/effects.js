(function () {
  const HL = window.HL;

  function glowSprite(r, g, b, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size || 64;
    const x = c.getContext('2d');
    const h = c.width / 2;
    const gr = x.createRadialGradient(h, h, 0, h, h, h);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, c.width, c.width);
    return c;
  }

  const FX = (HL.FX = {
    parts: [], free: [], MAX: 800,
    glow: null,
    skids: new Map(), CH: 170, PPM: 3,
  });

  FX.init = function () {
    FX.glow = {
      red: glowSprite(255, 40, 40), blue: glowSprite(60, 120, 255), orange: glowSprite(255, 150, 40),
      white: glowSprite(255, 255, 255), smoke: glowSprite(170, 170, 170), dark: glowSprite(35, 35, 35),
    };
  };

  function emit(type, x, y, vx, vy, life, size, grow, a, extra) {
    if (FX.parts.length >= FX.MAX) return null;
    const p = FX.free.pop() || {};
    p.type = type; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
    p.size = size; p.grow = grow; p.a = a; p.sprite = extra || null; p.rot = Math.random() * 6.28;
    FX.parts.push(p);
    return p;
  }

  FX.smoke = function (x, y, vx, vy, size, alpha, dark) {
    emit(0, x, y, vx + (Math.random() - 0.5) * 1.2, vy + (Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.8, size, 2.2, alpha, dark ? 'dark' : 'smoke');
  };
  FX.spark = function (x, y, vx, vy) {
    emit(1, x, y, vx, vy, 0.25 + Math.random() * 0.35, 0.12, 0, 1, null);
  };
  FX.flame = function (x, y, vx, vy) {
    emit(2, x, y, vx, vy, 0.18 + Math.random() * 0.12, 0.9, -2.5, 0.9, 'orange');
  };
  FX.debris = function (x, y, vx, vy) {
    emit(3, x, y, vx, vy, 0.8 + Math.random() * 0.8, 0.12 + Math.random() * 0.15, 0, 1, null);
  };

  FX.update = function (dt) {
    const arr = FX.parts;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { FX.free.push(p); arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const damp = Math.exp(-(p.type === 0 ? 1.6 : 2.4) * dt);
      p.vx *= damp; p.vy *= damp;
      p.size = Math.max(0.01, p.size + p.grow * dt);
    }
  };

  FX.drawParticles = function (ctx, vis, additiveOnly) {
    const arr = FX.parts;
    if (!additiveOnly) {
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (p.type !== 0 && p.type !== 3) continue;
        if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        const t = p.life / p.max;
        if (p.type === 0) {
          ctx.globalAlpha = p.a * t * 0.8;
          const s = p.size * 2;
          ctx.drawImage(FX.glow[p.sprite], p.x - s, p.y - s, s * 2, s * 2);
        } else {
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.fillStyle = '#555';
          ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (p.type !== 1 && p.type !== 2) continue;
      if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
      const t = p.life / p.max;
      if (p.type === 1) {
        ctx.globalAlpha = Math.min(1, t * 2);
        ctx.strokeStyle = '#ffb347';
        ctx.lineWidth = 0.14;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
        ctx.stroke();
      } else {
        ctx.globalAlpha = p.a * t;
        const s = p.size * 1.6;
        ctx.drawImage(FX.glow[p.sprite], p.x - s, p.y - s, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // ---- persistent skid marks (chunked canvases, created on demand) ----
  function chunk(cx, cy, create) {
    const k = cx + ',' + cy;
    let c = FX.skids.get(k);
    if (!c && create) {
      if (FX.skids.size > 40) FX.skids.delete(FX.skids.keys().next().value);
      const cv = document.createElement('canvas');
      cv.width = cv.height = Math.round(FX.CH * FX.PPM);
      c = { cv, ctx: cv.getContext('2d') };
      c.ctx.lineCap = 'round';
      FX.skids.set(k, c);
    }
    return c;
  }
  function addSeg(cx, cy, x0, y0, x1, y1, w, a) {
    const c = chunk(cx, cy, true), s = FX.PPM, ox = cx * FX.CH, oy = cy * FX.CH;
    c.ctx.strokeStyle = `rgba(8,8,8,${a})`;
    c.ctx.lineWidth = w * s;
    c.ctx.beginPath();
    c.ctx.moveTo((x0 - ox) * s, (y0 - oy) * s);
    c.ctx.lineTo((x1 - ox) * s, (y1 - oy) * s);
    c.ctx.stroke();
  }
  FX.skid = function (x0, y0, x1, y1, w, a) {
    const c0x = Math.floor(x0 / FX.CH), c0y = Math.floor(y0 / FX.CH);
    const c1x = Math.floor(x1 / FX.CH), c1y = Math.floor(y1 / FX.CH);
    addSeg(c1x, c1y, x0, y0, x1, y1, w, a);
    if (c0x !== c1x || c0y !== c1y) addSeg(c0x, c0y, x0, y0, x1, y1, w, a);
  };
  FX.clearSkids = function () { FX.skids.clear(); FX.parts.length = 0; };
  FX.drawSkids = function (ctx, vis) {
    const x0 = Math.floor(vis.x0 / FX.CH), x1 = Math.floor(vis.x1 / FX.CH);
    const y0 = Math.floor(vis.y0 / FX.CH), y1 = Math.floor(vis.y1 / FX.CH);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = chunk(cx, cy, false);
      if (c) ctx.drawImage(c.cv, cx * FX.CH, cy * FX.CH, FX.CH, FX.CH);
    }
  };

  // Per-car effects, run in the physics loop for cars near the player.
  const tmp = { x: 0, y: 0 };
  FX.carEffects = function (car, dt) {
    const s = car.spec;
    const sk = car.skid;
    if (sk > 0.12) {
      for (let w = 0; w < 2; w++) {
        const ly = (w ? 1 : -1) * 0.82;
        car.toWorld(-s.len * 0.3, ly, tmp);
        const px = car.wp[w * 2], py = car.wp[w * 2 + 1];
        if (!isNaN(px)) FX.skid(px, py, tmp.x, tmp.y, 0.3, 0.12 + sk * 0.38);
        car.wp[w * 2] = tmp.x; car.wp[w * 2 + 1] = tmp.y;
        if (Math.random() < dt * 70 * sk) FX.smoke(tmp.x, tmp.y, car.wvx * 0.25, car.wvy * 0.25, 0.7 + sk * 0.6, 0.45 * sk + 0.1);
      }
    } else { car.wp[0] = car.wp[1] = car.wp[2] = car.wp[3] = NaN; }
    if (car.nitroOn) {
      for (let w = -1; w <= 1; w += 2) {
        car.toWorld(-s.len * 0.5 - 0.1, w * 0.45, tmp);
        FX.flame(tmp.x, tmp.y, car.wvx * 0.6 - Math.cos(car.theta) * 8, car.wvy * 0.6 - Math.sin(car.theta) * 8);
      }
    }
    if (car.health < 45) {
      const rate = (50 - car.health) * 0.4;
      if (Math.random() < dt * rate) {
        car.toWorld(s.len * 0.3, (Math.random() - 0.5) * 0.8, tmp);
        FX.smoke(tmp.x, tmp.y, car.wvx * 0.4, car.wvy * 0.4, 0.8, 0.5, car.health < 25);
      }
      if (car.health < 15 && Math.random() < dt * 20) {
        car.toWorld(s.len * 0.3, (Math.random() - 0.5) * 0.8, tmp);
        FX.flame(tmp.x, tmp.y, car.wvx * 0.5, car.wvy * 0.5 - 1);
      }
    }
  };

  FX.impact = function (x, y, nx, ny, strength) {
    const n = Math.min(24, 3 + Math.floor(strength * 1.2));
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.4;
      const v = 4 + Math.random() * 12 * Math.min(1.5, strength / 8);
      FX.spark(x, y, Math.cos(a) * v, Math.sin(a) * v);
      if (i % 3 === 0) FX.debris(x, y, Math.cos(a) * v * 0.5, Math.sin(a) * v * 0.5);
    }
    if (strength > 6) for (let i = 0; i < 3; i++) FX.smoke(x, y, nx * 2, ny * 2, 1.2, 0.5);
  };
})();
