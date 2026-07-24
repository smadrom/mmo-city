import { Server } from 'colyseus';
import { createServer } from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CityRoom } from './rooms/CityRoom.js';
import { adminApi } from './admin/routes.js';
import { getRoom } from './admin/registry.js';

const dirname = path.dirname(fileURLToPath(import.meta.url)); // ESM: __dirname нет

export function createExpressApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/', (_req, res) => res.send('mmo2game server'));
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', players: getRoom()?.adminState().playersOnline ?? 0, uptimeSec: Math.floor(process.uptime()) });
  });
  app.use('/admin/api', adminApi());
  app.use('/admin', express.static(path.join(dirname, '../public'))); // dev-раздача админки; в prod — nginx
  return app;
}

export function createGameServer(): Server {
  const gameServer = new Server({ server: createServer(createExpressApp()) });
  gameServer.define('city', CityRoom);
  return gameServer;
}
