import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Хеширование паролей email-привязки: scrypt из node:crypto (без новых зависимостей).
// Формат хранения: salt:hashHex (соль 16 байт, хеш 32 байта — в hex).

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex'); // свежая соль на каждый хеш — радужные таблицы не работают
  return `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false; // битая запись — не пускаем
  const hash = scryptSync(pw, salt, 32);
  const expected = Buffer.from(hashHex, 'hex');
  // timingSafeEqual — сравнение без утечки по таймингу; длины обязаны совпасть
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
