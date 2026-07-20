import { describe, it, expect } from 'vitest';
import { MapSchema } from '@colyseus/schema';
import { MAX_HP } from '@mmo/shared';
import { GameState, Player, Car, Apartment, Pickup } from '../src/schema/GameState.js';

describe('Player schema', () => {
  it('has expected defaults', () => {
    const p = new Player();
    expect(p.name).toBe('');
    expect(p.role).toBe('citizen');
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.z).toBe(0);
    expect(p.rotY).toBe(0);
    expect(p.hp).toBe(MAX_HP);
    expect(p.mode).toBe('foot');
    expect(p.carId).toBe('');
    expect(p.apt).toBe('');
    expect(p.wantedUntil).toBe(0);
    expect(p.jailUntil).toBe(0);
    expect(p.cash).toBe(0);
    expect(p.safe).toBe(0);
    expect(p.cargo).toBe(false);
    expect(p.deliveryTarget).toBe('');
    expect(p.deliveryDeadline).toBe(0);
    expect(p.weapon).toBe('');
    expect(p.ammo).toBe(0);
  });
});

describe('Car schema', () => {
  it('has expected defaults', () => {
    const c = new Car();
    expect(c.id).toBe('');
    expect(c.x).toBe(0);
    expect(c.z).toBe(0);
    expect(c.rotY).toBe(0);
    expect(c.speed).toBe(0);
    expect(c.steer).toBe(0);
    expect(c.driverId).toBe('');
  });
});

describe('Apartment schema', () => {
  it('has expected defaults', () => {
    const a = new Apartment();
    expect(a.id).toBe('');
    expect(a.doorX).toBe(0);
    expect(a.doorZ).toBe(0);
    expect(a.rentedBy).toBe('');
  });
});

describe('Pickup schema', () => {
  it('has expected defaults', () => {
    const p = new Pickup();
    expect(p.id).toBe('');
    expect(p.kind).toBe('');
    expect(p.x).toBe(0);
    expect(p.z).toBe(0);
    expect(p.active).toBe(true);
    expect(p.amount).toBe(0);
  });
});

describe('GameState schema', () => {
  it('has map collections and serverTime', () => {
    const s = new GameState();
    expect(s.players).toBeInstanceOf(MapSchema);
    expect(s.cars).toBeInstanceOf(MapSchema);
    expect(s.apartments).toBeInstanceOf(MapSchema);
    expect(s.pickups).toBeInstanceOf(MapSchema);
    expect(s.serverTime).toBe(0);
  });

  it('stores entities in maps', () => {
    const s = new GameState();
    const p = new Player();
    p.name = 'Bob';
    s.players.set('sess1', p);
    expect(s.players.get('sess1')?.name).toBe('Bob');
    expect(s.players.size).toBe(1);
  });
});
