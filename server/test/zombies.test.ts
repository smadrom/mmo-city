import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { spawnZombies, tickZombies } from '../src/systems/zombies.js';
import { tickMovement } from '../src/systems/movement.js';
import { ZOMBIE_COUNT, ZOMBIE_HP, ZOMBIE_DAMAGE, MAX_HP, pointInAABB, createCityMap } from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const runtimes = new Map<string, Runtime>();
  spawnZombies(state, runtimes, map, 0);
  return { state, runtimes };
}

function firstZombie(state: GameState): [string, Player] {
  let found: [string, Player] | null = null;
  state.players.forEach((p, id) => { if (!found && p.role === 'zombie') found = [id, p]; });
  return found!;
}

describe('зомби', () => {
  it('спавн: ZOMBIE_COUNT зомби с ролью и HP на точках спавна', () => {
    const { state } = setup();
    let n = 0;
    state.players.forEach((p) => {
      if (p.role !== 'zombie') return;
      n++;
      expect(p.hp).toBe(ZOMBIE_HP);
      expect(p.name).toBe('Зомби');
    });
    expect(n).toBe(ZOMBIE_COUNT);
  });

  it('преследование: input направлен на ближайшего игрока, зомби движется к нему', () => {
    const { state, runtimes } = setup();
    const [zid, z] = firstZombie(state);
    z.x = 0; z.z = 0;
    const hero = new Player();
    hero.name = 'hero';
    hero.x = 10; hero.z = 0;
    state.players.set('h1', hero);
    runtimes.set('h1', makeRuntime(0));
    tickZombies(state, runtimes, map, [], 100);
    const inp = runtimes.get(zid)!.input;
    expect(inp.up).toBe(true);
    expect(inp.rotY).toBeCloseTo(Math.atan2(-10, 0), 5); // -PI/2
    const d0 = Math.hypot(hero.x - z.x, hero.z - z.z);
    tickMovement(state, runtimes, [], 0.05, 150);
    expect(Math.hypot(hero.x - z.x, hero.z - z.z)).toBeLessThan(d0);
  });

  it('в упоре бьёт: AttackResult с hit по ZOMBIE_DAMAGE', () => {
    const { state, runtimes } = setup();
    const [, z] = firstZombie(state);
    z.x = 0; z.z = 0;
    const hero = new Player();
    hero.x = 1.5; hero.z = 0;
    state.players.set('h1', hero);
    runtimes.set('h1', makeRuntime(0));
    const results = tickZombies(state, runtimes, map, [], 2000); // кулдаун кулака прошёл
    expect(hero.hp).toBe(MAX_HP - ZOMBIE_DAMAGE);
    expect(results.some(r => r.hits.length > 0)).toBe(true);
  });

  it('игрок в безопасной зоне игнорируется', () => {
    const { state, runtimes } = setup();
    const [, z] = firstZombie(state);
    z.x = -150; z.z = -100; // рядом с зоной больницы
    const hero = new Player();
    hero.x = map.hospitalDoor.x; hero.z = map.hospitalDoor.z; // внутри зоны
    state.players.set('h1', hero);
    runtimes.set('h1', makeRuntime(0));
    const results = tickZombies(state, runtimes, map, [], 100);
    expect(results).toHaveLength(0);
    expect(hero.hp).toBe(MAX_HP);
  });

  it('зомби не целится в зомби', () => {
    const { state, runtimes } = setup();
    const [zid, z] = firstZombie(state);
    z.x = 0; z.z = 0;
    const other = new Player();
    other.name = 'Зомби'; other.role = 'zombie';
    other.x = 1; other.z = 0;
    state.players.set('zOther', other);
    runtimes.set('zOther', makeRuntime(0));
    const results = tickZombies(state, runtimes, map, [], 2000); // кулдаун прошёл — но цели-зомби нет
    expect(results).toHaveLength(0);
    expect(other.hp).toBe(MAX_HP);
  });

  it('зомби выталкивается из безопасной зоны', () => {
    const { state, runtimes } = setup();
    const [, z] = firstZombie(state);
    const zone = map.safeZones[0];
    z.x = zone.x; z.z = zone.z; // в самом центре зоны
    tickZombies(state, runtimes, map, [], 100);
    expect(pointInAABB(z.x, z.z, zone)).toBe(false);
  });
});
