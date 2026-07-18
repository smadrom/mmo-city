import { describe, it, expect } from 'vitest';
import { GameState, Player, Car } from '../src/schema/GameState.js';
import { tryStartDelivery, tickDelivery } from '../src/systems/economy.js';
import { DELIVERY_REWARD, DELIVERY_TIME_MS, createCityMap } from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'courier';
  p.mode = 'car';
  p.carId = 'car0';
  p.x = map.warehouse.x;
  p.z = map.warehouse.z;
  p.cash = 0;
  state.players.set('s1', p);
  const car = new Car();
  car.id = 'car0';
  car.x = p.x; car.z = p.z;
  car.driverId = 's1';
  state.cars.set('car0', car);
  return { state, p, car };
}

describe('доставка', () => {
  it('взятие груза на складе в машине', () => {
    const { state, p } = setup();
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(true);
    expect(p.cargo).toBe(true);
    expect(map.deliveryTargets.map(t => t.id)).toContain(p.deliveryTarget);
    expect(p.deliveryDeadline).toBe(1000 + DELIVERY_TIME_MS);
  });

  it('нельзя взять груз пешком', () => {
    const { state, p } = setup();
    p.mode = 'foot';
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(false);
  });

  it('нельзя взять груз вдали от склада', () => {
    const { state, p } = setup();
    p.x = 0; p.z = 0;
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(false);
  });

  it('доставка в точку: награда, груз снят', () => {
    const { state, p } = setup();
    tryStartDelivery(state, 's1', map, 1000);
    const target = map.deliveryTargets.find(t => t.id === p.deliveryTarget)!;
    p.x = target.x; p.z = target.z;
    tickDelivery(state, map, 2000);
    expect(p.cargo).toBe(false);
    expect(p.cash).toBe(DELIVERY_REWARD);
    expect(p.deliveryTarget).toBe('');
  });

  it('таймаут: груз пропадает без награды', () => {
    const { state, p } = setup();
    tryStartDelivery(state, 's1', map, 1000);
    tickDelivery(state, map, 1000 + DELIVERY_TIME_MS + 1);
    expect(p.cargo).toBe(false);
    expect(p.cash).toBe(0);
  });
});
