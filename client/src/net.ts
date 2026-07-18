import { Client, type Room } from 'colyseus.js';

export async function connect(name: string, role: string): Promise<Room> {
  const url = (import.meta as any).env?.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
  const client = new Client(url);
  return client.joinOrCreate('city', { name, role });
}
