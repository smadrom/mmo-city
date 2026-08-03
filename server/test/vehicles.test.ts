import { describe, it, expect } from 'vitest';
import { GameState, Player, Car } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tickVehicles, tryEnterCar, tryExitCar, type CarRuntime } from '../src/systems/vehicles.js';
import {
  CAR_ACCEL, CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_PARK_RETURN_MS,
  MAX_HP, RUNOVER_DAMAGE_K, WANTED_DURATION_MS, CAR_CRASH_SPEED_KEEP, pointInAABB,
  PLAYER_RADIUS, collidesAny, type ParkingSpot,
} from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'driver';
  state.players.set('s1', p);
  const car = new Car();
  car.id = 'car0';
  car.x = 5; car.z = 0;
  state.cars.set('car0', car);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(0)]]);
  const carRuntime = new Map<string, CarRuntime>([['car0', { emptySince: 0 }]]);
  const spots: ParkingSpot[] = [{ id: 'car0', x: 100, z: 100 }];
  return { state, p, car, runtimes, carRuntime, spots };
}

describe('машины', () => {
  it('игрок садится в ближайшую свободную машину', () => {
    const { state, p, car } = setup();
    expect(tryEnterCar(state, 's1')).toBe(true);
    expect(p.mode).toBe('car');
    expect(p.carId).toBe('car0');
    expect(car.driverId).toBe('s1');
  });

  it('нельзя сесть в машину дальше CAR_ENTER_DIST', () => {
    const { state, car } = setup();
    car.x = 100;
    expect(tryEnterCar(state, 's1')).toBe(false);
  });

  it('нельзя сесть в занятую машину', () => {
    const { state, car } = setup();
    car.driverId = 'someone';
    expect(tryEnterCar(state, 's1')).toBe(false);
  });

  it('газ разгоняет машину, игрок едет вместе с ней', () => {
    const { state, p, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    runtimes.get('s1')!.input.up = true;
    for (let i = 0; i < 20; i++) tickVehicles(state, runtimes, carRuntime, [], 0.05, i * 50, spots);
    expect(car.speed).toBeCloseTo(Math.min(CAR_MAX_SPEED, CAR_ACCEL * 1), 1);
    expect(car.z).toBeLessThan(0); // едет в -z при rotY=0
    expect(p.x).toBe(car.x);
    expect(p.z).toBe(car.z);
  });

  it('столкновение со зданием отбрасывает машину, стена не проходится', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const wall = { x: 5, z: -10, w: 20, d: 2 };
    runtimes.get('s1')!.input.up = true;
    let bounced = false;
    for (let i = 0; i < 200; i++) {
      tickVehicles(state, runtimes, carRuntime, [wall], 0.05, i * 50, spots);
      if (car.speed < 0) bounced = true; // отскок: после удара скорость ушла в минус
    }
    expect(car.z).toBeGreaterThan(-10);
    expect(bounced).toBe(true);
  });

  it('задний ход: скорость отрицательная, упирается в -CAR_REVERSE_SPEED, машина едет назад', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    runtimes.get('s1')!.input.down = true;
    for (let i = 0; i < 100; i++) tickVehicles(state, runtimes, carRuntime, [], 0.05, i * 50, spots);
    expect(car.speed).toBe(-CAR_REVERSE_SPEED);
    expect(car.z).toBeGreaterThan(0); // едет в +z (назад) при rotY=0
  });

  it('тормоз при движении вперёд не уводит в реверс сразу', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    runtimes.get('s1')!.input.up = true;
    for (let i = 0; i < 20; i++) tickVehicles(state, runtimes, carRuntime, [], 0.05, i * 50, spots);
    runtimes.get('s1')!.input.up = false;
    runtimes.get('s1')!.input.down = true;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 2000, spots);
    expect(car.speed).toBeGreaterThan(0); // ещё тормозит, не реверс
  });

  it('при реверсе руль инвертируется: left уводит rotY в минус', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    runtimes.get('s1')!.input.down = true;
    for (let i = 0; i < 50; i++) tickVehicles(state, runtimes, carRuntime, [], 0.05, i * 50, spots);
    expect(car.speed).toBeLessThan(0);
    runtimes.get('s1')!.input.down = false;
    runtimes.get('s1')!.input.left = true;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(car.rotY).toBeLessThan(0); // вперёд с left rotY рос бы в плюс
  });

  it('выход из машины: игрок рядом, машина свободна', () => {
    const { state, p, car } = setup();
    tryEnterCar(state, 's1');
    expect(tryExitCar(state, 's1', [])).toBe(true);
    expect(p.mode).toBe('foot');
    expect(car.driverId).toBe('');
    expect(car.speed).toBe(0);
  });

  it('выход из машины ищет свободную точку (не ставит в здание)', () => {
    const { state, p } = setup();
    tryEnterCar(state, 's1'); // машина на (5,0), rotY=0 → дефолтная точка выхода (7,0)
    const wall = { x: 7, z: 0, w: 2, d: 2 }; // перекрывает дефолтную точку выхода
    expect(tryExitCar(state, 's1', [wall])).toBe(true);
    expect(p.mode).toBe('foot');
    expect(collidesAny(p.x, p.z, PLAYER_RADIUS, [wall])).toBe(false); // не в здании
  });

  it('брошенная машина возвращается на парковку через CAR_PARK_RETURN_MS', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    car.x = 0; car.z = 0; // уехала с парковки
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000, spots); // фиксирует emptySince
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000 + CAR_PARK_RETURN_MS + 1, spots);
    expect(car.x).toBe(100);
    expect(car.z).toBe(100);
  });

  it('steer пишется в схему: left = 1, без ввода 0', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    runtimes.get('s1')!.input.up = true;
    runtimes.get('s1')!.input.left = true;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 0, spots);
    expect(car.steer).toBe(1);
    runtimes.get('s1')!.input.left = false;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 50, spots);
    expect(car.steer).toBe(0);
  });

  it('наезд: урон по скорости, hit-событие, жертву отбрасывает', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const v = new Player();
    v.name = 'ped';
    state.players.set('v', v);
    runtimes.set('v', makeRuntime(0));
    v.x = car.x + 0.5; v.z = car.z - 1; // в контакте (радиус 2.0)
    const v0 = { x: v.x, z: v.z };
    car.speed = 20; // тик сам погасит до 19.7 — всё равно > RUNOVER_MIN_SPEED
    const hits = tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(hits).toHaveLength(1);
    expect(hits[0].victim).toBe('v');
    expect(hits[0].damage).toBeGreaterThan(0);
    expect(v.hp).toBe(MAX_HP - hits[0].damage);
    expect(Math.hypot(v.x - v0.x, v.z - v0.z)).toBeGreaterThan(0.5); // отброшена
  });

  it('наезд насмерть на зомби: без розыска водителю', () => {
    const { state, p, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const z = new Player();
    z.name = 'Зомби'; z.role = 'zombie'; z.hp = 5;
    state.players.set('z0', z);
    runtimes.set('z0', makeRuntime(0));
    z.x = car.x + 0.5; z.z = car.z - 1;
    car.speed = 20;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(z.mode).toBe('dead');
    expect(p.wantedUntil).toBe(0); // зомби — не преступление
  });

  it('медленный контакт: только толчок, без урона', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const v = new Player();
    state.players.set('v', v);
    runtimes.set('v', makeRuntime(0));
    v.x = car.x + 0.5; v.z = car.z - 1;
    const v0 = { x: v.x, z: v.z };
    car.speed = 3; // < RUNOVER_MIN_SPEED
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(v.hp).toBe(MAX_HP);
    expect(Math.hypot(v.x - v0.x, v.z - v0.z)).toBeGreaterThan(0.1); // оттолкнула
  });

  it('повторный урон той же жертве не чаще раза в 500 мс', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const v = new Player();
    state.players.set('v', v);
    runtimes.set('v', makeRuntime(0));
    v.x = car.x + 0.5; v.z = car.z - 1;
    runtimes.get('v')!.lastDamageAt = 4900; // «только что» уже получал урон
    car.speed = 20;
    const hits = tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(hits).toHaveLength(0); // кулдаун 500 мс не прошёл
    expect(v.hp).toBe(MAX_HP);
  });

  it('таран: машины разъезжаются, скорости гаснут', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    car.speed = 10;
    const b = new Car();
    b.id = 'car1'; b.x = car.x + 1; b.z = car.z; b.speed = -4; // перекрытие 1 м
    state.cars.set('car1', b);
    carRuntime.set('car1', { emptySince: 0 });
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000, spots);
    const d = Math.hypot(b.x - car.x, b.z - car.z);
    expect(d).toBeGreaterThanOrEqual(3 - 1e-9); // 2 * CAR_RADIUS
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(10 * CAR_CRASH_SPEED_KEEP + 1e-9);
    expect(Math.abs(b.speed)).toBeLessThanOrEqual(4 * CAR_CRASH_SPEED_KEEP + 1e-9);
  });

  it('въезд в безопасную зону: разворот на PI, остановка, снаружи', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const zone = { x: 5, z: -20, w: 30, d: 20 }; // z: -30..-10, машина на (5,0) едет в -z
    runtimes.get('s1')!.input.up = true;
    const rotBefore = car.rotY;
    let flipped = false;
    for (let i = 0; i < 60 && !flipped; i++) {
      tickVehicles(state, runtimes, carRuntime, [], 0.05, i * 50, spots, [zone]);
      if (Math.abs(car.rotY - rotBefore) > 1) flipped = true; // поймали тик разворота
    }
    expect(flipped).toBe(true);
    expect(pointInAABB(car.x, car.z, zone)).toBe(false);
    expect(car.speed).toBe(0);
    expect(Math.abs((car.rotY - rotBefore) % (Math.PI * 2))).toBeCloseTo(Math.PI, 1);
  });
});
