import { Client, type Room } from 'colyseus.js';
import { PROTOCOL_VERSION } from '@mmo/shared';

export async function connect(name: string, role: string): Promise<Room> {
  const url = (import.meta as any).env?.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
  const client = new Client(url);
  const token = localStorage.getItem(`tok:${name}`) ?? ''; // клейм ника из прошлого входа
  const room = await client.joinOrCreate('city', { name, role, token, ver: PROTOCOL_VERSION });
  room.onMessage('authToken', (m: { token: string }) => {
    if (m?.token) localStorage.setItem(`tok:${name}`, m.token);
  });
  return room;
}
