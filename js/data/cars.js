(function () {
  const HL = window.HL;

  // Arcade specs for the Matter.js car model (js/physics/car.js).
  //   top: top speed (m/s)          accel: acceleration from standstill (m/s^2), fades to 0 at top speed
  //   grip: max lateral accel (m/s^2) before the car slides     gripRate: how fast sideways motion is cancelled (1/s)
  //   turnRadius0: turning radius at low speed (m)              steerResp: how quickly yaw follows the wheel (1/s)
  const base = {
    len: 4.72, hitW: 1.86, mass: 1700,
    top: 70, accel: 6.8, brakeDecel: 11, grip: 11.5, gripRate: 12, turnRadius0: 5.5, steerResp: 9,
    durability: 1, nitroPower: 1.4, awd: false, redline: 7000,
  };
  const mk = (o) => Object.assign({}, base, o);
  const kmh = (v) => v / 3.6;

  HL.PLAYER_CARS = [
    mk({ id: 'silver', name: 'Silver GT', cls: 'Grand Tourer', file: 'cars/LS20261123150654.png', mass: 1740, top: kmh(256), accel: 6.8, grip: 11.5 }),
    mk({ id: 'rose', name: 'Rose Coupe', cls: 'Coupe', file: 'cars/LS20261123150716.png', mass: 1700, top: kmh(241), accel: 6.6, grip: 11.2 }),
    mk({ id: 'blacksuv', name: 'Black Enforcer SUV', cls: 'Heavy SUV', file: 'cars/LS20261123150746.png', len: 4.95, hitW: 1.98,
      mass: 2150, top: kmh(209), accel: 6.9, grip: 10, turnRadius0: 6.2, steerResp: 7.5, awd: true, durability: 1.45, redline: 6500 }),
    mk({ id: 'bluecross', name: 'Blue Crossover', cls: 'Crossover', file: 'cars/LS20261123150828.png', len: 4.85, hitW: 1.94,
      mass: 2000, top: kmh(216), accel: 7.0, grip: 10.4, turnRadius0: 6, steerResp: 8, awd: true, durability: 1.3, redline: 6600 }),
    mk({ id: 'red', name: 'Red Fury', cls: 'Sport Coupe', file: 'cars/LS20261123150904.png', mass: 1600, top: kmh(266), accel: 7.1, grip: 12, durability: 0.9 }),
    mk({ id: 'green', name: 'Green Apex', cls: 'Sport Coupe', file: 'cars/LS20261123150914.png', mass: 1620, top: kmh(245), accel: 7.1, grip: 12.5, steerResp: 10, durability: 0.95 }),
    mk({ id: 'white', name: 'White Lightning', cls: 'Rear-Engine Sport', file: 'cars/LS20261123150933.png', len: 4.55, hitW: 1.84,
      mass: 1550, top: kmh(270), accel: 7.5, grip: 12.3, turnRadius0: 5.2, steerResp: 10, durability: 0.9 }),
    mk({ id: 'orange', name: 'Orange Blaze', cls: 'Rear-Engine Sport', file: 'cars/LS20261123150943.png', len: 4.55, hitW: 1.84,
      mass: 1580, top: kmh(266), accel: 7.2, grip: 11.8, turnRadius0: 5.2, steerResp: 10.5, durability: 0.9 }),
    mk({ id: 'graphite', name: 'Graphite GT', cls: 'Grand Tourer', file: 'cars/LS20261123150955.png', mass: 1800, top: kmh(238), accel: 6.4, grip: 11, durability: 1.1 }),
  ];

  HL.POLICE_SPEC = mk({ id: 'police', name: 'Interceptor', cls: 'Police', file: 'cars/1795439954041.png', mass: 1750, top: kmh(256), accel: 6.9, grip: 11.6, durability: 1.15, police: true });
  HL.POLICE_HEAVY = mk({ id: 'police_heavy', name: 'Heavy Interceptor', cls: 'Police', file: 'cars/1795439954041.png', len: 4.9, mass: 2000, top: kmh(240), accel: 6.6, grip: 11, durability: 1.6, police: true, heavy: true });

  HL.ALL_CAR_FILES = Array.from(new Set(HL.PLAYER_CARS.map((c) => c.file).concat([HL.POLICE_SPEC.file])));

  // Stats for the car-select screen: integrate the same drive formula the car uses.
  HL.estimate = function (s) {
    const traction = s.grip * (s.awd ? 1 : 0.8);
    let v = 0, t = 0;
    while (v < 27.8 && t < 20) {
      const r = v / s.top;
      v += Math.min(traction, s.accel * Math.max(0, 1 - r * r)) * 0.01;
      t += 0.01;
    }
    return { top: s.top, t100: t };
  };
})();
