import { MAP_HALF } from './config.js';

export const ROADS = [-100, 0, 100];
export const ROAD_WIDTH = 20;

export interface BuildingDef {
  x: number; z: number; w: number; d: number; h: number;
  color: number;
  kind: 'house' | 'hospital' | 'police' | 'warehouse';
}
export interface Point { x: number; z: number; }
export interface DoorPoint extends Point { id: string; }
export interface ParkingSpot extends Point { id: string; }
export interface DeliveryTarget extends Point { id: string; }

export interface CityMap {
  buildings: BuildingDef[];
  apartments: DoorPoint[];
  parkingSpots: ParkingSpot[];
  deliveryTargets: DeliveryTarget[];
  hospitalDoor: Point;
  policeDoor: Point;
  jailCell: Point;
  warehouse: Point;
}

export function createCityMap(): CityMap {
  const buildings: BuildingDef[] = [];
  const special: Record<string, BuildingDef['kind']> = {
    '0,0': 'hospital',
    '3,0': 'police',
    '0,3': 'warehouse',
  };
  const specialConf = {
    hospital: { w: 40, d: 30, h: 12, color: 0xffffff },
    police: { w: 40, d: 30, h: 10, color: 0x2244aa },
    warehouse: { w: 40, d: 40, h: 8, color: 0x8b5a2b },
  } as const;
  const palette = [0x8d99ae, 0x6d6875, 0xb5838d, 0x7f8c8d, 0x95a472];

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = -150 + i * 100;
      const cz = -150 + j * 100;
      const kind = special[`${i},${j}`];
      if (kind) {
        buildings.push({ x: cx, z: cz, kind, ...specialConf[kind] });
      } else {
        const n = i * 4 + j;
        buildings.push({
          x: cx, z: cz, w: 36, d: 36,
          h: 10 + ((n * 7) % 20),
          color: palette[n % palette.length],
          kind: 'house',
        });
      }
    }
  }

  const houses = buildings.filter(b => b.kind === 'house');
  const apartments: DoorPoint[] = houses
    .slice(0, 10)
    .map((b, k) => ({ id: `apt${k}`, x: b.x, z: b.z + b.d / 2 + 1 }));

  const parkingSpots: ParkingSpot[] = Array.from({ length: 15 }, (_, k) => ({
    id: `car${k}`,
    x: -175 + k * 25,
    z: -12,
  }));

  void MAP_HALF; // границы проверяются тестами через MAP_HALF из config

  return {
    buildings,
    apartments,
    parkingSpots,
    deliveryTargets: [
      { id: 'shop', x: 50, z: 100 },
      { id: 'gas', x: -100, z: -50 },
      { id: 'port', x: 100, z: -150 },
    ],
    hospitalDoor: { x: -150, z: -133 },
    policeDoor: { x: 150, z: -133 },
    jailCell: { x: 150, z: -172 },
    warehouse: { x: -150, z: 127 },
  };
}
