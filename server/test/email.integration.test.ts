import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

describe('CityRoom email-привязка (integration)', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    process.env.GAME_DB = ':memory:';
    const gameServer = new Server();
    gameServer.define('city', CityRoom);
    testServer = await boot(gameServer);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  it('(a) привязка при первом входе; повторный вход по email резолвит исходный ник', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'anchorMail', role: 'citizen' }); // держит комнату/БД
    const c1 = await testServer.connectTo(room, { name: 'mail1', role: 'citizen', email: 'm1@example.com', password: 'pw1234' });
    let tok: any = null;
    c1.onMessage('authToken', (m: any) => { tok = m; });
    await new Promise(r => setTimeout(r, 150));
    expect(tok?.token).toBeTruthy();
    expect(tok?.name).toBe('mail1'); // authToken теперь несёт резолвнутый ник
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    // без токена и с ДРУГИМ ником в опциях — сервер обязан войти под исходным ником из email-привязки
    const c2 = await testServer.connectTo(room, { name: 'someoneelse', role: 'citizen', email: 'm1@example.com', password: 'pw1234' });
    expect(room.state.players.get(c2.sessionId).name).toBe('mail1');
    // и токен приходит под исходный ник
    let tok2: any = null;
    c2.onMessage('authToken', (m: any) => { tok2 = m; });
    await new Promise(r => setTimeout(r, 150));
    expect(tok2?.name).toBe('mail1');
  });

  it('(b) неверный пароль к привязанной почте отклоняется (bad_password)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'anchorBad', role: 'citizen' });
    const c1 = await testServer.connectTo(room, { name: 'badmail1', role: 'citizen', email: 'bad@example.com', password: 'right1' });
    await new Promise(r => setTimeout(r, 150));
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    await expect(
      testServer.connectTo(room, { name: 'badmail1', role: 'citizen', email: 'bad@example.com', password: 'wrong1' }),
    ).rejects.toThrow(/bad_password/);
  });

  it('(c) новая привязка с коротким паролем отклоняется (weak_password)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'anchorWeak', role: 'citizen' });
    await expect(
      testServer.connectTo(room, { name: 'weak1', role: 'citizen', email: 'weak@example.com', password: '123' }),
    ).rejects.toThrow(/weak_password/);
  });
});
