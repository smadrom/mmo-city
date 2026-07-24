import { describe, it, expect } from 'vitest';
import { censor } from '../src/profanity.js';

describe('censor', () => {
  it('маскирует мат звёздочками, сохраняя длину', () => {
    expect(censor('сука, привет')).toBe('****, привет');
  });
  it('регистронезависим и ловит английский мат', () => {
    expect(censor('FUCK off')).toBe('**** off');
  });
  it('ловит подстроку внутри слова', () => {
    expect(censor('пиздец')).toBe('****ец');
  });
  it('чистый текст не трогает', () => {
    expect(censor('привет, город')).toBe('привет, город');
  });
});
