import { createGameServer } from './app.js';

const port = Number(process.env.PORT ?? 2567);

createGameServer().listen(port).then(() => {
  console.log(`[server] ws://localhost:${port}`);
});
