(function () {
  const HL = window.HL;
  const STEP = 1 / 120;
  const Loop = (HL.Loop = { paused: false, timeScale: 1, STEP });
  Loop.start = function (update, render) {
    let last = performance.now(), acc = 0;
    function frame(now) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      if (!Loop.paused) {
        acc += dt * Loop.timeScale;
        let n = 0;
        while (acc >= STEP && n++ < 12) { update(STEP); acc -= STEP; }
        if (acc > STEP * 2) acc = 0;
      }
      render(Loop.paused ? 1 : acc / STEP, dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };
})();
