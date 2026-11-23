(function () {
  const HL = window.HL;
  const clamp = HL.clamp;

  HL.Camera = {
    x: 0, y: 0, view: 52, scale: 20, angle: 0, shake: 0, mode: 'north', init: false,
    vis: { x0: 0, y0: 0, x1: 0, y1: 0 },
    snap() { this.init = false; },
    addShake(a) { this.shake = Math.min(1, this.shake + a); },
    update(dt, pl, alpha, W, H) {
      const px = pl.px + (pl.x - pl.px) * alpha, py = pl.py + (pl.y - pl.py) * alpha;
      const lx = clamp(pl.wvx * 0.3, -16, 16), ly = clamp(pl.wvy * 0.3, -16, 16);
      const tx = px + lx, ty = py + ly;
      const view = 34 + 36 * clamp(pl.speed / 62, 0, 1);
      const targetAngle = this.mode === 'heading' ? -Math.PI / 2 - (pl.pth + HL.wrapAngle(pl.theta - pl.pth) * alpha) : 0;
      if (!this.init) {
        this.x = tx; this.y = ty; this.view = view; this.angle = targetAngle; this.init = true;
      }
      this.x = HL.damp(this.x, tx, 7, dt);
      this.y = HL.damp(this.y, ty, 7, dt);
      this.view = HL.damp(this.view, view, 1.4, dt);
      this.angle += HL.wrapAngle(targetAngle - this.angle) * (1 - Math.exp(-5 * dt));
      this.scale = H / this.view;
      this.shake *= Math.exp(-5 * dt);
    },
    begin(ctx, W, H) {
      ctx.save();
      const s = this.scale;
      const sx = (Math.random() - 0.5) * this.shake * 26, sy = (Math.random() - 0.5) * this.shake * 26;
      ctx.translate(W / 2 + sx, H / 2 + sy);
      ctx.rotate(this.angle);
      ctx.scale(s, s);
      ctx.translate(-this.x, -this.y);
      const r = Math.hypot(W, H) / 2 / s + 6;
      const v = this.vis;
      v.x0 = this.x - r; v.x1 = this.x + r; v.y0 = this.y - r; v.y1 = this.y + r;
    },
    end(ctx) { ctx.restore(); },
  };
})();
