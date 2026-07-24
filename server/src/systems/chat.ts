import { CHAT_MAX_LEN, CHAT_COOLDOWN_MS, censor } from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export interface ChatMessage { from: string; text: string; t: number }

export function tryChat(
  state: GameState,
  runtimes: Map<string, Runtime>,
  playerId: string,
  text: unknown,
  now: number,
): ChatMessage | null {
  const p = state.players.get(playerId);
  const rt = runtimes.get(playerId);
  if (!p || !rt) return null;
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length === 0 || trimmed.length > CHAT_MAX_LEN) return null;
  if (now - rt.lastChatAt < CHAT_COOLDOWN_MS) return null;
  rt.lastChatAt = now;
  return { from: p.name, text: censor(trimmed), t: state.serverTime }; // мат — звёздочками
}
