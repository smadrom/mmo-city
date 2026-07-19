import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { tryBuyWeapon, tryBuyAmmo } from '../src/systems/shop.js';
import { WEAPONS, AMMO_PACK_PRICE, AMMO_PACK_SIZE, AMMO_MAX, createCityMap } from '@mmo/shared';

const map = createCityMap();

function setup(cash = 5000) {
  const state = new GameState();
  const p = new Player();
  p.name = 'buyer';
  p.cash = cash;
  p.x = map.gunShop.x;
  p.z = map.gunShop.z;
  state.players.set('s1', p);
  return { state, p };
}

describe('оружейный магазин', () => {
  it('покупка оружия: деньги списаны, оружие в руках', () => {
    const { state, p } = setup();
    expect(tryBuyWeapon(state, 's1', 'bat', map)).toBe('ok');
    expect(p.weapon).toBe('bat');
    expect(p.cash).toBe(5000 - WEAPONS.bat.price);
  });

  it('новое оружие заменяет старое без возврата', () => {
    const { state, p } = setup();
    tryBuyWeapon(state, 's1', 'bat', map);
    expect(tryBuyWeapon(state, 's1', 'pistol', map)).toBe('ok');
    expect(p.weapon).toBe('pistol');
    expect(p.cash).toBe(5000 - WEAPONS.bat.price - WEAPONS.pistol.price);
  });

  it('too_far: далеко от магазина', () => {
    const { state, p } = setup();
    p.x = 0; p.z = 0;
    expect(tryBuyWeapon(state, 's1', 'bat', map)).toBe('too_far');
    expect(tryBuyAmmo(state, 's1', map)).toBe('too_far');
  });

  it('too_far: в машине покупать нельзя', () => {
    const { state, p } = setup();
    p.mode = 'car';
    expect(tryBuyWeapon(state, 's1', 'bat', map)).toBe('too_far');
  });

  it('no_money: не хватает денег', () => {
    const { state } = setup(100);
    expect(tryBuyWeapon(state, 's1', 'rifle', map)).toBe('no_money');
    expect(tryBuyAmmo(state, 's1', map)).toBe('ok'); // пачка стоит 100 — хватает ровно
  });

  it('bad_kind: несуществующее оружие', () => {
    const { state, p } = setup();
    expect(tryBuyWeapon(state, 's1', 'minigun', map)).toBe('bad_kind');
    expect(p.weapon).toBe('');
  });

  it('патроны: пачка добавляется, упирается в AMMO_MAX', () => {
    const { state, p } = setup();
    expect(tryBuyAmmo(state, 's1', map)).toBe('ok');
    expect(p.ammo).toBe(AMMO_PACK_SIZE);
    p.ammo = AMMO_MAX - 5;
    tryBuyAmmo(state, 's1', map);
    expect(p.ammo).toBe(AMMO_MAX);
    expect(p.cash).toBe(5000 - AMMO_PACK_PRICE * 2);
  });
});
