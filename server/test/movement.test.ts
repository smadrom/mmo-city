import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tickMovement } from '../src/systems/movement.js';
import { PLAYER_SPEED, MAX_HP } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'a';
  state.players.set('s1', p);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(1000)]]);
  return { state, p, runtimes };
}

describe('tickMovement', () => {
  it('двигает вперёд при rotY=0 (в -z)', () => {
    const { state, p, runtimes } = setup();
    runtimes.get('s1')!.input = { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 };
    tickMovement(state, runtimes, [], 0.05, 1000);
    expect(p.z).toBeCloseTo(-PLAYER_SPEED * 0.05, 5);
    expect(p.x).toBeCloseTo(0, 5);
  });

  it('спринт быстрее ходьбы', () => {
    const { state, p, runtimes } = setup();
    runtimes.get('s1')!.input = { up: true, down: false, left: false, right: false, sprint: true, rotY: 0 };
    tickMovement(state, runtimes, [], 0.05, 1000);
    expect(-p.z).toBeGreaterThan(PLAYER_SPEED * 0.05);
  });

  it('не проходит сквозь здание', () => {
    const { state, p, runtimes } = setup();
    p.z = 10;
    const wall = { x: 0, z: 5, w: 20, d: 2 }; // z: 4..6
    runtimes.get('s1')!.input = { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 };
    for (let i = 0; i < 100; i++) tickMovement(state, runtimes, [wall], 0.05, 1000);
    expect(p.z).toBeGreaterThan(6); // остался снаружи (6 + radius)
  });

  it('диагональ нормализуется (не быстрее по диагонали)', () => {
    const { state, p, runtimes } = setup();
    runtimes.get('s1')!.input = { up: true, down: false, left: true, right: false, sprint: false, rotY: 0 };
    tickMovement(state, runtimes, [], 0.05, 1000);
    const dist = Math.hypot(p.x, p.z);
    expect(dist).toBeCloseTo(PLAYER_SPEED * 0.05, 5);
  });

  it('не двигает игрока в машине/тюрьме/мёртвого', () => {
    const { state, p, runtimes } = setup();
    p.mode = 'car';
    runtimes.get('s1')!.input.up = true;
    tickMovement(state, runtimes, [], 0.05, 1000);
    expect(p.z).toBe(0);
  });

  it('регенерирует HP после задержки', () => {
    const { state, p, runtimes } = setup();
    p.hp = 50;
    runtimes.get('s1')!.lastDamageAt = 0;
    tickMovement(state, runtimes, [], 1, 10_000);
    expect(p.hp).toBeGreaterThan(50);
    expect(p.hp).toBeLessThanOrEqual(MAX_HP);
  });

  it('не регенерирует сразу после урона', () => {
    const { state, p, runtimes } = setup();
    p.hp = 50;
    runtimes.get('s1')!.lastDamageAt = 9000;
    tickMovement(state, runtimes, [], 1, 10_000);
    expect(p.hp).toBe(50);
  });
});
