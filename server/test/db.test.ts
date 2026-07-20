import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
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
    expect(rec.secret).toBeTruthy(); // новый аккаунт получает секрет
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
    expect(db.transfer('alice', 'bob', 200, 5000)).toBe(true);
    expect(db.load('alice').cash).toBe(START_CASH - 200);
    expect(db.load('bob').cash).toBe(START_CASH + 200);
    const hist = db.getTransfers('bob', 10);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ fromNick: 'alice', toNick: 'bob', amount: 200, ts: 5000 });
  });

  it('transfer: нехватка средств — false, балансы и история не тронуты', () => {
    db = new GameDB(':memory:');
    db.load('alice'); db.load('bob');
    expect(db.transfer('alice', 'bob', START_CASH + 1, 5000)).toBe(false);
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

  it('auth: новый аккаунт получает секрет; getAuth совпадает; чужой ник свободен', () => {
    db = new GameDB(':memory:');
    const rec = db.load('neo');
    expect(rec.secret).toBeTruthy();
    const auth = db.getAuth('neo');
    expect(auth.exists).toBe(true);
    expect(auth.secret).toBe(rec.secret);
    expect(db.getAuth('nobody')).toEqual({ exists: false, secret: '' });
  });

  it('rent_due: setRentDue/getRentDue персистятся, дефолт 0', () => {
    db = new GameDB(':memory:');
    db.load('renter');
    expect(db.getRentDue('renter')).toBe(0);
    db.setRentDue('renter', 1_700_000_000_000);
    expect(db.getRentDue('renter')).toBe(1_700_000_000_000);
  });
});
