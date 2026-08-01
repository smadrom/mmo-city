import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { createExpressApp } from '../src/app.js';
import { registerRoom, clearRoom } from '../src/admin/registry.js';
import { GameDB } from '../src/db.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('админ API', () => {
  let srv: HttpServer;
  let base: string;
  let db: GameDB;

  const stubRoom = () => ({
    adminState: () => ({
      players: [{ name: 'online1', cash: 100, wanted: false, playtimeSec: 60, ip: '5.5.5.5' }],
      playersOnline: 1, maxClients: 100, uptimeSec: 1,
    }),
    kickByName: (n: string) => n === 'online1',
    gameDb: db,
  });

  beforeAll(async () => {
    process.env.ADMIN_TOKEN = 'test-token';
    srv = createExpressApp().listen(0);
    await new Promise<void>(r => srv.once('listening', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env.ADMIN_TOKEN;
    await new Promise(r => srv.close(r));
  });

  beforeEach(() => {
    db = new GameDB(':memory:');
    registerRoom(stubRoom() as any);
  });

  const api = (path: string, opts: RequestInit = {}, token: string | null = 'test-token') =>
    fetch(`${base}/admin/api${path}`, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });

  it('/healthz отвечает JSON без авторизации', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.players).toBe(1); // stubRoom зарегистрирован в beforeEach
    expect(typeof body.rssMb).toBe('number'); // нагрузочный тест читает память отсюда
  });

  it('без токена — 401, с неверным — 401', async () => {
    expect((await api('/state', {}, null)).status).toBe(401);
    expect((await api('/state', {}, 'wrong')).status).toBe(401);
  });

  it('без ADMIN_TOKEN в env — 503 (fail-closed)', async () => {
    const saved = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    expect((await api('/state')).status).toBe(503);
    process.env.ADMIN_TOKEN = saved;
  });

  it('/state отдаёт игроков комнаты', async () => {
    const res = await api('/state');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playersOnline).toBe(1);
    expect(body.players[0]).toMatchObject({ name: 'online1', ip: '5.5.5.5' });
  });

  it('/kick: онлайн — ok, офлайн — 404', async () => {
    const ok = await api('/kick', { method: 'POST', body: JSON.stringify({ name: 'online1' }) });
    expect(ok.status).toBe(200);
    const no = await api('/kick', { method: 'POST', body: JSON.stringify({ name: 'ghost' }) });
    expect(no.status).toBe(404);
  });

  it('/ban пишет в БД (IP подхватывается из онлайна), /unban снимает', async () => {
    const res = await api('/ban', { method: 'POST', body: JSON.stringify({ name: 'online1', reason: 'чит', byIp: true }) });
    expect(res.status).toBe(200);
    expect(db.getActiveBan('online1', Date.now())).toEqual({ reason: 'чит', until: null });
    expect(db.getActiveIpBan('5.5.5.5', Date.now())).not.toBeNull();
    await api('/unban', { method: 'POST', body: JSON.stringify({ name: 'online1' }) });
    expect(db.getActiveBan('online1', Date.now())).toBeNull();
  });

  it('/mute требует минуты, /mutes отдаёт активные', async () => {
    expect((await api('/mute', { method: 'POST', body: JSON.stringify({ name: 'm1' }) })).status).toBe(400);
    const res = await api('/mute', { method: 'POST', body: JSON.stringify({ name: 'm1', minutes: 30, reason: 'флуд' }) });
    expect(res.status).toBe(200);
    const list = await (await api('/mutes')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: 'm1', reason: 'флуд' });
    await api('/unmute', { method: 'POST', body: JSON.stringify({ name: 'm1' }) });
    expect(db.getActiveMute('m1', Date.now())).toBeNull();
  });

  it('/bans отдаёт список', async () => {
    await api('/ban', { method: 'POST', body: JSON.stringify({ name: 'b1', hours: 2 }) });
    const list = await (await api('/bans')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe('b1');
    expect(list.items[0].until).toBeGreaterThan(Date.now());
  });
});
