import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPath } from "./ai/pathfind";
import { DEFAULT_RATING, Difficulty, scoreRun } from "./ai/difficulty";
import { loop, MAX_STEPS_PER_FRAME, startLoop, STEP } from "./core/loop";
import { LEVELS, quality, TIERS } from "./render/quality";
import { CELL, HOT, Memory } from "./ai/memory";
import { predictRoute } from "./ai/tactics";
import {
  fitScale,
  LOT_MAX_SCALE,
  LOTS,
  lotDims,
  lotRect,
  tileGrid,
  treeSpecies,
  WORLD_FILES,
} from "./world/worldArt";
import {
  ALL_CAR_FILES,
  estimate,
  PLAYER_CARS,
  POLICE_SPEC,
  TRAFFIC_BIKES,
  TRAFFIC_CARS,
  TRAFFIC_TRUCKS,
} from "./data/cars";
import { Car } from "./physics/car";
import { Phys } from "./physics/world";
import { game } from "./state";
import { carGrid } from "./world/carGrid";
import { LaneDriver, Traffic } from "./world/traffic";
import { heat } from "./ai/heat";
import { BRIDGES, LANE_OFFSET, RAMPS, RIVER_I, SURF, TILE } from "./world/city";
import type { Tile } from "./world/city";
import { createCity, World } from "./world/world";
import type { Building, SaveData } from "./types";
import { migrateSave } from "./save";
import { capForTraffic, speedTo } from "./ai/drive";
import { Combo } from "./progress/combo";
import {
  activeStreak,
  challengeById,
  ensureDaily,
  pickDaily,
  trackDaily,
  yesterdayKey,
} from "./progress/daily";
import {
  applyUpgrades,
  buyCar,
  buyUpgrade,
  carPrice,
  levelsOf,
  MAX_LEVEL,
  nextUnlock,
  upgradeCost,
} from "./progress/economy";

const DT = 1 / 120;

describe("car data", () => {
  it("has nine player cars and three motorcycles plus a police car, all with sprites", () => {
    expect(PLAYER_CARS).toHaveLength(12);
    expect(PLAYER_CARS.filter((c) => c.bike)).toHaveLength(3);
    expect(POLICE_SPEC.police).toBe(true);
    expect(ALL_CAR_FILES).toContain(POLICE_SPEC.file);
    expect(new Set(PLAYER_CARS.map((c) => c.id)).size).toBe(12);
  });

  it("Silver GT does 0-100 km/h in about 4.4 s", () => {
    const silver = PLAYER_CARS.find((c) => c.id === "silver")!;
    expect(estimate(silver).t100).toBeGreaterThan(4.2);
    expect(estimate(silver).t100).toBeLessThan(4.7);
  });

  it("spreads top speed across the roster (SUV slowest, White Lightning fastest)", () => {
    const top = (id: string) => PLAYER_CARS.find((c) => c.id === id)!.top * 3.6;
    expect(top("blacksuv")).toBeLessThan(215);
    expect(top("white")).toBeGreaterThan(265);
  });
});

describe("city", () => {
  it("is deterministic for a given seed and differs between seeds", () => {
    const a = createCity(123),
      b = createCity(123),
      c = createCity(456);
    expect(a.buildings.length).toBe(b.buildings.length);
    expect(a.buildings[0].x).toBe(b.buildings[0].x);
    expect(a.vx).toEqual(b.vx);
    expect(c.vx).not.toEqual(a.vx);
  });

  it("classifies roads, sidewalks and parks, and blocks line of sight through buildings", () => {
    const city = createCity();
    const road = city.nodeX(city.nodeId(8, 8));
    expect(city.surfaceAt(road, city.nodeY(city.nodeId(8, 8))).kind).toBe(
      "asphalt",
    );
    const b = city.buildings[0];
    expect(city.pointInBuilding(b.x, b.y)).toBe(true);
    expect(city.hasLOS(b.x0 - 20, b.y, b.x1 + 20, b.y)).toBe(false);
  });
});

describe("pathfinding", () => {
  it("finds a connected path across the city", () => {
    const city = createCity();
    const start = city.nodeId(0, 0),
      goal = city.nodeId(city.NV - 1, city.NH - 1);
    const path = findPath(city, start, goal)!;
    expect(path[0]).toBe(start);
    expect(path[path.length - 1]).toBe(goal);
    for (let i = 1; i < path.length; i++)
      expect(city.neighbors(path[i - 1])).toContain(path[i]);
    // a Manhattan grid needs (NV-1)+(NH-1) hops; the winding roads' diagonal shortcuts can only make it fewer
    expect(path.length - 1).toBeLessThanOrEqual(city.NV - 1 + city.NH - 1);
  });

  it("returns a single node when start equals goal", () => {
    expect(findPath(createCity(), 5, 5)).toEqual([5]);
  });
});

describe("Matter.js car physics (headless)", () => {
  const impact = vi.fn();

  beforeEach(() => {
    impact.mockClear();
    game.onImpact = impact;
  });

  function spawn(spec = PLAYER_CARS[0], x = 0, y = 0, theta = 0): Car {
    const car = new Car(spec, "player");
    Phys.addCar(car);
    car.place(x, y, theta);
    return car;
  }
  function drive(car: Car, seconds: number, ctrl: Partial<Car["ctrl"]>): void {
    Object.assign(
      car.ctrl,
      { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 },
      ctrl,
    );
    for (let i = 0; i < seconds / DT; i++) {
      car.applyControls(DT, SURF.asphalt);
      Phys.step(DT);
      car.readBack();
    }
  }

  it("accelerates to 100 km/h in about 4.4 s and keeps going toward top speed", () => {
    Phys.init({ buildings: [], walls: [] });
    const car = spawn();
    let t = 0;
    car.ctrl.throttle = 1;
    while (car.speed * 3.6 < 100 && t < 10) {
      car.applyControls(DT, SURF.asphalt);
      Phys.step(DT);
      car.readBack();
      t += DT;
    }
    expect(t).toBeGreaterThan(4.0);
    expect(t).toBeLessThan(4.9);
    drive(car, 20, { throttle: 1 });
    expect(car.speed * 3.6).toBeGreaterThan(200);
    expect(car.speed).toBeLessThanOrEqual(car.spec.top * 1.01);
  });

  it("brakes to a stop and then reverses", () => {
    Phys.init({ buildings: [], walls: [] });
    const car = spawn();
    car.setSpeed(30);
    drive(car, 6, { brake: 1 });
    expect(car.vx).toBeLessThan(0); // held S: stopped, then backing up
  });

  it("steers without spinning out at speed, and a handbrake drift produces sideslip", () => {
    Phys.init({ buildings: [], walls: [] });
    const car = spawn();
    car.setSpeed(28);
    drive(car, 3, { throttle: 1, steer: 1 });
    expect(Math.abs(car.w)).toBeLessThan(1.2);
    const drift = spawn(PLAYER_CARS[0], 5000, 5000);
    drift.setSpeed(22);
    drive(drift, 0.5, { throttle: 1, steer: 1, handbrake: 1 });
    expect(Math.abs(Math.atan2(drift.vy, drift.vx))).toBeGreaterThan(0.15);
  });

  it("stops at a building without tunnelling and reports the impact", () => {
    const wall: Building = {
      x: 100,
      y: 0,
      theta: 0,
      hx: 20,
      hy: 20,
      kind: "tower",
      x0: 80,
      y0: -20,
      x1: 120,
      y1: 20,
      height: 30,
      roof: "",
      wall: "",
      props: [],
      hasHeli: false,
      stamp: 0,
    };
    Phys.init({ buildings: [wall], walls: [] });
    const car = spawn(PLAYER_CARS[0], 40, 0, 0);
    car.setSpeed(100 / 3.6);
    drive(car, 3, {});
    expect(car.x + car.hx).toBeLessThanOrEqual(wall.x0 + 0.5); // never inside the building
    expect(car.speed).toBeLessThan(2);
    expect(impact).toHaveBeenCalled();
    // Matter may report the static building as bodyA or bodyB; the engine handles both orders
    const [a, b, dvA, dvB] = impact.mock.calls[0];
    expect([a, b]).toContain(car);
    expect([a, b]).toContain(null);
    const carDv = a === car ? dvA : dvB;
    expect(carDv).toBeGreaterThan(25); // ~100 km/h crash
  });

  it("removing a car takes its body out of the world", () => {
    Phys.init({ buildings: [], walls: [] });
    const car = spawn();
    const before = Phys.engine!.world.bodies.length;
    Phys.removeCar(car);
    expect(Phys.engine!.world.bodies.length).toBe(before - 1);
    expect(car.body).toBeNull();
  });
});

describe("busy roads (plan 4)", () => {
  it("civilian cars are slower, softer variants of the nine bodies", () => {
    const cars = PLAYER_CARS.filter((c) => !c.bike);
    expect(TRAFFIC_CARS).toHaveLength(cars.length);
    TRAFFIC_CARS.forEach((t, i) => {
      expect(t.file).toBe(cars[i].file);
      expect(t.top).toBeLessThan(cars[i].top);
      expect(t.accel).toBeLessThan(cars[i].accel);
    });
    // and the same for the motorcycles in traffic
    const bikes = PLAYER_CARS.filter((c) => c.bike);
    expect(TRAFFIC_BIKES).toHaveLength(bikes.length);
    TRAFFIC_BIKES.forEach((t, i) => {
      expect(t.bike).toBe(true);
      expect(t.top).toBeLessThan(bikes[i].top);
    });
  });

  it("spatial grid query matches a brute-force search", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const cars = Array.from({ length: 80 }, () => {
      const c = new Car(PLAYER_CARS[0], "civil");
      c.x = rnd() * 1800;
      c.y = rnd() * 1800;
      return c;
    });
    carGrid.rebuild(cars);
    const out: Car[] = [];
    for (let k = 0; k < 40; k++) {
      const x = rnd() * 1800,
        y = rnd() * 1800,
        r = 10 + rnd() * 120;
      const expected = cars
        .filter((c) => Math.hypot(c.x - x, c.y - y) <= r)
        .map((c) => c.id)
        .sort();
      const got = carGrid
        .query(x, y, r, out)
        .map((c) => c.id)
        .sort();
      expect(got).toEqual(expected);
    }
  });

  it("stays cheap with 60 cars in the Matter world", () => {
    Phys.init({ buildings: [], walls: [] });
    const cars: Car[] = [];
    for (let i = 0; i < 60; i++) {
      const c = new Car(TRAFFIC_CARS[i % 9], "civil");
      Phys.addCar(c);
      c.place((i % 10) * 40, Math.floor(i / 10) * 40, 0);
      c.setSpeed(10);
      cars.push(c);
    }
    for (let i = 0; i < 120; i++) {
      for (const c of cars) c.applyControls(DT, SURF.asphalt);
      Phys.step(DT);
      for (const c of cars) c.readBack();
    }
    const t0 = performance.now();
    const N = 600;
    for (let i = 0; i < N; i++) {
      for (const c of cars) {
        c.ctrl.throttle = 0.3;
        c.applyControls(DT, SURF.asphalt);
      }
      Phys.step(DT);
      for (const c of cars) c.readBack();
      carGrid.rebuild(cars);
    }
    const ms = (performance.now() - t0) / N;
    expect(ms).toBeLessThan(3); // ~0.3 ms in practice; this guards against accidental O(n^2) blow-ups
  });
});

describe("city districts (plan 5)", () => {
  const city = createCity();

  it("has downtown, port and suburbs, and the spawn point is downtown", () => {
    const present = new Set(city.blocks.map((b) => b.district));
    expect([...present].sort()).toEqual(["downtown", "port", "suburbs"]);
    expect(
      city.districtAt(
        city.nodeX(city.nodeId(8, 8)),
        city.nodeY(city.nodeId(8, 8)),
      ),
    ).toBe("downtown");
    expect(city.districtAt(city.vx[0], 300)).toBe("highway");
  });

  it("is deterministic for a seed (districts and buildings)", () => {
    const again = createCity();
    expect(again.blocks.map((b) => b.district)).toEqual(
      city.blocks.map((b) => b.district),
    );
    expect(again.buildings.length).toBe(city.buildings.length);
    expect(createCity(99).blocks.map((b) => b.district)).not.toEqual(
      city.blocks.map((b) => b.district),
    );
  });

  it("puts the right buildings in the right district", () => {
    for (const b of city.buildings) {
      const d = city.districtAt(b.x, b.y);
      if (b.kind === "house") expect(d).toBe("suburbs");
      if (b.kind === "container" || b.kind === "warehouse")
        expect(d).toBe("port");
      if (b.kind === "tower") expect(d).toBe("downtown");
    }
    const kinds = new Set(city.buildings.map((b) => b.kind));
    expect([...kinds].sort()).toEqual([
      "container",
      "house",
      "rock",
      "statue",
      "tower",
      "warehouse",
    ]);
  });

  it("never builds on a road", () => {
    for (const b of city.buildings) {
      for (let i = 0; i < city.NV; i++)
        expect(
          b.x1 <= city.vx[i] - city.vw[i] / 2 ||
            b.x0 >= city.vx[i] + city.vw[i] / 2,
        ).toBe(true);
      for (let j = 0; j < city.NH; j++)
        expect(
          b.y1 <= city.hy[j] - city.hw[j] / 2 ||
            b.y0 >= city.hy[j] + city.hw[j] / 2,
        ).toBe(true);
    }
  });

  it("makes the ring a wide highway that is entered only through the ramps", () => {
    expect(city.vw[0]).toBe(28);
    expect(city.vt[0]).toBe("highway");
    const ring = (i: number, j: number) => city.nodeId(i, j);
    for (let j = 1; j < city.NH - 1; j++) {
      const toInterior = city.neighbors(ring(0, j)).includes(ring(1, j));
      expect(toInterior).toBe(RAMPS.includes(j));
      expect(city.neighbors(ring(1, j)).includes(ring(0, j))).toBe(
        RAMPS.includes(j),
      ); // and the same in reverse
    }
    // ring nodes always connect along the ring
    expect(city.neighbors(ring(0, 3))).toContain(ring(0, 2));
    expect(city.neighbors(ring(0, 3))).toContain(ring(0, 4));
  });

  it("keeps every intersection reachable from the centre, highway included", () => {
    const from = city.nodeId(8, 8);
    let reachable = 0;
    for (let id = 0; id < city.nodeCount; id++)
      if (findPath(city, from, id)) reachable++;
    // every crossing a bend park hasn't removed
    let live = 0;
    for (let id = 0; id < city.nodeCount; id++) if (!city.isDead(id)) live++;
    expect(reachable).toBe(live);
    // a trip to a far ring corner must go via a ramp
    const path = findPath(city, from, city.nodeId(0, 0))!;
    const entry = path.find(
      (n, k) =>
        k > 0 &&
        (city.nodeId(0, 0) === n
          ? false
          : n % city.NV === 0 ||
            n % city.NV === city.NV - 1 ||
            ((n / city.NV) | 0) === 0 ||
            ((n / city.NV) | 0) === city.NH - 1),
    )!;
    expect(city.isRamp(entry % city.NV, (entry / city.NV) | 0)).toBe(true);
  });

  it("barricades the highway except at the ramps", () => {
    const px = city.vx[0] + city.vw[0] / 2 + 0.6; // the barrier line along the left highway
    const covers = (y: number) =>
      city.barriers.some(
        (b) => Math.abs(b.x - px) < 0.01 && Math.abs(y - b.y) <= b.hy,
      );
    expect(covers(city.hy[3])).toBe(true); // a plain street mouth is walled off
    for (const j of RAMPS) expect(covers(city.hy[j])).toBe(false); // a ramp is open
  });

  it("barriers block line of sight (so cops route to a ramp) but ramps do not", () => {
    const y3 = city.hy[3],
      y4 = city.hy[4];
    const xIn = city.vx[0] + city.vw[0] / 2 + 12; // inside the first block column
    const xHwy = city.vx[0] + 6;
    expect(city.hasLOS(xHwy, y3, xIn, y3)).toBe(false); // across a plain street mouth: walled off
    expect(city.hasLOS(xHwy, y4, xIn, y4)).toBe(true); // through the ramp opening: clear
  });
});

describe("living map features (plan 6)", () => {
  const city = createCity();

  it("splits the city with a river crossed only by the bridge streets", () => {
    const id = (i: number, j: number) => city.nodeId(i, j);
    for (let j = 1; j < city.NH - 1; j++) {
      const crosses = city
        .neighbors(id(RIVER_I, j))
        .includes(id(RIVER_I + 1, j));
      expect(crosses).toBe(BRIDGES.includes(j));
    }
    expect(city.bridges).toHaveLength(BRIDGES.length);
    // every intersection stays reachable (through the bridges)
    const from = id(8, 8);
    for (let n = 0; n < city.nodeCount; n += 7)
      expect(findPath(city, from, n)).not.toBeNull();
    // west-to-east trips have to use a bridge
    const path = findPath(city, id(2, 6), id(RIVER_I + 3, 6))!;
    const hop = path.findIndex(
      (n, k) =>
        k > 0 &&
        path[k - 1] % city.NV === RIVER_I &&
        n % city.NV === RIVER_I + 1,
    );
    expect(hop).toBeGreaterThan(0);
    expect(BRIDGES).toContain((path[hop] / city.NV) | 0);
  });

  it("makes the water solid and keeps bridge decks open", () => {
    const mx = (city.river.x0 + city.river.x1) / 2;
    const waterY = (city.hy[5] + city.hy[6]) / 2; // between two streets, nowhere near a bridge
    expect(city.inWater(mx, waterY)).toBe(true);
    expect(city.isObstacle(mx, waterY)).toBe(true);
    for (const j of BRIDGES) expect(city.inWater(mx, city.hy[j])).toBe(false);
    expect(city.waterWalls.length).toBeGreaterThan(0);
  });

  it("has tunnels that block line of sight and hide you from the helicopter", () => {
    expect(city.tunnels.length).toBeGreaterThan(3);
    const t = city.tunnels[0];
    const cx = (t.x0 + t.x1) / 2,
      cy = (t.y0 + t.y1) / 2;
    expect(city.inTunnel(cx, cy)).toBe(true);
    const outsideX = t.horiz ? t.x0 - 12 : cx,
      outsideY = t.horiz ? cy : t.y0 - 12;
    expect(city.hasLOS(outsideX, outsideY, cx, cy)).toBe(false);
  });

  it("places ramps, construction gravel and props deterministically", () => {
    const again = createCity();
    expect(again.jumps).toEqual(city.jumps);
    expect(again.propSpots.length).toBe(city.propSpots.length);
    expect(city.jumps.length).toBeGreaterThan(2);
    expect(city.gravel.length).toBeGreaterThan(3);
    const kinds = new Set(city.propSpots.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(["cone", "fence", "sawhorse"]);
    const g = city.gravel[0];
    expect(city.surfaceAt((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2).kind).toBe(
      "gravel",
    );
  });

  it("launches an airborne car over another car and lands it with less grip", () => {
    Phys.init({ buildings: [], walls: [] }); // open ground, so only the thing under test can be hit
    const a = new Car(PLAYER_CARS[0], "player");
    Phys.addCar(a);
    a.place(0, 0, 0);
    const b = new Car(PLAYER_CARS[1], "civil");
    Phys.addCar(b);
    b.place(30, 0, 0);
    a.setSpeed(30);
    a.launch(1.2);
    let hits = 0;
    const oi = game.onImpact;
    game.onImpact = () => {
      hits++;
    };
    let landed = false;
    for (let i = 0; i < 240; i++) {
      a.ctrl.throttle = 0;
      a.applyControls(DT, SURF.asphalt);
      b.applyControls(DT, SURF.asphalt);
      Phys.step(DT);
      a.readBack();
      b.readBack();
      if (a.justLanded) landed = true;
    }
    game.onImpact = oi;
    expect(a.x).toBeGreaterThan(b.x); // flew past it...
    expect(hits).toBe(0); // ...without touching it
    expect(landed).toBe(true);
    expect(a.air).toBe(0);
  });

  it("a prop hit is a smash, not a crash", () => {
    Phys.init({ buildings: [], walls: [] }); // open ground, so only the thing under test can be hit
    const car = new Car(PLAYER_CARS[0], "player");
    Phys.addCar(car);
    car.place(0, 0, 0);
    const spot = { kind: "cone" as const, x: 20, y: 0, angle: 0, gone: false };
    const body = Phys.addProp(spot);
    const oi = game.onImpact,
      op = game.onPropHit;
    let crashes = 0,
      smashes = 0;
    game.onImpact = () => {
      crashes++;
    };
    game.onPropHit = () => {
      smashes++;
    };
    car.setSpeed(15);
    for (let i = 0; i < 240; i++) {
      car.applyControls(DT, SURF.asphalt);
      Phys.step(DT);
      car.readBack();
    }
    game.onImpact = oi;
    game.onPropHit = op;
    expect(smashes).toBeGreaterThan(0);
    expect(crashes).toBe(0);
    expect(car.speed).toBeGreaterThan(12); // a cone barely slows a car
    expect(body.position.x / Phys.S).toBeGreaterThan(20.5); // and it got knocked down the road
  });
});

describe("coordinated police tactics (plan 1)", () => {
  const city = createCity();
  // an interior intersection with a straight street through it
  const i0 = 6,
    j0 = 6;
  const n = city.nodeId(i0, j0);
  const sx = city.nodeX(n),
    sy = city.nodeY(n);

  it("predicts the road ahead of a fast player, and nothing for a slow one", () => {
    expect(predictRoute(city, sx + 30, sy, 3, 0)).toEqual([]);
    const r = predictRoute(city, sx + 30, sy, 28, 0);
    expect(r.length).toBeGreaterThan(0);
    for (const e of r) {
      expect(e.dx).toBeGreaterThan(0.99); // along +x
      expect(e.wy).toBeCloseTo(sy, 0); // on the street the player is on
      expect(e.wx).toBeGreaterThan(sx + 30 + 24); // clearly ahead of the player
      expect(e.eta).toBeGreaterThan(0.5);
    }
  });

  it("later cut-off points have later arrival times", () => {
    const r = predictRoute(city, sx + 30, sy, 28, 0);
    if (r.length === 2) {
      expect(r[1].eta).toBeGreaterThan(r[0].eta);
      expect(r[1].wx).toBeGreaterThan(r[0].wx);
    }
  });

  it("predicts in every direction and always lands on a drivable edge", () => {
    for (const [vx, vy] of [
      [28, 0],
      [-28, 0],
      [0, 28],
      [0, -28],
    ]) {
      const r = predictRoute(city, sx + vx, sy + vy, vx, vy);
      for (const e of r) {
        expect(city.neighbors(e.n0)).toContain(e.n1);
        expect(e.dx * vx + e.dy * vy).toBeGreaterThan(0);
      }
    }
  });
});

describe("police memory (plan 2)", () => {
  beforeEach(() => Memory.clear());

  it("records hidden time per cell and learns from a finished run", () => {
    Memory.startRun();
    Memory.recordHidden(100, 100, 6);
    Memory.recordHidden(110, 90, 4); // same cell
    Memory.recordHidden(500, 500, 2);
    Memory.endRun(true);
    expect(Memory.cells.get(Memory.keyAt(100, 100))).toBeCloseTo(10);
    expect(Memory.cells.get(Memory.keyAt(500, 500))).toBeCloseTo(2);
    expect(Memory.hot().map((c) => c.key)).toEqual([Memory.keyAt(100, 100)]); // only the 10 s cell is "hot"
  });

  it("learns half as much from a bust, and fades old knowledge each run", () => {
    Memory.startRun();
    Memory.recordHidden(100, 100, 10);
    Memory.endRun(false);
    expect(Memory.cells.get(Memory.keyAt(100, 100))).toBeCloseTo(5);
    Memory.endRun(true); // nothing new: just decays
    expect(Memory.cells.get(Memory.keyAt(100, 100))).toBeCloseTo(5 * 0.85);
    for (let i = 0; i < 30; i++) Memory.endRun(true);
    expect(Memory.cells.size).toBe(0); // forgotten
  });

  it("repeated escapes to the same spot make it hotter than a one-off", () => {
    for (let r = 0; r < 3; r++) {
      Memory.startRun();
      Memory.recordHidden(300, 300, 8);
      if (r === 2) Memory.recordHidden(900, 900, 8);
      Memory.endRun(true);
    }
    const hot = Memory.hot();
    expect(hot[0].key).toBe(Memory.keyAt(300, 300));
    expect(hot[0].w).toBeGreaterThan(hot[hot.length - 1].w);
  });

  it("round-trips through the save format and ignores junk", () => {
    Memory.startRun();
    Memory.recordHidden(200, 400, 12);
    Memory.endRun(true);
    const saved = JSON.parse(JSON.stringify(Memory.save())) as Record<
      string,
      number
    >;
    Memory.clear();
    Memory.load({ ...saved, bogus: 5, "1,2": -3, "3,4": NaN });
    expect([...Memory.cells.keys()]).toEqual([Memory.keyAt(200, 400)]);
    expect(Memory.cells.get(Memory.keyAt(200, 400))).toBeCloseTo(12, 0);
  });

  it("picks a nearby hideout, ignores far ones, and the cell centre lies inside its cell", () => {
    Memory.cells.set(Memory.keyAt(1000, 1000), 20);
    Memory.cells.set(Memory.keyAt(5000, 5000), 50);
    const t = Memory.pick(1100, 1050);
    expect(t).not.toBeNull();
    expect(Math.abs(t!.x - 1000)).toBeLessThan(CELL);
    expect(Memory.pick(3000, 3000, 400)).toBeNull(); // nothing within 400 m
    Memory.cells.set(Memory.keyAt(2000, 2000), HOT - 1);
    expect(Memory.pick(2000, 2000)).toBeNull(); // too cold to matter
  });

  it("keeps the table bounded", () => {
    Memory.startRun();
    for (let i = 0; i < 300; i++) Memory.recordHidden(i * CELL, 0, 1 + (i % 7));
    Memory.endRun(true);
    expect(Memory.cells.size).toBeLessThanOrEqual(80);
  });
});

describe("adaptive difficulty (plan 3)", () => {
  beforeEach(() => {
    Difficulty.reset();
  });

  it("the default rating is the baseline tuning", () => {
    expect(Difficulty.rating).toBe(DEFAULT_RATING);
    const k = Difficulty.k;
    expect(k.copOffset).toBe(0);
    expect(k.boostMul).toBe(1);
    expect(k.reactMul).toBe(1);
    expect(k.spawnMin).toBe(110);
    expect(k.spawnMax).toBe(260);
    expect(k.trapMul).toBe(1);
    expect(k.evadeAdd).toBe(0);
    expect(k.tactBonus).toBe(0);
  });

  it("escaping raises the rating, getting busted early lowers it", () => {
    const up = Difficulty.update("escaped", 40, 2, 90);
    expect(up.after).toBeGreaterThan(up.before);
    Difficulty.reset();
    const down = Difficulty.update("busted", 15, 0, 100);
    expect(down.after).toBeLessThan(down.before);
  });

  it("scores: fast clean escapes beat slow ones, long busts beat short ones", () => {
    expect(scoreRun("escaped", 30, 3, 100)).toBeGreaterThan(
      scoreRun("escaped", 120, 0, 40),
    );
    expect(scoreRun("busted", 100, 0, 0)).toBeGreaterThan(
      scoreRun("busted", 10, 0, 0),
    );
    expect(scoreRun("escaped", 200, 0, 0)).toBeGreaterThan(
      scoreRun("busted", 200, 0, 0),
    );
  });

  it("moves a bounded amount per run and stays within 0.05..0.95", () => {
    const r = Difficulty.update("escaped", 30, 5, 100);
    expect(Math.abs(r.after - r.before)).toBeLessThanOrEqual(0.1 + 1e-9);
    for (let i = 0; i < 80; i++) Difficulty.update("escaped", 30, 5, 100);
    expect(Difficulty.rating).toBeLessThanOrEqual(0.95);
    expect(Difficulty.rating).toBeGreaterThan(0.8);
    for (let i = 0; i < 200; i++) Difficulty.update("busted", 9, 0, 0);
    expect(Difficulty.rating).toBeGreaterThanOrEqual(0.05);
    expect(Difficulty.rating).toBeLessThan(0.15);
  });

  it("ignores instant restarts, fixed difficulty and the dev override", () => {
    expect(Difficulty.update("busted", 3, 0, 100).after).toBe(DEFAULT_RATING);
    Difficulty.setFixed(true);
    expect(Difficulty.update("escaped", 40, 3, 100).after).toBe(DEFAULT_RATING);
    Difficulty.setFixed(false);
    Difficulty.load({ best: 0, total: 0, longest: 0, car: 0 }, "0.9");
    expect(Difficulty.eff()).toBe(0.9);
    expect(Difficulty.update("escaped", 40, 3, 100).after).toBe(DEFAULT_RATING); // override: nothing is saved
  });

  it("the knobs grow monotonically with the rating", () => {
    const at = (r: number) => {
      Difficulty.load(
        { best: 0, total: 0, longest: 0, car: 0, skill: r },
        null,
      );
      return { ...Difficulty.k };
    };
    const ks = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map(at);
    for (let i = 1; i < ks.length; i++) {
      expect(ks[i].copOffset).toBeGreaterThanOrEqual(ks[i - 1].copOffset);
      expect(ks[i].boostMul).toBeGreaterThan(ks[i - 1].boostMul);
      expect(ks[i].reactMul).toBeLessThan(ks[i - 1].reactMul);
      expect(ks[i].spawnMin).toBeLessThan(ks[i - 1].spawnMin);
      expect(ks[i].trapMul).toBeLessThan(ks[i - 1].trapMul);
      expect(ks[i].evadeAdd).toBeGreaterThanOrEqual(ks[i - 1].evadeAdd);
      expect(ks[i].tactBonus).toBeGreaterThanOrEqual(ks[i - 1].tactBonus);
    }
    expect(ks[0].copOffset).toBeLessThan(0); // easier than baseline
    expect(ks[5].copOffset).toBeGreaterThan(0); // harder than baseline
    expect(ks[5].boostMul).toBeLessThan(1.2); // but bounded
  });

  it("loads a saved rating and survives junk", () => {
    Difficulty.load(
      { best: 0, total: 0, longest: 0, car: 0, skill: 0.7, fixedSkill: true },
      null,
    );
    expect(Difficulty.rating).toBe(0.7);
    expect(Difficulty.fixed).toBe(true);
    Difficulty.load(
      { best: 0, total: 0, longest: 0, car: 0, skill: Number.NaN },
      "abc",
    );
    expect(Difficulty.rating).toBe(DEFAULT_RATING);
    expect(Difficulty.override).toBeNull();
  });
});

describe("photo art, lanes and landmark lots at real-world scale", () => {
  const city = createCity();
  const lotBlocks = city.blocks.filter((b) => b.lots && b.lots.length);
  const allLots = lotBlocks.flatMap((b) => b.lots!.map((l) => ({ b, l })));

  it("every art file the game loads exists in public/", () => {
    const found = Object.keys(import.meta.glob("/public/world/**/*.webp"));
    for (const f of WORLD_FILES) expect(found, f).toContain("/public/" + f);
  });

  it("every tree value maps to one of the 8 sprites, and all of them get used", () => {
    const used = new Set<number>();
    for (let i = 0; i <= 1000; i++) used.add(treeSpecies(i / 1000));
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("lanes are about 3.6 m: the lane centre sits inside its half of every road, with room for a car", () => {
    for (const t of ["highway", "avenue", "street", "alley"] as const) {
      const w = { highway: 28, avenue: 18, street: 11, alley: 6 }[t];
      const lane = LANE_OFFSET[t];
      expect(lane).toBeGreaterThan(0.9); // a 1.9 m car doesn't straddle the centre line
      expect(lane + 0.95).toBeLessThan(w / 2); // and doesn't hang over the kerb
    }
    // laneOffset follows the edge's road type
    const a = city.nodeId(3, 4),
      b = city.nodeId(4, 4);
    expect(city.laneOffset(a, b)).toBe(LANE_OFFSET[city.ht[4]]);
    expect(city.laneOffset(city.nodeId(4, 3), city.nodeId(4, 4))).toBe(
      LANE_OFFSET[city.vt[4]],
    );
  });

  it("lane points are on the right-hand side of the road, inside it", () => {
    for (let k = 0; k < 40; k++) {
      const n = city.randomNode();
      for (const m of city.neighbors(n)) {
        if (city.isCurve(n, m)) continue; // winding roads bend: checked in their own test
        const p = city.lanePoint(n, m, 0.5);
        expect(city.laneOffset(n, m)).toBeLessThan(city.edgeWidth(n, m) / 2);
        // offset is to the right of the direction of travel (y down): (-uy, ux)
        const cx = (city.nodeX(n) + city.nodeX(m)) / 2,
          cy = (city.nodeY(n) + city.nodeY(m)) / 2;
        const side = (p.x - cx) * -p.uy + (p.y - cy) * p.ux;
        expect(side).toBeGreaterThan(0);
      }
    }
  });

  it("places each kind of lot in its own district, deterministically", () => {
    expect(allLots.length).toBeGreaterThan(0);
    for (const art of Object.values(LOTS)) {
      const mine = lotBlocks.filter((b) => b.lots![0].art === art.id);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.length).toBeLessThanOrEqual(art.count);
      for (const b of mine) expect(b.district).toBe(art.district);
    }
    const sig = (c: ReturnType<typeof createCity>) =>
      c.blocks
        .filter((b) => b.lots)
        .map((b) => [
          b.i,
          b.j,
          b.lots!.map((l) => [
            l.art,
            l.rot,
            l.flipX,
            l.flipY,
            Math.round(l.x0),
            Math.round(l.y0),
          ]),
        ]);
    expect(sig(createCity())).toEqual(sig(city));
  });

  it("lots are drawn at their real-world size, never stretched", () => {
    for (const { l } of allLots) {
      const art = LOTS[l.art];
      const w = l.x1 - l.x0,
        h = l.y1 - l.y0;
      const [rw, rh] = l.rot ? [h, w] : [w, h];
      expect(rw / rh).toBeCloseTo(art.aspect, 3); // aspect ratio untouched
      const s = rw / art.metresWide;
      expect(s).toBeGreaterThanOrEqual(art.minScale - 1e-6);
      expect(s).toBeLessThanOrEqual(LOT_MAX_SCALE + 1e-6);
    }
  });

  it("lots stay inside their block, off the roads, and never overlap each other", () => {
    for (const { b, l } of allLots) {
      expect(l.x0).toBeGreaterThanOrEqual(b.x0 + 3 - 1e-6);
      expect(l.y0).toBeGreaterThanOrEqual(b.y0 + 3 - 1e-6);
      expect(l.x1).toBeLessThanOrEqual(b.x1 - 3 + 1e-6);
      expect(l.y1).toBeLessThanOrEqual(b.y1 - 3 + 1e-6);
    }
    for (const b of lotBlocks) {
      const ls = b.lots!;
      for (let i = 0; i < ls.length; i++)
        for (let j = i + 1; j < ls.length; j++) {
          const p = ls[i],
            q = ls[j];
          expect(
            p.x1 <= q.x0 + 1e-6 ||
              q.x1 <= p.x0 + 1e-6 ||
              p.y1 <= q.y0 + 1e-6 ||
              q.y1 <= p.y0 + 1e-6,
          ).toBe(true);
        }
    }
  });

  it("villa blocks hold several villas (a street of them), all the same way round", () => {
    const villaBlocks = lotBlocks.filter((b) => b.lots![0].art === "villa");
    expect(villaBlocks.some((b) => b.lots!.length >= 2)).toBe(true);
    for (const b of villaBlocks)
      expect(new Set(b.lots!.map((l) => l.rot)).size).toBe(1);
  });

  it("leftover strips of a lot block get ordinary buildings that do not overlap the lots", () => {
    for (const b of lotBlocks) {
      const mine = city.buildings.filter(
        (q) => q.x0 >= b.x0 && q.x1 <= b.x1 && q.y0 >= b.y0 && q.y1 <= b.y1,
      );
      const flat = mine.filter((q) => q.flat);
      expect(flat.length).toBe(
        b.lots!.reduce((n, l) => n + LOTS[l.art].parts.length, 0),
      );
      for (const q of mine.filter((x) => !x.flat))
        for (const l of b.lots!)
          expect(
            q.x1 <= l.x0 + 1e-6 ||
              q.x0 >= l.x1 - 1e-6 ||
              q.y1 <= l.y0 + 1e-6 ||
              q.y0 >= l.y1 - 1e-6,
            "building overlaps a lot",
          ).toBe(true);
    }
    for (const q of city.buildings.filter((x) => x.flat))
      expect(
        lotBlocks.some(
          (b) => q.x0 >= b.x0 && q.x1 <= b.x1 && q.y0 >= b.y0 && q.y1 <= b.y1,
        ),
      ).toBe(true);
  });

  it("fitScale / tileGrid only return sizes that really fit", () => {
    const v = LOTS.villa;
    expect(fitScale(v, 40, 40)).toBeNull(); // smaller than a villa: not squeezed into a toy
    const f = fitScale(LOTS.campus, 100, 100);
    if (f) {
      const [w, h] = lotDims(LOTS.campus, f.s, f.rot);
      expect(w).toBeLessThanOrEqual(100 + 1e-6);
      expect(h).toBeLessThanOrEqual(100 + 1e-6);
    }
    const g = tileGrid(v, 120, 100, 2)!;
    expect(g.cols * g.tw + (g.cols - 1) * 2).toBeLessThanOrEqual(120 + 1e-6);
    expect(g.rows * g.th + (g.rows - 1) * 2).toBeLessThanOrEqual(100 + 1e-6);
    expect(tileGrid(v, 30, 30, 2)).toBeNull();
  });

  it("lotRect honours turning and mirroring (the corners land on the right corners)", () => {
    const base = {
      art: "villa" as const,
      x0: 0,
      y0: 0,
      x1: 200,
      y1: 100,
      rot: 0 as const,
      flipX: false,
      flipY: false,
    };
    expect(lotRect(base, 0, 0, 0.5, 0.5)).toEqual([0, 0, 100, 50]);
    expect(lotRect({ ...base, flipX: true }, 0, 0, 0.5, 0.5)).toEqual([
      100, 0, 200, 50,
    ]);
    expect(lotRect({ ...base, flipY: true }, 0, 0, 0.5, 0.5)).toEqual([
      0, 50, 100, 100,
    ]);
    // quarter turn: the art's top-left corner ends up at the block's top-right
    expect(lotRect({ ...base, rot: 1 }, 0, 0, 0.5, 0.5)).toEqual([
      100, 0, 200, 50,
    ]);
  });

  it("the road graph is still fully connected", () => {
    const n = city.nodeCount;
    const seen = new Uint8Array(n);
    const stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      for (const nb of city.neighbors(c))
        if (!seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
    }
    expect(seen.every((v, id) => v === 1 || city.isDead(id))).toBe(true); // the crossings bend parks removed have no roads
  });
});

describe("performance: static streaming, loop budget, quality tiers, 60 Hz physics", () => {
  const box = (x: number, y: number, hx: number, hy: number): Building => ({
    x,
    y,
    theta: 0,
    hx,
    hy,
    kind: "tower",
    x0: x - hx,
    y0: y - hy,
    x1: x + hx,
    y1: y + hy,
    height: 30,
    roof: "",
    wall: "",
    props: [],
    hasHeli: false,
    stamp: 0,
  });
  const carAt = (x: number, y: number, theta = 0): Car => {
    const car = new Car(PLAYER_CARS[0], "player");
    Phys.addCar(car);
    car.place(x, y, theta);
    return car;
  };
  const run = (
    car: Car,
    seconds: number,
    dt: number,
    ctrl: Partial<Car["ctrl"]> = {},
  ) => {
    Object.assign(
      car.ctrl,
      { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 },
      ctrl,
    );
    for (let i = 0; i < seconds / dt; i++) {
      car.applyControls(dt, SURF.asphalt);
      Phys.step(dt);
      car.readBack();
    }
  };

  it("only the static colliders near the player are in the physics world, and they follow the player around", () => {
    const city = createCity();
    Phys.init(city);
    expect(Phys.statics.length).toBeGreaterThan(1000);
    expect(Phys.staticCount()).toBeLessThan(Phys.statics.length);
    for (const [x, y] of [
      [0, 0],
      [1000, 900],
      [city.bounds.maxX, city.bounds.maxY],
    ]) {
      Phys.streamStatics(x, y);
      for (const s of Phys.statics) {
        const d = Math.hypot(
          Math.max(Math.abs(x - s.cx) - s.hx, 0),
          Math.max(Math.abs(y - s.cy) - s.hy, 0),
        );
        if (s.always || d <= Phys.radius)
          expect(s.on, "near collider missing").toBe(true);
        if (!s.always && d > Phys.radius + 80)
          expect(s.on, "far collider still live").toBe(false);
      }
      expect(Phys.engine!.world.bodies.filter((b) => b.isStatic).length).toBe(
        Phys.staticCount(),
      ); // Matter agrees
    }
    expect(Phys.statics.filter((s) => s.always).every((s) => s.on)).toBe(true); // the boundary walls never leave
  });

  it("a building still stops a car after its collider has been streamed out and back in", () => {
    const wall = box(100, 0, 20, 20);
    Phys.init({ buildings: [wall], walls: [] });
    Phys.streamStatics(9000, 9000);
    expect(Phys.staticCount()).toBe(0); // far away: not simulated at all
    const car = carAt(40, 0);
    Phys.streamStatics(40, 0); // the player is back
    expect(Phys.staticCount()).toBe(1);
    car.setSpeed(100 / 3.6);
    run(car, 3, 1 / 120);
    expect(car.x + car.hx).toBeLessThanOrEqual(wall.x0 + 0.5);
    expect(car.speed).toBeLessThan(2);
  });

  it("the loop never runs more than 4 physics steps for one frame, however late the frame is", () => {
    let frame: FrameRequestCallback = () => {};
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
      frame = f;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    loop.paused = false;
    loop.step = STEP;
    let steps = 0;
    const stop = startLoop(
      () => steps++,
      () => {},
    );
    const t0 = performance.now();
    frame(t0 + 90); // a 90 ms frame: 10 steps' worth at 120 Hz
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    frame(t0 + 90 + 17); // the backlog was dropped, not carried over: a normal frame runs a normal number of steps
    expect(steps - MAX_STEPS_PER_FRAME).toBeLessThanOrEqual(2);
    stop();
    vi.unstubAllGlobals();
  });

  it("quality: phones start in the middle, step down when slow, step up with headroom, and fixed tiers stay put", () => {
    quality.configure("auto", true);
    expect(quality.tier).toBe("medium");
    expect(loop.step).toBeCloseTo(1 / 60, 6);
    const start = quality.level;
    loop.frameMs = 33;
    loop.workMs = 22;
    for (let i = 0; i < 40; i++) quality.update(0.1); // 4 s of struggling
    expect(quality.level).toBeGreaterThan(start);
    const down = quality.level;
    loop.frameMs = 16.7;
    loop.workMs = 3;
    quality.noUp = 0;
    quality.cool = 0;
    for (let i = 0; i < 120; i++) quality.update(0.1); // 12 s of headroom
    expect(quality.level).toBeLessThan(down);
    quality.configure("auto", false);
    expect(quality.tier).toBe("high");
    expect(loop.step).toBeCloseTo(1 / 120, 6);
    quality.configure("low", false);
    const fixed = quality.level;
    loop.frameMs = 40;
    loop.workMs = 30;
    for (let i = 0; i < 100; i++) quality.update(0.1);
    expect(quality.level).toBe(fixed);
    expect(quality.spec.shadows).toBe(false);
    quality.configure("auto", false);
    loop.frameMs = 16.7;
    loop.workMs = 4;
  });

  it("every tier is cheaper than the one above it", () => {
    expect(TIERS.medium.traffic).toBeLessThan(TIERS.high.traffic);
    expect(TIERS.low.traffic).toBeLessThan(TIERS.medium.traffic);
    expect(TIERS.low.staticRadius).toBeLessThan(TIERS.medium.staticRadius);
    expect(TIERS.medium.staticRadius).toBeLessThan(TIERS.high.staticRadius);
    expect(TIERS.low.particles).toBeLessThan(TIERS.medium.particles);
    for (let i = 1; i < LEVELS.length; i++)
      expect(
        LEVELS[i].dpr <= LEVELS[i - 1].dpr ||
          LEVELS[i].tier !== LEVELS[i - 1].tier,
      ).toBe(true);
  });

  it("60 Hz physics keeps the car feel: same 0-100 time (within 10%) and still no tunnelling at 200 km/h", () => {
    const t100 = (dt: number) => {
      Phys.init({ buildings: [], walls: [] });
      const car = carAt(0, 0);
      car.ctrl.throttle = 1;
      let t = 0;
      while (car.speed * 3.6 < 100 && t < 10) {
        car.applyControls(dt, SURF.asphalt);
        Phys.step(dt);
        car.readBack();
        t += dt;
      }
      return t;
    };
    const a = t100(1 / 120),
      b = t100(1 / 60);
    expect(Math.abs(a - b) / a).toBeLessThan(0.1);
    const wall = box(300, 0, 20, 20);
    Phys.init({ buildings: [wall], walls: [] });
    const car = carAt(100, 0);
    car.setSpeed(200 / 3.6);
    run(car, 4, 1 / 60);
    expect(car.x + car.hx).toBeLessThanOrEqual(wall.x0 + 0.5);
    // and a thin 1.2 m highway barrier is not tunnelled either
    const bar: Building = box(300, 0, 0.6, 20);
    Phys.init({ buildings: [bar], walls: [] });
    const c2 = carAt(200, 0);
    c2.setSpeed(200 / 3.6);
    run(c2, 4, 1 / 60);
    expect(c2.x).toBeLessThan(bar.x0 + 0.5);
  });
});

describe("the endless world: tiles, windows and recentering", () => {
  const sig = (t: Tile) =>
    [
      t.buildings.length,
      t.trees.length,
      t.riverCol,
      t.name,
      Math.round(t.x0),
      Math.round(t.y1),
      t.buildings[0]?.x0.toFixed(2),
      t.propSpots.length,
    ].join("|");

  beforeEach(() => World.init(777));

  it("a tile is a pure function of (seed, tx, ty): regenerating gives the identical tile", () => {
    const first = [World.tile(3, -2), World.tile(-7, 5), World.tile(0, 0)].map(
      sig,
    );
    World.cache.clear();
    const again = [World.tile(3, -2), World.tile(-7, 5), World.tile(0, 0)].map(
      sig,
    );
    expect(again).toEqual(first);
    expect(sig(World.tile(1, 1))).not.toEqual(sig(World.tile(2, 1))); // and different tiles differ
  });

  it("neighbouring tiles share their boundary highway exactly, so roads never jump at a tile edge", () => {
    for (const [tx, ty] of [
      [0, 0],
      [4, -3],
      [-5, 2],
    ]) {
      const a = World.tile(tx, ty),
        r = World.tile(tx + 1, ty),
        d = World.tile(tx, ty + 1);
      expect(r.V.pos[0]).toBeCloseTo(a.V.pos[16], 6);
      expect(a.V.type[16]).toBe("highway");
      expect(r.V.type[0]).toBe("highway");
      expect(d.H.pos[0]).toBeCloseTo(a.H.pos[16], 6);
      expect(d.H.type[0]).toBe("highway");
      // the lines of one tile column are the same for every tile in that column
      expect(World.tile(tx, ty + 3).V.pos).toEqual(a.V.pos);
    }
  });

  it("a window joins 3 x 3 tiles into one road grid with a highway every 16 lines, and tile lookups agree", () => {
    const city = World.build(2, -1, 1);
    expect(city.NV).toBe(49);
    expect(city.tiles.length).toBe(9);
    for (let i = 0; i < city.NV; i++)
      expect(city.vt[i] === "highway").toBe(i % 16 === 0);
    for (let j = 0; j < city.NH; j++)
      expect(city.ht[j] === "highway").toBe(j % 16 === 0);
    for (let i = 1; i < city.NV; i++)
      expect(city.vx[i]).toBeGreaterThan(city.vx[i - 1]);
    const centre = city.tiles[4];
    expect([centre.tx, centre.ty]).toEqual([2, -1]);
    const mx = (centre.x0 + centre.x1) / 2,
      my = (centre.y0 + centre.y1) / 2;
    expect(city.tileAt(mx, my)).toBe(centre);
    expect(World.tileIndexAt(mx, my)).toEqual({ tx: 2, ty: -1 });
  });

  it("the road graph connects tiles: A* finds routes between far-apart tiles of a window", () => {
    for (const seed of [777, 1234, 99]) {
      World.init(seed);
      const city = World.build(0, 0, 1);
      const pairs: [number, number][] = [
        [city.nodeId(8, 8), city.nodeId(40, 40)],
        [city.nodeId(5, 43), city.nodeId(44, 6)],
        [city.nodeId(24, 24), city.nodeId(24, 3)],
        [city.nodeId(10, 24), city.nodeId(38, 24)],
      ];
      for (const [a, b] of pairs) {
        const p = findPath(city, a, b);
        expect(p, `seed ${seed}: ${a} -> ${b}`).not.toBeNull();
      }
    }
  });

  it("highways run straight across tile corners: the barrier strips stop at the crossing highway", () => {
    const city = World.build(0, 0, 1);
    for (const [ci, cj] of [
      [16, 16],
      [32, 16],
      [16, 32],
      [32, 32],
    ]) {
      const x = city.vx[ci],
        y = city.hy[cj],
        hw = city.vw[ci] / 2 - 1,
        hh = city.hw[cj] / 2 - 1;
      for (const b of city.barriers) {
        const overlaps =
          Math.abs(b.x - x) < b.hx + hw && Math.abs(b.y - y) < b.hy + hh;
        expect(
          overlaps,
          `a barrier blocks the interchange at line (${ci}, ${cj})`,
        ).toBe(false);
      }
    }
    // and there is a barrier on both sides of a shared highway (one from each tile)
    const x = city.vx[16];
    const left = city.barriers.filter(
      (b) => Math.abs(b.x - (x - city.vw[16] / 2 - 0.6)) < 0.01 && b.hy > 20,
    );
    const right = city.barriers.filter(
      (b) => Math.abs(b.x - (x + city.vw[16] / 2 + 0.6)) < 0.01 && b.hy > 20,
    );
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
  });

  it("no building touches a road anywhere in the 9 tiles", () => {
    const city = World.build(-3, 4, 1);
    for (const b of city.buildings) {
      if (b.flat) continue;
      for (let i = 0; i < city.NV; i++)
        if (!(
          b.x1 <= city.vx[i] - city.vw[i] / 2 + 1e-6 ||
          b.x0 >= city.vx[i] + city.vw[i] / 2 - 1e-6
        ))
          throw new Error(
            `building at ${b.x0},${b.y0} overlaps road line ${i}`,
          );
      for (let j = 0; j < city.NH; j++)
        if (!(
          b.y1 <= city.hy[j] - city.hw[j] / 2 + 1e-6 ||
          b.y0 >= city.hy[j] + city.hw[j] / 2 - 1e-6
        ))
          throw new Error(`building at ${b.x0},${b.y0} overlaps road row ${j}`);
    }
  });

  it("moving the window keeps world coordinates: a node id shifted by whole tiles lands on the same point", () => {
    const old = World.build(0, 0, 1);
    for (const [dx, dy] of [
      [1, 0],
      [0, -1],
      [-1, 1],
    ]) {
      const next = World.build(dx, dy, 1);
      const di = (old.tx0 - next.tx0) * TILE,
        dj = (old.ty0 - next.ty0) * TILE;
      for (let k = 0; k < 300; k++) {
        const id = old.randomNode();
        const i = (id % old.NV) + di,
          j = ((id / old.NV) | 0) + dj;
        if (i < 0 || j < 0 || i >= next.NV || j >= next.NH) continue;
        const nid = next.nodeId(i, j);
        expect(next.nodeX(nid)).toBeCloseTo(old.nodeX(id), 6);
        expect(next.nodeY(nid)).toBeCloseTo(old.nodeY(id), 6);
      }
      // shared tiles are literally the same data, so buildings and colliders are not duplicated or lost
      const shared = old.tiles.filter((t) => next.tiles.includes(t));
      expect(shared.length).toBe((3 - Math.abs(dx)) * (3 - Math.abs(dy)));
    }
  });

  it("the tile cache is bounded however far you travel", () => {
    for (let t = 0; t < 120; t++) World.tile(t, (t * 7) % 13);
    expect(World.cache.size).toBeLessThanOrEqual(22);
  });

  it("the window only recentres once the player is 100 m into the next tile", () => {
    const w = World;
    const edge = w.axisV.originOf(1);
    expect(w.centerFor(edge + 40, 500, 0, 0)).toEqual([0, 0]); // just across: stay put
    expect(w.centerFor(edge + 140, 500, 0, 0)).toEqual([1, 0]);
    expect(w.centerFor(edge - 40, 500, 1, 0)).toEqual([1, 0]); // and back again: no flicker
    expect(w.centerFor(edge - 140, 500, 1, 0)).toEqual([0, 0]);
    expect(w.centerFor(-99999, 500, 0, 0)[0]).toBeLessThan(-30); // teleports work too
  });

  it("randomNodeNear picks nodes around the player, not anywhere in a 5 km window", () => {
    const city = World.build(0, 0, 1);
    const px = city.vx[24],
      py = city.hy[24];
    for (let k = 0; k < 200; k++) {
      const n = city.randomNodeNear(px, py, 150, 360);
      const d = Math.hypot(city.nodeX(n) - px, city.nodeY(n) - py);
      expect(d).toBeGreaterThan(40);
      expect(d).toBeLessThan(520);
    }
  });

  it("rivers: bridges are the only crossings, in every tile of a window", () => {
    for (const seed of [777, 4242]) {
      World.init(seed);
      const city = World.build(1, 1, 1);
      for (const t of city.tiles.filter((q) => q.riverCol >= 0)) {
        const a = Math.round(t.tx - city.tx0),
          b = Math.round(t.ty - city.ty0);
        for (let k = 1; k < TILE; k++) {
          const i = a * TILE + t.riverCol,
            j = b * TILE + k;
          const crossable = city
            .neighbors(city.nodeId(i, j))
            .includes(city.nodeId(i + 1, j));
          expect(crossable, `tile ${t.tx},${t.ty} row ${k}`).toBe(
            t.bridgeRows.includes(k),
          );
        }
      }
    }
  });

  it("static collider bodies are created lazily, only for colliders that come near the player", () => {
    World.init(777);
    const city = World.build(0, 0, 1);
    Phys.init(city);
    const withBody = city.statics.filter((s) => s.body).length;
    expect(withBody).toBe(Phys.staticCount()); // only the live ones have a body
    expect(withBody).toBeLessThan(city.statics.length / 5);
    Phys.streamStatics(3000, 3000); // somewhere else inside the window
    expect(Phys.staticCount()).toBeGreaterThan(0);
    expect(city.statics.filter((s) => s.body).length).toBeGreaterThan(withBody); // new ones got bodies on arrival
    // swapping to another window takes the old window's bodies out of the physics world
    const next = World.build(2, 2, 1);
    Phys.setStatics(next.statics, 4500, 4500);
    const stale = city.statics.filter((s) => s.on && !next.statics.includes(s));
    expect(stale.length).toBe(0);
    expect(Phys.engine!.world.bodies.filter((b) => b.isStatic).length).toBe(
      Phys.staticCount(),
    );
  });

  it("there is no outer wall: a car can drive 20 km along a highway without hitting anything", () => {
    World.init(777);
    const city = World.build(0, 0, 1);
    expect(city.walls.length).toBe(0);
    Phys.init({ buildings: [], walls: [], statics: [] });
    const car = new Car(PLAYER_CARS[0], "player");
    Phys.addCar(car);
    car.place(0, 7, 0);
    car.setSpeed(60);
    const hit = vi.fn();
    game.onImpact = hit;
    for (let i = 0; i < 360 / (1 / 60); i++) {
      car.ctrl.throttle = 1;
      car.applyControls(1 / 60, SURF.asphalt);
      Phys.step(1 / 60);
      car.readBack();
      if (i % 600 === 0) Phys.streamStatics(car.x, car.y);
    }
    expect(car.x).toBeGreaterThan(20000);
    expect(hit).not.toHaveBeenCalled();
  });
});

describe("performance structures", () => {
  it("A* with the binary heap finds a path as cheap as a plain Dijkstra search", () => {
    const city = World.build(0, 0, 1);
    const dist = (a: number, b: number) =>
      Math.hypot(city.nodeX(a) - city.nodeX(b), city.nodeY(a) - city.nodeY(b));
    const cost = (p: number[]) =>
      p.slice(1).reduce((s, n, i) => s + dist(p[i], n), 0);
    const reference = (from: number, to: number): number => {
      const d = new Map<number, number>([[from, 0]]);
      const done = new Set<number>();
      for (;;) {
        let cur = -1,
          best = Infinity;
        for (const [k, v] of d)
          if (!done.has(k) && v < best) {
            cur = k;
            best = v;
          }
        if (cur < 0) return Infinity;
        if (cur === to) return best;
        done.add(cur);
        for (const nb of city.neighbors(cur)) {
          const c = best + dist(cur, nb);
          if (c < (d.get(nb) ?? Infinity)) d.set(nb, c);
        }
      }
    };
    const rnd = (n: number) => (n * 2654435761) % city.nodeCount;
    for (let i = 1; i <= 4; i++) {
      const a = city.centerNode(),
        b = rnd(i * 7919);
      const p = findPath(city, a, b);
      expect(p).not.toBeNull();
      expect(p![0]).toBe(a);
      expect(p![p!.length - 1]).toBe(b);
      expect(cost(p!)).toBeCloseTo(reference(a, b), 1);
    }
  });

  it("neighborsInto fills a reused array with exactly the neighbours", () => {
    const city = World.build(0, 0, 1);
    const out: number[] = [99, 98, 97];
    for (let id = 0; id < city.nodeCount; id += 37) {
      city.neighborsInto(id, out);
      expect(out).toEqual(city.neighbors(id));
    }
  });

  it("surface lookups find gravel in every tile of a window, not only the first", () => {
    const city = World.build(1, 1, 1);
    for (const t of city.tiles) {
      for (const g of t.gravel)
        expect(city.surfaceAt((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2).kind).toBe(
          "gravel",
        );
    }
    expect(
      city.tiles.filter((t) => t.gravel.length > 0).length,
    ).toBeGreaterThan(3);
  });
});

describe("bends and roundabouts", () => {
  let city = World.build(0, 0, 1);
  beforeEach(() => {
    World.init(); // other tests may have switched seeds
    city = World.build(0, 0, 1);
  });
  const nodeOf = (t: Tile, i: number, j: number) => {
    const a = city.tiles.indexOf(t) % 3,
      b = Math.floor(city.tiles.indexOf(t) / 3);
    return city.nodeId(a * TILE + i, b * TILE + j);
  };

  it("every tile has bends and roundabouts, deterministically, clear of the ring, river and spawn", () => {
    for (const t of city.tiles) {
      expect(
        t.supers.filter((s) => s.kind === "bend").length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        t.supers.filter((s) => s.kind === "round").length,
      ).toBeGreaterThanOrEqual(1);
      const used = new Set<string>();
      for (const s of t.supers) {
        expect(s.i).toBeGreaterThan(0);
        expect(s.j).toBeGreaterThan(0);
        expect(s.i + 2).toBeLessThan(TILE);
        expect(s.j + 2).toBeLessThan(TILE);
        expect(s.i <= 8 && 8 <= s.i + 2 && s.j <= 8 && 8 <= s.j + 2).toBe(
          false,
        );
        if (t.riverCol >= 0)
          expect(s.i > t.riverCol + 1 || s.i + 2 < t.riverCol).toBe(true);
        for (let dj = 0; dj < 3; dj++)
          for (let di = 0; di < 3; di++) {
            const k = s.i + di + "," + (s.j + dj);
            expect(used.has(k)).toBe(false); // no two share a crossing
            used.add(k);
          }
        for (const b of t.blocks) if (b.sb === s) expect(b.type).toBe("park");
      }
    }
    World.cache.clear();
    const again = World.build(0, 0, 1);
    expect(again.tiles[4].supers.map((s) => [s.i, s.j, s.kind])).toEqual(
      city.tiles[4].supers.map((s) => [s.i, s.j, s.kind]),
    );
  });

  it("a bend park has no centre crossing, and its two arcs join mid-side crossings both ways", () => {
    for (const t of city.tiles)
      for (const s of t.supers.filter((q) => q.kind === "bend")) {
        const c = nodeOf(t, s.ci, s.cj);
        expect(city.isDead(c)).toBe(true);
        expect(city.neighbors(c)).toEqual([]);
        expect(city.roundAt(c)).toBeUndefined();
        // the dead crossing never comes out of nearestNode
        expect(city.nearestNode(s.cx, s.cy)).not.toBe(c);
        expect(s.arcs).toHaveLength(2);
        for (const r of s.arcs) {
          const a = nodeOf(t, r.ai, r.aj),
            b = nodeOf(t, r.bi, r.bj);
          expect(city.neighbors(a)).toContain(b);
          expect(city.neighbors(b)).toContain(a);
          expect(city.neighbors(a)).not.toContain(c);
          expect(city.isCurve(a, b)).toBe(true);
          expect(city.edgeLength(a, b)).toBeCloseTo(r.len, 5);
          // it leaves its crossing straight along a street: the tangent is axis-aligned at both ends
          const out = { x: 0, y: 0, ux: 0, uy: 0, len: 0 };
          for (const s0 of [0, r.len]) {
            city.edgePoint(a, b, s0, 0, out);
            expect(Math.min(Math.abs(out.ux), Math.abs(out.uy))).toBeLessThan(
              0.12,
            );
          }
          // an arc is long and smooth: about a quarter turn
          expect(r.len).toBeGreaterThan(
            Math.hypot(
              city.nodeX(a) - city.nodeX(b),
              city.nodeY(a) - city.nodeY(b),
            ),
          );
        }
      }
  });

  it("surfaces: lawn over a removed street, asphalt on an arc, island / ring / outside on a roundabout", () => {
    for (const t of city.tiles) {
      for (const s of t.supers) {
        if (s.kind === "bend") {
          expect(city.surfaceAt(s.cx, s.cy).kind).toBe("grass");
          const r = s.arcs[0],
            m = r.pts.length >> 1;
          expect(
            city.surfaceAt(r.pts[m - (m % 2)], r.pts[m - (m % 2) + 1]).kind,
          ).toBe("asphalt");
        } else {
          expect(city.roundAt(nodeOf(t, s.ci, s.cj))).toBeDefined();
          expect(city.surfaceAt(s.cx, s.cy).kind).toBe("grass"); // the island
          expect(city.surfaceAt(s.cx + (s.ri + s.ro) / 2, s.cy).kind).toBe(
            "asphalt",
          ); // the ring
          expect(
            city.surfaceAt(s.cx + s.ro + 6, s.cy + s.ro + 6).kind,
          ).not.toBe("asphalt"); // beside the arms: the park
        }
      }
    }
  });

  it("never run into a building, the river or the highway ring", () => {
    for (const t of city.tiles)
      for (const r of t.curves) {
        for (let q = 0; q < r.pts.length; q += 2) {
          expect(city.inWater(r.pts[q], r.pts[q + 1])).toBe(false);
          expect(city.pointInBuilding(r.pts[q], r.pts[q + 1])).toBe(false);
          const q0 = Math.max(0, q - 2),
            q1 = Math.min(r.pts.length - 2, q + 2);
          const tx = r.pts[q1] - r.pts[q0],
            ty = r.pts[q1 + 1] - r.pts[q0 + 1];
          const tl = Math.hypot(tx, ty) || 1;
          for (const sgn of [-1, 1])
            expect(
              city.pointInBuilding(
                r.pts[q] - (ty / tl) * 6 * sgn,
                r.pts[q + 1] + (tx / tl) * 6 * sgn,
              ),
            ).toBe(false);
        }
      }
  });

  it("a lane driver follows a whole bend without leaving the asphalt", () => {
    const t = city.tiles[4];
    const sb = t.supers.find((s) => s.kind === "bend")!;
    const r = sb.arcs[0];
    const a = nodeOf(t, r.ai, r.aj),
      b = nodeOf(t, r.bi, r.bj);
    Phys.init({ buildings: [], walls: [] });
    const car = new Car(TRAFFIC_CARS[0], "civil");
    Phys.addCar(car);
    const p = city.lanePoint(a, b, 0.02);
    car.place(p.x, p.y, Math.atan2(p.uy, p.ux));
    car.setSpeed(6);
    const drv = new LaneDriver(city, a, b);
    drv.speedCap = 12;
    let steps = 0;
    while (drv.a === a && steps < 60 * 60) {
      carGrid.rebuild([car]);
      drv.control(car, 1 / 60);
      car.applyControls(1 / 60, city.surfaceAt(car.x, car.y));
      Phys.step(1 / 60);
      car.readBack();
      expect(city.surfaceAt(car.x, car.y).kind).not.toBe("grass");
      steps++;
    }
    expect(drv.a).not.toBe(a); // it reached the far end and moved on
    expect(steps).toBeLessThan(60 * 40);
  });
});

describe("right of way and roundabouts", () => {
  let city = World.build(0, 0, 1);
  // route choices use Math.random: a fixed sequence keeps these simulations reproducible
  const realRandom = Math.random;
  beforeEach(() => {
    let seed = 7;
    Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  });
  afterEach(() => {
    Math.random = realRandom;
  });
  beforeEach(() => {
    World.init();
    city = World.build(0, 0, 1);
    Traffic.clearHolds();
    Phys.init({ buildings: [], walls: [] });
  });

  /** a plain 4-way crossing near the middle of the window (not in a bend or roundabout park) */
  const crossing = (): number => {
    for (let r = 0; r < 12; r++) {
      for (const [di, dj] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 1],
        [-1, -1],
      ]) {
        const i = 24 + r * 2 + di,
          j = 24 + dj;
        const id = city.nodeId(i, j);
        if (
          city.neighbors(id).length === 4 &&
          !city.roundAt(id) &&
          city.vt[i] !== "alley" &&
          city.ht[j] !== "alley" &&
          i % 16 &&
          j % 16
        )
          if (city.neighbors(id).every((m) => !city.isCurve(id, m))) return id;
      }
    }
    throw new Error("no plain crossing found");
  };

  const mkCar = (_id: number, from: number, to: number, toEnd: number): Car => {
    const car = new Car(TRAFFIC_CARS[0], "civil");
    Phys.addCar(car);
    const len = city.edgeLength(from, to);
    const p = city.lanePoint(from, to, 1 - toEnd / len);
    car.place(p.x, p.y, Math.atan2(p.uy, p.ux));
    car.setSpeed(5);
    return car;
  };

  it("two cars arriving on crossing paths are never granted the junction together; the second goes once the first is clear", () => {
    const n = crossing();
    const nb = city.neighbors(n);
    const west = nb.find((m) => city.nodeX(m) < city.nodeX(n))!,
      east = nb.find((m) => city.nodeX(m) > city.nodeX(n))!,
      north = nb.find((m) => city.nodeY(m) < city.nodeY(n))!,
      south = nb.find((m) => city.nodeY(m) > city.nodeY(n))!;
    const carA = mkCar(1, west, n, 12),
      carB = mkCar(2, north, n, 12);
    const A = new LaneDriver(city, west, n),
      B = new LaneDriver(city, north, n);
    A.next = east; // straight on
    B.next = south; // straight on, across A
    carGrid.rebuild([carA, carB]);
    A.control(carA, 1 / 60);
    B.control(carB, 1 / 60);
    const granted = () => Traffic.holdsAt(n).filter((h) => h.granted).length;
    expect(Traffic.holdsAt(n)).toHaveLength(2);
    expect(granted()).toBe(1); // exactly one of them may enter
    // the waiting car is braking for the line, the other is free
    const waiter = A.hold!.granted ? B : A;
    const goer = A.hold!.granted ? A : B;
    expect(waiter.hold!.granted).toBe(false);
    // a few more ticks: still only one
    for (let k = 0; k < 30; k++) {
      Traffic.advance(1 / 60);
      A.control(carA, 1 / 60);
      B.control(carB, 1 / 60);
      expect(granted()).toBe(1);
    }
    // the first car is through: move it 25 m into its exit road, then the other is let in
    const goerCar = goer === A ? carA : carB;
    const out = goer === A ? east : south;
    const p = city.edgePoint(n, out, 25, city.laneOffset(n, out), {
      x: 0,
      y: 0,
      ux: 0,
      uy: 0,
      len: 0,
    });
    goerCar.place(p.x, p.y, Math.atan2(p.uy, p.ux));
    goerCar.setSpeed(8);
    goer.a = n;
    goer.b = out;
    goer.next = -1;
    for (let k = 0; k < 10; k++) {
      Traffic.advance(1 / 60);
      carGrid.rebuild([carA, carB]);
      goer.control(goerCar, 1 / 60);
      waiter.control(waiter === A ? carA : carB, 1 / 60);
    }
    expect(waiter.hold!.granted).toBe(true);
    expect(goer.hold).toBeNull();
  });

  it("opposite straight-through cars share a junction, a left turn across oncoming traffic does not", () => {
    const n = crossing();
    const nb = city.neighbors(n);
    const west = nb.find((m) => city.nodeX(m) < city.nodeX(n))!,
      east = nb.find((m) => city.nodeX(m) > city.nodeX(n))!,
      south = nb.find((m) => city.nodeY(m) > city.nodeY(n))!;
    const cars = [mkCar(1, west, n, 12), mkCar(2, east, n, 12)];
    const A = new LaneDriver(city, west, n),
      B = new LaneDriver(city, east, n);
    A.next = east;
    B.next = west;
    carGrid.rebuild(cars);
    A.control(cars[0], 1 / 60);
    B.control(cars[1], 1 / 60);
    expect(Traffic.holdsAt(n).filter((h) => h.granted)).toHaveLength(2);
    Traffic.clearHolds();
    // now B turns left across A's path (arriving from the east, turning south)
    const B2 = new LaneDriver(city, east, n);
    B2.next = south;
    const A2 = new LaneDriver(city, west, n);
    A2.next = east;
    A2.control(cars[0], 1 / 60);
    B2.control(cars[1], 1 / 60);
    expect(Traffic.holdsAt(n).filter((h) => h.granted)).toHaveLength(1);
  });

  it("a car enters a roundabout, goes round it and leaves by the arm it chose, on the asphalt", () => {
    const t = city.tiles[4];
    const sb = t.supers.find((s) => s.kind === "round")!;
    const idOf = (i: number, j: number) => city.nodeId(TILE + i, TILE + j);
    const C = idOf(sb.ci, sb.cj);
    const from = idOf(sb.ci - 1, sb.cj), // the west arm, heading east
      exit = idOf(sb.ci, sb.cj - 1); // out by the north arm: a left turn, almost all the way round
    expect(city.roundAt(C)).toBeDefined();
    const car = new Car(TRAFFIC_CARS[0], "civil");
    Phys.addCar(car);
    const p = city.lanePoint(from, C, 0.8);
    car.place(p.x, p.y, Math.atan2(p.uy, p.ux));
    car.setSpeed(6);
    const drv = new LaneDriver(city, from, C);
    drv.next = exit;
    let steps = 0,
      sawRing = false;
    while (!(drv.a === C && drv.b === exit) && steps < 60 * 60) {
      Traffic.advance(1 / 60);
      carGrid.rebuild([car]);
      drv.control(car, 1 / 60);
      if (drv.ring) sawRing = true;
      car.applyControls(1 / 60, city.surfaceAt(car.x, car.y));
      Phys.step(1 / 60);
      car.readBack();
      expect(city.surfaceAt(car.x, car.y).kind).not.toBe("sidewalk");
      steps++;
    }
    expect(sawRing).toBe(true);
    expect(drv.b).toBe(exit);
    // it ends up on the north arm, heading north
    expect(car.y).toBeLessThan(sb.cy);
    expect(Math.abs(car.x - sb.cx)).toBeLessThan(8);
    expect(steps).toBeLessThan(60 * 40);
  });

  it("a car waits for a car already on the ring before it enters", () => {
    const t = city.tiles[4];
    const sb = t.supers.find((s) => s.kind === "round")!;
    const idOf = (i: number, j: number) => city.nodeId(TILE + i, TILE + j);
    const C = idOf(sb.ci, sb.cj),
      from = idOf(sb.ci - 1, sb.cj);
    const rc = (sb.ri + sb.ro) / 2;
    const me = new Car(TRAFFIC_CARS[0], "civil"),
      ring = new Car(TRAFFIC_CARS[1], "civil");
    Phys.addCar(me);
    Phys.addCar(ring);
    const p = city.lanePoint(
      from,
      C,
      1 - (sb.ro + 2) / city.edgeLength(from, C),
    );
    me.place(p.x, p.y, Math.atan2(p.uy, p.ux));
    me.setSpeed(1);
    // a car on the circle just upstream of our entry point (it will pass in front of us)
    const phi = Math.atan2(me.y - sb.cy, me.x - sb.cx) + 0.5;
    ring.place(
      sb.cx + Math.cos(phi) * rc,
      sb.cy + Math.sin(phi) * rc,
      phi - Math.PI / 2,
    );
    ring.setSpeed(5);
    const drv = new LaneDriver(city, from, C);
    drv.next = idOf(sb.ci + 1, sb.cj);
    carGrid.rebuild([me, ring]);
    drv.control(me, 1 / 60);
    expect(drv.ring).toBeNull(); // it holds at the line
    ring.place(sb.cx - rc, sb.cy + 40, 0); // the ring is clear again
    carGrid.rebuild([me, ring]);
    me.place(p.x, p.y, Math.atan2(p.uy, p.ux));
    drv.control(me, 1 / 60);
    expect(drv.ring).not.toBeNull();
  });

  it("110 vehicles (cars, motorcycles and lorries) packed into town drive for 90 seconds without a single civilian-civilian collision, and nobody sits stuck", () => {
    const rnd = (() => {
      let s = 12345;
      return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    })();
    const centre = {
      x: city.nodeX(city.centerNode()),
      y: city.nodeY(city.centerNode()),
    };
    const cars: Car[] = [],
      drivers: LaneDriver[] = [];
    for (let tries = 0; tries < 6000 && cars.length < 110; tries++) {
      const n = city.nodeId(
        (24 - 7 + rnd() * 14) | 0,
        (24 - 7 + rnd() * 14) | 0,
      );
      if (
        city.isDead(n) ||
        Math.hypot(city.nodeX(n) - centre.x, city.nodeY(n) - centre.y) > 700
      )
        continue;
      const nb = city.neighbors(n);
      if (!nb.length) continue;
      const to = nb[(rnd() * nb.length) | 0];
      const p = city.lanePoint(n, to, 0.2 + rnd() * 0.5);
      // one vehicle in ten is a motorcycle and one in eight a lorry or pickup, as on the real road
      const k = cars.length;
      const spec =
        k % 10 === 4
          ? TRAFFIC_BIKES[((k / 10) | 0) % TRAFFIC_BIKES.length]
          : k % 8 === 2
            ? TRAFFIC_TRUCKS[[0, 1, 0, 2][((k / 8) | 0) % 4]]
            : TRAFFIC_CARS[k % TRAFFIC_CARS.length];
      if (cars.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 14 + 2 * Math.max(0, spec.len * 0.485 - 2.4))) continue;
      const car = new Car(spec, "civil");
      Phys.addCar(car);
      car.place(p.x, p.y, Math.atan2(p.uy, p.ux));
      car.setSpeed(6);
      const d = new LaneDriver(city, n, to);
      d.speedCap = (9 + rnd() * 6) * (spec.truck ? 0.8 : 1);
      cars.push(car);
      drivers.push(d);
    }
    expect(cars.length).toBeGreaterThan(80);
    expect(cars.filter((c) => c.spec.truck).length).toBeGreaterThan(8);
    let crashes = 0;
    const was = game.onImpact;
    game.onImpact = (a, b) => {
      if (a && b && a.kind === "civil" && b.kind === "civil") crashes++;
    };
    const stuckFor = new Array(cars.length).fill(0);
    let worstStuck = 0;
    for (let step = 0; step < 90 * 60; step++) {
      Traffic.advance(1 / 60);
      carGrid.rebuild(cars);
      for (let i = 0; i < cars.length; i++) drivers[i].control(cars[i], 1 / 60);
      for (const c of cars) c.applyControls(1 / 60, city.surfaceAt(c.x, c.y));
      Phys.step(1 / 60);
      for (const c of cars) c.readBack();
      for (let i = 0; i < cars.length; i++) {
        stuckFor[i] = cars[i].speed < 0.5 ? stuckFor[i] + 1 / 60 : 0;
        worstStuck = Math.max(worstStuck, stuckFor[i]);
      }
    }
    game.onImpact = was;
    expect(crashes).toBe(0);
    expect(worstStuck).toBeLessThan(25);
  });
});

describe("no escaping in a straight line", () => {
  /** drive the player at 50 m/s for `secs`, turning by `turn` radians every `every` seconds, with no cops around */
  function drive(
    secs: number,
    turn: number,
    every: number,
  ): ReturnType<typeof vi.fn> {
    World.init();
    const city = World.build(0, 0, 1);
    game.city = city;
    Phys.init({ buildings: [], walls: [] });
    const car = new Car(PLAYER_CARS[0], "player");
    car.place(city.nodeX(city.centerNode()), city.nodeY(city.centerNode()), 0);
    game.player = { car, spec: PLAYER_CARS[0] };
    game.cops.length = 0;
    const endRun = vi.fn();
    game.endRun = endRun;
    heat.reset();
    heat.start("TEST");
    let heading = 0;
    for (let t = 0; t < secs; t += 0.1) {
      if (
        turn &&
        Math.floor(t / every) !== Math.floor((t - 0.1) / every) &&
        t > 0
      )
        heading += turn;
      car.theta = heading;
      car.speed = 50;
      car.wvx = Math.cos(heading) * 50;
      car.wvy = Math.sin(heading) * 50;
      car.x += car.wvx * 0.1;
      car.y += car.wvy * 0.1;
      heat.spawnT = 1e9; // no new cops: only the evade rules are under test
      heat.blockT = heat.spikeT = heat.hwyBlockT = 1e9;
      heat.update(0.1);
    }
    return endRun;
  }

  it("holding one heading stops the evade meter, so you can't just run", () => {
    const endRun = drive(40, 0, 1);
    expect(heat.predictable).toBe(true);
    expect(heat.evade).toBeLessThan(heat.evadeNeeded);
    expect(endRun).not.toHaveBeenCalled();
  });

  it("real turns still let you shake them", () => {
    const endRun = drive(40, 1.2, 4);
    expect(endRun).toHaveBeenCalledWith("escaped");
  });
});

describe("cash, garage, combos and daily challenges", () => {
  const fresh = (): SaveData => migrateSave({});

  it("an old save turns its banked bounty into cash and keeps the car you last drove", () => {
    const s = migrateSave({ best: 900, total: 4200, longest: 60, car: 3 } as Partial<SaveData>);
    expect(s.v).toBe(2);
    expect(s.cash).toBe(4200);
    expect(s.owned).toEqual([PLAYER_CARS[0].id, PLAYER_CARS[3].id]);
    expect(s.streak).toBe(0);
    // a current save is left alone
    const again = migrateSave({ ...s, cash: 17 });
    expect(again.cash).toBe(17);
    expect(again.owned).toEqual(s.owned);
    // junk does not crash
    expect(migrateSave({ cash: Number.NaN, owned: [] as string[] } as Partial<SaveData>).owned).toEqual([PLAYER_CARS[0].id]);
  });

  it("cars and upgrades cost money, and only affordable purchases go through", () => {
    const s = fresh();
    const rose = PLAYER_CARS[1].id;
    expect(carPrice(PLAYER_CARS[0].id)).toBe(0);
    expect(buyCar(s, rose)).toBe(false); // no money
    expect(s.owned).not.toContain(rose);
    s.cash = carPrice(rose) + 100;
    expect(buyCar(s, rose)).toBe(true);
    expect(s.cash).toBe(100);
    expect(buyCar(s, rose)).toBe(false); // already owned
    expect(buyUpgrade(s, rose, 0)).toBe(false); // too poor
    s.cash = 1e6;
    for (let i = 0; i < MAX_LEVEL; i++) expect(buyUpgrade(s, rose, 1)).toBe(true);
    expect(buyUpgrade(s, rose, 1)).toBe(false); // maxed
    expect(levelsOf(s, rose)).toEqual([0, MAX_LEVEL, 0, 0]);
    expect(buyUpgrade(s, PLAYER_CARS[5].id, 0)).toBe(false); // not owned
    expect(upgradeCost(rose, 2)).toBeGreaterThan(upgradeCost(rose, 0));
    expect(nextUnlock(s)?.price).toBeGreaterThan(0);
  });

  it("upgrades make a better copy of the car and never touch the catalogue", () => {
    const base = PLAYER_CARS[2];
    const top = base.top;
    expect(applyUpgrades(base, undefined)).toBe(base);
    const up = applyUpgrades(base, [3, 3, 3, 3]);
    expect(up.top).toBeCloseTo(top * 1.12);
    expect(up.accel).toBeCloseTo(base.accel * 1.18);
    expect(up.grip).toBeCloseTo(base.grip * 1.12);
    expect(up.durability).toBeCloseTo(base.durability * 1.36);
    expect(up.nitroPower).toBeGreaterThan(base.nitroPower);
    expect(base.top).toBe(top);
    expect(estimate(up).t100).toBeLessThan(estimate(base).t100);
  });

  it("the same date always brings the same three different challenges", () => {
    const a = pickDaily("2026-11-26"),
      b = pickDaily("2026-11-26");
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(new Set(a.map((id) => challengeById(id)!.stat)).size).toBe(3);
    const days = new Set<string>();
    for (let d = 1; d <= 20; d++) days.add(pickDaily(`2026-12-${String(d).padStart(2, "0")}`).join());
    expect(days.size).toBeGreaterThan(5); // it does change from day to day
  });

  it("a challenge pays once when finished, and finishing all three builds the streak", () => {
    const s = fresh();
    const day1 = "2026-03-10";
    const d = ensureDaily(s, day1);
    const stats = d.ids.map((id) => challengeById(id)!);
    let paid = 0;
    for (let i = 0; i < 3; i++) {
      const c = stats[i];
      // half way: nothing yet
      if (c.goal > 1) expect(trackDaily(s, c.stat, c.goal / 2, day1)).toHaveLength(0);
      const ev = trackDaily(s, c.stat, c.goal, day1);
      expect(ev).toHaveLength(1);
      paid += ev[0].reward;
      expect(trackDaily(s, c.stat, c.goal, day1)).toHaveLength(0); // done: no second payout
    }
    expect(s.cash).toBe(paid);
    expect(s.streak).toBe(1);
    expect(s.lastDailyDone).toBe(day1);
    expect(activeStreak(s, day1)).toBe(1);
    expect(activeStreak(s, "2026-03-11")).toBe(1); // still alive the next day
    expect(activeStreak(s, "2026-03-12")).toBe(0); // a missed day breaks it
    // the next day: a fresh set, and finishing it extends the streak
    const day2 = "2026-03-11";
    const d2 = ensureDaily(s, day2);
    expect(d2.date).toBe(day2);
    expect(d2.done.some(Boolean)).toBe(false);
    for (const id of d2.ids) trackDaily(s, challengeById(id)!.stat, 1000, day2);
    expect(s.streak).toBe(2);
    // a gap resets it to 1
    const day5 = "2026-03-15";
    for (const id of ensureDaily(s, day5).ids) trackDaily(s, challengeById(id)!.stat, 1000, day5);
    expect(s.streak).toBe(1);
    expect(yesterdayKey("2026-03-01")).toBe("2026-02-28");
  });

  describe("combos", () => {
    const cash: number[] = [],
      stats: [string, number][] = [];
    beforeEach(() => {
      cash.length = 0;
      stats.length = 0;
      game.heat = heat;
      heat.reset();
      Combo.reset();
      Combo.sinks = { cash: (n) => cash.push(n), stat: (k, n) => stats.push([k, n]) };
    });

    it("each skill raises the multiplier, and the chain pays out when it runs out", () => {
      Combo.add(100, "A");
      expect(Combo.pending).toBe(100);
      expect(Combo.mult).toBe(1.25);
      Combo.add(100, "B");
      expect(Combo.pending).toBe(225); // 100 + 100 * 1.25
      const pl = new Car(PLAYER_CARS[0], "player");
      carGrid.rebuild([pl]);
      for (let t = 0; t < 4.2 * 60; t++) Combo.update(1 / 60, pl);
      expect(Combo.pending).toBe(0);
      expect(Combo.mult).toBe(1);
      expect(cash).toEqual([113]); // free roam: half goes straight to the wallet
      expect(Combo.earned).toBe(113);
    });

    it("in a pursuit the money goes onto the bounty, scaled by the heat level, and a crash loses it", () => {
      const car = new Car(PLAYER_CARS[0], "player");
      car.place(0, 0, 0);
      game.player = { car, spec: PLAYER_CARS[0] };
      heat.start("TEST", 3);
      const before = heat.bounty;
      Combo.add(200, "A");
      Combo.bank();
      expect(heat.bounty - before).toBe(Math.round(200 * (1 + 0.25 * 3)));
      expect(cash).toHaveLength(0);
      Combo.add(500, "B");
      Combo.lose();
      expect(Combo.pending).toBe(0);
      expect(Combo.mult).toBe(1);
      const b2 = heat.bounty;
      Combo.bank();
      expect(heat.bounty).toBe(b2); // nothing left to bank
      heat.reset();
    });

    it("the multiplier is capped and reaching x3 is reported once", () => {
      for (let i = 0; i < 30; i++) Combo.add(10, "S");
      expect(Combo.mult).toBe(5);
      expect(Combo.bestMult).toBe(5);
      expect(stats.filter(([k]) => k === "mult3")).toHaveLength(1);
    });

    // a player doing 20 m/s passes a civilian coming the other way, 2.5 m to the side
    const pass = (touch: boolean): number => {
      const pl = new Car(PLAYER_CARS[0], "player"),
        civ = new Car(TRAFFIC_CARS[0], "civil");
      pl.place(0, 0, 0);
      pl.setSpeed(20);
      civ.place(70, -2.5, Math.PI);
      civ.setSpeed(20);
      let hits = 0;
      for (let t = 0; t < 4 * 60; t++) {
        pl.x += (20 / 60) * 1;
        civ.x -= 20 / 60;
        carGrid.rebuild([pl, civ]);
        if (touch && Math.abs(pl.x - civ.x) < 4) Combo.markHit(civ);
        Combo.update(1 / 60, pl);
      }
      for (const [k] of stats) if (k === "near") hits++;
      return hits;
    };

    it("a close pass at speed is a near miss, and touching the car cancels it", () => {
      expect(pass(false)).toBe(1);
      expect(Combo.pending).toBeGreaterThanOrEqual(60);
      stats.length = 0;
      Combo.reset();
      expect(pass(true)).toBe(0);
      expect(Combo.pending).toBe(0);
    });

    it("a slow pass, or a wide one, is not a near miss", () => {
      const pl = new Car(PLAYER_CARS[0], "player"),
        civ = new Car(TRAFFIC_CARS[0], "civil");
      pl.place(0, 0, 0);
      pl.setSpeed(8); // too slow
      civ.place(40, -2.5, Math.PI);
      civ.setSpeed(8);
      for (let t = 0; t < 4 * 60; t++) {
        pl.x += 8 / 60;
        civ.x -= 8 / 60;
        carGrid.rebuild([pl, civ]);
        Combo.update(1 / 60, pl);
      }
      pl.place(0, 0, 0);
      pl.setSpeed(20);
      civ.place(70, -5, Math.PI); // a whole lane away
      civ.setSpeed(20);
      for (let t = 0; t < 4 * 60; t++) {
        pl.x += 20 / 60;
        civ.x -= 20 / 60;
        carGrid.rebuild([pl, civ]);
        Combo.update(1 / 60, pl);
      }
      expect(stats.filter(([k]) => k === "near")).toHaveLength(0);
    });
  });
});

describe("motorcycles", () => {
  const bikes = PLAYER_CARS.filter((c) => c.bike);

  beforeEach(() => {
    Phys.init({ buildings: [], walls: [] });
  });

  /** drive a vehicle for `secs` with fixed controls on one surface, from `v0` m/s */
  function drive(spec: (typeof PLAYER_CARS)[number], surf: (typeof SURF)[keyof typeof SURF], secs: number, v0: number, steer: number, throttle: number): Car {
    Phys.reset();
    const car = new Car(spec, "player");
    Phys.addCar(car);
    car.place(0, 0, 0);
    car.setSpeed(v0);
    car.ctrl.throttle = throttle;
    car.ctrl.steer = steer;
    for (let i = 0; i < secs / DT; i++) {
      car.applyControls(DT, surf);
      Phys.step(DT);
      car.readBack();
    }
    return car;
  }

  it("there are three bikes, narrower and lighter than any car, each with a top and a side picture", () => {
    expect(bikes.map((b) => b.id).sort()).toEqual(["cruiser", "dirt", "race"]);
    for (const b of bikes) {
      expect(b.side).toBeTruthy();
      expect(ALL_CAR_FILES).toContain(b.file);
      expect(ALL_CAR_FILES).toContain(b.side);
      expect(b.hitW).toBeLessThan(1);
      expect(b.mass).toBeLessThan(500);
      expect(b.durability).toBeLessThan(1);
      expect(carPrice(b.id)).toBeGreaterThan(0);
    }
    expect(Math.max(...bikes.map((b) => b.top))).toBeGreaterThan(Math.max(...PLAYER_CARS.filter((c) => !c.bike).map((c) => c.top)));
  });

  it("a bike leans into a turn: right turn to the right, left turn to the left, within the limit", () => {
    const right = drive(bikes.find((b) => b.id === "race")!, SURF.asphalt, 1.5, 28, 1, 0.4);
    expect(right.lean).toBeGreaterThan(0.2);
    expect(right.lean).toBeLessThanOrEqual(0.75);
    const left = drive(bikes.find((b) => b.id === "race")!, SURF.asphalt, 1.5, 28, -1, 0.4);
    expect(left.lean).toBeLessThan(-0.2);
    expect(left.lean).toBeGreaterThanOrEqual(-0.75);
    const straight = drive(bikes.find((b) => b.id === "race")!, SURF.asphalt, 1.5, 28, 0, 0.4);
    expect(Math.abs(straight.lean)).toBeLessThan(0.03);
  });

  it("cars never lean, and a bike in the air straightens up", () => {
    expect(drive(PLAYER_CARS[0], SURF.asphalt, 1.5, 28, 1, 0.4).lean).toBe(0);
    const bike = drive(bikes[0], SURF.asphalt, 1, 28, 1, 0.4);
    expect(bike.lean).toBeGreaterThan(0.1);
    bike.launch(1);
    for (let i = 0; i < 0.6 / DT; i++) {
      bike.applyControls(DT, SURF.asphalt);
      Phys.step(DT);
      bike.readBack();
    }
    expect(Math.abs(bike.lean)).toBeLessThan(0.1);
  });

  it("the dirt bike gets going on grass better than the road bike", () => {
    const dirt = drive(bikes.find((b) => b.id === "dirt")!, SURF.grass, 4, 3, 0, 1);
    const race = drive(bikes.find((b) => b.id === "race")!, SURF.grass, 4, 3, 0, 1);
    expect(dirt.speed).toBeGreaterThan(race.speed * 1.05);
    // and on asphalt the road bike is the faster one
    const dirtRoad = drive(bikes.find((b) => b.id === "dirt")!, SURF.asphalt, 6, 3, 0, 1);
    const raceRoad = drive(bikes.find((b) => b.id === "race")!, SURF.asphalt, 6, 3, 0, 1);
    expect(raceRoad.speed).toBeGreaterThan(dirtRoad.speed);
  });
});

describe("lorries in traffic", () => {
  const trucks = TRAFFIC_TRUCKS;

  beforeEach(() => {
    World.init();
    Traffic.clearHolds();
    Phys.init({ buildings: [], walls: [] });
  });

  it("there are three of them, long and heavy, only in traffic, with their pictures preloaded", () => {
    expect(trucks.map((t) => t.id)).toEqual(["pickup", "box", "container"]);
    for (const t of trucks) {
      expect(t.truck).toBe(true);
      expect(PLAYER_CARS.some((c) => c.id === t.id)).toBe(false); // never in the garage
      expect(ALL_CAR_FILES).toContain(t.file);
      expect(t.mass).toBeGreaterThan(2400);
      expect(t.len).toBeGreaterThan(Math.max(...PLAYER_CARS.filter((c) => !c.bike).map((c) => c.len)));
    }
    expect(trucks[2].len).toBeGreaterThan(trucks[1].len);
    expect(trucks[1].len).toBeGreaterThan(trucks[0].len);
  });

  /** a follower comes up to a stopped vehicle in the same lane; returns the gap left between its nose and the other's tail */
  function followGap(lead: (typeof trucks)[number], follower: (typeof trucks)[number]): { gap: number; speed: number } {
    Phys.reset();
    const a = new Car(follower, "civil"),
      b = new Car(lead, "civil");
    Phys.addCar(a);
    Phys.addCar(b);
    a.place(0, 0, 0);
    a.setSpeed(10);
    b.place(70, 0, 0);
    for (let i = 0; i < 20 * 60; i++) {
      carGrid.rebuild([a, b]);
      speedTo(a, capForTraffic(a, 10));
      a.ctrl.steer = 0;
      a.applyControls(1 / 60, SURF.asphalt);
      Phys.step(1 / 60);
      a.readBack();
      b.readBack();
    }
    return { gap: b.x - b.hx - (a.x + a.hx), speed: a.speed };
  }

  it("a car stops a safe distance behind a stopped container truck, not with its nose in the trailer", () => {
    const behindTruck = followGap(trucks[2], TRAFFIC_CARS[0]);
    expect(behindTruck.speed).toBeLessThan(0.3);
    expect(behindTruck.gap).toBeGreaterThan(1);
    // and behind an ordinary car it keeps the distance it always did
    const behindCar = followGap(TRAFFIC_CARS[1], TRAFFIC_CARS[0]);
    expect(behindCar.gap).toBeGreaterThan(1);
    expect(behindCar.gap).toBeLessThan(5);
  });

  it("a lorry keeps its booking of a junction until its tail is out of it, a car lets go sooner", () => {
    const city = World.build(0, 0, 1);
    let n = -1;
    for (let r = 0; r < 12 && n < 0; r++)
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const i = 24 + r * 2 + di,
          j = 24 + dj;
        const id = city.nodeId(i, j);
        if (city.neighbors(id).length === 4 && !city.roundAt(id) && i % 16 && j % 16 && city.neighbors(id).every((m) => !city.isCurve(id, m))) {
          n = id;
          break;
        }
      }
    expect(n).toBeGreaterThanOrEqual(0);
    const nb = city.neighbors(n);
    const west = nb.find((m) => city.nodeX(m) < city.nodeX(n))!,
      east = nb.find((m) => city.nodeX(m) > city.nodeX(n))!;
    const hwn = city.nodeHalfWidth(n);
    const holdAfter = (spec: (typeof trucks)[number], metres: number): boolean => {
      Traffic.clearHolds();
      Phys.reset();
      const car = new Car(spec, "civil");
      Phys.addCar(car);
      const len = city.edgeLength(west, n);
      const p = city.lanePoint(west, n, 1 - 14 / len);
      car.place(p.x, p.y, Math.atan2(p.uy, p.ux));
      car.setSpeed(4);
      const drv = new LaneDriver(city, west, n);
      drv.next = east;
      carGrid.rebuild([car]);
      drv.control(car, 1 / 60);
      expect(drv.hold).not.toBeNull(); // it booked the junction
      // it has driven through: now it is `metres` into the road beyond
      const q = city.edgePoint(n, east, metres, city.laneOffset(n, east), { x: 0, y: 0, ux: 0, uy: 0, len: 0 });
      car.place(q.x, q.y, Math.atan2(q.uy, q.ux));
      car.setSpeed(4);
      drv.a = n;
      drv.b = east;
      drv.next = -1;
      carGrid.rebuild([car]);
      drv.control(car, 1 / 60);
      return drv.hold !== null;
    };
    const lorry = trucks[2];
    // 5 m past the junction's edge: a car's tail is clear (its hold is gone), a 9 m lorry is still half inside
    expect(holdAfter(TRAFFIC_CARS[0], hwn + 5.5)).toBe(false);
    expect(holdAfter(lorry, hwn + 5.5)).toBe(true);
    expect(holdAfter(lorry, hwn + 10)).toBe(false);
  });
});

describe("squares, sand and rocks", () => {
  const windows: [number, number][] = [[0, 0], [3, 2], [-4, 5], [7, -6], [-9, -3]];
  const tilesOf = () => {
    World.init();
    const out: Tile[] = [];
    for (const [cx, cy] of windows) for (const t of World.build(cx, cy, 1).tiles) if (!out.includes(t)) out.push(t);
    return out;
  };

  it("every town has exactly three statue squares, each with one statue in the middle and nothing else built on it", () => {
    const tiles = tilesOf();
    expect(tiles.length).toBeGreaterThan(30);
    for (const t of tiles) {
      const squares = t.blocks.filter((b) => b.type === "square");
      expect(squares).toHaveLength(3);
      expect(new Set(squares.map((b) => b.square!.k))).toEqual(new Set([0, 1, 2]));
      for (const b of squares) {
        expect(b.lots).toBeUndefined();
        const inside = t.buildings.filter((q) => q.x > b.x0 && q.x < b.x1 && q.y > b.y0 && q.y < b.y1);
        expect(inside).toHaveLength(1);
        expect(inside[0].kind).toBe("statue");
        expect(inside[0].art).toBe(b.square!.k);
        expect(Math.hypot(inside[0].x - b.square!.cx, inside[0].y - b.square!.cy)).toBeLessThan(0.01);
      }
    }
  });

  it("the home town's three squares are close to where you start", () => {
    World.init();
    const city = World.build(0, 0, 1);
    const n = city.centerNode();
    const sx = city.nodeX(n),
      sy = city.nodeY(n);
    const home = city.tileAt(sx, sy)!;
    const squares = home.blocks.filter((b) => b.type === "square");
    expect(squares).toHaveLength(3);
    for (const b of squares) expect(Math.hypot(b.square!.cx - sx, b.square!.cy - sy)).toBeLessThan(700);
  });

  it("the decorations are the same every time a tile is made", () => {
    const sig = () =>
      tilesOf()
        .map((t) => t.blocks.filter((b) => b.type === "square" || b.type === "sand").map((b) => `${b.type}${b.i},${b.j}`).join(" ") + "|" + t.buildings.filter((q) => q.kind === "rock" || q.kind === "statue").map((q) => `${q.kind}${q.x.toFixed(1)},${q.y.toFixed(1)},${q.art}`).join(" "))
        .join("\n");
    const a = sig();
    World.cache.clear();
    expect(sig()).toBe(a);
  });

  it("rocks stand in plain parks, with no tree growing out of them, and they block cars", () => {
    const tiles = tilesOf();
    let rocks = 0;
    for (const t of tiles) {
      for (const r of t.buildings.filter((q) => q.kind === "rock")) {
        rocks++;
        const park = t.blocks.find((b) => b.type === "park" && !b.sb && r.x > b.x0 && r.x < b.x1 && r.y > b.y0 && r.y < b.y1);
        expect(park).toBeDefined();
        expect(r.x0).toBeGreaterThan(park!.x0 + 5);
        expect(r.x1).toBeLessThan(park!.x1 - 5);
        for (const tr of t.trees) expect(tr.x > r.x0 - tr.r && tr.x < r.x1 + tr.r && tr.y > r.y0 - tr.r && tr.y < r.y1 + tr.r).toBe(false);
      }
    }
    expect(rocks).toBeGreaterThan(20);
    World.init();
    const city = World.build(0, 0, 1);
    const rock = city.buildings.find((q) => q.kind === "rock")!;
    expect(city.isObstacle(rock.x, rock.y)).toBe(true);
    expect(city.isObstacle(rock.x1 + 6, rock.y)).toBe(false);
  });

  it("a sandy lot is sand underfoot, and sand slows a car down", () => {
    World.init();
    const city = World.build(0, 0, 1);
    const sand = city.tiles.flatMap((t) => t.blocks).find((b) => b.type === "sand")!;
    expect(sand).toBeDefined();
    expect(city.surfaceAt((sand.x0 + sand.x1) / 2, (sand.y0 + sand.y1) / 2).kind).toBe("sand");
    const top = (surf: (typeof SURF)[keyof typeof SURF]): number => {
      Phys.init({ buildings: [], walls: [] });
      const car = new Car(PLAYER_CARS[0], "player");
      Phys.addCar(car);
      car.place(0, 0, 0);
      car.ctrl.throttle = 1;
      for (let i = 0; i < 25 / DT; i++) {
        car.applyControls(DT, surf);
        Phys.step(DT);
        car.readBack();
      }
      return car.speed;
    };
    expect(top(SURF.sand)).toBeLessThan(top(SURF.asphalt) * 0.85);
    expect(top(SURF.sand)).toBeGreaterThan(top(SURF.grass));
  });
});
