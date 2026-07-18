import { describe, it, expect } from 'vitest';
import { GameState, Player, Apartment } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tryRent, adjustSafe, tickRent } from '../src/systems/housing.js';
import { RENT_PRICE, RENT_INTERVAL_MS, SAFE_LIMIT } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'tenant';
  p.cash = 500;
  state.players.set('s1', p);
  const apt = new Apartment();
  apt.id = 'apt0';
  apt.doorX = 10; apt.doorZ = 10;
  state.apartments.set('apt0', apt);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(0)]]);
  // игрок у двери
  p.x = 10; p.z = 11;
  return { state, p, apt, runtimes };
}

describe('аренда и сейф', () => {
  it('аренда у свободной двери: деньги списаны, квартира занята', () => {
    const { state, p, apt, runtimes } = setup();
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('ok');
    expect(p.cash).toBe(500 - RENT_PRICE);
    expect(apt.rentedBy).toBe('tenant');
    expect(p.apt).toBe('apt0');
    expect(runtimes.get('s1')!.nextRentAt).toBe(1000 + RENT_INTERVAL_MS);
  });

  it('нельзя арендовать вдали от двери', () => {
    const { state, p, runtimes } = setup();
    p.x = 100; p.z = 100;
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('too_far');
  });

  it('нельзя арендовать занятую квартиру', () => {
    const { state, apt, runtimes } = setup();
    apt.rentedBy = 'other';
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('taken');
  });

  it('нельзя арендовать без денег', () => {
    const { state, p, runtimes } = setup();
    p.cash = RENT_PRICE - 1;
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('no_money');
  });

  it('пересъём освобождает предыдущую квартиру', () => {
    const { state, p, apt, runtimes } = setup();
    const apt2 = new Apartment();
    apt2.id = 'apt1';
    apt2.doorX = 20; apt2.doorZ = 20;
    state.apartments.set('apt1', apt2);
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('ok');
    expect(p.apt).toBe('apt0');
    // игрок подходит к другой свободной двери и арендует её
    p.x = 20; p.z = 21;
    expect(tryRent(state, runtimes, 's1', 2000)).toBe('ok');
    expect(apt.rentedBy).toBe('');
    expect(apt2.rentedBy).toBe('tenant');
    expect(p.apt).toBe('apt1');
    expect(p.cash).toBe(500 - RENT_PRICE * 2);
  });

  it('депозит и снятие у своей двери с лимитом сейфа', () => {
    const { state, p } = setup();
    p.apt = 'apt0';
    state.apartments.get('apt0')!.rentedBy = 'tenant';
    expect(adjustSafe(state, 's1', 300)).toBe(true);
    expect(p.cash).toBe(200);
    expect(p.safe).toBe(300);
    expect(adjustSafe(state, 's1', -100)).toBe(true);
    expect(p.cash).toBe(300);
    expect(p.safe).toBe(200);
    // лимит сейфа: допускается частичный депозит до лимита
    p.safe = SAFE_LIMIT - 50;
    expect(adjustSafe(state, 's1', 300)).toBe(true);
    expect(p.safe).toBe(SAFE_LIMIT);
    expect(p.cash).toBe(250);
    // сейф полон — депозит отклонён
    expect(adjustSafe(state, 's1', 100)).toBe(false);
  });

  it('нельзя пользоваться чужим сейфом', () => {
    const { state } = setup();
    state.apartments.get('apt0')!.rentedBy = 'other';
    expect(adjustSafe(state, 's1', 100)).toBe(false);
  });

  it('списание аренды и выселение при нехватке денег', () => {
    const { state, p, apt, runtimes } = setup();
    tryRent(state, runtimes, 's1', 1000);
    // первая оплата прошла, следующая в 1000+RENT_INTERVAL_MS
    p.cash = 10; // не хватит
    tickRent(state, runtimes, 1000 + RENT_INTERVAL_MS + 1);
    expect(apt.rentedBy).toBe('');
    expect(p.apt).toBe('');
  });

  it('списание аренды при наличии денег', () => {
    const { state, p, apt, runtimes } = setup();
    tryRent(state, runtimes, 's1', 1000);
    const before = p.cash;
    tickRent(state, runtimes, 1000 + RENT_INTERVAL_MS + 1);
    expect(p.cash).toBe(before - RENT_PRICE);
    expect(apt.rentedBy).toBe('tenant');
  });
});
