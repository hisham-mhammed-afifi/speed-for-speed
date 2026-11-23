(function () {
  const HL = window.HL;
  const clamp = HL.clamp;

  const HUD = (HL.HUD = { map: null, mapScale: 0.5, fps: 60 });

  HUD.init = function (city) {
    const b = city.bounds, k = HUD.mapScale;
    const w = Math.ceil((b.maxX - b.minX) * k), h = Math.ceil((b.maxY - b.minY) * k);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.fillStyle = '#4a4f58';
    x.fillRect(0, 0, w, h);
    x.scale(k, k);
    x.translate(-b.minX, -b.minY);
    for (const bl of city.blocks) {
      x.fillStyle = bl.type === 'park' ? '#25472c' : bl.type === 'plaza' ? '#3a3e45' : '#23272d';
      x.fillRect(bl.x0, bl.y0, bl.x1 - bl.x0, bl.y1 - bl.y0);
    }
    x.fillStyle = '#23272d';
    for (const bd of city.buildings) x.fillRect(bd.x0, bd.y0, bd.x1 - bd.x0, bd.y1 - bd.y0);
    HUD.map = cv; HUD.bounds = b;
  };

  function arc(ctx, cx, cy, r, a0, a1, lw, col) {
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke();
  }

  function star(ctx, cx, cy, r, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke();
  }

  function bar(ctx, x, y, w, h, frac, col, back) {
    ctx.fillStyle = back || 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }

  function speedo(ctx, G, cx, cy, r) {
    const pl = G.player.car, s = pl.spec;
    const kmh = pl.speed * 3.6;
    const A0 = Math.PI * 0.75, SW = Math.PI * 1.5, MAX = 320;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,0.62)';
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, 6.283); ctx.fill();
    arc(ctx, cx, cy, r, A0, A0 + SW, 5, 'rgba(255,255,255,0.15)');
    const f = clamp(kmh / MAX, 0, 1);
    arc(ctx, cx, cy, r, A0, A0 + SW * f, 5, f > 0.8 ? '#ff5a3c' : '#38d6ff');
    // ticks
    ctx.font = '600 ' + Math.round(r * 0.11) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= MAX; v += 20) {
      const a = A0 + (SW * v) / MAX, big = v % 40 === 0;
      const r0 = r - (big ? 14 : 9), r1 = r - 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineWidth = big ? 2 : 1; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
      if (big) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(String(v), cx + Math.cos(a) * (r - 27), cy + Math.sin(a) * (r - 27)); }
    }
    // rpm ring
    const rf = clamp(pl.rpm / s.redline, 0, 1.02);
    arc(ctx, cx, cy, r * 0.62, A0, A0 + SW, 7, 'rgba(255,255,255,0.1)');
    arc(ctx, cx, cy, r * 0.62, A0, A0 + SW * Math.min(1, rf), 7, rf > 0.88 ? '#ff3b3b' : rf > 0.72 ? '#ffb02e' : '#e9eef5');
    // needle
    const na = A0 + SW * f;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * (r - 10), cy + Math.sin(na) * (r - 10));
    ctx.lineWidth = 3; ctx.strokeStyle = '#ff5a3c'; ctx.stroke();
    // digits
    ctx.fillStyle = '#fff';
    ctx.font = '800 ' + Math.round(r * 0.34) + 'px "Segoe UI", sans-serif';
    ctx.fillText(String(Math.round(kmh)), cx, cy - r * 0.05);
    ctx.font = '600 ' + Math.round(r * 0.11) + 'px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('KM/H', cx, cy + r * 0.2);
    let gear = String(pl.gear);
    if (pl.reversing) gear = 'R'; else if (pl.speed < 0.5 && pl.ctrl.throttle < 0.05) gear = 'N';
    ctx.fillStyle = pl.shiftT > 0 ? '#ffb02e' : '#fff';
    ctx.font = '800 ' + Math.round(r * 0.26) + 'px "Segoe UI", sans-serif';
    ctx.fillText(gear, cx, cy + r * 0.45);
    ctx.restore();
    // bars
    const bx = cx - r, by = cy + r + 16, bw = r * 2;
    ctx.font = '700 10px "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('NITRO', bx, by - 3);
    bar(ctx, bx + 44, by - 9, bw - 44, 7, pl.nitro, pl.nitroOn ? '#9be7ff' : '#38b6ff');
    ctx.fillText('DMG', bx, by + 14);
    bar(ctx, bx + 44, by + 8, bw - 44, 7, pl.health / 100, pl.health > 50 ? '#7be08a' : pl.health > 25 ? '#ffb02e' : '#ff4a4a');
    if (pl.flat > 0) { ctx.fillStyle = '#ff4a4a'; ctx.fillText('FLAT TIRES ' + pl.flat.toFixed(0) + 's', bx, by + 32); }
  }

  // compact speed readout for phones (the round gauges are too big next to the touch buttons)
  function touchPanel(ctx, G, x, y, w) {
    const pl = G.player.car;
    const h = 58;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,0.62)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '800 28px "Segoe UI", sans-serif';
    const kmh = String(Math.round(pl.speed * 3.6));
    ctx.fillText(kmh, x + 10, y + 29);
    const tw = ctx.measureText(kmh).width;
    ctx.font = '700 10px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('KM/H', x + 14 + tw, y + 29);
    let gear = String(pl.gear);
    if (pl.reversing) gear = 'R'; else if (pl.speed < 0.5 && pl.ctrl.throttle < 0.05) gear = 'N';
    ctx.textAlign = 'right';
    ctx.fillStyle = pl.shiftT > 0 ? '#ffb02e' : '#fff';
    ctx.font = '800 22px "Segoe UI", sans-serif';
    ctx.fillText(gear, x + w - 10, y + 28);
    bar(ctx, x + 10, y + 38, w - 20, 5, pl.nitro, pl.nitroOn ? '#9be7ff' : '#38b6ff');
    bar(ctx, x + 10, y + 47, w - 20, 5, pl.health / 100, pl.health > 50 ? '#7be08a' : pl.health > 25 ? '#ffb02e' : '#ff4a4a');
    ctx.restore();
    if (pl.flat > 0) { ctx.fillStyle = '#ff4a4a'; ctx.font = '700 11px "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.fillText('FLAT TIRES ' + pl.flat.toFixed(0) + 's', x, y + h + 14); }
  }

  function minimap(ctx, G, cx, cy, r, cam) {
    const pl = G.player.car, H = G.heat;
    const range = 240, k = r / range;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.clip();
    ctx.fillStyle = '#101317'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.translate(cx, cy);
    ctx.rotate(cam.angle);
    ctx.scale(k, k);
    ctx.translate(-pl.x, -pl.y);
    const b = HUD.bounds;
    if (HUD.map) ctx.drawImage(HUD.map, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    const dot = (x, y, rad, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rad / k, 0, 6.283); ctx.fill(); };
    if (H.active && !H.visible) {
      ctx.strokeStyle = 'rgba(255,200,60,0.8)'; ctx.lineWidth = 1.5 / k; ctx.setLineDash([6 / k, 5 / k]);
      ctx.beginPath(); ctx.arc(H.lastX, H.lastY, 60, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const s of H.spikes) dot(s.x, s.y, 3, '#ffb02e');
    const blink = Math.floor(G.time * 6) % 2;
    for (const u of G.cops) {
      if (u.state === 'wrecked') continue;
      dot(u.car.x, u.car.y, 3.2, u.state === 'patrol' ? '#6a8fd6' : blink ? '#ff3b3b' : '#4a7dff');
    }
    if (H.heli) dot(H.heli.x, H.heli.y, 4.5, '#ffffff');
    // player arrow
    ctx.save();
    ctx.translate(pl.x, pl.y); ctx.rotate(pl.theta);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.moveTo(7 / k, 0); ctx.lineTo(-5 / k, 4.5 / k); ctx.lineTo(-3 / k, 0); ctx.lineTo(-5 / k, -4.5 / k); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.stroke();
  }

  HUD.draw = function (ctx, G, W, H, dt, cam) {
    const pl = G.player.car, heat = G.heat;
    HUD.fps += (1 / Math.max(dt, 0.001) - HUD.fps) * 0.05;
    const s = clamp(Math.min(W, H) / 760, 0.62, 1.2);
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    const touch = !!(HL.Touch && HL.Touch.active);
    const sf = HL.safe || { t: 0, r: 0, b: 0, l: 0 };
    const portrait = H > W;

    if (touch) {
      // phone layout: speed panel beside the pause/reset buttons (top-left), small minimap top-right
      touchPanel(ctx, G, sf.l + 64, sf.t + 10, 150);
      const mr = clamp(Math.min(W, H) * 0.16, 50, 78);
      minimap(ctx, G, W - sf.r - mr - 10, sf.t + mr + 10, mr, cam);
    } else {
      // gauges bottom-right
      const r = 92 * s;
      speedo(ctx, G, W - r - 28 * s, H - r - 62 * s, r);
      // minimap top-right
      const mr = 88 * s;
      minimap(ctx, G, W - mr - 20 * s, mr + 20 * s, mr, cam);
    }

    // heat stars + bounty (top center; on a portrait phone it drops below the speed panel row)
    const cx = W / 2, top = touch ? (portrait ? sf.t + 84 : sf.t + 8) : 18 * s;
    const flash = Math.floor(G.time * 4) % 2;
    for (let i = 0; i < 5; i++) {
      const lit = heat.active && i < heat.level;
      const fill = lit ? (flash ? '#ff3b3b' : '#4a7dff') : 'rgba(255,255,255,0.08)';
      star(ctx, cx + (i - 2) * 34 * s, top + 16 * s, 14 * s, fill, lit ? '#fff' : 'rgba(255,255,255,0.25)');
    }
    ctx.textAlign = 'center';
    ctx.font = '800 ' + Math.round(26 * s) + 'px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('$' + Math.floor(heat.active ? heat.bounty : 0).toLocaleString(), cx, top + 64 * s);
    ctx.font = '700 ' + Math.round(13 * s) + 'px "Segoe UI", sans-serif';
    if (!heat.active) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('FREE ROAM', cx, top + 84 * s);
    } else if (heat.visible) {
      ctx.fillStyle = flash ? '#ff6b6b' : '#7aa2ff';
      ctx.fillText('PURSUIT', cx, top + 84 * s);
    } else {
      ctx.fillStyle = '#7be08a';
      ctx.fillText('EVADING ' + Math.max(0, (heat.evadeNeeded - heat.evade)).toFixed(1) + 's', cx, top + 84 * s);
    }
    const bw = 220 * s;
    if (heat.active && heat.evade > 0.3) {
      bar(ctx, cx - bw / 2, top + 92 * s, bw, 7 * s, heat.evade / heat.evadeNeeded, '#7be08a');
    }
    if (heat.bust > 0.01) {
      ctx.fillStyle = '#ff4a4a'; ctx.fillText('BUSTED', cx, top + 118 * s);
      bar(ctx, cx - bw / 2, top + 124 * s, bw, 9 * s, heat.bust, '#ff4a4a');
    }

    // toasts (left)
    ctx.textAlign = 'left';
    ctx.font = '800 ' + Math.round(17 * s) + 'px "Segoe UI", sans-serif';
    for (let i = G.toasts.length - 1; i >= 0; i--) {
      const t = G.toasts[i];
      t.t += dt;
      if (t.t > 4) { G.toasts.splice(i, 1); continue; }
    }
    // toasts sit under the heat block on a portrait phone, under the pause buttons in landscape
    const toastX = touch ? sf.l + 12 : 16 * s;
    const toastY = touch ? (portrait ? top + 140 * s : sf.t + 120) : 20 * s;
    G.toasts.forEach((t, i) => {
      ctx.globalAlpha = clamp(4 - t.t, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      const w = ctx.measureText(t.text).width + 20;
      ctx.fillRect(toastX, toastY + i * 32 * s, w, 26 * s);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, toastX + 10 * s, toastY + (19 + i * 32) * s);
    });
    ctx.globalAlpha = 1;

    // hint
    if (touch && G.time < 14 && !heat.active) {
      ctx.textAlign = 'center';
      ctx.font = '700 14px "Segoe UI", sans-serif';
      const lines = ['Left thumb: drag to steer', 'Right thumb: GAS / BRAKE / DRIFT / NITRO', 'Speed past a cop or ram one to start a pursuit'];
      const bw2 = Math.min(W - 24, 330), by2 = H * 0.28; // above the car, which sits at screen centre
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W / 2 - bw2 / 2, by2, bw2, 84);
      lines.forEach((l, i) => { ctx.fillStyle = i === 2 ? '#ffd23f' : '#fff'; ctx.fillText(l, W / 2, by2 + 26 + i * 24, bw2 - 16); });
    } else if (!touch && G.time < 14 && !heat.active) {
      ctx.textAlign = 'left';
      ctx.font = '600 ' + Math.round(14 * s) + 'px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(16 * s, H - 70 * s, 470 * s, 54 * s);
      ctx.fillStyle = '#fff';
      ctx.fillText('W/S throttle-brake   A/D steer   SPACE handbrake   SHIFT nitro', 26 * s, H - 48 * s);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('Speed past a cop, ram one, or press H to start a pursuit', 26 * s, H - 26 * s);
    }

    if (HL.Renderer.debug) {
      ctx.font = '12px Consolas, monospace'; ctx.fillStyle = '#9f9'; ctx.textAlign = 'left';
      const lines = [
        'fps ' + HUD.fps.toFixed(0) + '  cars ' + G.cars.length + '  parts ' + HL.FX.parts.length,
        'v ' + pl.vx.toFixed(1) + ' / ' + pl.vy.toFixed(1) + ' m/s  yaw ' + pl.w.toFixed(2),
        'Matter.js bodies ' + HL.Phys.engine.world.bodies.length + '  sliding ' + (pl.sliding ? 'yes' : 'no'),
        'accel fwd ' + pl.aF.toFixed(1) + '  lat ' + pl.aL.toFixed(1) + ' m/s2  grip use ' + (pl.gripUse * 100).toFixed(0) + '%',
        'gear ' + pl.gear + '  rpm ' + pl.rpm.toFixed(0),
        'surface ' + pl.surfaceKind + '  skid ' + pl.skid.toFixed(2),
        'heat ' + heat.level + ' pts ' + heat.points.toFixed(0) + ' evade ' + heat.evade.toFixed(1),
      ];
      lines.forEach((l, i) => ctx.fillText(l, 16, 150 + i * 15));
    }
    ctx.restore();
  };
})();
