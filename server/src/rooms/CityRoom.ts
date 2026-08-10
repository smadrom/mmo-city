import { Room, type Client, type AuthContext } from 'colyseus';
import { StateView } from '@colyseus/schema';
import {
  TICK_RATE, MAX_PLAYERS, COP_LIMIT, DELIVERY_PICKUP_DIST, DOOR_DIST, CHAT_HISTORY, CHAT_HISTORY_COOLDOWN_MS,
  SMS_HISTORY_COOLDOWN_MS, SMS_THREAD_LIMIT, TRANSFER_HISTORY, RENT_INTERVAL_MS, WRITE_COOLDOWN_MS, PROTOCOL_VERSION,
  CHAT_MAX_LEN, CHAT_COOLDOWN_MS, AUTOMUTE_VIOLATIONS, AUTOMUTE_WINDOW_MS, AUTOMUTE_MINUTES, CHARACTER_LIMIT,
  createCityMap, dist2, type AABB, type CityMap,
} from '@mmo/shared';
import { GameState, Player, Car, Apartment } from '../schema/GameState.js';
import { makeRuntime, type Runtime } from '../runtime.js';
import { GameDB } from '../db.js';
import { hashPassword, verifyPassword } from '../auth.js';
import { registerRoom, clearRoom } from '../admin/registry.js';
import { tickMovement } from '../systems/movement.js';
import { tickVehicles, tryEnterCar, tryExitCar, type CarRuntime } from '../systems/vehicles.js';
import { handleAttack, tickRespawn, type AttackResult, type KillEvent } from '../systems/combat.js';
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
  autoDispose = false; // единственная комната живёт вечно (создаётся сервером при старте)

  private map!: CityMap;
  private colliders!: AABB[];
  private db!: GameDB;
  private runtimes = new Map<string, Runtime>();
  private carRuntime = new Map<string, CarRuntime>();
  private lastSaveAt = 0;
  private lastPlaytimeAt = 0; // 0 → первый тик сразу начисляет минуту всем онлайн
  private chatLog: ChatMessage[] = [];
  private pickupRuntime = new Map<string, PickupRuntime>();

  onCreate(options?: { maxClients?: number }): void {
    if (options?.maxClients) this.maxClients = options.maxClients; // тесты поднимают комнату с маленьким лимитом
    registerRoom(this); // админ-API и /healthz
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
      if (!this.state.players.get(client.sessionId)) return; // лобби не атакует
      const events: KillEvent[] = [];
      const res = handleAttack(this.state, this.runtimes, client.sessionId, Date.now(), this.colliders, this.map.safeZones, events);
      this.broadcastAttack(res);
      this.broadcastKillEvents(events);
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
      if (this.writeRateLimited(client.sessionId)) return;
      adjustSafe(this.state, client.sessionId, Math.floor(Math.abs(Number(data?.amount) || 0)));
    });
    this.onMessage('withdraw', (client, data) => {
      if (this.writeRateLimited(client.sessionId)) return;
      adjustSafe(this.state, client.sessionId, -Math.floor(Math.abs(Number(data?.amount) || 0)));
    });
    this.onMessage('chat', (client, data) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.runtimes.get(client.sessionId);
      if (!p || !rt) return;
      const now = Date.now();
      const mute = this.db.getActiveMute(p.name, now);
      if (mute) {
        client.send('notice', { code: 'muted', until: mute.until }); // текст собирает клиент (i18n)
        return;
      }
      // засчитываем нарушение кулдауна до вызова tryChat (он молча гасит спам)
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (text && text.length <= CHAT_MAX_LEN && now - rt.lastChatAt < CHAT_COOLDOWN_MS) {
        this.recordChatViolation(client.sessionId);
      }
      const msg = tryChat(this.state, this.runtimes, client.sessionId, data?.text, now);
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
      if (this.writeRateLimited(client.sessionId)) return;
      const p = this.state.players.get(client.sessionId);
      const withNick = String(data?.with ?? '').trim();
      if (!p || !withNick) return;
      this.db.markRead(p.name, withNick);
    });
    this.onMessage('transfer', (client, data) => {
      if (this.writeRateLimited(client.sessionId)) return;
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      this.savePlayer(client.sessionId); // синк БД с авторитетной памятью: иначе db.transfer (WHERE cash>=amount) даёт ложный no_money после свежего заработка
      const res = tryTransfer(this.state, this.db, client.sessionId, data?.to, data?.amount, Date.now(), { playtimeSec: rt.playtimeSec, ip: rt.ip });
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
    this.onMessage('leaderboardReq', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      const now = Date.now();
      if (!rt || now - rt.lastLbAt < SMS_HISTORY_COOLDOWN_MS) return;
      rt.lastLbAt = now;
      client.send('leaderboard', { items: this.db.topByKills(10) });
    });
    this.onMessage('ping', (client, data) => client.send('pong', data)); // эхо для RTT-метрики клиента (F3)
    // --- лобби персонажей (только пока у клиента нет Player в state) ---
    this.onMessage('createChar', (client, data) => {
      if (this.state.players.get(client.sessionId)) return;
      const auth = client.auth as { email: string };
      const name = String(data?.name ?? '').trim().slice(0, 16);
      const role = String(data?.role ?? '');
      if (!name) return this.lobbyError(client, 'nick_bad');
      if (role !== 'citizen' && role !== 'cop') return this.lobbyError(client, 'role_bad');
      if (this.db.countChars(auth.email) >= CHARACTER_LIMIT) return this.lobbyError(client, 'slots_full');
      const ban = this.db.getActiveBan(name, Date.now()); // бан переживает удаление ника — проверяем и при создании
      if (ban) return this.lobbyError(client, ban.until === null ? 'banned_perm' : 'banned');
      if (this.db.getChar(name) || this.db.hasPlayer(name)) return this.lobbyError(client, 'nick_taken');
      if (role === 'cop' && this.copCount() >= COP_LIMIT) return this.lobbyError(client, 'cop_full');
      this.db.createChar(auth.email, name, role);
      this.spawnPlayer(client, { name, role });
    });
    this.onMessage('selectChar', (client, data) => {
      if (this.state.players.get(client.sessionId)) return;
      const auth = client.auth as { email: string };
      const name = String(data?.name ?? '').trim().slice(0, 16);
      const char = this.db.getChar(name);
      if (!char || char.email !== auth.email) return this.lobbyError(client, 'not_found');
      const ban = this.db.getActiveBan(name, Date.now());
      if (ban) return this.lobbyError(client, ban.until === null ? 'banned_perm' : 'banned');
      if (char.role === 'cop' && this.copCount() >= COP_LIMIT) return this.lobbyError(client, 'cop_full');
      this.spawnPlayer(client, char);
    });
    this.onMessage('deleteChar', (client, data) => {
      if (this.state.players.get(client.sessionId)) return;
      const auth = client.auth as { email: string };
      const name = String(data?.name ?? '').trim().slice(0, 16);
      const char = this.db.getChar(name);
      if (!char || char.email !== auth.email) return this.lobbyError(client, 'not_found');
      if (this.findSessionByName(name)) return this.lobbyError(client, 'not_found'); // персонаж в мире (даже frozen-призрак) — не удаляем
      this.db.deleteChar(name);
      this.sendCharList(client); // свежий список после удаления
    });
    this.onMessage('jobTake', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      const res = tryTakeJob(this.state, client.sessionId, this.map, Date.now(), rt);
      client.send('jobResult', { ok: res === 'ok', error: res === 'ok' ? undefined : res });
    });
    this.onMessage('jobDrop', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      const ok = tryDropJob(this.state, client.sessionId, rt, Date.now());
      client.send('jobResult', { ok, error: ok ? undefined : 'no_job' });
    });
  }

  // аутентификация: только email + пароль. Неизвестный email = регистрация на месте
  // (без подтверждения почты). Ник/токен больше не участвуют (жёсткий срез).
  onAuth(_client: Client, options: { email?: string; password?: string; ver?: number }, context?: AuthContext): { email: string; ip: string } {
    // хендшейк версии: присланный, но несовпадающий ver отклоняем
    if (options?.ver !== undefined && options.ver !== PROTOCOL_VERSION) throw new Error('bad_version');
    const email = String(options?.email ?? '').trim().toLowerCase().slice(0, 64);
    if (!email) throw new Error('need_email');
    const password = String(options?.password ?? '').slice(0, 128);
    // IP для антифарм-лимита/IP-бана: Colyseus берёт X-Real-IP/X-Forwarded-For (за nginx), иначе сокет
    const rawIp = context?.ip;
    const ip = Array.isArray(rawIp) ? (rawIp[0] ?? '') : (rawIp ?? '').split(',')[0].trim();
    const ipBan = this.db.getActiveIpBan(ip, Date.now());
    if (ipBan) throw new Error(ipBan.until === null ? 'banned_perm' : 'banned');
    const acc = this.db.getAccount(email);
    if (acc) {
      if (!verifyPassword(password, acc.passhash)) throw new Error('bad_password');
    } else {
      if (password.length < 4) throw new Error('weak_password'); // регистрация — минимум 4
      this.db.createAccount(email, hashPassword(password));
    }
    // один онлайн на аккаунт; замороженный призрак — реконнект владельца, его вытеснит spawnPlayer
    for (const c of this.clients) {
      if ((c.auth as { email?: string } | undefined)?.email === email && !this.runtimes.get(c.sessionId)?.frozen) {
        throw new Error('account_online');
      }
    }
    return { email, ip };
  }

  // лобби: Player НЕ создаётся — клиент получает список персонажей и выбирает/создаёт
  onJoin(client: Client): void {
    this.sendCharList(client);
  }

  private sendCharList(client: Client): void {
    const email = (client.auth as { email: string }).email;
    client.send('charList', { chars: this.db.listChars(email), copFull: this.copCount() >= COP_LIMIT });
  }

  private copCount(): number {
    let n = 0;
    this.state.players.forEach(pl => { if (pl.role === 'cop') n++; });
    return n;
  }

  private lobbyError(client: Client, code: string): void {
    client.send('lobbyError', { code });
  }

  // спавн персонажа: вытеснение призрака того же ника, загрузка прогресса, StateView, runtime
  private spawnPlayer(client: Client, char: { name: string; role: string }): void {
    const name = char.name;
    const ghostId = this.findSessionByName(name);
    if (ghostId) this.removePlayer(ghostId, true); // вытеснение своего призрака — не «вышел»
    const role: 'citizen' | 'cop' = char.role === 'cop' ? 'cop' : 'citizen';
    const rec = this.db.load(name);
    const auth = client.auth as { email: string; ip?: string };

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

    // приватные поля (@view) видит только владелец
    client.view = new StateView();
    client.view.add(p);

    const rt = makeRuntime(Date.now());
    rt.kills = rec.kills;
    rt.deaths = rec.deaths;
    rt.playtimeSec = this.db.getPlaytime(name); // наигрыш переживает релог
    rt.ip = auth.ip ?? ''; // из onAuth — антифарм-лимит переводов по IP
    rt.nextRentAt = this.db.getRentDue(name) || (Date.now() + RENT_INTERVAL_MS); // рента переживает релог
    rt.salaryAnchorX = p.x; // якорь патруля = точка спавна
    rt.salaryAnchorZ = p.z;
    this.runtimes.set(client.sessionId, rt);
    client.send('spawnOk', { name });
    client.send('smsInbox', { unread: this.db.unreadCount(name) });
    this.broadcast('sys', { code: 'join', name, t: this.state.serverTime }); // системное: вошёл в город
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    if (!this.state.players.get(client.sessionId)) return; // лобби-клиент: ни игрока, ни runtime — чистить нечего
    try {
      if (consented) throw new Error('consented leave');
      const rt = this.runtimes.get(client.sessionId);
      if (rt) rt.frozen = true; // заморозить призрака на окно реконнекта (не двигается/не арестуется/не агрит зомби)
      await this.allowReconnection(client, 10);
      const rt2 = this.runtimes.get(client.sessionId);
      if (rt2) rt2.frozen = false; // настоящий colyseus-реконнект (если появится) — размораживаем
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  onDispose(): void {
    this.state.players.forEach((_p, id) => this.savePlayer(id));
    this.db.close();
    clearRoom();
  }

  private removePlayer(id: string, silent = false): void {
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
      if (!silent && p.role !== 'zombie') {
        this.broadcast('sys', { code: 'leave', name: p.name, t: this.state.serverTime }); // системное: вышел
      }
    }
    this.runtimes.delete(id);
  }

  private savePlayer(id: string): void {
    const p = this.state.players.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return;
    if (p.role === 'zombie') return; // зомби не персистентны
    try {
      this.db.save({ name: p.name, cash: p.cash, safe: p.safe, apt: p.apt, kills: rt.kills, deaths: rt.deaths, weapon: p.weapon, ammo: p.ammo, playtimeSec: rt.playtimeSec });
      this.db.setRentDue(p.name, rt.nextRentAt); // персистим срок ренты → релог не обнуляет
    } catch (err) {
      console.error('[city] db save error', err);
    }
  }

  // антиспам дешёвых пишущих эндпоинтов (deposit/withdraw/transfer/smsRead)
  private writeRateLimited(id: string): boolean {
    const rt = this.runtimes.get(id);
    if (!rt) return true;
    const now = Date.now();
    if (now - rt.lastWriteAt < WRITE_COOLDOWN_MS) return true;
    rt.lastWriteAt = now;
    return false;
  }

  // N срабатываний чат-кулдауна за окно → автомут (спам-флуд)
  private recordChatViolation(id: string): void {
    const rt = this.runtimes.get(id);
    const p = this.state.players.get(id);
    if (!rt || !p) return;
    const now = Date.now();
    rt.chatViolations = rt.chatViolations.filter(t => now - t < AUTOMUTE_WINDOW_MS);
    rt.chatViolations.push(now);
    if (rt.chatViolations.length >= AUTOMUTE_VIOLATIONS) {
      rt.chatViolations = [];
      this.db.mute(p.name, now + AUTOMUTE_MINUTES * 60_000, 'автомут: спам');
    }
  }

  private findSessionByName(name: string): string | null {
    let found: string | null = null;
    this.state.players.forEach((pl, id) => {
      if (!found && pl.name === name && pl.role !== 'zombie') found = id;
    });
    return found;
  }

  // --- админ-API (server/src/admin/routes.ts) ---
  get gameDb(): GameDB { return this.db; }

  adminState(): {
    players: { name: string; cash: number; wanted: boolean; playtimeSec: number; ip: string }[];
    playersOnline: number; maxClients: number; uptimeSec: number;
  } {
    const players: { name: string; cash: number; wanted: boolean; playtimeSec: number; ip: string }[] = [];
    this.state.players.forEach((p, id) => {
      if (p.role === 'zombie') return;
      const rt = this.runtimes.get(id);
      players.push({
        name: p.name,
        cash: p.cash,
        wanted: p.wantedUntil > Date.now(),
        playtimeSec: rt?.playtimeSec ?? 0,
        ip: rt?.ip ?? '',
      });
    });
    return { players, playersOnline: players.length, maxClients: this.maxClients, uptimeSec: Math.floor(process.uptime()) };
  }

  kickByName(name: string): boolean {
    const id = this.findSessionByName(name);
    if (!id) return false;
    this.clients.find(c => c.sessionId === id)?.leave(4000); // 4000 = consented, без окна реконнекта
    return true;
  }

  private broadcastAttack(res: AttackResult): void {
    if (res.shot) this.broadcast('shot', { ...res.shot, attacker: res.attacker }); // attacker — клиентской отдаче/вспышке
    if (res.swing) this.broadcast('swing', { player: res.attacker });
    for (const h of res.hits) this.broadcast('hit', { ...h, attacker: res.attacker }); // attacker — клиентскому hitDealt/hitTaken
  }

  // kill feed: убийства (и bounty) — общий broadcast ников
  private broadcastKillEvents(events: KillEvent[]): void {
    for (const ev of events) {
      const a = this.state.players.get(ev.killerId)?.name;
      const b = this.state.players.get(ev.victimId)?.name;
      if (!a || !b) continue;
      this.broadcast('feed', { kind: ev.bounty ? 'bounty' : 'kill', a, b });
    }
  }

  private handleInteract(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    if (p.mode === 'car') {
      if (!p.cargo && dist2(p.x, p.z, this.map.warehouse.x, this.map.warehouse.z) < DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) {
        const rt = this.runtimes.get(client.sessionId);
        if (rt) tryStartDelivery(this.state, client.sessionId, this.map, Date.now(), rt);
        return;
      }
      tryExitCar(this.state, client.sessionId, this.colliders);
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
    const killEvents: KillEvent[] = [];
    const carHits = tickVehicles(this.state, this.runtimes, this.carRuntime, this.colliders, dt, now, this.map.parkingSpots, this.map.safeZones, killEvents);
    for (const h of carHits) this.broadcast('hit', h);
    const zombieAttacks = tickZombies(this.state, this.runtimes, this.map, this.colliders, now, killEvents);
    for (const res of zombieAttacks) this.broadcastAttack(res);
    this.broadcastKillEvents(killEvents);
    for (const ev of tickPickups(this.state, this.pickupRuntime, now)) {
      this.clients.find(c => c.sessionId === ev.playerId)?.send('picked', { kind: ev.kind, amount: ev.amount });
    }
    tickRespawn(this.state, this.runtimes, this.map, now);
    const arrests = tickPolice(this.state, this.runtimes, now, dt, this.map);
    for (const a of arrests) this.broadcast('feed', { kind: 'arrest', a: a.cop, b: a.crim });
    for (const ev of tickDelivery(this.state, this.map, now, this.runtimes)) {
      this.clients.find(c => c.sessionId === ev.playerId)?.send('delivered', { reward: ev.reward });
    }
    tickRent(this.state, this.runtimes, now);
    if (now - this.lastPlaytimeAt > 60_000) { // наигрыш для порога переводов (антимультиаккаунт)
      this.runtimes.forEach((rt) => { rt.playtimeSec += 60; });
      this.lastPlaytimeAt = now;
    }
    if (now - this.lastSaveAt > SAVE_INTERVAL_MS) {
      this.state.players.forEach((_p, id) => this.savePlayer(id));
      this.lastSaveAt = now;
    }
  }
}
