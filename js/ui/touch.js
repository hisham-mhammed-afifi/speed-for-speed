(function () {
  const HL = window.HL;
  const clamp = HL.clamp;
  const $ = (id) => document.getElementById(id);

  // On-screen controls for phones: a drag-to-steer pad on the left, gas / brake / drift / nitro on the right.
  // Everything funnels into HL.Touch.state, which HL.Input.poll() merges with keyboard and gamepad input.
  const T = (HL.Touch = {
    active: false,
    onChange: null,
    state: { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 },
  });

  const STEER_RANGE = 70; // px of thumb travel for full lock
  const pad = { id: null, x0: 0 };
  const held = {}; // field -> Set of pointer ids holding it
  let root, padEl, baseEl, knobEl;

  function setActive(on) {
    if (T.active === on) return;
    T.active = on;
    document.body.classList.toggle('touch', on);
    if (T.onChange) T.onChange();
  }

  function releaseAll() {
    const s = T.state;
    s.throttle = s.brake = s.steer = s.handbrake = s.nitro = 0;
    pad.id = null;
    for (const k in held) held[k].clear();
    for (const el of document.querySelectorAll('#touch .tbtn.down')) el.classList.remove('down');
    if (baseEl) { baseEl.classList.remove('on'); knobEl.classList.remove('on'); }
  }

  function bindButton(id, field) {
    const el = $(id);
    held[field] = new Set();
    const down = (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      held[field].add(e.pointerId);
      T.state[field] = 1;
      el.classList.add('down');
    };
    const up = (e) => {
      held[field].delete(e.pointerId);
      if (!held[field].size) { T.state[field] = 0; el.classList.remove('down'); }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  T.init = function () {
    root = $('touch'); padEl = $('t-pad'); baseEl = $('t-base'); knobEl = $('t-knob');
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (coarse) setActive(true);
    // a finger on a hybrid laptop turns touch controls on; a physical key press turns them off again
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setActive(true); }, { passive: true });
    addEventListener('keydown', () => { if (!coarse) setActive(false); });

    // steering pad: slide the thumb left / right from wherever it lands
    padEl.addEventListener('pointerdown', (e) => {
      if (pad.id !== null) return;
      e.preventDefault();
      pad.id = e.pointerId; pad.x0 = e.clientX;
      try { padEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      for (const el of [baseEl, knobEl]) { el.style.left = e.clientX + 'px'; el.style.top = e.clientY + 'px'; el.classList.add('on'); }
      knobEl.style.transform = 'translate(-50%,-50%)';
    });
    padEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pad.id) return;
      const dx = e.clientX - pad.x0;
      T.state.steer = clamp(dx / STEER_RANGE, -1, 1);
      knobEl.style.transform = `translate(calc(-50% + ${clamp(dx, -STEER_RANGE, STEER_RANGE)}px),-50%)`;
    });
    const padUp = (e) => {
      if (e.pointerId !== pad.id) return;
      pad.id = null; T.state.steer = 0;
      baseEl.classList.remove('on'); knobEl.classList.remove('on');
    };
    padEl.addEventListener('pointerup', padUp);
    padEl.addEventListener('pointercancel', padUp);
    padEl.addEventListener('lostpointercapture', padUp);

    bindButton('t-gas', 'throttle');
    bindButton('t-brake', 'brake');
    bindButton('t-drift', 'handbrake');
    bindButton('t-nitro', 'nitro');

    $('t-pause').addEventListener('click', () => HL.G.togglePause());
    $('t-reset').addEventListener('click', () => HL.G.resetCar());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari: stop the pinch-zoom gesture
    for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault());
  };

  // called every frame: controls only exist while driving
  T.update = function (G) {
    const on = T.active && G.state === 'play';
    if (root.classList.contains('show') !== on) {
      root.classList.toggle('show', on);
      if (!on) releaseAll();
    }
  };

  // landscape fullscreen makes the game feel native on Android; iOS ignores both calls and still plays fine
  T.goFullscreen = function () {
    if (!T.active) return;
    try {
      const el = document.documentElement;
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (p && p.then) {
        p.then(() => {
          try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ }
        }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  };
})();
