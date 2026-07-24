import { Router, type Request, type Response, type NextFunction } from 'express';
import { getRoom } from './registry.js';

// Bearer ADMIN_TOKEN из env; без env — всё 503 (fail-closed), с неверным — 401
function auth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) { res.status(503).json({ error: 'admin_disabled' }); return; }
  if (req.headers.authorization !== `Bearer ${token}`) { res.status(401).json({ error: 'unauthorized' }); return; }
  next();
}

const nick = (v: unknown): string => String(v ?? '').slice(0, 16);

export function adminApi(): Router {
  const r = Router();
  r.use(auth);

  r.get('/state', (_req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    res.json(room.adminState());
  });

  r.post('/kick', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    if (!room.kickByName(nick(req.body?.name))) { res.status(404).json({ error: 'not_online' }); return; }
    res.json({ ok: true });
  });

  r.post('/ban', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    const name = nick(req.body?.name);
    if (!name) { res.status(400).json({ error: 'need_name' }); return; }
    const hours = Number(req.body?.hours ?? 0);
    const until = hours > 0 ? Date.now() + hours * 3600_000 : null; // 0/отсутствует = перманент
    const reason = String(req.body?.reason ?? '').slice(0, 120);
    const online = room.adminState().players.find(pl => pl.name === name);
    room.gameDb.ban(name, online?.ip ?? '', reason, until, req.body?.byIp === true);
    if (online) room.kickByName(name); // бан вышвыривает сразу
    res.json({ ok: true });
  });

  r.post('/unban', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    room.gameDb.unban(nick(req.body?.name));
    res.json({ ok: true });
  });

  r.post('/mute', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    const name = nick(req.body?.name);
    const minutes = Number(req.body?.minutes ?? 0);
    if (!name || !(minutes > 0)) { res.status(400).json({ error: 'need_name_minutes' }); return; }
    room.gameDb.mute(name, Date.now() + minutes * 60_000, String(req.body?.reason ?? '').slice(0, 120));
    res.json({ ok: true });
  });

  r.post('/unmute', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    room.gameDb.unmute(nick(req.body?.name));
    res.json({ ok: true });
  });

  r.get('/bans', (_req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    res.json({ items: room.gameDb.listBans() });
  });

  r.get('/mutes', (_req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    res.json({ items: room.gameDb.listMutes(Date.now()) });
  });

  return r;
}
