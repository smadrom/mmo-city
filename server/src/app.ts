import { Server } from 'colyseus';
import { createServer } from 'node:http';
import express from 'express';
import { CityRoom } from './rooms/CityRoom.js';

export function createGameServer(): Server {
  const app = express();
  app.get('/', (_req, res) => res.send('mmo2game server'));
  const gameServer = new Server({ server: createServer(app) });
  gameServer.define('city', CityRoom);
  return gameServer;
}
