# Деплой MMO City на VPS (Docker + Traefik)

Стек: три контейнера — `mmo-traefik` (TLS сам через Let's Encrypt, роутинг), `mmo-web` (статика клиента+админки), `mmo-server` (Colyseus+tsx).
Домен: **mmo.expw.net** → 77.42.4.230. Сервер жив: июльский билд на systemd, `/srv/mmo`, `game.db` с игроками.

## 0. Подготовка

- DNS уже настроен: `mmo.expw.net → 77.42.4.230` ✓
- Локальный `ssh deploy@77.42.4.230` с этой машины — `deploy.sh` ходит по ssh.
- **Docker** на VPS (один раз, официальный скрипт — ставит docker-ce + compose-плагин v2):
  ```bash
  ssh deploy@77.42.4.230 'curl -fsSL https://get.docker.com | sh'
  ssh deploy@77.42.4.230 'docker compose version'  # проверка: Docker Compose v2.x
  ```

## 1. Остановить старый билд и забэкапить БД (один раз)

```bash
ssh deploy@77.42.4.230 'systemctl disable --now mmo-server nginx || true'
ssh deploy@77.42.4.230 'mkdir -p /srv/mmo/data /srv/mmo/letsencrypt && cp /srv/mmo/server/game.db /srv/mmo/data/game.db && cp /srv/mmo/server/game.db ~/game.db.bak'
```

Июльские аккаунты сохранятся: миграции идемпотентны, ники без секрета заклеймятся при первом входе владельца.

## 2. Конфигурация .env (один раз)

```bash
ssh deploy@77.42.4.230 'cd /srv/mmo/deploy/docker && cp .env.example .env && sed -i "s/DOMAIN=example.com/DOMAIN=mmo.expw.net/" .env && sed -i "s/you@example.com/<твой-email>/" .env && sed -i "s/ADMIN_TOKEN=change-me/ADMIN_TOKEN=$(openssl rand -hex 32)/" .env && chmod 600 .env && grep ADMIN_TOKEN .env'
```

`ADMIN_TOKEN` из вывода — сохранить себе (вход в `/admin/`). Если `.env` уже есть — только проверить `DOMAIN` и `ACME_EMAIL`.

## 3. Выкат (с этой машины, из корня репо)

```bash
./deploy/deploy.sh deploy@77.42.4.230
```

Скрипт: `git archive HEAD` → `/srv/mmo` → `docker compose build` → `up -d` → healthz на localhost.
Первая сборка ~3–5 мин. **TLS выпустится сам** при первом обращении к `https://mmo.expw.net` (Traefik ACME, может занять до минуты после подъёма).

Клиент и сервер версионируются вместе (`PROTOCOL_VERSION=4`): старые вкладки получат «Обновите страницу» — штатно.

## 4. Проверка

```bash
curl -s https://mmo.expw.net/healthz   # {"status":"ok","players":0,...}
```

Игра: `https://mmo.expw.net`. Админка: `https://mmo.expw.net/admin/` (токен из `.env`).

## 5. Закрыть игровой порт наружу

```bash
ssh deploy@77.42.4.230 'ufw delete allow 2567 || true; ufw allow 80; ufw allow 443; ufw enable; ufw status'
```

Остаются: 22 (ssh), 80 (редирект на https + ACME), 443 (игра). 2567 слушает только localhost хоста.

## 6. Каждый следующий деплой

```bash
./deploy/deploy.sh deploy@77.42.4.230
```

## Как устроен роутинг (traefik labels в docker-compose.yml)

- `Host(mmo.expw.net)` + `Upgrade: websocket` → `mmo-server:2567` (игровое WS-соединение)
- `Host(...)` + `/matchmake|/healthz|/admin/api` → `mmo-server:2567` (API)
- всё остальное на хосте → `mmo-web:80` (статика клиента и админки)
- 80-й порт → редирект на 443; сертификаты — `/srv/mmo/letsencrypt/acme.json`, продление автоматическое

## Операционка

- Логи: `ssh deploy@77.42.4.230 'cd /srv/mmo/deploy/docker && docker compose logs -f'` (или `logs -f server` / `traefik`).
- Статус: `docker compose ps` там же; healthz хоста: `curl http://127.0.0.1:2567/healthz`.
- Бэкап БД (WAL-режим: копируем все три файла, game.db сам по себе почти пуст): `ssh deploy@77.42.4.230 'cd /srv/mmo/deploy/docker && docker compose stop server && tar -czf ~/game.db-full.$(date +%F-%H%M).tar.gz -C /srv/mmo/data game.db game.db-wal game.db-shm && docker compose start server'`.
- Откат: вернуть `game.db` из бэкапа в `/srv/mmo/data/`, локально `git checkout <старый-sha>`, `./deploy/deploy.sh ...`.

## Структура deploy/docker

- `Dockerfile` — образ игрового сервера (node:20-slim, prod-зависимости, tsx, USER node).
- `nginx.Dockerfile` + `nginx-static.conf` — сборка клиента (Vite) → nginx:alpine со статикой и админкой.
- `docker-compose.yml` — traefik + web + server; `game.db` на хосте в `/srv/mmo/data`, сертификаты в `/srv/mmo/letsencrypt`.
- `.env.example` → `.env` — DOMAIN, ACME_EMAIL, ADMIN_TOKEN (не коммитится).
