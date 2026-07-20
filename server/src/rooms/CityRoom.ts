import { Room, type Client } from 'colyseus';
import {
  TICK_RATE, MAX_PLAYERS, COP_LIMIT, DELIVERY_PICKUP_DIST, DOOR_DIST, CHAT_HISTORY, CHAT_HISTORY_COOLDOWN_MS,
  SMS_HISTORY_COOLDOWN_MS, SMS_THREAD_LIMIT, TRANSFER_HISTORY,
  createCityMap, dist2, type AABB, type CityMap,
} from '@mmo/shared';
import { GameState, Player, Car, Apartment } from '../schema/GameState.js';
import { makeRuntime, type Runtime } from '../runtime.js';
import { GameDB } from '../db.js';
import { tickMovement } from '../systems/movement.js';
import { tickVehicles, tryEnterCar, tryExitCar, type CarRuntime } from '../systems/vehicles.js';
import { handleAttack, tickRespawn, type AttackResult } from '../systems/combat.js';
import { spawnPickups, tickPickups, type PickupRuntime } from '../systems/pickups.js';
import { spawnZombies, tickZombies } from '../systems/zombies.js';
import { tickPolice } from '../systems/police.js';
import { tryStartDelivery, tickDelivery, tryTransfer, tryTakeJob, tryDropJob } from '../systems/economy.js';
import { trySms } from '../systems/messages.js';
import { tryRent, adjustSafe, tickRent } from '../systems/housing.js';
import { tryBuyWeapon, tryBuyAmmo } from '../systems/shop.js';
import { tryChat, type ChatMessage } from '../systems/chat.js';

const SAVE_INTERVAL_MS = 5000;

export class CityRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;

  private map!: CityMap;
  private colliders!: AABB[];
  private db!: GameDB;
  private runtimes = new Map<string, Runtime>();
  private carRuntime = new Map<string, CarRuntime>();
  private lastSaveAt = 0;
  private chatLog: ChatMessage[] = [];
  private pickupRuntime = new Map<string, PickupRuntime>();

  onCreate(): void {
    this.map = createCityMap();
    this.colliders = this.map.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
    this.db = new GameDB(process.env.GAME_DB ?? 'game.db');
    this.setState(new GameState());

    for (const spot of this.map.parkingSpots) {
      const car = new Car();
      car.id = spot.id;
      car.x = spot.x;
      car.z = spot.z;
      this.state.cars.set(spot.id, car);
      this.carRuntime.set(spot.id, { emptySince: 0 });
    }
    for (const door of this.map.apartments) {
      const a = new Apartment();
      a.id = door.id;
      a.doorX = door.x;
      a.doorZ = door.z;
      this.state.apartments.set(door.id, a);
    }
    const now0 = Date.now();
    spawnPickups(this.state, this.map, this.pickupRuntime);
    spawnZombies(this.state, this.runtimes, this.map, now0);

    this.setSimulationInterval((dtMs) => {
      try {
        this.tick(dtMs / 1000);
      } catch (err) {
        console.error('[city] tick error', err);
      }
    }, 1000 / TICK_RATE);

    this.onMessage('input', (client, data) => {
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      const rotY = Number(data?.rotY);
      rt.input = {
        up: !!data?.up, down: !!data?.down, left: !!data?.left, right: !!data?.right,
        sprint: !!data?.sprint, rotY: Number.isFinite(rotY) ? rotY : 0,
      };
    });
    this.onMessage('attack', (client) => {
      const res = handleAttack(this.state, this.runtimes, client.sessionId, Date.now(), this.colliders, this.map.safeZones);
      this.broadcastAttack(res);
    });
    this.onMessage('buyWeapon', (client, data) => {
      const reason = tryBuyWeapon(this.state, client.sessionId, String(data?.kind ?? ''), this.map);
      client.send('shopResult', { ok: reason === 'ok', reason });
    });
    this.onMessage('buyAmmo', (client) => {
      const reason = tryBuyAmmo(this.state, client.sessionId, this.map);
      client.send('shopResult', { ok: reason === 'ok', reason });
    });
    this.onMessage('interact', (client) => this.handleInteract(client));
    this.onMessage('deposit', (client, data) => {
      adjustSafe(this.state, client.sessionId, Math.abs(Number(data?.amount) || 0));
    });
    this.onMessage('withdraw', (client, data) => {
      adjustSafe(this.state, client.sessionId, -Math.abs(Number(data?.amount) || 0));
    });
    this.onMessage('chat', (client, data) => {
      const msg = tryChat(this.state, this.runtimes, client.sessionId, data?.text, Date.now());
      if (!msg) return;
      this.chatLog.push(msg);
      if (this.chatLog.length > CHAT_HISTORY) this.chatLog.shift();
      this.broadcast('chat', msg);
    });
    this.onMessage('chatHistoryReq', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      const now = Date.now();
      if (!rt || now - rt.lastChatHistAt < CHAT_HISTORY_COOLDOWN_MS) return;
      rt.lastChatHistAt = now;
      client.send('chatHistory', { items: this.chatLog });
    });
    this.onMessage('sms', (client, data) => {
      const res = trySms(this.state, this.runtimes, this.db, client.sessionId, data?.to, data?.text, Date.now());
      if (res.error || !res.sms) {
        client.send('smsResult', { ok: false, error: res.error });
        return;
      }
      client.send('smsResult', { ok: true });
      client.send('sms', res.sms); // эхо для своей ленты
      const toId = this.findSessionByName(res.sms.to);
      if (toId) this.clients.find(c => c.sessionId === toId)?.send('sms', res.sms);
    });
    this.onMessage('smsHistoryReq', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      const p = this.state.players.get(client.sessionId);
      const now = Date.now();
      if (!rt || !p || now - rt.lastSmsHistAt < SMS_HISTORY_COOLDOWN_MS) return;
      rt.lastSmsHistAt = now;
      client.send('smsHistory', { dialogs: this.db.getDialogs(p.name) });
    });
    this.onMessage('smsThreadReq', (client, data) => {
      const rt = this.runtimes.get(client.sessionId);
      const p = this.state.players.get(client.sessionId);
      const now = Date.now();
      const withNick = String(data?.with ?? '').trim();
      if (!rt || !p || !withNick || now - rt.lastSmsThreadAt < SMS_HISTORY_COOLDOWN_MS) return;
      rt.lastSmsThreadAt = now;
      client.send('smsThread', { with: withNick, items: this.db.getThread(p.name, withNick, SMS_THREAD_LIMIT) });
    });
    this.onMessage('smsRead', (client, data) => {
      const p = this.state.players.get(client.sessionId);
      const withNick = String(data?.with ?? '').trim();
      if (!p || !withNick) return;
      this.db.markRead(p.name, withNick);
    });
    this.onMessage('transfer', (client, data) => {
      const res = tryTransfer(this.state, this.db, client.sessionId, data?.to, data?.amount, Date.now());
      client.send('transferResult', { ok: res.ok, error: res.error, balance: res.balance });
      if (res.ok && res.toNick && res.amount) {
        const from = this.state.players.get(client.sessionId)?.name ?? '';
        const toId = this.findSessionByName(res.toNick);
        if (toId) this.clients.find(c => c.sessionId === toId)?.send('transferIn', { from, amount: res.amount });
      }
    });
    this.onMessage('transferHistoryReq', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      const p = this.state.players.get(client.sessionId);
      const now = Date.now();
      if (!rt || !p || now - rt.lastTransferHistAt < SMS_HISTORY_COOLDOWN_MS) return;
      rt.lastTransferHistAt = now;
      client.send('transferHistory', { items: this.db.getTransfers(p.name, TRANSFER_HISTORY) });
    });
    this.onMessage('jobTake', (client) => {
      const ok = tryTakeJob(this.state, client.sessionId, this.map, Date.now());
      client.send('jobResult', { ok, error: ok ? undefined : 'need_car' });
    });
    this.onMessage('jobDrop', (client) => {
      const ok = tryDropJob(this.state, client.sessionId);
      client.send('jobResult', { ok, error: ok ? undefined : 'no_job' });
    });
  }

  onJoin(client: Client, options: { name?: string; role?: string }): void {
    const name = String(options?.name ?? '').slice(0, 16) || `p${client.sessionId.slice(0, 6)}`;
    let role: 'citizen' | 'cop' = options?.role === 'cop' ? 'cop' : 'citizen';
    if (role === 'cop') {
      let cops = 0;
      this.state.players.forEach(pl => { if (pl.role === 'cop') cops++; });
      if (cops >= COP_LIMIT) role = 'citizen';
    }
    const rec = this.db.load(name);

    const p = new Player();
    p.name = name;
    p.role = role;
    const door = role === 'cop' ? this.map.policeDoor : this.map.hospitalDoor;
    p.x = door.x + Math.random() * 4 - 2;
    p.z = door.z + Math.random() * 2; // только в сторону от здания, чтобы не заспавнить в коллизии
    p.cash = rec.cash;
    p.safe = rec.safe;
    p.weapon = rec.weapon;
    p.ammo = rec.ammo;
    if (rec.apt) {
      const apt = this.state.apartments.get(rec.apt);
      if (apt && (!apt.rentedBy || apt.rentedBy === name)) {
        apt.rentedBy = name;
        p.apt = rec.apt;
      }
    }
    this.state.players.set(client.sessionId, p);

    const rt = makeRuntime(Date.now());
    rt.kills = rec.kills;
    rt.deaths = rec.deaths;
    this.runtimes.set(client.sessionId, rt);
    client.send('smsInbox', { unread: this.db.unreadCount(name) });
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    try {
      if (consented) throw new Error('consented leave');
      await this.allowReconnection(client, 10);
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  onDispose(): void {
    this.state.players.forEach((_p, id) => this.savePlayer(id));
    this.db.close();
  }

  private removePlayer(id: string): void {
    const p = this.state.players.get(id);
    if (p) {
      if (p.mode === 'car') {
        const car = this.state.cars.get(p.carId);
        if (car) {
          car.driverId = '';
          car.speed = 0;
        }
      }
      this.savePlayer(id);
      this.state.players.delete(id);
    }
    this.runtimes.delete(id);
  }

  private savePlayer(id: string): void {
    const p = this.state.players.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return;
    if (p.role === 'zombie') return; // зомби не персистентны
    try {
      this.db.save({ name: p.name, cash: p.cash, safe: p.safe, apt: p.apt, kills: rt.kills, deaths: rt.deaths, weapon: p.weapon, ammo: p.ammo });
    } catch (err) {
      console.error('[city] db save error', err);
    }
  }

  private findSessionByName(name: string): string | null {
    let found: string | null = null;
    this.state.players.forEach((pl, id) => {
      if (!found && pl.name === name && pl.role !== 'zombie') found = id;
    });
    return found;
  }

  private broadcastAttack(res: AttackResult): void {
    if (res.shot) this.broadcast('shot', { ...res.shot, attacker: res.attacker }); // attacker — клиентской отдаче/вспышке
    if (res.swing) this.broadcast('swing', { player: res.attacker });
    for (const h of res.hits) this.broadcast('hit', h);
  }

  private handleInteract(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    if (p.mode === 'car') {
      if (!p.cargo && dist2(p.x, p.z, this.map.warehouse.x, this.map.warehouse.z) < DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) {
        tryStartDelivery(this.state, client.sessionId, this.map, Date.now());
        return;
      }
      tryExitCar(this.state, client.sessionId);
      return;
    }
    if (p.mode !== 'foot') return;
    if (dist2(p.x, p.z, this.map.gunShop.x, this.map.gunShop.z) < DOOR_DIST * DOOR_DIST) {
      client.send('openShop');
      return;
    }
    let nearApt: Apartment | null = null;
    this.state.apartments.forEach((a) => {
      if (nearApt) return;
      if (dist2(p.x, p.z, a.doorX, a.doorZ) < DOOR_DIST * DOOR_DIST) nearApt = a;
    });
    if (nearApt) {
      const apt: Apartment = nearApt;
      if (apt.rentedBy === p.name) client.send('openSafe');
      else tryRent(this.state, this.runtimes, client.sessionId, Date.now());
      return;
    }
    tryEnterCar(this.state, client.sessionId);
  }

  private tick(dt: number): void {
    const now = Date.now();
    this.state.serverTime = now;
    tickMovement(this.state, this.runtimes, this.colliders, dt, now);
    const carHits = tickVehicles(this.state, this.runtimes, this.carRuntime, this.colliders, dt, now, this.map.parkingSpots, this.map.safeZones);
    for (const h of carHits) this.broadcast('hit', h);
    const zombieAttacks = tickZombies(this.state, this.runtimes, this.map, this.colliders, now);
    for (const res of zombieAttacks) this.broadcastAttack(res);
    tickPickups(this.state, this.pickupRuntime, now);
    tickRespawn(this.state, this.runtimes, this.map, now);
    tickPolice(this.state, this.runtimes, now, dt, this.map);
    tickDelivery(this.state, this.map, now);
    tickRent(this.state, this.runtimes, now);
    if (now - this.lastSaveAt > SAVE_INTERVAL_MS) {
      this.state.players.forEach((_p, id) => this.savePlayer(id));
      this.lastSaveAt = now;
    }
  }
}
