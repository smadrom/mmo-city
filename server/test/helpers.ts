import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room } from 'colyseus.js';
import { PROTOCOL_VERSION } from '@mmo/shared';

// Вход в новой модели: аккаунт = email (дёривируется из ника → ник = один аккаунт),
// персонаж создаётся createChar'ом; повторный вход того же ника → selectChar.
// Возвращает клиента уже заспавненным (spawnOk получен).
export async function joinWithChar(
  testServer: ColyseusTestServer,
  room: any,
  name: string,
  role: 'citizen' | 'cop' = 'citizen',
): Promise<Room> {
  const email = `${name.toLowerCase()}@t.local`;
  const client = await testServer.connectTo(room, { email, password: 'pw1234', ver: PROTOCOL_VERSION });
  const spawned = onceMessage(client, 'spawnOk');
  const exists = room.db.getChar(name); // серверная БД (приватное поле) — тесты лезут осознанно
  client.send(exists ? 'selectChar' : 'createChar', { name, role });
  await spawned;
  return client;
}

export function onceMessage<T = any>(client: Room, type: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting "${type}"`)), ms);
    const off = client.onMessage(type, (m: T) => { clearTimeout(timer); off(); resolve(m); });
  });
}
