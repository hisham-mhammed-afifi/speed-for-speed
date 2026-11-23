(function () {
  const HL = window.HL;
  const $ = (id) => document.getElementById(id);
  const Menus = (HL.Menus = { index: 0 });

  Menus.show = function (id) {
    for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
  };
  Menus.hideAll = function () { Menus.show(null); };

  function statBar(label, frac, text) {
    return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round(Math.max(0.06, Math.min(1, frac)) * 100)}%"></i></div><b>${text}</b></div>`;
  }

  Menus.renderSelect = function () {
    const spec = HL.PLAYER_CARS[Menus.index];
    const e = spec._est || (spec._est = HL.estimate(spec));
    const handling = ((spec.muF + spec.muR) / 2) * 10 - (spec.h - 0.46) * 10 - (spec.mass - 1500) / 400;
    $('car-img').src = spec.file;
    $('car-name').textContent = spec.name;
    $('car-cls').textContent = spec.cls + (spec.awd ? ' - AWD' : ' - RWD');
    $('car-stats').innerHTML =
      statBar('Top speed', (e.top - 45) / 28, Math.round(e.top * 3.6) + ' km/h') +
      statBar('Acceleration', (7.5 - e.t100) / 4, e.t100.toFixed(1) + 's 0-100') +
      statBar('Handling', (handling - 5) / 6.5, '') +
      statBar('Durability', (spec.durability - 0.7) / 0.9, '') +
      statBar('Weight', (spec.mass - 1400) / 900, spec.mass + ' kg');
    $('car-count').textContent = Menus.index + 1 + ' / ' + HL.PLAYER_CARS.length;
  };

  Menus.step = function (d) {
    const n = HL.PLAYER_CARS.length;
    Menus.index = (Menus.index + d + n) % n;
    Menus.renderSelect();
  };

  Menus.showResult = function (kind, st) {
    const t = $('res-title');
    t.textContent = kind === 'escaped' ? 'ESCAPED' : kind === 'busted' ? 'BUSTED' : 'WRECKED';
    t.className = kind;
    const mins = Math.floor(st.time / 60), secs = Math.floor(st.time % 60).toString().padStart(2, '0');
    $('res-stats').innerHTML =
      `<div><span>Pursuit time</span><b>${mins}:${secs}</b></div>` +
      `<div><span>Heat level reached</span><b>${st.level}</b></div>` +
      `<div><span>Cops wrecked</span><b>${st.copsDown}</b></div>` +
      `<div><span>Bounty</span><b>${kind === 'escaped' ? '+' : 'lost '}$${Math.floor(st.bounty).toLocaleString()}</b></div>` +
      `<div><span>Best bounty</span><b>$${Math.floor(st.best).toLocaleString()}</b></div>`;
    $('res-continue').style.display = kind === 'escaped' ? '' : 'none';
    $('res-retry').style.display = kind === 'escaped' ? 'none' : '';
    Menus.show('result');
  };

  Menus.refreshPause = function () {
    const G = HL.G;
    $('p-cam').textContent = 'Camera: ' + (HL.Camera.mode === 'north' ? 'North up' : 'Heading up');
    $('p-debug').textContent = 'Debug overlay: ' + (HL.Renderer.debug ? 'On' : 'Off');
  };

  Menus.init = function () {
    const G = HL.G;
    $('btn-play').onclick = () => { Menus.show('select'); Menus.renderSelect(); };
    $('btn-help').onclick = () => Menus.show('help');
    $('btn-help-back').onclick = () => Menus.show('title');
    $('btn-sel-back').onclick = () => Menus.show('title');
    $('btn-prev').onclick = () => Menus.step(-1);
    $('btn-next').onclick = () => Menus.step(1);
    $('btn-drive').onclick = () => G.startGame(Menus.index);
    $('p-resume').onclick = () => G.togglePause();
    $('p-cam').onclick = () => { HL.Camera.mode = HL.Camera.mode === 'north' ? 'heading' : 'north'; Menus.refreshPause(); };
    $('p-debug').onclick = () => { HL.Renderer.debug = !HL.Renderer.debug; Menus.refreshPause(); };
    $('p-restart').onclick = () => G.startGame(G.carIndex);
    $('p-cars').onclick = () => { G.state = 'title'; G.player = null; HL.Loop.paused = false; Menus.show('select'); Menus.renderSelect(); };
    $('res-continue').onclick = () => G.continueAfterEscape();
    $('res-retry').onclick = () => G.startGame(G.carIndex);
    $('res-cars').onclick = () => { G.state = 'title'; G.player = null; HL.Loop.paused = false; Menus.show('select'); Menus.renderSelect(); };
    addEventListener('keydown', (e) => {
      if (!$('select').classList.contains('hidden')) {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') Menus.step(-1);
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') Menus.step(1);
        else if (e.code === 'Enter') G.startGame(Menus.index);
      } else if (!$('title').classList.contains('hidden') && e.code === 'Enter') {
        Menus.show('select'); Menus.renderSelect();
      }
    });
  };
})();
