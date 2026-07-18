import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { GameDB } from '../src/db.js';
import { START_CASH } from '@mmo/shared';

describe('GameDB', () => {
  let db: GameDB;
  afterEach(() => db?.close());

  it('новый игрок получает стартовые значения', () => {
    db = new GameDB(':memory:');
    const rec = db.load('alice');
    expect(rec).toEqual({ name: 'alice', cash: START_CASH, safe: 0, apt: '', kills: 0, deaths: 0 });
  });

  it('save/load сохраняет прогресс', () => {
    db = new GameDB(':memory:');
    db.load('bob');
    db.save({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1 });
    expect(db.load('bob')).toEqual({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1 });
  });

  it('данные переживают переоткрытие файла', () => {
    const path = `test-${Date.now()}.db`;
    const db1 = new GameDB(path);
    db1.save({ name: 'c', cash: 1, safe: 2, apt: '', kills: 0, deaths: 0 });
    db1.close();
    const db2 = new GameDB(path);
    expect(db2.load('c').safe).toBe(2);
    db2.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
    db = new GameDB(':memory:'); // заглушка для afterEach
  });
});
