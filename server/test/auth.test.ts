import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';

describe('auth (scrypt)', () => {
  it('hashPassword → salt:hashHex, verifyPassword подтверждает', () => {
    const stored = hashPassword('secret1');
    const [salt, hashHex] = stored.split(':');
    expect(salt).toHaveLength(32); // 16 байт в hex
    expect(hashHex).toHaveLength(64); // scrypt 32 байта в hex
    expect(verifyPassword('secret1', stored)).toBe(true);
  });

  it('соль уникальна: два хеша одного пароля различаются', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('неверный пароль и битый формат — false', () => {
    const stored = hashPassword('right');
    expect(verifyPassword('wrong', stored)).toBe(false);
    expect(verifyPassword('right', 'no-colon')).toBe(false);
    expect(verifyPassword('right', '')).toBe(false);
  });
});
