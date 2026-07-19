import { describe, it, expect } from 'vitest';
import { GameState, Player, Car } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tickVehicles, tryEnterCar, tryExitCar, type CarRuntime } from '../src/systems/vehicles.js';
import { CAR_ACCEL, CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_PARK_RETURN_MS, type ParkingSpot } from '@mmo/shared';

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

  it('столкновение со зданием останавливает машину', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const wall = { x: 5, z: -10, w: 20, d: 2 };
    runtimes.get('s1')!.input.up = true;
    for (let i = 0; i < 200; i++) tickVehicles(state, runtimes, carRuntime, [wall], 0.05, i * 50, spots);
    expect(car.z).toBeGreaterThan(-10);
    expect(car.speed).toBe(0);
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
    expect(tryExitCar(state, 's1')).toBe(true);
    expect(p.mode).toBe('foot');
    expect(car.driverId).toBe('');
    expect(car.speed).toBe(0);
  });

  it('брошенная машина возвращается на парковку через CAR_PARK_RETURN_MS', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    car.x = 0; car.z = 0; // уехала с парковки
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000, spots); // фиксирует emptySince
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000 + CAR_PARK_RETURN_MS + 1, spots);
    expect(car.x).toBe(100);
    expect(car.z).toBe(100);
  });
});
