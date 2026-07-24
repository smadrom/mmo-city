import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
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
  secret?: string; // токен владельца аккаунта (не попадает в реплицируемое состояние)
  playtimeSec?: number; // наигрыш в секундах (колонка playtime_sec); антимультиаккаунт
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
      );
      CREATE TABLE IF NOT EXISTS sms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_nick TEXT NOT NULL,
        to_nick TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sms_inbox ON sms(to_nick, is_read);
      CREATE TABLE IF NOT EXISTS transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_nick TEXT NOT NULL,
        to_nick TEXT NOT NULL,
        amount INTEGER NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfer_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_nick TEXT NOT NULL,
        to_nick TEXT NOT NULL,
        amount INTEGER NOT NULL,
        ip TEXT NOT NULL DEFAULT '',
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transfer_log_ip ON transfer_log(ip, ts);
      CREATE TABLE IF NOT EXISTS bans (
        name TEXT PRIMARY KEY,
        ip TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        until INTEGER,
        byIp INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bans_ip ON bans(ip);
      CREATE TABLE IF NOT EXISTS mutes (
        name TEXT PRIMARY KEY,
        until INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT ''
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
    if (!has('secret')) this.db.exec(`ALTER TABLE players ADD COLUMN secret TEXT NOT NULL DEFAULT ''`);
    if (!has('rent_due')) this.db.exec(`ALTER TABLE players ADD COLUMN rent_due INTEGER NOT NULL DEFAULT 0`);
    if (!has('playtime_sec')) this.db.exec(`ALTER TABLE players ADD COLUMN playtime_sec INTEGER NOT NULL DEFAULT 0`);
  }

  load(name: string): PlayerRecord {
    const row = this.db.prepare('SELECT * FROM players WHERE name = ?').get(name) as PlayerRecord | undefined;
    if (row) {
      if (!row.secret) { // аккаунт из старой БД (до auth) — клеймим секретом при первом входе
        row.secret = randomUUID();
        this.db.prepare('UPDATE players SET secret = ? WHERE name = ?').run(row.secret, name);
      }
      return row;
    }
    const rec: PlayerRecord = { name, cash: START_CASH, safe: 0, apt: '', kills: 0, deaths: 0, weapon: '', ammo: 0, secret: randomUUID() };
    this.db.prepare(`
      INSERT INTO players (name, cash, safe, apt, kills, deaths, weapon, ammo, secret)
      VALUES (@name, @cash, @safe, @apt, @kills, @deaths, @weapon, @ammo, @secret)
    `).run(rec);
    return rec;
  }

  // { exists, secret } для аутентификации; secret '' = аккаунт ещё не заклеймён (можно занять)
  getAuth(name: string): { exists: boolean; secret: string } {
    const row = this.db.prepare('SELECT secret FROM players WHERE name = ?').get(name) as { secret: string } | undefined;
    return { exists: !!row, secret: row?.secret ?? '' };
  }

  // срок следующей ренты (ms). 0 = не задан (новый/без квартиры). Персистится → релог не сбрасывает.
  getRentDue(name: string): number {
    const row = this.db.prepare('SELECT rent_due AS rentDue FROM players WHERE name = ?').get(name) as { rentDue: number } | undefined;
    return row?.rentDue ?? 0;
  }

  setRentDue(name: string, ts: number): void {
    this.db.prepare('UPDATE players SET rent_due = ? WHERE name = ?').run(Math.floor(ts), name);
  }

  // наигрыш (сек) — порог для переводов; живёт в рантайме, сюда сбрасывается savePlayer'ом
  getPlaytime(name: string): number {
    const row = this.db.prepare('SELECT playtime_sec AS s FROM players WHERE name = ?').get(name) as { s: number } | undefined;
    return row?.s ?? 0;
  }

  // сумма переводов с IP за окно (суточный антифарм-лимит). Без IP — 0 (лимит не срабатывает)
  ipTransferSum(ip: string, sinceTs: number): number {
    if (!ip) return 0;
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM transfer_log WHERE ip = ? AND ts >= ?',
    ).get(ip, sinceTs) as { s: number };
    return row.s;
  }

  ban(name: string, ip: string, reason: string, until: number | null, byIp: boolean): void {
    this.db.prepare(`
      INSERT INTO bans (name, ip, reason, until, byIp, created) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET ip = excluded.ip, reason = excluded.reason,
        until = excluded.until, byIp = excluded.byIp, created = excluded.created
    `).run(name, ip, reason, until, byIp ? 1 : 0, Date.now());
  }

  unban(name: string): void {
    this.db.prepare('DELETE FROM bans WHERE name = ?').run(name);
  }

  getActiveBan(name: string, now: number): { reason: string; until: number | null } | null {
    const row = this.db.prepare('SELECT reason, until FROM bans WHERE name = ?').get(name) as { reason: string; until: number | null } | undefined;
    if (!row) return null;
    if (row.until !== null && row.until <= now) return null; // истёк
    return { reason: row.reason, until: row.until };
  }

  // жёсткий бан по IP — только строки с byIp=1 (NAT: осознанный opt-in админа)
  getActiveIpBan(ip: string, now: number): { reason: string; until: number | null } | null {
    if (!ip) return null;
    const row = this.db.prepare('SELECT reason, until FROM bans WHERE ip = ? AND byIp = 1').get(ip) as { reason: string; until: number | null } | undefined;
    if (!row) return null;
    if (row.until !== null && row.until <= now) return null;
    return { reason: row.reason, until: row.until };
  }

  listBans(): { name: string; ip: string; reason: string; until: number | null; byIp: number; created: number }[] {
    return this.db.prepare('SELECT name, ip, reason, until, byIp, created FROM bans ORDER BY created DESC').all() as any[];
  }

  mute(name: string, until: number, reason: string): void {
    this.db.prepare(`
      INSERT INTO mutes (name, until, reason) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET until = excluded.until, reason = excluded.reason
    `).run(name, Math.floor(until), reason);
  }

  unmute(name: string): void {
    this.db.prepare('DELETE FROM mutes WHERE name = ?').run(name);
  }

  getActiveMute(name: string, now: number): { until: number; reason: string } | null {
    const row = this.db.prepare('SELECT until, reason FROM mutes WHERE name = ?').get(name) as { until: number; reason: string } | undefined;
    if (!row || row.until <= now) return null;
    return { until: row.until, reason: row.reason };
  }

  listMutes(now: number): { name: string; until: number; reason: string }[] {
    return this.db.prepare('SELECT name, until, reason FROM mutes WHERE until > ? ORDER BY until DESC').all(now) as any[];
  }

  save(rec: PlayerRecord): void {
    this.db.prepare(`
      INSERT INTO players (name, cash, safe, apt, kills, deaths, weapon, ammo, playtime_sec)
      VALUES (@name, @cash, @safe, @apt, @kills, @deaths, @weapon, @ammo, @playtimeSec)
      ON CONFLICT(name) DO UPDATE SET
        cash = @cash, safe = @safe, apt = @apt, kills = @kills, deaths = @deaths,
        weapon = @weapon, ammo = @ammo, playtime_sec = @playtimeSec
    `).run({ playtimeSec: 0, ...rec });
  }

  hasPlayer(name: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM players WHERE name = ?').get(name);
  }

  addSms(from: string, to: string, text: string, ts: number): { id: number } {
    const info = this.db.prepare(
      'INSERT INTO sms (from_nick, to_nick, text, ts) VALUES (?, ?, ?, ?)',
    ).run(from, to, text, ts);
    return { id: Number(info.lastInsertRowid) };
  }

  unreadCount(nick: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS c FROM sms WHERE to_nick = ? AND is_read = 0',
    ).get(nick) as { c: number };
    return row.c;
  }

  markRead(me: string, withNick: string): void {
    this.db.prepare('UPDATE sms SET is_read = 1 WHERE to_nick = ? AND from_nick = ?').run(me, withNick);
  }

  getDialogs(nick: string): { withNick: string; lastText: string; lastTs: number; unread: number }[] {
    const last = this.db.prepare(`
      SELECT s.from_nick AS fromNick, s.to_nick AS toNick, s.text AS lastText, s.ts AS lastTs
      FROM sms s
      JOIN (
        SELECT MAX(id) AS mid FROM sms
        WHERE from_nick = ? OR to_nick = ?
        GROUP BY CASE WHEN from_nick = ? THEN to_nick ELSE from_nick END
      ) m ON s.id = m.mid
      ORDER BY s.id DESC
    `).all(nick, nick, nick) as { fromNick: string; toNick: string; lastText: string; lastTs: number }[];
    const unread = this.db.prepare(
      'SELECT from_nick AS withNick, COUNT(*) AS unread FROM sms WHERE to_nick = ? AND is_read = 0 GROUP BY from_nick',
    ).all(nick) as { withNick: string; unread: number }[];
    const unreadBy = new Map(unread.map(u => [u.withNick, u.unread]));
    return last.map(r => ({
      withNick: r.fromNick === nick ? r.toNick : r.fromNick,
      lastText: r.lastText,
      lastTs: r.lastTs,
      unread: unreadBy.get(r.fromNick === nick ? r.toNick : r.fromNick) ?? 0,
    }));
  }

  getThread(me: string, withNick: string, limit: number): { id: number; fromNick: string; text: string; ts: number }[] {
    const rows = this.db.prepare(`
      SELECT id, from_nick AS fromNick, text, ts FROM sms
      WHERE (from_nick = ? AND to_nick = ?) OR (from_nick = ? AND to_nick = ?)
      ORDER BY id DESC LIMIT ?
    `).all(me, withNick, withNick, me, limit) as { id: number; fromNick: string; text: string; ts: number }[];
    return rows.reverse(); // DESC выборку разворачиваем в хронологию
  }

  transfer(from: string, to: string, amount: number, ts: number, ip: string): boolean {
    const tx = this.db.transaction((): boolean => {
      const r = this.db.prepare('UPDATE players SET cash = cash - ? WHERE name = ? AND cash >= ?').run(amount, from, amount);
      if (r.changes === 0) return false;
      this.db.prepare('UPDATE players SET cash = cash + ? WHERE name = ?').run(amount, to);
      this.db.prepare('INSERT INTO transfers (from_nick, to_nick, amount, ts) VALUES (?, ?, ?, ?)').run(from, to, amount, ts);
      this.db.prepare('INSERT INTO transfer_log (from_nick, to_nick, amount, ip, ts) VALUES (?, ?, ?, ?, ?)').run(from, to, amount, ip, ts);
      return true;
    });
    return tx();
  }

  getTransfers(nick: string, limit: number): { fromNick: string; toNick: string; amount: number; ts: number }[] {
    return this.db.prepare(`
      SELECT from_nick AS fromNick, to_nick AS toNick, amount, ts FROM transfers
      WHERE from_nick = ? OR to_nick = ?
      ORDER BY id DESC LIMIT ?
    `).all(nick, nick, limit) as { fromNick: string; toNick: string; amount: number; ts: number }[];
  }

  close(): void {
    this.db.close();
  }
}
