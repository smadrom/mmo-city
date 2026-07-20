import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import type { GameState } from '../src/schema/GameState.js';
import { CityRoom } from '../src/rooms/CityRoom.js';

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
    const c1 = await testServer.connectTo(room, { name: 'smsA', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'smsB', role: 'citizen' });
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
    const c1 = await testServer.connectTo(room, { name: 'smsC', role: 'citizen' });
    let result: any = null;
    c1.onMessage('smsResult', (m) => { result = m; });
    c1.send('sms', { to: 'ghost', text: 'алло' });
    await wait(200);
    expect(result).toEqual({ ok: false, error: 'no_such_user' });
  });

  it('sms: офлайн-получатель при входе получает smsInbox с непрочитанными', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const anchor = await testServer.connectTo(room, { name: 'anchor1', role: 'citizen' });
    const off = await testServer.connectTo(room, { name: 'off1', role: 'citizen' });
    let offTok = '';
    off.onMessage('authToken', (m: any) => { offTok = m.token; });
    await wait(150);
    await off.leave();
    await wait(200);
    anchor.onMessage('sms', () => {});
    anchor.send('sms', { to: 'off1', text: 'где ты?' });
    await wait(200);
    const back = await testServer.connectTo(room, { name: 'off1', role: 'citizen', token: offTok });
    let inbox: any = null;
    back.onMessage('smsInbox', (m) => { inbox = m; });
    await wait(300);
    expect(inbox).toEqual({ unread: 1 });
  });

  it('smsHistory/smsThread/smsRead: диалоги, тред, сброс непрочитанных', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'hist1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'hist2', role: 'citizen' });
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
    const c1 = await testServer.connectTo(room, { name: 'bank1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'bank2', role: 'citizen' });
    const p1 = room.state.players.get(c1.sessionId);
    const p2 = room.state.players.get(c2.sessionId);
    p1.cash = 500;
    (room as any).savePlayer(c1.sessionId); // фиксируем 500 в БД
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

  it('transfer: нехватка средств → no_money', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'poor1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'poor2', role: 'citizen' });
    void c2;
    const p1 = room.state.players.get(c1.sessionId);
    p1.cash = 50;
    (room as any).savePlayer(c1.sessionId);
    let result: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c1.send('transfer', { to: 'poor2', amount: 100 });
    await wait(200);
    expect(result).toMatchObject({ ok: false, error: 'no_money' });
    expect(p1.cash).toBe(50);
  });

  it('transferHistory: свои переводы видны', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'th1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'th2', role: 'citizen' });
    room.state.players.get(c1.sessionId).cash = 500;
    (room as any).savePlayer(c1.sessionId);
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

  it('jobTake/jobDrop: заказ через телефон, требование машины', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'jobber', role: 'citizen' });
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
