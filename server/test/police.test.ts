import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tickPolice } from '../src/systems/police.js';
import {
  ARREST_TIME_MS, ARREST_CASH_LOSS, ARREST_BONUS, JAIL_TIME_MS,
  COP_SALARY, COP_SALARY_INTERVAL_MS, createCityMap,
} from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const cop = new Player(); cop.name = 'cop'; cop.role = 'cop'; cop.x = 0; cop.z = 0;
  const crim = new Player(); crim.name = 'crim'; crim.x = 1; crim.z = 0;
  crim.wantedUntil = 100_000; crim.cash = 400;
  state.players.set('c', cop);
  state.players.set('k', crim);
  const runtimes = new Map<string, Runtime>([['c', makeRuntime(0)], ['k', makeRuntime(0)]]);
  return { state, cop, crim, runtimes };
}

describe('полиция', () => {
  it('арест после ARREST_TIME_MS рядом с копом: тюрьма, штраф, бонус копу', () => {
    const { state, cop, crim, runtimes } = setup();
    const copCash = cop.cash;
    // три тика по 1 секунде
    tickPolice(state, runtimes, 1000, 1, map);
    tickPolice(state, runtimes, 2000, 1, map);
    expect(crim.mode).toBe('foot'); // ещё не арестован
    tickPolice(state, runtimes, 3000, 1, map);
    expect(crim.mode).toBe('jail');
    expect(crim.x).toBe(map.jailCell.x);
    expect(crim.cash).toBe(Math.floor(400 * (1 - ARREST_CASH_LOSS)));
    expect(crim.wantedUntil).toBe(0);
    expect(crim.jailUntil).toBe(3000 + JAIL_TIME_MS);
    expect(cop.cash).toBe(copCash + ARREST_BONUS);
  });

  it('прогресс ареста сбрасывается, если коп отошёл', () => {
    const { state, cop, crim, runtimes } = setup();
    tickPolice(state, runtimes, 1000, 1, map);
    tickPolice(state, runtimes, 2000, 1, map);
    cop.x = 100; // коп ушёл
    tickPolice(state, runtimes, 3000, 1, map);
    expect(crim.mode).toBe('foot');
    expect(runtimes.get('k')!.arrestProgress).toBe(0);
  });

  it('коп в розыске не может арестовывать', () => {
    const { state, cop, crim, runtimes } = setup();
    cop.wantedUntil = 200_000;
    for (let i = 0; i < 5; i++) tickPolice(state, runtimes, 1000 + i * 1000, 1, map);
    expect(crim.mode).toBe('foot');
  });

  it('освобождение из тюрьмы после JAIL_TIME_MS', () => {
    const { state, crim, runtimes } = setup();
    crim.mode = 'jail';
    crim.jailUntil = 5000;
    crim.wantedUntil = 0;
    tickPolice(state, runtimes, 5001, 0.05, map);
    expect(crim.mode).toBe('foot');
    expect(crim.x).toBe(map.policeDoor.x);
  });

  it('зарплата копа каждые COP_SALARY_INTERVAL_MS', () => {
    const { state, cop, crim, runtimes } = setup();
    crim.wantedUntil = 0; // убрать арест из картины
    cop.cash = 0;
    tickPolice(state, runtimes, COP_SALARY_INTERVAL_MS + 1, 0.05, map);
    expect(cop.cash).toBe(COP_SALARY);
    expect(runtimes.get('c')!.nextSalaryAt).toBe(COP_SALARY_INTERVAL_MS + 1 + COP_SALARY_INTERVAL_MS);
  });

  it('гражданин зарплату не получает', () => {
    const { state, crim, runtimes } = setup();
    crim.wantedUntil = 0;
    crim.cash = 0;
    tickPolice(state, runtimes, COP_SALARY_INTERVAL_MS + 1, 0.05, map);
    expect(crim.cash).toBe(0);
  });
});
