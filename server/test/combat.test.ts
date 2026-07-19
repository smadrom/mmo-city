import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { handleAttack, tickRespawn } from '../src/systems/combat.js';
import { PUNCH_DAMAGE, MAX_HP, WANTED_DURATION_MS, DEATH_CASH_LOSS, RESPAWN_DELAY_MS, WEAPONS, createCityMap } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const a = new Player(); a.name = 'attacker';
  const v = new Player(); v.name = 'victim';
  // жертва прямо перед атакующим (rotY=0 смотрит в -z)
  a.x = 0; a.z = 0; a.rotY = 0;
  v.x = 0; v.z = -1.5;
  state.players.set('a', a);
  state.players.set('v', v);
  const runtimes = new Map<string, Runtime>([['a', makeRuntime(0)], ['v', makeRuntime(0)]]);
  return { state, a, v, runtimes };
}

describe('бой', () => {
  it('удар наносит урон цели впереди', () => {
    const { state, v, runtimes } = setup();
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('не бьёт цель за спиной', () => {
    const { state, v, runtimes } = setup();
    v.z = 1.5; // сзади
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('не бьёт дальше PUNCH_RANGE', () => {
    const { state, v, runtimes } = setup();
    v.z = -5;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('кулачный кулдаун: второй удар сразу не проходит', () => {
    const { state, v, runtimes } = setup();
    handleAttack(state, runtimes, 'a', 1000, []);
    handleAttack(state, runtimes, 'a', 1100, []);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('смерть: потеря 50% наличных, розыск убийцы, респаун', () => {
    const { state, a, v, runtimes } = setup();
    v.hp = PUNCH_DAMAGE;
    v.cash = 400;
    const now = 5000;
    handleAttack(state, runtimes, 'a', now, []);
    expect(v.mode).toBe('dead');
    expect(v.cash).toBe(Math.floor(400 * (1 - DEATH_CASH_LOSS)));
    expect(a.wantedUntil).toBe(now + WANTED_DURATION_MS);
    expect(runtimes.get('a')!.kills).toBe(1);
    expect(runtimes.get('v')!.deaths).toBe(1);
    // респаун без квартиры — в больнице
    const map = createCityMap();
    tickRespawn(state, runtimes, map, now + RESPAWN_DELAY_MS + 1);
    expect(v.mode).toBe('foot');
    expect(v.hp).toBe(MAX_HP);
    expect(v.x).toBe(map.hospitalDoor.x);
    expect(v.wantedUntil).toBe(0);
  });

  it('нельзя ударить из машины', () => {
    const { state, a, v, runtimes } = setup();
    a.mode = 'car';
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('бита: урон 35, дальность 2.5, кулдаун 800', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'bat';
    v.z = -2.2; // в пределах 2.5
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - WEAPONS.bat.damage);
    handleAttack(state, runtimes, 'a', 1500, []); // кулдаун 800 не прошёл
    expect(v.hp).toBe(MAX_HP - WEAPONS.bat.damage);
  });

  it('бита не достаёт на 3 метрах', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'bat';
    v.z = -3;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('пистолет без патронов не стреляет', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 0;
    const shot = handleAttack(state, runtimes, 'a', 1000, []);
    expect(shot).toBeNull();
    expect(a.ammo).toBe(0);
    expect(v.hp).toBe(MAX_HP);
  });

  it('пистолет: попадание тратит патрон и наносит урон, shot.hit=true', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.z = -20; // в пределах 40, точно по центру конуса
    const shot = handleAttack(state, runtimes, 'a', 1000, []);
    expect(a.ammo).toBe(4);
    expect(v.hp).toBe(MAX_HP - WEAPONS.pistol.damage);
    expect(shot).toEqual({ from: { x: 0, z: 0 }, to: { x: 0, z: -20 }, hit: true, victim: 'v' });
  });

  it('промах тратит патрон, shot.hit=false, to — точка на дальности', () => {
    const { state, a, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    state.players.delete('v'); // setup ставит жертву на линию огня — убираем, выстрел уходит в пустоту
    const shot = handleAttack(state, runtimes, 'a', 1000, []);
    expect(a.ammo).toBe(4);
    expect(shot).toEqual({ from: { x: 0, z: 0 }, to: { x: 0, z: -40 }, hit: false, victim: '' });
  });

  it('пистолет не бьёт дальше своей дальности', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.z = -41;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('пистолет не бьёт вне узкого конуса (~12°)', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.x = 7; v.z = -27; // dot ≈ 0.968 < 0.98
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('стена блокирует выстрел (LOS)', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.z = -20;
    const wall = [{ x: 0, z: -10, w: 4, d: 2 }];
    const shot = handleAttack(state, runtimes, 'a', 1000, wall);
    expect(v.hp).toBe(MAX_HP);
    expect(shot?.hit).toBe(false);
  });

  it('водитель машины — легальная цель (машина не укрытие)', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.mode = 'car';
    v.z = -20;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - WEAPONS.pistol.damage);
  });

  it('убийство из пистолета: розыск и счётчики как у кулаков', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.hp = WEAPONS.pistol.damage;
    const now = 5000;
    handleAttack(state, runtimes, 'a', now, []);
    expect(v.mode).toBe('dead');
    expect(a.wantedUntil).toBe(now + WANTED_DURATION_MS);
    expect(runtimes.get('a')!.kills).toBe(1);
  });
});
