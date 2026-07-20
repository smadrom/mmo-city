import { describe, it, expect } from 'vitest';
import {
  SMS_MAX_LEN, SMS_COOLDOWN_MS, SMS_THREAD_LIMIT, SMS_HISTORY_COOLDOWN_MS,
  TRANSFER_MIN, TRANSFER_MAX, TRANSFER_HISTORY,
  MINIMAP_SIZE, MINIMAP_RADIUS, FULLMAP_MAX_ZOOM,
} from '../src/index.js';

describe('константы этапа «Карта и телефон»', () => {
  it('SMS-лимиты заданы и разумны', () => {
    expect(SMS_MAX_LEN).toBe(140);
    expect(SMS_COOLDOWN_MS).toBe(1500);
    expect(SMS_THREAD_LIMIT).toBe(50);
    expect(SMS_HISTORY_COOLDOWN_MS).toBe(5000);
  });

  it('лимиты переводов и миникарты заданы', () => {
    expect(TRANSFER_MIN).toBe(1);
    expect(TRANSFER_MAX).toBe(100_000);
    expect(TRANSFER_HISTORY).toBe(10);
    expect(MINIMAP_SIZE).toBe(200);
    expect(MINIMAP_RADIUS).toBe(60);
    expect(FULLMAP_MAX_ZOOM).toBe(6);
  });
});
