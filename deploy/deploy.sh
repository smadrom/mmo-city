#!/usr/bin/env bash
# Деплой на VPS через Docker: git archive → compose build → up -d → healthz.
# Запуск из корня репо:  ./deploy/deploy.sh deploy@77.42.4.230
# На хосте нужен Docker с compose v2; конфигурация — /srv/mmo/deploy/docker/.env
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh deploy@host}"

echo "== заливаем код на $HOST:/srv/mmo"
git archive HEAD | ssh "$HOST" 'mkdir -p /srv/mmo && tar -x -C /srv/mmo'

echo "== docker compose build + up (первая сборка долгая, ~3-5 мин)"
ssh "$HOST" 'cd /srv/mmo/deploy/docker && docker compose build -q && docker compose up -d'

echo "== проверка (healthz игрового сервера на localhost хоста)"
ssh "$HOST" 'sleep 3 && curl -sf http://127.0.0.1:2567/healthz && echo " — deploy OK"'
