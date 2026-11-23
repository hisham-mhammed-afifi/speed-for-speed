(function () {
  const HL = (window.HL = window.HL || {});
  HL.TAU = Math.PI * 2;
  HL.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  HL.lerp = (a, b, t) => a + (b - a) * t;
  HL.wrapAngle = (a) => {
    while (a > Math.PI) a -= HL.TAU;
    while (a < -Math.PI) a += HL.TAU;
    return a;
  };
  HL.damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  HL.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  HL.rand = (a, b) => a + Math.random() * (b - a);
  HL.pick = (arr) => arr[(Math.random() * arr.length) | 0];
})();
