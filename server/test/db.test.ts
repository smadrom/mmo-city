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
    expect(rec).toEqual({ name: 'alice', cash: START_CASH, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0 });
  });

  it('save/load сохраняет прогресс, включая оружие', () => {
    db = new GameDB(':memory:');
    db.load('bob');
    db.save({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1, weapon: 'pistol', ammo: 90 });
    expect(db.load('bob')).toEqual({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1, weapon: 'pistol', ammo: 90 });
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
    expect(db.load('old')).toEqual({ name: 'old', cash: 100, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0 });
    db.close();
    db = new GameDB(path); // повторный запуск — миграция не падает
    expect(db.load('old').cash).toBe(100);
    db.close();
    cleanup(path);
    db = new GameDB(':memory:');
  });
});
