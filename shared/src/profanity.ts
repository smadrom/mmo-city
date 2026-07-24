// Мини-словарь явного мата (RU+EN). Не претендует на полноту — режет грубое.
const WORDS = [
  'блядь', 'блять', 'сука', 'хуй', 'пизд', 'ебал', 'ёб', 'мудак', 'пидор', 'пидар', 'нахуй',
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot',
];
const RE = new RegExp(`(${WORDS.join('|')})`, 'giu');

// заменяет мат на звёздочки той же длины (длина строки сохраняется — важно для лимитов)
export function censor(text: string): string {
  return text.replace(RE, (m) => '*'.repeat(m.length));
}
