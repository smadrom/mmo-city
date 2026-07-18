import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { handleAttack, tickRespawn } from '../src/systems/combat.js';
import { PUNCH_DAMAGE, MAX_HP, WANTED_DURATION_MS, DEATH_CASH_LOSS, RESPAWN_DELAY_MS, createCityMap } from '@mmo/shared';

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
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('не бьёт цель за спиной', () => {
    const { state, v, runtimes } = setup();
    v.z = 1.5; // сзади
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP);
  });

  it('не бьёт дальше PUNCH_RANGE', () => {
    const { state, v, runtimes } = setup();
    v.z = -5;
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP);
  });

  it('кулачный кулдаун: второй удар сразу не проходит', () => {
    const { state, v, runtimes } = setup();
    handleAttack(state, runtimes, 'a', 1000);
    handleAttack(state, runtimes, 'a', 1100);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('смерть: потеря 50% наличных, розыск убийцы, респаун', () => {
    const { state, a, v, runtimes } = setup();
    v.hp = PUNCH_DAMAGE;
    v.cash = 400;
    const now = 5000;
    handleAttack(state, runtimes, 'a', now);
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
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP);
  });
});
