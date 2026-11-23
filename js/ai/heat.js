(function () {
  const HL = window.HL;
  const clamp = HL.clamp;

  const THRESH = [0, 45, 110, 190, 290];
  const COPS = [0, 3, 4, 6, 8, 9];

  const Heat = (HL.Heat = {
    active: false, level: 0, points: 0, bounty: 0, time: 0,
    bust: 0, evade: 0, evadeNeeded: 12, lastX: 0, lastY: 0, visible: false, heliLit: false,
    nearCount: 0, spawnT: 0, roleT: 0, blockT: 0, spikeT: 0, heliT: 0, civT: 0, grace: 0,
    blocks: [], spikes: [], heli: null, copsDown: 0, reason: '', stats: null,
  });

  Heat.reset = function () {
    Object.assign(Heat, {
      active: false, level: 0, points: 0, bounty: 0, time: 0, bust: 0, evade: 0, visible: false, heliLit: false,
      nearCount: 0, spawnT: 0, roleT: 0, blockT: 15, spikeT: 20, heliT: 0, civT: 0, copsDown: 0, reason: '',
      blocks: [], spikes: [], heli: null,
    });
  };

  Heat.start = function (reason, level) {
    const G = HL.G;
    if (Heat.active) return;
    Heat.reset();
    Heat.active = true; Heat.reason = reason; Heat.grace = 10;
    Heat.points = level ? THRESH[level - 1] : 0;
    Heat.level = level || 1;
    const pl = G.player.car;
    Heat.lastX = pl.x; Heat.lastY = pl.y;
    Heat.evadeNeeded = 12 + Heat.level * 3;
    G.toast('PURSUIT: ' + reason, '#ff4d4d');
    for (const u of G.cops) {
      if (u.state === 'patrol' && Math.hypot(u.car.x - pl.x, u.car.y - pl.y) < 420) {
        u.state = 'pursue'; u.role = 'ram'; u.path = null; u.los = false;
      }
    }
  };

  Heat.stop = function () {
    const G = HL.G;
    Heat.active = false;
    for (const u of G.cops) {
      if (u.state === 'pursue' || u.state === 'block') HL.Police.makePatrol(G, u);
    }
    Heat.blocks = []; Heat.spikes = []; Heat.heli = null; Heat.heliLit = false;
    Heat.bust = 0; Heat.evade = 0;
  };

  Heat.onCopWrecked = function () {
    Heat.bounty += 500; Heat.points += 14; Heat.copsDown++;
    HL.G.toast('COP DOWN  +$500', '#ffd23f');
  };
  Heat.onCivilCrash = function () {
    Heat.bounty += 40; Heat.points += 2.5;
  };

  function nearestIdx(arr, v) {
    let bi = 0, bd = 1e9;
    for (let k = 0; k < arr.length; k++) { const d = Math.abs(arr[k] - v); if (d < bd) { bd = d; bi = k; } }
    return bi;
  }

  // Find a spot on the road ahead of the player, mid-block, plus the road axis there.
  function aheadSpot(G, dist) {
    const city = G.city, pl = G.player.car;
    if (pl.speed < 8) return null;
    const horiz = Math.abs(pl.wvx) > Math.abs(pl.wvy);
    if (horiz) {
      let x = pl.x + Math.sign(pl.wvx) * dist;
      const j = nearestIdx(city.hy, pl.y);
      x = clamp(x, city.vx[0] + 40, city.vx[city.NV - 1] - 40);
      let k = 0; while (k < city.NV - 2 && x >= city.vx[k + 1]) k++;
      return { x: (city.vx[k] + city.vx[k + 1]) / 2, y: city.hy[j], horiz: true, w: city.hw[j] };
    }
    let y = pl.y + Math.sign(pl.wvy) * dist;
    const i = nearestIdx(city.vx, pl.x);
    y = clamp(y, city.hy[0] + 40, city.hy[city.NH - 1] - 40);
    let k = 0; while (k < city.NH - 2 && y >= city.hy[k + 1]) k++;
    return { x: city.vx[i], y: (city.hy[k] + city.hy[k + 1]) / 2, horiz: false, w: city.vw[i] };
  }

  function placeRoadblock(G) {
    const s = aheadSpot(G, 220 + Math.random() * 60);
    if (!s) return;
    const heavy = Heat.level >= 4;
    const base = s.horiz ? Math.PI / 2 : 0;
    const blk = { x: s.x, y: s.y, units: [], t: 0 };
    for (const side of [-1, 1]) {
      const off = side * s.w * 0.2;
      const x = s.horiz ? s.x : s.x + off, y = s.horiz ? s.y + off : s.y;
      if (!G.spotFree(x, y, 5)) continue;
      const u = HL.Police.spawnUnit(G, x, y, base + side * 0.45 + (Math.random() - 0.5) * 0.2, 'block', heavy);
      HL.Phys.setMass(u.car, u.car.spec.mass * 1.6);
      blk.units.push(u);
    }
    if (blk.units.length) { Heat.blocks.push(blk); G.toast('ROADBLOCK AHEAD', '#ff9a3c'); }
  }

  function placeSpikes(G) {
    const s = aheadSpot(G, 150 + Math.random() * 50);
    if (!s) return;
    const hx = s.horiz ? 0.8 : s.w * 0.45, hy = s.horiz ? s.w * 0.45 : 0.8;
    Heat.spikes.push({ x: s.x, y: s.y, hx, hy, hit: false });
    G.toast('SPIKE STRIPS AHEAD', '#ff9a3c');
  }

  function spawnPursuer(G) {
    const city = G.city, pl = G.player.car;
    let pick = null;
    for (let tries = 0; tries < 20; tries++) {
      const n = city.randomNode();
      const nx = city.nodeX(n), ny = city.nodeY(n);
      const d = Math.hypot(nx - pl.x, ny - pl.y);
      if (d < 110 || d > 260) continue;
      const hidden = !city.hasLOS(nx, ny, pl.x, pl.y);
      if (!hidden && tries < 14) continue;
      pick = n; break;
    }
    if (pick === null) return;
    const nb = city.neighbors(pick);
    let to = nb[0], bd = 1e9;
    for (const n of nb) { const d = Math.hypot(city.nodeX(n) - pl.x, city.nodeY(n) - pl.y); if (d < bd) { bd = d; to = n; } }
    const p = city.lanePoint(pick, to, 0.3);
    if (!G.spotFree(p.x, p.y, 10)) return;
    const heavy = Heat.level >= 4 && Math.random() < 0.4;
    const u = HL.Police.spawnUnit(G, p.x, p.y, Math.atan2(p.uy, p.ux), 'pursue', heavy);
    u.car.setSpeed(10);
    u.role = 'ram';
  }

  Heat.update = function (dt, G) {
    if (!Heat.active) return;
    const pl = G.player.car;
    Heat.time += dt;
    Heat.points += dt;
    let lvl = 1;
    for (let i = 1; i < THRESH.length; i++) if (Heat.points >= THRESH[i]) lvl = i + 1;
    if (lvl > Heat.level) { Heat.level = lvl; G.toast('HEAT LEVEL ' + lvl, '#ff4d4d'); }
    Heat.evadeNeeded = 12 + Heat.level * 3;
    Heat.bounty += dt * (8 + Heat.level * 6);

    // visibility / busted
    let visible = false, near = 0, pursuers = 0;
    for (const u of G.cops) {
      if (u.state !== 'pursue') continue;
      pursuers++;
      const d = Math.hypot(u.car.x - pl.x, u.car.y - pl.y);
      if ((u.los && d < 130) || d < 70) visible = true; // a cop right beside you counts even without line of sight
      if (d < 14) near++;
    }
    Heat.nearCount = near;

    // helicopter
    if (Heat.level >= 5 && !Heat.heli) {
      Heat.heliT -= dt;
      if (Heat.heliT <= 0) {
        const a = Math.random() * 6.28;
        Heat.heli = { x: pl.x + Math.cos(a) * 380, y: pl.y + Math.sin(a) * 380, vx: 0, vy: 0, life: 60, rot: 0 };
        G.toast('HELICOPTER INBOUND', '#6ab7ff');
      }
    }
    Heat.heliLit = false;
    const h = Heat.heli;
    if (h) {
      h.rot += dt * 30;
      h.life -= dt;
      let tx = pl.x + pl.wvx * 0.6, ty = pl.y + pl.wvy * 0.6;
      if (h.life <= 0) { tx = h.x + (h.x - pl.x) * 4; ty = h.y + (h.y - pl.y) * 4; }
      const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy) || 1;
      const sp = Math.min(h.life > 0 ? 44 : 60, d * 1.4);
      h.vx += (dx / d * sp - h.vx) * Math.min(1, dt * 1.6);
      h.vy += (dy / d * sp - h.vy) * Math.min(1, dt * 1.6);
      h.x += h.vx * dt; h.y += h.vy * dt;
      if (h.life > 0 && Math.hypot(h.x - pl.x, h.y - pl.y) < 20) Heat.heliLit = true;
      if (h.life <= 0 && Math.hypot(h.x - pl.x, h.y - pl.y) > 700) { Heat.heli = null; Heat.heliT = 40; }
    }
    if (Heat.heliLit) visible = true;
    // grace period: the cops are still converging, so you cannot slip away yet
    if (Heat.grace > 0) { Heat.grace -= dt; visible = true; }
    Heat.visible = visible;
    if (visible) { Heat.lastX = pl.x; Heat.lastY = pl.y; Heat.evade = Math.max(0, Heat.evade - dt * 2.5); }
    else Heat.evade += dt;

    const slow = pl.speed < 7;
    if (slow && near > 0) Heat.bust += dt * (0.28 + 0.18 * Math.min(near, 3));
    else Heat.bust = Math.max(0, Heat.bust - dt * 0.5);
    if (Heat.bust >= 1) { G.endRun('busted'); return; }
    if (Heat.evade >= Heat.evadeNeeded) { G.endRun('escaped'); return; }

    // keep the right number of pursuers
    Heat.spawnT -= dt;
    if (pursuers < COPS[Heat.level] && Heat.spawnT <= 0) {
      Heat.spawnT = Heat.level >= 3 ? 1.6 : 2.4;
      spawnPursuer(G);
    }
    // roles
    Heat.roleT -= dt;
    if (Heat.roleT <= 0) {
      Heat.roleT = 1;
      const list = G.cops.filter((u) => u.state === 'pursue');
      list.sort((a, b) => Math.hypot(a.car.x - pl.x, a.car.y - pl.y) - Math.hypot(b.car.x - pl.x, b.car.y - pl.y));
      let side = 1;
      list.forEach((u, i) => {
        if (i === 0) u.role = 'ram';
        else if (i % 4 === 3 && Heat.level >= 2) u.role = 'block';
        else { u.role = 'flank'; u.side = side; side = -side; }
      });
    }
    // roadblocks & spikes
    if (Heat.level >= 3) {
      Heat.blockT -= dt;
      if (Heat.blockT <= 0) { Heat.blockT = 24; placeRoadblock(G); }
    }
    if (Heat.level >= 4) {
      Heat.spikeT -= dt;
      if (Heat.spikeT <= 0) { Heat.spikeT = 30; placeSpikes(G); }
    }
    for (let i = Heat.spikes.length - 1; i >= 0; i--) {
      const s = Heat.spikes[i];
      if (!s.hit && Math.abs(pl.x - s.x) < s.hx + 1.2 && Math.abs(pl.y - s.y) < s.hy + 1.2) {
        s.hit = true; pl.flat = 15;
        G.toast('TIRES SHREDDED', '#ff4d4d'); G.shake(0.5);
      }
      if (Math.hypot(pl.x - s.x, pl.y - s.y) > 600) Heat.spikes.splice(i, 1);
    }
    for (let i = Heat.blocks.length - 1; i >= 0; i--) {
      if (!Heat.blocks[i].units.some((u) => G.cops.includes(u))) Heat.blocks.splice(i, 1);
    }
  };
})();
