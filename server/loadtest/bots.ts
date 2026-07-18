import { Client } from 'colyseus.js';

const N = Number(process.env.BOTS ?? 100);
const url = process.env.SERVER_URL ?? 'ws://localhost:2567';

async function main(): Promise<void> {
  let connected = 0;
  for (let i = 0; i < N; i++) {
    const client = new Client(url);
    try {
      const role = i % 6 === 0 ? 'cop' : 'citizen';
      const room = await client.joinOrCreate('city', { name: `bot${i}`, role });
      connected++;
      const baseDir = Math.random() * Math.PI * 2;
      setInterval(() => {
        room.send('input', {
          up: true,
          down: false,
          left: false,
          right: false,
          sprint: Math.random() < 0.3,
          rotY: baseDir + Math.sin(Date.now() / 5000 + i) * 2,
        });
      }, 100);
      // изредка машем кулаками и жмём E
      setInterval(() => { if (Math.random() < 0.2) room.send('attack'); }, 2000);
      setInterval(() => { if (Math.random() < 0.1) room.send('interact'); }, 5000);
    } catch (e) {
      console.error(`bot${i} не подключился:`, e);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`Подключено ботов: ${connected}/${N}`);
}

void main();
