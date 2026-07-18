import { describe, it, expect } from 'vitest';
import { createCityMap, MAP_HALF, CAR_RADIUS } from '../src/index.js';
import { collidesCircleAABB } from '../src/physics.js';

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
    const pts = [...map.deliveryTargets, map.hospitalDoor, map.policeDoor, map.jailCell, map.warehouse];
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
});
