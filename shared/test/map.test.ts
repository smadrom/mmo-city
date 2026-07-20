import { describe, it, expect } from 'vitest';
import { createCityMap, MAP_HALF, CAR_RADIUS } from '../src/index.js';
import { collidesCircleAABB, inAnyAABB } from '../src/physics.js';

describe('createCityMap', () => {
  const map = createCityMap();

  it('все здания внутри границ мира', () => {
    for (const b of map.buildings) {
      expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(MAP_HALF);
      expect(Math.abs(b.z) + b.d / 2).toBeLessThanOrEqual(MAP_HALF);
    }
  });

  it('ровно 10 квартир, двери не пересекаются со зданиями', () => {
    expect(map.apartments).toHaveLength(10);
    for (const door of map.apartments) {
      for (const b of map.buildings) {
        expect(collidesCircleAABB(door.x, door.z, 1, b)).toBe(false);
      }
    }
  });

  it('15 парковочных мест не пересекаются со зданиями', () => {
    expect(map.parkingSpots).toHaveLength(15);
    for (const s of map.parkingSpots) {
      for (const b of map.buildings) {
        expect(collidesCircleAABB(s.x, s.z, CAR_RADIUS, b)).toBe(false);
      }
    }
  });

  it('точки доставки и ключевые места не внутри зданий', () => {
    const pts = [...map.deliveryTargets, map.hospitalDoor, map.policeDoor, map.jailCell, map.warehouse, map.gunShop];
    for (const p of pts) {
      for (const b of map.buildings) {
        expect(collidesCircleAABB(p.x, p.z, 1, b)).toBe(false);
      }
    }
  });

  it('есть все три точки доставки: shop, gas, port', () => {
    const ids = map.deliveryTargets.map(t => t.id).sort();
    expect(ids).toEqual(['gas', 'port', 'shop']);
  });

  it('двери больницы и полиции — внутри безопасных зон', () => {
    expect(inAnyAABB(map.hospitalDoor.x, map.hospitalDoor.z, map.safeZones)).toBe(true);
    expect(inAnyAABB(map.policeDoor.x, map.policeDoor.z, map.safeZones)).toBe(true);
  });

  it('точки спавна зомби и пикапов не в зданиях и в границах мира', () => {
    for (const p of [...map.zombieSpawns, ...map.pickupSpots]) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(MAP_HALF - 1);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(MAP_HALF - 1);
      for (const b of map.buildings) expect(collidesCircleAABB(p.x, p.z, 1, b)).toBe(false);
    }
  });

  it('10 пикапов, все вне безопасных зон', () => {
    expect(map.pickupSpots).toHaveLength(10);
    for (const p of map.pickupSpots) expect(inAnyAABB(p.x, p.z, map.safeZones)).toBe(false);
  });
});
