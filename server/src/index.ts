import { matchMaker } from 'colyseus';
import { createGameServer } from './app.js';

const port = Number(process.env.PORT ?? 2567);

createGameServer().listen(port).then(async () => {
  // единственная комната на весь процесс: клиент делает join (не create) → расщепление невозможно
  await matchMaker.createRoom('city', {});
  console.log(`[server] ws://localhost:${port}`);
});
