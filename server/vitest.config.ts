import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 20000,
    // forks-пул ломается: @colyseus/core динамически импортирует @pm2/io,
    // который шлёт axm-* объекты в IPC-канал воркера vitest
    pool: 'threads',
  },
});
