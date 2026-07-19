import Database from 'better-sqlite3';
import { START_CASH } from '@mmo/shared';

export interface PlayerRecord {
  name: string;
  cash: number;
  safe: number;
  apt: string;
  kills: number;
  deaths: number;
  weapon: string;
  ammo: number;
}

export class GameDB {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        cash INTEGER NOT NULL,
        safe INTEGER NOT NULL,
        apt TEXT NOT NULL DEFAULT '',
        kills INTEGER NOT NULL DEFAULT 0,
        deaths INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.migrate();
  }

  // идемпотентно: добавляет колонки, которых нет (старые БД MVP)
  private migrate(): void {
    const cols = this.db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
    const has = (n: string) => cols.some(c => c.name === n);
    if (!has('weapon')) this.db.exec(`ALTER TABLE players ADD COLUMN weapon TEXT NOT NULL DEFAULT ''`);
    if (!has('ammo')) this.db.exec(`ALTER TABLE players ADD COLUMN ammo INTEGER NOT NULL DEFAULT 0`);
  }

  load(name: string): PlayerRecord {
    const row = this.db.prepare('SELECT * FROM players WHERE name = ?').get(name) as PlayerRecord | undefined;
    if (row) return row;
    const rec: PlayerRecord = { name, cash: START_CASH, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0 };
    this.save(rec);
    return rec;
  }

  save(rec: PlayerRecord): void {
    this.db.prepare(`
      INSERT INTO players (name, cash, safe, apt, kills, deaths, weapon, ammo)
      VALUES (@name, @cash, @safe, @apt, @kills, @deaths, @weapon, @ammo)
      ON CONFLICT(name) DO UPDATE SET
        cash = @cash, safe = @safe, apt = @apt, kills = @kills, deaths = @deaths,
        weapon = @weapon, ammo = @ammo
    `).run(rec);
  }

  close(): void {
    this.db.close();
  }
}
