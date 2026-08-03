import { Client, type Room } from 'colyseus.js';
import { PROTOCOL_VERSION } from '@mmo/shared';

// за https (прод, nginx терминирует TLS) — wss на тот же хост без порта; локально — ws на :2567
function serverUrl(): string {
  return (import.meta as any).env?.VITE_SERVER_URL
    ?? (location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.hostname}:2567`);
}

export async function connect(name: string, role: string, email?: string, password?: string): Promise<Room> {
  const client = new Client(serverUrl());
  const token = localStorage.getItem(`tok:${name}`) ?? ''; // клейм ника из прошлого входа
  const options: Record<string, unknown> = { name, role, token, ver: PROTOCOL_VERSION };
  if (email) options.email = email; // непустые — сервер сам решит: вход по почте или новая привязка
  if (password) options.password = password;
  const room = await client.join('city', options); // join-only: комнату создаёт сервер
  room.onMessage('authToken', (m: { token: string; name?: string }) => {
    // m.name — ник, резолвнутый сервером (при входе по email может отличаться от введённого)
    if (m?.token) localStorage.setItem(`tok:${m.name ?? name}`, m.token);
  });
  return room;
}

// прозрачный реконнект: токен из room.reconnectionToken, окно 10 с держит сервер (allowReconnection)
export function reconnect(reconnectionToken: string): Promise<Room> {
  return new Client(serverUrl()).reconnect(reconnectionToken);
}
