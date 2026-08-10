import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { GameDB } from '../src/db.js';
import { START_CASH } from '@mmo/shared';

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(path + suffix)) unlinkSync(path + suffix);
  }
}

describe('GameDB', () => {
  let db: GameDB;
  afterEach(() => db?.close());

  it('новый игрок получает стартовые значения', () => {
    db = new GameDB(':memory:');
    const rec = db.load('alice');
    expect(rec).toMatchObject({ name: 'alice', cash: START_CASH, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0 });
  });

  it('save/load сохраняет прогресс, включая оружие', () => {
    db = new GameDB(':memory:');
    db.load('bob');
    db.save({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1, weapon: 'pistol', ammo: 90 });
    expect(db.load('bob')).toMatchObject({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1, weapon: 'pistol', ammo: 90 });
  });

  it('данные переживают переоткрытие файла', () => {
    const path = `test-${Date.now()}.db`;
    const db1 = new GameDB(path);
    db1.save({ name: 'c', cash: 1, safe: 2, apt: '', kills: 0, deaths: 0, weapon: 'bat', ammo: 0 });
    db1.close();
    const db2 = new GameDB(path);
    expect(db2.load('c').weapon).toBe('bat');
    db2.close();
    cleanup(path);
    db = new GameDB(':memory:'); // заглушка для afterEach
  });

  it('миграция: старая таблица без weapon/ammo дополняется идемпотентно', () => {
    const path = `test-migrate-${Date.now()}.db`;
    const raw = new Database(path);
    raw.exec(`CREATE TABLE players (
      name TEXT PRIMARY KEY, cash INTEGER NOT NULL, safe INTEGER NOT NULL,
      apt TEXT NOT NULL DEFAULT '', kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0
    )`);
    raw.prepare(`INSERT INTO players (name, cash, safe, apt, kills, deaths) VALUES ('old', 100, 0, '', 0, 0)`).run();
    raw.close();

    db = new GameDB(path); // первая миграция
    expect(db.load('old')).toMatchObject({ name: 'old', cash: 100, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0 });
    db.close();
    db = new GameDB(path); // повторный запуск — миграция не падает
    expect(db.load('old').cash).toBe(100);
    db.close();
    cleanup(path);
    db = new GameDB(':memory:');
  });

  it('SMS: addSms/getThread/markRead/unreadCount', () => {
    db = new GameDB(':memory:');
    db.load('alice'); db.load('bob');
    db.addSms('alice', 'bob', 'привет', 1000);
    db.addSms('bob', 'alice', 'и тебе', 2000);
    db.addSms('alice', 'bob', 'как дела', 3000);
    expect(db.unreadCount('bob')).toBe(2);
    expect(db.unreadCount('alice')).toBe(1);
    const thread = db.getThread('alice', 'bob', 50);
    expect(thread.map(m => m.text)).toEqual(['привет', 'и тебе', 'как дела']);
    expect(thread[0].fromNick).toBe('alice');
    db.markRead('bob', 'alice');
    expect(db.unreadCount('bob')).toBe(0);
  });

  it('SMS: getDialogs — по одному ряду на собеседника, свежие сверху', () => {
    db = new GameDB(':memory:');
    db.load('alice'); db.load('bob'); db.load('carl');
    db.addSms('alice', 'bob', 'a→b', 1000);
    db.addSms('carl', 'alice', 'c→a', 2000);
    db.addSms('bob', 'alice', 'b→a', 3000);
    const dialogs = db.getDialogs('alice');
    expect(dialogs.map(d => d.withNick)).toEqual(['bob', 'carl']);
    expect(dialogs[0].lastText).toBe('b→a');
    expect(dialogs[0].unread).toBe(1);
    expect(dialogs[1].unread).toBe(1);
    db.markRead('alice', 'bob');
    expect(db.getDialogs('alice')[0].unread).toBe(0);
  });

  it('getThread режет до limit последних (хронология сохраняется)', () => {
    db = new GameDB(':memory:');
    db.load('a'); db.load('b');
    for (let i = 1; i <= 5; i++) db.addSms('a', 'b', `m${i}`, i * 1000);
    expect(db.getThread('a', 'b', 3).map(m => m.text)).toEqual(['m3', 'm4', 'm5']);
  });

  it('transfer: успех списывает и зачисляет, пишет историю', () => {
    db = new GameDB(':memory:');
    db.load('alice'); db.load('bob'); // по START_CASH
    expect(db.transfer('alice', 'bob', 200, 5000, '')).toBe(true);
    expect(db.load('alice').cash).toBe(START_CASH - 200);
    expect(db.load('bob').cash).toBe(START_CASH + 200);
    const hist = db.getTransfers('bob', 10);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ fromNick: 'alice', toNick: 'bob', amount: 200, ts: 5000 });
  });

  it('transfer: нехватка средств — false, балансы и история не тронуты', () => {
    db = new GameDB(':memory:');
    db.load('alice'); db.load('bob');
    expect(db.transfer('alice', 'bob', START_CASH + 1, 5000, '')).toBe(false);
    expect(db.load('alice').cash).toBe(START_CASH);
    expect(db.load('bob').cash).toBe(START_CASH);
    expect(db.getTransfers('alice', 10)).toHaveLength(0);
  });

  it('hasPlayer: true для существующего, false для неизвестного', () => {
    db = new GameDB(':memory:');
    db.load('alice');
    expect(db.hasPlayer('alice')).toBe(true);
    expect(db.hasPlayer('ghost')).toBe(false);
  });

  it('rent_due: setRentDue/getRentDue персистятся, дефолт 0', () => {
    db = new GameDB(':memory:');
    db.load('renter');
    expect(db.getRentDue('renter')).toBe(0);
    db.setRentDue('renter', 1_700_000_000_000);
    expect(db.getRentDue('renter')).toBe(1_700_000_000_000);
  });

  it('accounts/chars: createAccount/getAccount, createChar/listChars/countChars/getChar', () => {
    const db = new GameDB(':memory:');
    expect(db.getAccount('a@b.c')).toBeNull();
    db.createAccount('a@b.c', 'salt:hash');
    expect(db.getAccount('a@b.c')).toEqual({ email: 'a@b.c', passhash: 'salt:hash' });
    expect(db.countChars('a@b.c')).toBe(0);
    db.createChar('a@b.c', 'neo', 'citizen');
    db.createChar('a@b.c', 'trinity', 'cop');
    expect(db.countChars('a@b.c')).toBe(2);
    expect(db.listChars('a@b.c')).toEqual([
      { name: 'neo', role: 'citizen' },
      { name: 'trinity', role: 'cop' },
    ]);
    expect(db.getChar('neo')).toEqual({ name: 'neo', email: 'a@b.c', role: 'citizen' });
    expect(db.getChar('nobody')).toBeNull();
    // createChar создаёт и строку прогресса со стартовым капиталом
    expect(db.load('neo').cash).toBe(START_CASH);
    db.close();
  });

  it('deleteChar: чистит characters/players/sms; ник освобождается; бан не трогает', () => {
    const db = new GameDB(':memory:');
    db.createAccount('a@b.c', 'salt:hash');
    db.createChar('a@b.c', 'neo', 'citizen');
    db.addSms('neo', 'trinity', 'hi', 1);
    db.addSms('trinity', 'neo', 'yo', 2);
    db.ban('neo', '', 'test', null, false);
    db.deleteChar('neo');
    expect(db.getChar('neo')).toBeNull();
    expect(db.hasPlayer('neo')).toBe(false);
    expect(db.getDialogs('trinity')).toEqual([]); // SMS с ником стёрты
    expect(db.getActiveBan('neo', Date.now())).not.toBeNull(); // бан переживает удаление (анти-обход)
    db.createChar('a@b.c', 'neo', 'cop'); // ник освободился
    expect(db.getChar('neo')?.role).toBe('cop');
    db.close();
  });

  it('миграция: старый email-аккаунт переносится в accounts/characters', () => {
    const path = `test-migrate-chars-${Date.now()}.db`;
    const db1 = new GameDB(path);
    db1.load('oldnick'); // строка прогресса
    (db1 as any).db.prepare(`UPDATE players SET email = 'old@example.com', passhash = 'salt:hash' WHERE name = 'oldnick'`).run();
    db1.close();
    const db2 = new GameDB(path); // конструктор → migrate() → бэкфилл
    expect(db2.getAccount('old@example.com')).toEqual({ email: 'old@example.com', passhash: 'salt:hash' });
    expect(db2.getChar('oldnick')).toEqual({ name: 'oldnick', email: 'old@example.com', role: 'citizen' });
    db2.close();
    rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
  });
});

describe('playtime + transfer_log + модерация', () => {
  it('playtime: по умолчанию 0, save/getPlaytime сохраняют значение', () => {
    const db = new GameDB(':memory:');
    db.load('pt1');
    expect(db.getPlaytime('pt1')).toBe(0);
    const rec = db.load('pt1');
    rec.playtimeSec = 1234;
    db.save(rec);
    expect(db.getPlaytime('pt1')).toBe(1234);
    db.close();
  });

  it('ipTransferSum: суммирует только свежие переводы с этого IP', () => {
    const db = new GameDB(':memory:');
    db.load('a'); db.load('b'); db.load('c');
    const now = Date.now();
    db.transfer('a', 'b', 300, now, '1.1.1.1');
    db.transfer('a', 'b', 200, now - 25 * 3600_000, '1.1.1.1'); // старый — не считается
    db.transfer('a', 'b', 500, now, '2.2.2.2');                  // другой IP — не считается
    expect(db.ipTransferSum('1.1.1.1', now - 24 * 3600_000)).toBe(300);
    expect(db.ipTransferSum('', now - 24 * 3600_000)).toBe(0);   // без IP лимит не считаем
    db.close();
  });

  it('ban: активный по нику, истёкший — нет, unban снимает', () => {
    const db = new GameDB(':memory:');
    const now = Date.now();
    db.ban('bad1', '1.2.3.4', 'спам', null, false);
    expect(db.getActiveBan('bad1', now)).toEqual({ reason: 'спам', until: null });
    expect(db.getActiveBan('good1', now)).toBeNull();
    db.ban('temp1', '', 'х', now - 1000, false); // уже истёк
    expect(db.getActiveBan('temp1', now)).toBeNull();
    db.unban('bad1');
    expect(db.getActiveBan('bad1', now)).toBeNull();
    db.close();
  });

  it('getActiveIpBan: только byIp=1 и непустой IP', () => {
    const db = new GameDB(':memory:');
    const now = Date.now();
    db.ban('soft', '9.9.9.9', 'x', null, false);  // byIp=0 — по IP не сработает
    db.ban('hard', '1.1.1.1', 'x', null, true);
    expect(db.getActiveIpBan('9.9.9.9', now)).toBeNull();
    expect(db.getActiveIpBan('1.1.1.1', now)).not.toBeNull();
    expect(db.getActiveIpBan('', now)).toBeNull();
    db.close();
  });

  it('mute: активен до until, unmute снимает, listMutes отдаёт активные', () => {
    const db = new GameDB(':memory:');
    const now = Date.now();
    db.mute('m1', now + 60_000, 'флуд');
    expect(db.getActiveMute('m1', now)).toEqual({ until: now + 60_000, reason: 'флуд' });
    expect(db.getActiveMute('m2', now)).toBeNull();
    db.mute('m3', now - 1, 'старый');
    expect(db.getActiveMute('m3', now)).toBeNull();
    expect(db.listMutes(now).map(m => m.name)).toEqual(['m1']);
    db.unmute('m1');
    expect(db.getActiveMute('m1', now)).toBeNull();
    db.close();
  });

  it('topByKills: порядок по kills desc, лимит', () => {
    const db = new GameDB(':memory:');
    for (let i = 0; i < 12; i++) {
      db.save({ name: `p${i}`, cash: 0, safe: 0, apt: '', kills: i, deaths: 0, weapon: '', ammo: 0 });
    }
    const top = db.topByKills(10);
    expect(top).toHaveLength(10);
    expect(top[0]).toMatchObject({ name: 'p11', kills: 11 });
    expect(top[9]).toMatchObject({ name: 'p2', kills: 2 });
    db.close();
  });

  it('listBans отдаёт все баны', () => {
    const db = new GameDB(':memory:');
    db.ban('b1', '', 'r1', null, false);
    db.ban('b2', '1.1.1.1', 'r2', Date.now() + 3600_000, true);
    const rows = db.listBans();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.name === 'b2')).toMatchObject({ ip: '1.1.1.1', byIp: 1 });
    db.close();
  });
});
