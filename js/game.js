(function () {
  const HL = window.HL;
  const G = (HL.G = {
    state: 'loading', cars: [], civs: [], cops: [], city: null, player: null, time: 0, toasts: [],
    fx: HL.FX, heat: HL.Heat, carIndex: 0,
    save: { best: 0, total: 0, longest: 0, car: 0 },
  });
  const params = new URLSearchParams(location.search);
  let canvas, ctx, W = 800, H = 600, dpr = 1, titleT = 0;

  // ---------- persistence ----------
  function loadSave() {
    try { const s = JSON.parse(localStorage.getItem('heatline.v1')); if (s) Object.assign(G.save, s); } catch (e) { /* ignore */ }
  }
  function writeSave() {
    try { localStorage.setItem('heatline.v1', JSON.stringify(G.save)); } catch (e) { /* ignore */ }
  }

  // ---------- world helpers ----------
  G.spawnCar = function (spec, x, y, theta, kind) {
    const car = new HL.Car(spec, kind);
    HL.Phys.addCar(car);
    car.place(x, y, theta);
    G.cars.push(car);
    return car;
  };
  G.removeCar = function (car) {
    const i = G.cars.indexOf(car);
    if (i >= 0) G.cars.splice(i, 1);
    HL.Phys.removeCar(car);
  };
  G.spotFree = function (x, y, r) {
    for (let i = 0; i < G.cars.length; i++) if (Math.hypot(G.cars[i].x - x, G.cars[i].y - y) < r) return false;
    return !G.city.pointInBuilding(x, y);
  };
  G.toast = function (text, color) {
    G.toasts.push({ text, color: color || '#fff', t: 0 });
    if (G.toasts.length > 5) G.toasts.shift();
  };
  G.shake = function (a) { HL.Camera.addShake(a); };

  // ---------- run control ----------
  G.startGame = function (idx) {
    G.carIndex = idx;
    G.save.car = idx; writeSave();
    G.cars.length = 0; G.civs.length = 0; G.cops.length = 0;
    HL.Phys.reset();
    HL.FX.clearSkids();
    HL.Heat.reset();
    const city = G.city;
    const n = city.nodeId(8, 8), nb = city.neighbors(n);
    const to = nb[0];
    const p = city.lanePoint(n, to, 0.5);
    const spec = HL.PLAYER_CARS[idx];
    const car = G.spawnCar(spec, p.x, p.y, Math.atan2(p.uy, p.ux), 'player');
    G.player = { car, spec };
    G.time = 0; G.toasts = [];
    HL.Camera.snap();
    for (let i = 0; i < 40 && G.civs.length < 18; i++) HL.Traffic.spawn(G);
    for (let i = 0; i < 12; i++) HL.Police.spawnAmbient(G);
    G.state = 'play';
    HL.Loop.paused = false;
    HL.Menus.hideAll();
    HL.Input.clearOnce();
    const lvl = parseInt(params.get('heat'), 10);
    if (lvl >= 1) HL.Heat.start('DEBUG', Math.min(5, lvl));
  };

  G.endRun = function (kind) {
    if (G.state !== 'play') return;
    const H = HL.Heat;
    const st = { time: H.time, level: H.level, copsDown: H.copsDown, bounty: H.bounty, best: G.save.best };
    if (kind === 'escaped') {
      G.save.total += Math.floor(H.bounty);
      G.save.best = Math.max(G.save.best, Math.floor(H.bounty));
      G.save.longest = Math.max(G.save.longest, Math.floor(H.time));
      st.best = G.save.best;
      writeSave();
    }
    G.state = 'result';
    G.lastResult = kind;
    HL.Loop.paused = true;
    HL.Menus.showResult(kind, st);
  };

  G.continueAfterEscape = function () {
    const pl = G.player.car;
    HL.Heat.stop();
    pl.health = 100; pl.flat = 0; pl.nitro = 1;
    G.state = 'play';
    HL.Loop.paused = false;
    HL.Menus.hideAll();
    G.toast('You lost them. Drive on.', '#7be08a');
  };

  G.togglePause = function () {
    if (G.state === 'play') {
      G.state = 'paused'; HL.Loop.paused = true;
      HL.Menus.refreshPause(); HL.Menus.show('pause');
    } else if (G.state === 'paused') {
      G.state = 'play'; HL.Loop.paused = false; HL.Menus.hideAll();
    }
  };

  function resetCar() {
    const c = G.player.car, city = G.city;
    const horiz = Math.abs(Math.cos(c.theta)) > Math.abs(Math.sin(c.theta));
    if (horiz) {
      let bj = 0, bd = 1e9;
      for (let j = 0; j < city.NH; j++) { const d = Math.abs(city.hy[j] - c.y); if (d < bd) { bd = d; bj = j; } }
      c.place(c.x, city.hy[bj] + (Math.cos(c.theta) > 0 ? 1 : -1) * city.hw[bj] * 0.25, Math.cos(c.theta) > 0 ? 0 : Math.PI);
    } else {
      let bi = 0, bd = 1e9;
      for (let i = 0; i < city.NV; i++) { const d = Math.abs(city.vx[i] - c.x); if (d < bd) { bd = d; bi = i; } }
      const down = Math.sin(c.theta) > 0;
      c.place(city.vx[bi] - (down ? 1 : -1) * city.vw[bi] * 0.25, c.y, down ? Math.PI / 2 : -Math.PI / 2);
    }
    HL.Camera.snap();
  }

  G.resetCar = resetCar; // used by the touch overlay's reset button

  // ---------- collisions (reported by Matter.js, see js/physics/world.js) ----------
  // a, b: game cars or null for buildings/walls; dvA, dvB: velocity change of each car (m/s)
  G.onImpact = function (a, b, dvA, dvB, x, y, nx, ny) {
    if (G.state !== 'play') return;
    const H = HL.Heat;
    const worst = Math.max(dvA, dvB);
    if (worst > 1.5) HL.FX.impact(x, y, nx, ny, worst);
    // short per-car cooldown so one crash (contact, bounce, re-contact) only damages once
    const hurt = (car, dv) => {
      if (!car || dv <= 3 || G.time - (car.lastHit || -1) < 0.25) return;
      car.lastHit = G.time;
      car.health = Math.max(0, car.health - ((dv - 3) * 2.2) / car.spec.durability);
    };
    hurt(a, dvA); hurt(b, dvB);
    const pl = G.player.car;
    if (a === pl || b === pl) {
      const dv = a === pl ? dvA : dvB;
      if (dv > 2) HL.Camera.addShake(Math.min(0.9, dv / 20));
      const other = a === pl ? b : a;
      if (!other) return;
      if (other.kind === 'police' && !H.active && dv > 1) H.start('COLLISION');
      else if (other.kind === 'civil' && dv > 3) {
        if (H.active) H.onCivilCrash();
        else if (G.cops.some((u) => u.state === 'patrol' && Math.hypot(u.car.x - pl.x, u.car.y - pl.y) < 140 && G.city.hasLOS(u.car.x, u.car.y, pl.x, pl.y))) H.start('RECKLESS DRIVING');
      }
    }
  };

  // ---------- main update ----------
  function update(dt) {
    if (G.state !== 'play') return;
    G.time += dt;
    const pl = G.player.car, city = G.city;
    const ctl = HL.Input.poll(dt);
    const pc = pl.ctrl;
    pc.throttle = ctl.throttle; pc.brake = ctl.brake; pc.steer = ctl.steer; pc.handbrake = ctl.handbrake; pc.nitro = ctl.nitro;
    // Matter.js step: controls -> forces, integrate + resolve collisions, read state back
    for (let i = 0; i < G.cars.length; i++) {
      const c = G.cars[i];
      c.applyControls(dt, city.surfaceAt(c.x, c.y));
    }
    HL.Phys.step(dt);
    for (let i = 0; i < G.cars.length; i++) G.cars[i].readBack();
    if (G.state !== 'play') return; // an impact may have ended the run
    HL.Traffic.update(dt, G);
    HL.Police.update(dt, G);
    HL.Heat.update(dt, G);
    for (let i = 0; i < G.cars.length; i++) {
      const c = G.cars[i];
      if (Math.abs(c.x - pl.x) < 90 && Math.abs(c.y - pl.y) < 90) HL.FX.carEffects(c, dt);
    }
    HL.FX.update(dt);
    if (pl.health <= 0 && G.state === 'play') G.endRun('wrecked');
  }

  G.update = update; // exposed for headless testing

  function handleKeys() {
    const I = HL.Input;
    if (I.pressed('KeyP') || I.pressed('Escape')) G.togglePause();
    if (I.pressed('F3')) HL.Renderer.debug = !HL.Renderer.debug;
    if (G.state !== 'play') { I.clearOnce(); return; }
    if (I.pressed('KeyC')) HL.Camera.mode = HL.Camera.mode === 'north' ? 'heading' : 'north';
    if (I.pressed('KeyR')) resetCar();
    if (I.pressed('KeyH') && !HL.Heat.active) HL.Heat.start('MANUAL', 1);
    for (let n = 1; n <= 5; n++) {
      if (I.pressed('Digit' + n) && params.has('debug')) { if (HL.Heat.active) HL.Heat.points = [0, 45, 110, 190, 290][n - 1] + 0.01; else HL.Heat.start('DEBUG', n); }
    }
  }

  function render(alpha, dt) {
    handleKeys();
    HL.Touch.update(G);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, W, H);
    const cam = HL.Camera;
    if (G.player && (G.state === 'play' || G.state === 'paused' || G.state === 'result')) {
      cam.update(dt, G.player.car, alpha, W, H);
      cam.begin(ctx, W, H);
      HL.Renderer.drawWorld(ctx, cam, G, alpha);
      cam.end(ctx);
      HL.HUD.draw(ctx, G, W, H, dt, cam);
    } else if (G.city) {
      // menu backdrop: slow flyover
      titleT += dt;
      cam.x = 900 + Math.cos(titleT * 0.05) * 500; cam.y = 900 + Math.sin(titleT * 0.04) * 400;
      cam.angle = 0; cam.view = 110; cam.scale = Math.min(W, H) / cam.view; cam.shake = 0;
      cam.begin(ctx, W, H);
      G.time += dt;
      HL.Renderer.drawWorld(ctx, cam, G, 1);
      cam.end(ctx);
      ctx.fillStyle = 'rgba(5,7,10,0.55)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // notch / home-bar insets (CSS env() values read back in px, so the canvas HUD can stay clear of them)
  let safeProbe = null;
  function readSafeArea() {
    if (!safeProbe) {
      safeProbe = document.createElement('div');
      safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      document.body.appendChild(safeProbe);
    }
    const cs = getComputedStyle(safeProbe);
    HL.safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }
  HL.safe = { t: 0, r: 0, b: 0, l: 0 };

  function resize() {
    // phones are often 3x DPR; 1.5x looks the same in motion for a fraction of the pixels
    dpr = Math.min(window.devicePixelRatio || 1, HL.Touch && HL.Touch.active ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    readSafeArea();
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }

  function init() {
    canvas = document.getElementById('c');
    ctx = canvas.getContext('2d');
    resize();
    addEventListener('resize', resize);
    loadSave();
    HL.Menus.index = Math.min(G.save.car || 0, HL.PLAYER_CARS.length - 1);
    HL.Renderer.init(ctx);
    HL.Heat.reset();
    HL.Menus.init();
    HL.Touch.onChange = resize; // switching between touch and keyboard changes the resolution cap
    HL.Touch.init();
    resize();
    // a phone call or app switch must not leave you driving blind into a bust
    document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') G.togglePause(); });
    HL.Menus.show('loading');
    const bar = document.getElementById('load-bar');
    HL.Assets.load(HL.ALL_CAR_FILES, (p) => { bar.style.width = Math.round(p * 100) + '%'; }).then(() => {
      G.city = new HL.City();
      HL.Phys.init(G.city);
      HL.HUD.init(G.city);
      G.state = 'title';
      HL.Loop.start(update, render);
      if (params.has('auto')) {
        const ci = parseInt(params.get('car'), 10);
        G.startGame(isNaN(ci) ? HL.Menus.index : Math.max(0, Math.min(HL.PLAYER_CARS.length - 1, ci)));
      } else {
        HL.Menus.show('title');
      }
    });
  }
  window.addEventListener('load', init);
})();
