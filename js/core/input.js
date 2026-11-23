(function () {
  const HL = window.HL;
  const keys = {};
  const once = {};
  const prevent = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
  addEventListener('keydown', (e) => {
    if (prevent.has(e.code)) e.preventDefault();
    if (!e.repeat) once[e.code] = true;
    keys[e.code] = true;
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const st = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
  const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

  function pad() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of gps) if (g && g.connected) return g;
    return null;
  }

  HL.Input = {
    keys,
    pressed(code) { const v = !!once[code]; once[code] = false; return v; },
    clearOnce() { for (const k in once) once[k] = false; },
    poll(dt) {
      const L = keys.ArrowLeft || keys.KeyA, R = keys.ArrowRight || keys.KeyD;
      const U = keys.ArrowUp || keys.KeyW, D = keys.ArrowDown || keys.KeyS;
      const target = (R ? 1 : 0) - (L ? 1 : 0);
      const flip = target !== 0 && st.steer !== 0 && Math.sign(target) !== Math.sign(st.steer);
      const rate = target === 0 ? 7 : flip ? 11 : 4.2;
      st.steer = approach(st.steer, target, rate * dt);
      st.throttle = approach(st.throttle, U ? 1 : 0, 8 * dt);
      st.brake = approach(st.brake, D ? 1 : 0, 10 * dt);
      st.handbrake = keys.Space ? 1 : 0;
      st.nitro = keys.ShiftLeft || keys.ShiftRight ? 1 : 0;
      const g = pad();
      if (g) {
        const ax = g.axes[0] || 0;
        if (Math.abs(ax) > 0.12) st.steer = ax;
        const rt = g.buttons[7] ? g.buttons[7].value : 0, lt = g.buttons[6] ? g.buttons[6].value : 0;
        if (rt > 0.05) st.throttle = Math.max(st.throttle, rt);
        if (lt > 0.05) st.brake = Math.max(st.brake, lt);
        if (g.buttons[0] && g.buttons[0].pressed) st.handbrake = 1;
        if ((g.buttons[2] && g.buttons[2].pressed) || (g.buttons[5] && g.buttons[5].pressed)) st.nitro = 1;
      }
      // on-screen controls (phones): steering is analog, the buttons are held
      const T = HL.Touch;
      if (T && T.active) {
        const ts = T.state;
        if (Math.abs(ts.steer) > 0.02) st.steer = ts.steer;
        if (ts.throttle) st.throttle = 1;
        if (ts.brake) st.brake = 1;
        if (ts.handbrake) st.handbrake = 1;
        if (ts.nitro) st.nitro = 1;
      }
      return st;
    },
  };
})();
