import { describe, it, expect } from 'vitest';
import { GameState, Player, Car } from '../src/schema/GameState.js';
import { tryStartDelivery, tickDelivery, tryTransfer, tryTakeJob, tryDropJob } from '../src/systems/economy.js';
import { DELIVERY_REWARD, DELIVERY_TIME_MS, createCityMap, START_CASH, TRANSFER_MAX } from '@mmo/shared';
import { GameDB } from '../src/db.js';

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

  it('пешком груз не сдаётся — только из машины', () => {
    const { state, p } = setup();
    tryStartDelivery(state, 's1', map, 1000);
    const target = map.deliveryTargets.find(t => t.id === p.deliveryTarget)!;
    p.x = target.x; p.z = target.z;
    p.mode = 'foot';
    tickDelivery(state, map, 2000);
    expect(p.cargo).toBe(true);
    expect(p.cash).toBe(0);
  });

  it('таймаут: груз пропадает без награды', () => {
    const { state, p } = setup();
    tryStartDelivery(state, 's1', map, 1000);
    tickDelivery(state, map, 1000 + DELIVERY_TIME_MS + 1);
    expect(p.cargo).toBe(false);
    expect(p.cash).toBe(0);
  });
});

describe('переводы', () => {
  function setupTransfer() {
    const state = new GameState();
    const p = new Player();
    p.name = 'payer';
    p.cash = 500;
    state.players.set('s1', p);
    const db = new GameDB(':memory:');
    db.load('payer'); // cash = START_CASH в БД
    db.load('payee');
    return { state, p, db };
  }

  // обход порога наигрыша: эти тесты — про деньги, не про антифарм
  const guard = { playtimeSec: 99999, ip: '' };

  it('успех: state и БД обоих обновлены, возврат balance', () => {
    const { state, p, db } = setupTransfer();
    db.save({ name: 'payer', cash: 500, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0 });
    const payee = new Player();
    payee.name = 'payee';
    payee.cash = 100;
    state.players.set('s2', payee);
    const res = tryTransfer(state, db, 's1', 'payee', 200, 7000, guard);
    expect(res).toMatchObject({ ok: true, balance: 300, toNick: 'payee', amount: 200 });
    expect(p.cash).toBe(300);
    expect(payee.cash).toBe(300); // 100 + 200
    expect(db.load('payer').cash).toBe(300);
    expect(db.load('payee').cash).toBe(START_CASH + 200); // офлайн-часть БД: payee был START_CASH
  });

  it('нехватка средств → no_money, ничего не меняется', () => {
    const { state, p, db } = setupTransfer();
    db.save({ name: 'payer', cash: 500, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0 });
    const res = tryTransfer(state, db, 's1', 'payee', 501, 7000, guard);
    expect(res).toMatchObject({ ok: false, error: 'no_money' });
    expect(p.cash).toBe(500);
    expect(db.load('payer').cash).toBe(500);
  });

  it('валидация: bad_amount / self / no_such_user', () => {
    const { state, db } = setupTransfer();
    expect(tryTransfer(state, db, 's1', 'payee', 0, 1000, guard).error).toBe('bad_amount');
    expect(tryTransfer(state, db, 's1', 'payee', -50, 1000, guard).error).toBe('bad_amount');
    expect(tryTransfer(state, db, 's1', 'payee', 10.5, 1000, guard).error).toBe('bad_amount');
    expect(tryTransfer(state, db, 's1', 'payee', TRANSFER_MAX + 1, 1000, guard).error).toBe('bad_amount');
    expect(tryTransfer(state, db, 's1', 'payer', 10, 1000, guard).error).toBe('self');
    expect(tryTransfer(state, db, 's1', 'ghost', 10, 1000, guard).error).toBe('no_such_user');
  });

  it('state авторитетен: перевод после траты в state (БД отстаёт) → no_money', () => {
    const { state, p, db } = setupTransfer();
    // БД ещё хранит START_CASH=500 (savePlayer не было), в state уже потрачено
    p.cash = 100;
    const res = tryTransfer(state, db, 's1', 'payee', 400, 7000, guard);
    expect(res).toMatchObject({ ok: false, error: 'no_money' });
    expect(p.cash).toBe(100);
    expect(db.load('payer').cash).toBe(START_CASH);
    expect(db.load('payee').cash).toBe(START_CASH);
  });
});

describe('удалённый заказ (телефон)', () => {
  function setupJob() {
    const state = new GameState();
    const p = new Player();
    p.name = 'courier';
    p.mode = 'car';
    p.carId = 'car0';
    state.players.set('s1', p);
    const map = createCityMap();
    return { state, p, map };
  }

  it('tryTakeJob: в машине без груза — заказ назначен, склад не нужен', () => {
    const { state, p, map } = setupJob();
    p.x = 0; p.z = 0; // далеко от склада (-150, 127)
    expect(tryTakeJob(state, 's1', map, 10_000)).toBe(true);
    expect(p.cargo).toBe(true);
    expect(p.deliveryTarget).not.toBe('');
    expect(p.deliveryDeadline).toBe(10_000 + DELIVERY_TIME_MS);
  });

  it('tryTakeJob: пешком или с грузом — отказ', () => {
    const { state, p, map } = setupJob();
    p.mode = 'foot';
    expect(tryTakeJob(state, 's1', map, 1000)).toBe(false);
    p.mode = 'car';
    p.cargo = true;
    expect(tryTakeJob(state, 's1', map, 1000)).toBe(false);
  });

  it('tryDropJob: снимает заказ; без заказа — false', () => {
    const { state, p, map } = setupJob();
    expect(tryDropJob(state, 's1')).toBe(false);
    tryTakeJob(state, 's1', map, 1000);
    expect(tryDropJob(state, 's1')).toBe(true);
    expect(p.cargo).toBe(false);
    expect(p.deliveryTarget).toBe('');
  });

  it('складской tryStartDelivery по-прежнему требует склад', () => {
    const { state, p, map } = setupJob();
    p.x = 0; p.z = 0;
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(false);
    p.x = map.warehouse.x; p.z = map.warehouse.z;
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(true);
  });
});
