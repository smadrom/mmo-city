import { SMS_MAX_LEN, SMS_COOLDOWN_MS } from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';
import type { GameDB } from '../db.js';

export type SmsError = 'bad_to' | 'self' | 'bad_text' | 'cooldown' | 'no_such_user';
export interface SmsOut { id: number; from: string; to: string; text: string; ts: number }

export function trySms(
  state: GameState,
  runtimes: Map<string, Runtime>,
  db: GameDB,
  playerId: string,
  to: unknown,
  text: unknown,
  now: number,
): { sms?: SmsOut; error?: SmsError } {
  const p = state.players.get(playerId);
  const rt = runtimes.get(playerId);
  if (!p || !rt) return { error: 'bad_to' };
  const toNick = typeof to === 'string' ? to.trim() : '';
  if (!toNick || toNick.length > 16) return { error: 'bad_to' };
  if (toNick === p.name) return { error: 'self' };
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t || t.length > SMS_MAX_LEN) return { error: 'bad_text' };
  if (now - rt.lastSmsAt < SMS_COOLDOWN_MS) return { error: 'cooldown' };
  if (!db.hasPlayer(toNick)) return { error: 'no_such_user' };
  rt.lastSmsAt = now;
  const row = db.addSms(p.name, toNick, t, now);
  return { sms: { id: row.id, from: p.name, to: toNick, text: t, ts: now } };
}
