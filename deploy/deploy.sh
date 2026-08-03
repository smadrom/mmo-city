#!/usr/bin/env bash
# Деплой на VPS: git archive → deps → build клиента → restart. Запуск из корня репо:
#   ./deploy/deploy.sh root@77.42.4.230
# Хост — root (или sudo-пользователь): у сервисного mmo shell nologin, ssh туда не зайти.
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh root@host}"

echo "== заливаем код на $HOST:/srv/mmo"
git archive HEAD | ssh "$HOST" 'mkdir -p /srv/mmo && tar -x -C /srv/mmo'

echo "== deps + build клиента + restart"
ssh "$HOST" 'cd /srv/mmo && npm ci --no-audit --no-fund && npm run build -w client && chown -R mmo:mmo /srv/mmo && systemctl restart mmo-server'

echo "== проверка"
ssh "$HOST" 'sleep 2 && curl -sf http://127.0.0.1:2567/healthz && echo " — deploy OK"'
