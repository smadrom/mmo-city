import { describe, it, expect, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { createExpressApp } from '../src/app.js';

describe('админка (статика)', () => {
  let srv: HttpServer | null = null;

  afterAll(async () => {
    if (srv) await new Promise(r => srv!.close(r));
  });

  it('GET /admin/ отдаёт страницу', async () => {
    srv = createExpressApp().listen(0);
    await new Promise<void>(r => srv!.once('listening', r));
    const port = (srv.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/admin/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MMO Admin');
  });
});
