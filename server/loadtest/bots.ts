import { Client, type Room } from 'colyseus.js';
import { PROTOCOL_VERSION } from '@mmo/shared';

// Нагрузочный тест: N ботов с полным профилем сообщений (движение, бой, магазин,
// чат, sms, переводы, сейф, заказы, лидерборд) на RUN_MS миллисекунд.
// Метрики: интервалы serverTime между патчами (здоровье тика), RSS сервера
// через /healthz до/после, ошибки джойна. Пороги деградации → exit(1).
// Сервер поднимается отдельно, против ЧИСТОЙ БД (иначе повторные прогоны
// упираются в занятые ники и уже зарегистрированные аккаунты):
//   GAME_DB=':memory:' npm run start -w server
//   npm run loadtest -w server

const N = Number(process.env.BOTS ?? 100);
const RUN_MS = Number(process.env.RUN_MS ?? 60_000);
const url = process.env.SERVER_URL ?? 'ws://localhost:2567';
const httpUrl = url.replace(/^ws/, 'http');

// пороги деградации (тик 20 Гц = 50 мс; сетевой шум localhost минимален)
const AVG_TICK_MAX_MS = 100;
const P99_TICK_MAX_MS = 300;

const PHRASES = ['привет', 'как дела', 'го в порт', 'копы на складе', 'продам биту', 'где магазин?', '++++'];

interface Healthz { status: string; players: number; uptimeSec: number; rssMb?: number }

async function health(): Promise<Healthz | null> {
  try {
    const res = await fetch(`${httpUrl}/healthz`);
    return (await res.json()) as Healthz;
  } catch {
    return null;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// все типы, которые может прислать сервер — подписываемся, чтобы не спамить warning'и
const SILENCED = [
  'charList', 'lobbyError', 'spawnOk', 'smsInbox', 'sms', 'smsResult', 'smsHistory', 'smsThread',
  'transferResult', 'transferIn', 'transferHistory', 'notice', 'feed',
  'picked', 'delivered', 'leaderboard', 'chat', 'chatHistory',
  'shot', 'hit', 'swing', 'shopResult', 'jobResult', 'openShop', 'openSafe',
];

async function main(): Promise<void> {
  const before = await health();
  console.log(`healthz до: ${JSON.stringify(before)}`);

  const tickSamples: number[] = [];
  let connected = 0;
  let joinErrors = 0;
  const teardowns: (() => void)[] = [];

  for (let i = 0; i < N; i++) {
    const client = new Client(url);
    try {
      const role = i % 6 === 0 ? 'cop' : 'citizen';
      const room: Room = await client.joinOrCreate('city', { email: `bot${i}@load.test`, password: 'botpw1234', ver: PROTOCOL_VERSION });
      connected++;
      for (const type of SILENCED) room.onMessage(type, () => {});
      room.send('createChar', { name: `bot${i}`, role });

      // метрика тика: дельты serverTime между патчами состояния
      let lastSt = 0;
      room.onStateChange(() => {
        const st = (room.state as any).serverTime as number;
        if (!st) return;
        if (lastSt) tickSamples.push(st - lastSt);
        lastSt = st;
      });

      const timers: ReturnType<typeof setInterval>[] = [];
      const every = (ms: number, chance: number, fn: () => void) => {
        timers.push(setInterval(() => { if (Math.random() < chance) fn(); }, ms));
      };

      const baseDir = Math.random() * Math.PI * 2;
      timers.push(setInterval(() => {
        room.send('input', {
          up: true, down: false, left: false, right: false,
          sprint: Math.random() < 0.3,
          rotY: baseDir + Math.sin(Date.now() / 5000 + i) * 2,
        });
      }, 100));
      every(2000, 0.2, () => room.send('attack'));
      every(5000, 0.1, () => room.send('interact'));
      every(7000, 0.1, () => room.send('buyWeapon', { kind: 'pistol' }));
      every(9000, 0.1, () => room.send('buyAmmo'));
      // экономический профиль (часть отклонится: need_playtime/need_car/no apt — тоже работа обработчиков)
      every(7000, 0.3, () => room.send('chat', { text: PHRASES[(Math.random() * PHRASES.length) | 0] }));
      every(13_000, 0.25, () => room.send('sms', { to: `bot${(i + 1) % N}`, text: 'смс от бота' }));
      every(17_000, 0.2, () => room.send('transfer', { to: `bot${(i + 1) % N}`, amount: 1 + ((Math.random() * 50) | 0) }));
      every(11_000, 0.15, () => room.send('deposit', { amount: 100 }));
      every(12_000, 0.15, () => room.send('withdraw', { amount: 100 }));
      every(19_000, 0.2, () => room.send(Math.random() < 0.7 ? 'jobTake' : 'jobDrop'));
      every(23_000, 0.15, () => room.send('leaderboardReq'));
      every(29_000, 0.2, () => room.send('chatHistoryReq'));

      teardowns.push(() => {
        for (const t of timers) clearInterval(t);
        void room.leave();
      });
    } catch (e) {
      joinErrors++;
      console.error(`bot${i} не подключился:`, e);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`Подключено ботов: ${connected}/${N} (ошибок джойна: ${joinErrors}), гоняем ${RUN_MS / 1000}с…`);

  await new Promise(r => setTimeout(r, RUN_MS));

  for (const td of teardowns) td();
  await new Promise(r => setTimeout(r, 1000)); // дать leave() доехать
  const after = await health();

  tickSamples.sort((a, b) => a - b);
  const avg = tickSamples.length ? tickSamples.reduce((s, v) => s + v, 0) / tickSamples.length : 0;
  const p50 = percentile(tickSamples, 0.5);
  const p99 = percentile(tickSamples, 0.99);
  const max = tickSamples[tickSamples.length - 1] ?? 0;

  console.log('--- Итог нагрузочного ---');
  console.log(`тик (дельты serverTime, n=${tickSamples.length}): avg ${avg.toFixed(1)}мс, p50 ${p50}мс, p99 ${p99}мс, max ${max}мс`);
  console.log(`RSS сервера: ${before?.rssMb ?? '?'} → ${after?.rssMb ?? '?'} МБ; игроков в комнате после выхода: ${after?.players ?? '?'}`);
  console.log(`healthz после: ${JSON.stringify(after)}`);

  const failures: string[] = [];
  if (connected < N) failures.push(`подключилось ${connected}/${N}`);
  if (joinErrors > 0) failures.push(`ошибки джойна: ${joinErrors}`);
  if (avg > AVG_TICK_MAX_MS) failures.push(`avg тика ${avg.toFixed(1)}мс > ${AVG_TICK_MAX_MS}мс`);
  if (p99 > P99_TICK_MAX_MS) failures.push(`p99 тика ${p99}мс > ${P99_TICK_MAX_MS}мс`);

  if (failures.length) {
    console.error(`ДЕГРАДАЦИЯ: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('Пороги в норме — OK');
}

void main();
