import { Client, type Room } from 'colyseus.js';
import { PROTOCOL_VERSION } from '@mmo/shared';

// за https (прод, nginx терминирует TLS) — wss на тот же хост без порта; локально — ws на :2567
function serverUrl(): string {
  return (import.meta as any).env?.VITE_SERVER_URL
    ?? (location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.hostname}:2567`);
}

export async function connect(name: string, role: string): Promise<Room> {
  const client = new Client(serverUrl());
  const token = localStorage.getItem(`tok:${name}`) ?? ''; // клейм ника из прошлого входа
  const room = await client.join('city', { name, role, token, ver: PROTOCOL_VERSION }); // join-only: комнату создаёт сервер
  room.onMessage('authToken', (m: { token: string }) => {
    if (m?.token) localStorage.setItem(`tok:${name}`, m.token);
  });
  return room;
}

// прозрачный реконнект: токен из room.reconnectionToken, окно 10 с держит сервер (allowReconnection)
export function reconnect(reconnectionToken: string): Promise<Room> {
  return new Client(serverUrl()).reconnect(reconnectionToken);
}
