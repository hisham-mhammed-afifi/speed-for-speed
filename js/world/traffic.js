(function () {
  const HL = window.HL;
  const clamp = HL.clamp;

  // Follows the road graph, one lane edge at a time (right-hand traffic). Used by civilians and patrol cops.
  class LaneDriver {
    constructor(city, a, b) {
      this.city = city; this.a = a; this.b = b; this.next = -1;
      this.speedCap = 12; this.stuck = 0; this.turnSlow = false;
    }
    pickNext() {
      const city = this.city;
      let nb = city.neighbors(this.b).filter((n) => n !== this.a);
      if (!nb.length) nb = [this.a];
      const ax = city.nodeX(this.a), ay = city.nodeY(this.a), bx = city.nodeX(this.b), by = city.nodeY(this.b);
      const straight = nb.find((n) => Math.abs((city.nodeX(n) - bx) * (by - ay) - (city.nodeY(n) - by) * (bx - ax)) < 1);
      return straight !== undefined && Math.random() < 0.55 ? straight : nb[(Math.random() * nb.length) | 0];
    }
    control(car, dt, G) {
      const city = this.city;
      let pa = { x: city.nodeX(this.a), y: city.nodeY(this.a) }, pb = { x: city.nodeX(this.b), y: city.nodeY(this.b) };
      let dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
      let ux = dx / len, uy = dy / len;
      let t = (car.x - pa.x) * ux + (car.y - pa.y) * uy;
      let toEnd = len - t;
      if (toEnd < 45 && this.next < 0) {
        this.next = this.pickNext();
        const cx = city.nodeX(this.next) - pb.x, cy = city.nodeY(this.next) - pb.y;
        this.turnSlow = Math.abs(cx * ux + cy * uy) < 1; // 90 degree turn
        this.turnSlow = Math.abs(cx * ux + cy * uy) < 0.5 * Math.hypot(cx, cy);
      }
      if (toEnd < city.nodeHalfWidth(this.b) * 0.6 + 3 && this.next >= 0) {
        this.a = this.b; this.b = this.next; this.next = -1; this.turnSlow = false;
        pa = { x: city.nodeX(this.a), y: city.nodeY(this.a) }; pb = { x: city.nodeX(this.b), y: city.nodeY(this.b) };
        dx = pb.x - pa.x; dy = pb.y - pa.y; len = Math.hypot(dx, dy) || 1; ux = dx / len; uy = dy / len;
        t = (car.x - pa.x) * ux + (car.y - pa.y) * uy; toEnd = len - t;
      }
      const w = city.edgeWidth(this.a, this.b);
      const off = w * 0.25;
      const la = clamp(6 + car.speed * 0.55, 7, 20);
      const tt = Math.min(Math.max(t, 0) + la, len);
      const tx = pa.x + ux * tt - uy * off, ty = pa.y + uy * tt + ux * off;
      HL.Drive.steerTo(car, tx, ty);
      let target = this.speedCap * (w >= 24 ? 1.3 : w <= 8 ? 0.6 : 1);
      if (this.turnSlow && toEnd < 40) target = Math.min(target, 6.5);
      target = HL.Drive.capForTraffic(car, G.cars, target);
      HL.Drive.speedTo(car, target);
      if (HL.Drive.avoid(car, city)) car.ctrl.steer = car.ctrl.steer;
      // stuck detection
      if (car.speed < 0.6 && target > 2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    }
  }
  HL.LaneDriver = LaneDriver;

  HL.Traffic = {
    target: 22,
    timer: 0,
    // civilians
    update(dt, G) {
      this.timer -= dt;
      const pl = G.player.car;
      for (let i = G.civs.length - 1; i >= 0; i--) {
        const u = G.civs[i], car = u.car;
        u.driver.control(car, dt, G);
        const d = Math.hypot(car.x - pl.x, car.y - pl.y);
        if (d > 560 || u.driver.stuck > 7 || car.health <= 0) {
          if (car.health <= 0 && d < 120) { car.ctrl.throttle = 0; car.ctrl.brake = 0.4; u.dead = (u.dead || 0) + dt; if (u.dead < 8) continue; }
          G.removeCar(car); G.civs.splice(i, 1);
        }
      }
      if (this.timer <= 0 && G.civs.length < this.target) {
        this.timer = 0.25;
        this.spawn(G);
      }
    },
    spawn(G) {
      const city = G.city, pl = G.player.car;
      for (let tries = 0; tries < 8; tries++) {
        const n = city.randomNode();
        const nx = city.nodeX(n), ny = city.nodeY(n);
        const d = Math.hypot(nx - pl.x, ny - pl.y);
        if (d < 200 || d > 430) continue;
        const nb = city.neighbors(n);
        const to = nb[(Math.random() * nb.length) | 0];
        const t = 0.25 + Math.random() * 0.4;
        const p = city.lanePoint(n, to, t);
        if (!G.spotFree(p.x, p.y, 12)) continue;
        const spec = HL.pick(HL.PLAYER_CARS);
        const car = G.spawnCar(spec, p.x, p.y, Math.atan2(p.uy, p.ux), 'civil');
        car.setSpeed(8);
        const drv = new LaneDriver(city, n, to);
        drv.speedCap = 9 + Math.random() * 6;
        G.civs.push({ car, driver: drv });
        return;
      }
    },
  };
})();
