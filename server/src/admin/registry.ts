import type { CityRoom } from '../rooms/CityRoom.js';

// синглтон-комната регистрируется в onCreate — админ-API и /healthz ходят через неё
let room: CityRoom | null = null;

export function registerRoom(r: CityRoom): void { room = r; }
export function getRoom(): CityRoom | null { return room; }
export function clearRoom(): void { room = null; }
