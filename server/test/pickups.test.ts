import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { spawnPickups, tickPickups, spawnCashDrop, spawnWeaponDrop, type PickupRuntime } from '../src/systems/pickups.js';
import { AMMO_MAX, AMMO_PACK_SIZE, PICKUP_RESPAWN_MS, createCityMap } from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const runtimes = new Map<string, PickupRuntime>();
  spawnPickups(state, map, runtimes);
  const p = new Player();
  p.name = 'picker';
  state.players.set('s1', p);
  return { state, p, runtimes };
}

describe('пикапы', () => {
  it('спавн: пикап на каждой точке, вид из 4 не-денежных', () => {
    const { state } = setup();
    expect(state.pickups.size).toBe(map.pickupSpots.length);
    state.pickups.forEach((pk) => {
      expect(['bat', 'pistol', 'rifle', 'ammo']).toContain(pk.kind);
      expect(pk.active).toBe(true);
    });
  });

  it('подбор биты: оружие заменено, пикап деактивирован', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'bat';
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('bat');
    expect(pk.active).toBe(false);
  });

  it('подбор пистолета даёт +30 патронов, кап AMMO_MAX', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'pistol';
    p.ammo = AMMO_MAX - 5;
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('pistol');
    expect(p.ammo).toBe(AMMO_MAX);
  });

  it('патроны: +AMMO_PACK_SIZE с капом', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'ammo';
    p.ammo = 10;
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.ammo).toBe(10 + AMMO_PACK_SIZE);
  });

  it('денежный дроп: начисляет сумму и удаляется без респауна', () => {
    const { state, p, runtimes } = setup();
    spawnCashDrop(state, 10, 10, 250, 'cash-v-1');
    p.x = 10; p.z = 10;
    p.cash = 100;
    tickPickups(state, runtimes, 1000);
    expect(p.cash).toBe(350);
    expect(state.pickups.has('cash-v-1')).toBe(false);
  });

  it('дроп (пикап без runtime) после подбора удаляется, а не респаунится', () => {
    const state = new GameState();
    const p = new Player();
    p.name = 'looter';
    p.mode = 'foot';
    state.players.set('s1', p);
    spawnWeaponDrop(state, p.x, p.z, 'bat', 'wpn-test');
    const runtimes = new Map(); // пусто: дроп runtime-записи не имеет
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('bat');
    expect(state.pickups.has('wpn-test')).toBe(false);
    tickPickups(state, runtimes, 1000 + PICKUP_RESPAWN_MS + 1);
    expect(state.pickups.has('wpn-test')).toBe(false);
  });

  it('респаун регулярного пикапа через PICKUP_RESPAWN_MS со сменой вида (из 4)', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(pk.active).toBe(false);
    p.x = 999; p.z = 999; // ушёл
    tickPickups(state, runtimes, 1000 + PICKUP_RESPAWN_MS + 1);
    expect(pk.active).toBe(true);
    expect(['bat', 'pistol', 'rifle', 'ammo']).toContain(pk.kind);
  });

  it('зомби и водитель не подбирают', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'bat';
    p.role = 'zombie';
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('');
    expect(pk.active).toBe(true);
    p.role = 'citizen';
    p.mode = 'car';
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('');
    expect(pk.active).toBe(true);
  });
});
