(function () {
  const HL = window.HL;
  const clamp = HL.clamp;

  const Police = (HL.Police = { ambientTarget: 5, ambientTimer: 0 });

  Police.spawnUnit = function (G, x, y, theta, state, heavy) {
    const spec = heavy ? HL.POLICE_HEAVY : HL.POLICE_SPEC;
    const car = G.spawnCar(spec, x, y, theta, 'police');
    car.setSpeed(state === 'block' ? 0 : 9);
    const u = {
      car, state, driver: null, role: 'ram', side: 1, los: false, losT: 0, path: null, pi: 0, repath: 0,
      goal: undefined, stuckT: 0, reverseT: 0, wreckT: 0, detectT: Math.random() * 0.3, pit: false, blockT: 0,
    };
    car.unit = u;
    G.cops.push(u);
    return u;
  };

  Police.makePatrol = function (G, u) {
    const city = G.city, car = u.car;
    const a = city.nearestNode(car.x, car.y);
    const nb = city.neighbors(a);
    let best = nb[0], bd = -2;
    const fx = Math.cos(car.theta), fy = Math.sin(car.theta);
    for (const n of nb) {
      const dx = city.nodeX(n) - car.x, dy = city.nodeY(n) - car.y;
      const d = (dx * fx + dy * fy) / (Math.hypot(dx, dy) || 1);
      if (d > bd) { bd = d; best = n; }
    }
    u.driver = new HL.LaneDriver(city, a, best);
    u.driver.speedCap = 13;
    u.state = 'patrol';
  };

  Police.spawnAmbient = function (G) {
    const city = G.city, pl = G.player.car;
    for (let tries = 0; tries < 10; tries++) {
      const n = city.randomNode();
      const d = Math.hypot(city.nodeX(n) - pl.x, city.nodeY(n) - pl.y);
      if (d < 180 || d > 420) continue;
      const nb = city.neighbors(n);
      const to = nb[(Math.random() * nb.length) | 0];
      const p = city.lanePoint(n, to, 0.3);
      if (!G.spotFree(p.x, p.y, 12)) continue;
      const u = Police.spawnUnit(G, p.x, p.y, Math.atan2(p.uy, p.ux), 'patrol', false);
      u.driver = new HL.LaneDriver(city, n, to);
      u.driver.speedCap = 13;
      return;
    }
  };

  Police.update = function (dt, G) {
    const H = G.heat, pl = G.player.car;
    let patrolCount = 0;
    for (let i = G.cops.length - 1; i >= 0; i--) {
      const u = G.cops[i], car = u.car;
      const d = Math.hypot(car.x - pl.x, car.y - pl.y);
      if (car.health <= 0 && u.state !== 'wrecked') {
        u.state = 'wrecked'; u.wreckT = 0;
        if (H.active) H.onCopWrecked(u);
      }
      switch (u.state) {
        case 'patrol': {
          patrolCount++;
          u.driver.control(car, dt, G);
          u.detectT -= dt;
          if (u.detectT <= 0 && !H.active) {
            u.detectT = 0.3;
            if (d < 85 && pl.speed > 26 && G.city.hasLOS(car.x, car.y, pl.x, pl.y)) H.start('SPEEDING');
          }
          if (d > 620 || u.driver.stuck > 8) { G.removeCar(car); G.cops.splice(i, 1); }
          break;
        }
        case 'pursue':
          Police.pursue(u, dt, G, d);
          // too far to matter: drop it, the heat manager respawns pursuers closer
          if (d > 420 && !u.los) { G.removeCar(car); G.cops.splice(i, 1); }
          break;
        case 'block': {
          const c = car.ctrl;
          c.throttle = 0; c.brake = 1; c.handbrake = 1; c.steer = 0; c.nitro = 0;
          u.blockT += dt;
          if (u.blockT > 8 && d > 260 && H.active) { u.state = 'pursue'; u.role = 'ram'; car.boost = 1.3; }
          else if (!H.active && d > 200) { Police.makePatrol(G, u); }
          if (d > 700) { G.removeCar(car); G.cops.splice(i, 1); }
          break;
        }
        case 'wrecked': {
          const c = car.ctrl;
          c.throttle = 0; c.brake = 0.4; c.handbrake = 0; c.steer = 0; c.nitro = 0;
          u.wreckT += dt;
          if (Math.random() < dt * 14) G.fx.smoke(car.x, car.y, 0, 0, 2.2, 0.5, true);
          if (u.wreckT > 14 || d > 700) { G.removeCar(car); G.cops.splice(i, 1); }
          break;
        }
      }
    }
    // ambient patrol population while no pursuit is running
    Police.ambientTimer -= dt;
    if (!H.active && Police.ambientTimer <= 0 && patrolCount < Police.ambientTarget) {
      Police.ambientTimer = 0.5;
      Police.spawnAmbient(G);
    }
  };

  Police.pursue = function (u, dt, G, dist) {
    const car = u.car, pl = G.player.car, H = G.heat, city = G.city;
    u.losT -= dt;
    if (u.losT <= 0) {
      u.losT = 0.15 + Math.random() * 0.05;
      u.los = dist < 280 && city.hasLOS(car.x, car.y, pl.x, pl.y);
    }
    const plSp = pl.speed;
    const fx = Math.cos(pl.theta), fy = Math.sin(pl.theta);
    const rx = -fy, ry = fx;
    let tx, ty, tspeed;
    car.boost = dist > 150 ? 1.3 : 1;
    u.pit = false;
    if (u.los || H.heliLit) {
      u.goal = undefined;
      const lead = clamp(dist / Math.max(18, car.speed + 8), 0, 1.3);
      let ix = pl.x + pl.wvx * lead * 0.7, iy = pl.y + pl.wvy * lead * 0.7;
      const relF = (car.x - pl.x) * fx + (car.y - pl.y) * fy;
      const relR = (car.x - pl.x) * rx + (car.y - pl.y) * ry;
      const closeIn = Math.min(30, 8 + dist * 0.25); // fast when far, gentle when near (matters for a slow player)
      tspeed = Math.max(plSp * 1.12 + 5, closeIn);
      if (u.role === 'flank') {
        ix += rx * u.side * 8; iy += ry * u.side * 8; tspeed = Math.max(plSp * 1.06 + 3, closeIn);
      } else if (u.role === 'block' && H.level >= 2) {
        ix = pl.x + pl.wvx * 2.2 + fx * 8; iy = pl.y + pl.wvy * 2.2 + fy * 8; tspeed = Math.max(9, plSp * 0.95);
      }
      if (H.level >= 3 && u.role === 'ram' && dist < 18 && relF < 2) {
        const s = relR >= 0 ? 1 : -1;
        ix = pl.x - fx * 1.8 + rx * s * 0.9; iy = pl.y - fy * 1.8 + ry * s * 0.9;
        tspeed = plSp + 6; u.pit = true;
      }
      if (relF > 1 && dist < 14 && u.role !== 'block') tspeed = Math.max(6, plSp * 0.75);
      tx = ix; ty = iy;
    } else {
      // no line of sight: follow the road graph to the last known position, then search nearby
      u.repath -= dt;
      if (!u.path || u.repath <= 0) {
        u.repath = 1.5;
        const s = city.nearestNode(car.x, car.y);
        // cops "hear" a nearby player: close ones head for the real position, far ones for the last sighting
        const g = u.goal !== undefined && dist > 220 ? u.goal : dist < 220 ? city.nearestNode(pl.x, pl.y) : city.nearestNode(H.lastX, H.lastY);
        u.path = HL.Nav.findPath(city, s, g) || [s];
        u.pi = 0;
        if (u.path.length > 1 && Math.hypot(city.nodeX(u.path[0]) - car.x, city.nodeY(u.path[0]) - car.y) < 18) u.pi = 1;
      }
      const last = u.path.length - 1;
      let nid = u.path[Math.min(u.pi, last)];
      let nx = city.nodeX(nid), ny = city.nodeY(nid);
      const advR = 10 + car.speed * 0.45;
      if (Math.hypot(nx - car.x, ny - car.y) < advR) {
        if (u.pi < last) { u.pi++; nid = u.path[u.pi]; nx = city.nodeX(nid); ny = city.nodeY(nid); }
        else if (Math.hypot(nx - car.x, ny - car.y) < 20) {
          // arrived: search a random node near the last known position
          const g = city.randomNode();
          if (Math.hypot(city.nodeX(g) - H.lastX, city.nodeY(g) - H.lastY) < 280) u.goal = g;
          u.repath = 0;
        }
      }
      tx = nx; ty = ny; tspeed = 42;
      if (u.pi < last) {
        const n2 = u.path[u.pi + 1];
        const ax = nx - car.x, ay = ny - car.y, bx = city.nodeX(n2) - nx, by = city.nodeY(n2) - ny;
        const cosA = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-6);
        if (cosA < 0.6) {
          // brake for the corner: v^2 = vCorner^2 + 2*a*(distance to brake)
          const dd = Math.hypot(ax, ay);
          tspeed = Math.min(tspeed, Math.sqrt(8.5 * 8.5 + 2 * 9 * Math.max(dd - 14, 0)));
        }
      } else tspeed = 14;
    }
    HL.Drive.steerTo(car, tx, ty);
    HL.Drive.speedTo(car, tspeed);
    HL.Drive.avoid(car, city);
    if (car.speed < 1.2 && dist > 6 && u.reverseT <= 0) u.stuckT += dt; else u.stuckT = Math.max(0, u.stuckT - dt);
    if (u.stuckT > 1.0) { u.reverseT = 1.2; u.stuckT = 0; }
    if (u.reverseT > 0) {
      u.reverseT -= dt;
      car.ctrl.throttle = 0; car.ctrl.brake = 1; car.ctrl.steer *= -1;
    }
  };
})();
