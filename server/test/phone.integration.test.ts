import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import type { GameState } from '../src/schema/GameState.js';
import { CityRoom } from '../src/rooms/CityRoom.js';
import { START_CASH, PROTOCOL_VERSION } from '@mmo/shared';
import { joinWithChar, onceMessage } from './helpers.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Телефон (integration)', () => {
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

  it('sms: онлайн-получатель видит сообщение, отправителю эхо + smsResult', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'smsA', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'smsB', 'citizen');
    const got: any[] = [];
    let result: any = null;
    c1.onMessage('sms', (m) => got.push(m));
    c2.onMessage('sms', (m) => got.push(m));
    c1.onMessage('smsResult', (m) => { result = m; });
    c1.send('sms', { to: 'smsB', text: 'на связи?' });
    await wait(200);
    expect(result).toEqual({ ok: true });
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ from: 'smsA', to: 'smsB', text: 'на связи?' });
    expect(got[0].id).toBeGreaterThan(0);
  });

  it('sms: несуществующий ник → smsResult no_such_user', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'smsC', 'citizen');
    let result: any = null;
    c1.onMessage('smsResult', (m) => { result = m; });
    c1.send('sms', { to: 'ghost', text: 'алло' });
    await wait(200);
    expect(result).toEqual({ ok: false, error: 'no_such_user' });
  });

  it('sms: офлайн-получатель при входе получает smsInbox с непрочитанными', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const anchor = await joinWithChar(testServer, room, 'anchor1', 'citizen');
    const off = await joinWithChar(testServer, room, 'off1', 'citizen');
    await off.leave();
    await wait(200);
    anchor.onMessage('sms', () => {});
    anchor.send('sms', { to: 'off1', text: 'где ты?' });
    await wait(200);
    const back = await testServer.connectTo(room, { email: 'off1@t.local', password: 'pw1234', ver: PROTOCOL_VERSION });
    const inboxP = onceMessage<{ unread: number }>(back, 'smsInbox'); // слушаем ДО selectChar — smsInbox летит сразу за spawnOk
    back.send('selectChar', { name: 'off1' });
    expect(await inboxP).toEqual({ unread: 1 });
  });

  it('smsHistory/smsThread/smsRead: диалоги, тред, сброс непрочитанных', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'hist1', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'hist2', 'citizen');
    c1.onMessage('sms', () => {});
    c2.onMessage('sms', () => {});
    c1.send('sms', { to: 'hist2', text: 'первое' });
    await wait(200);
    let history: any = null;
    c2.onMessage('smsHistory', (m) => { history = m; });
    c2.send('smsHistoryReq');
    await wait(200);
    expect(history.dialogs).toHaveLength(1);
    expect(history.dialogs[0]).toMatchObject({ withNick: 'hist1', lastText: 'первое', unread: 1 });
    let thread: any = null;
    c2.onMessage('smsThread', (m) => { thread = m; });
    c2.send('smsThreadReq', { with: 'hist1' });
    await wait(200);
    expect(thread.items).toHaveLength(1);
    expect(thread.items[0]).toMatchObject({ fromNick: 'hist1', text: 'первое' });
    c2.send('smsRead', { with: 'hist1' });
    await wait(200);
    history = null;
    // smsHistoryReq rate-limited (5 с): ждём cooldown и просим заново
    await wait(5100);
    c2.send('smsHistoryReq');
    await wait(200);
    expect(history.dialogs[0].unread).toBe(0);
  }, 10_000);

  it('transfer: балансы обновляются, получателю transferIn', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'bank1', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'bank2', 'citizen');
    const p1 = room.state.players.get(c1.sessionId);
    const p2 = room.state.players.get(c2.sessionId);
    p1.cash = 500;
    (room as any).savePlayer(c1.sessionId); // фиксируем 500 в БД
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 99999; // обход порога 30 мин (антимультиаккаунт)
    let result: any = null;
    let incoming: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c2.onMessage('transferIn', (m) => { incoming = m; });
    c1.send('transfer', { to: 'bank2', amount: 200 });
    await wait(200);
    expect(result).toMatchObject({ ok: true, balance: 300 });
    expect(incoming).toEqual({ from: 'bank1', amount: 200 });
    expect(p1.cash).toBe(300);
    expect(p2.cash).toBe(700); // START_CASH 500 + 200
  });

  it('transfer: свежий заработок в памяти не даёт ложный no_money (авторизация по памяти)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'fresh1', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'fresh2', 'citizen');
    // заработок только в памяти: БД ещё на START_CASH (savePlayer не вызывали)
    room.state.players.get(c1.sessionId).cash = 900;
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 99999; // обход порога 30 мин (антимультиаккаунт)
    let result: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c1.send('transfer', { to: 'fresh2', amount: 700 }); // > START_CASH, но ≤ памяти
    await wait(200);
    expect(result).toMatchObject({ ok: true, balance: 200 });
    expect(room.state.players.get(c2.sessionId).cash).toBe(START_CASH + 700);
  });

  it('transfer: нехватка средств → no_money', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'poor1', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'poor2', 'citizen');
    void c2;
    const p1 = room.state.players.get(c1.sessionId);
    p1.cash = 50;
    (room as any).savePlayer(c1.sessionId);
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 99999; // обход порога 30 мин (антимультиаккаунт)
    let result: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c1.send('transfer', { to: 'poor2', amount: 100 });
    await wait(200);
    expect(result).toMatchObject({ ok: false, error: 'no_money' });
    expect(p1.cash).toBe(50);
  });

  it('deposit: дробная сумма floor-ится, спам в пределах cooldown игнорируется', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c = await joinWithChar(testServer, room, 'saver', 'citizen');
    const p = room.state.players.get(c.sessionId);
    const apt = [...room.state.apartments.values()][0] as any; // арендуем, ставим к двери
    apt.rentedBy = 'saver'; p.apt = apt.id; p.x = apt.doorX; p.z = apt.doorZ; p.cash = 1000; p.safe = 0;
    c.send('deposit', { amount: 0.9 }); // floor→0: сейф не меняется
    await wait(600);                    // > WRITE_COOLDOWN_MS
    expect(p.safe).toBe(0);
    c.send('deposit', { amount: 100 }); // проходит
    c.send('deposit', { amount: 100 }); // в пределах cooldown → игнор
    await wait(200);
    expect(p.safe).toBe(100);
    expect(p.cash).toBe(900);
  });

  it('transferHistory: свои переводы видны', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'th1', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'th2', 'citizen');
    room.state.players.get(c1.sessionId).cash = 500;
    (room as any).savePlayer(c1.sessionId);
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 99999; // обход порога 30 мин (антимультиаккаунт)
    c1.onMessage('transferResult', () => {});
    c1.send('transfer', { to: 'th2', amount: 50 });
    await wait(200);
    let hist: any = null;
    c2.onMessage('transferHistory', (m) => { hist = m; });
    c2.send('transferHistoryReq');
    await wait(200);
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0]).toMatchObject({ fromNick: 'th1', toNick: 'th2', amount: 50 });
  });

  it('leaderboardReq → leaderboard с топом по убийствам', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'lb1', 'citizen');
    (room as any).db.save({ name: 'champ', cash: 0, safe: 0, apt: '', kills: 42, deaths: 1, weapon: '', ammo: 0 });
    let msg: any = null;
    c1.onMessage('leaderboard', (m) => { msg = m; });
    c1.send('leaderboardReq');
    await wait(200);
    expect(msg.items[0]).toMatchObject({ name: 'champ', kills: 42 });
  });

  it('jobTake/jobDrop: заказ через телефон, требование машины', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'jobber', 'citizen');
    const p = room.state.players.get(c1.sessionId);
    const results: any[] = [];
    c1.onMessage('jobResult', (m) => results.push(m));
    c1.send('jobTake'); // пешком — отказ
    await wait(200);
    expect(results[0]).toEqual({ ok: false, error: 'need_car' });
    p.mode = 'car';
    p.carId = 'car0';
    c1.send('jobTake');
    await wait(200);
    expect(results[1]).toEqual({ ok: true });
    expect(p.cargo).toBe(true);
    c1.send('jobDrop');
    await wait(200);
    expect(results[2]).toEqual({ ok: true });
    expect(p.cargo).toBe(false);
    c1.send('jobDrop'); // повторный — нечего снимать
    await wait(200);
    expect(results[3]).toEqual({ ok: false, error: 'no_job' });
  });
});
