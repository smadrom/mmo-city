# Деплой MMO City на VPS (Docker)

Стек: два контейнера — `mmo-server` (Colyseus+tsx) и `mmo-nginx` (TLS, статика клиента, WS-прокси).
Сервер уже жив: **77.42.4.230** (июльский билд на systemd, `/srv/mmo`, `game.db` с игроками).
Ниже — переезд на Docker + TLS по своему домену.

## 0. Что нужно заранее

- **Домен**: A-запись на `77.42.4.230`. Без домена TLS не выдать — игра работает только по wss.
- Локальный `ssh root@77.42.4.230` с этой машины (ключ/агент) — `deploy.sh` ходит по ssh.
- **Docker** на VPS (один раз):
  ```bash
  ssh root@77.42.4.230 'apt update && apt install -y docker.io docker-compose-v2 && systemctl enable --now docker'
  ```

## 1. Остановить старый билд и забэкапить БД (один раз)

```bash
ssh root@77.42.4.230 'systemctl disable --now mmo-server nginx || true'
ssh root@77.42.4.230 'mkdir -p /srv/mmo/data /srv/mmo/certbot-www && cp /srv/mmo/server/game.db /srv/mmo/data/game.db && cp /srv/mmo/server/game.db /root/game.db.$(date +%F-%H%M).bak'
```

Июльские аккаунты сохранятся: миграции идемпотентны, ники без секрета заклеймятся при первом входе владельца.

## 2. Конфигурация .env (один раз)

```bash
ssh root@77.42.4.230 'cd /srv/mmo/deploy/docker && cp .env.example .env && sed -i "s/DOMAIN=example.com/DOMAIN=<домен>/" .env && sed -i "s/ADMIN_TOKEN=change-me/ADMIN_TOKEN=$(openssl rand -hex 32)/" .env && chmod 600 .env && cat .env'
```

(`ADMIN_TOKEN` из вывода — сохранить себе, это вход в `/admin/`.) Если `.env` уже есть от прошлого выката — просто проверить `DOMAIN`.

## 3. Первый выкат кода (с этой машины, из корня репо)

```bash
./deploy/deploy.sh root@77.42.4.230
```

Скрипт: `git archive HEAD` → `/srv/mmo` → `docker compose build` → `up -d` → проверка `/healthz` на localhost.
Клиент и сервер версионируются вместе (`PROTOCOL_VERSION=4`): старые вкладки получат «Обновите страницу» — штатно.

## 4. TLS: первый выпуск сертификата (один раз)

Nginx не стартует с `mmo.conf.template`, пока сертификата нет (ssl_* пути). Поэтому первый раз — bootstrap-конфиг:

```bash
# на хосте: оставить только bootstrap, поднять nginx на 80-м
ssh root@77.42.4.230 'cd /srv/mmo/deploy/docker/nginx/templates && mv mmo.conf.template mmo.conf.disabled && cd ../.. && cd deploy/docker && docker compose up -d nginx'

# выпуск через webroot (порт 80 занят nginx-контейнером, webroot смонтирован)
ssh root@77.42.4.230 'certbot certonly --webroot -w /srv/mmo/certbot-www -d <домен> --agree-tos -m <email>'

# вернуть прод-конфиг и перезапустить стек
ssh root@77.42.4.230 'cd /srv/mmo/deploy/docker/nginx/templates && mv mmo.conf.disabled mmo.conf.template && rm -f bootstrap.conf.template && cd ../.. && cd deploy/docker && docker compose up -d'
```

Проверка: `https://<домен>/healthz` → `{"status":"ok",...}`; `https://<домен>/admin/` → страница логина админки.

Продление: certbot renew по таймеру хоста через тот же webroot; чтобы nginx подхватывал свежий сертификат, добавить hook (один раз):

```bash
ssh root@77.42.4.230 'mkdir -p /etc/letsencrypt/renewal-hooks/deploy && printf "#!/bin/sh\ndocker exec mmo-nginx nginx -s reload\n" > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh && chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh'
```

## 5. Закрыть игровой порт наружу

```bash
ssh root@77.42.4.230 'ufw delete allow 2567 || true; ufw allow 80; ufw allow 443; ufw enable; ufw status'
```

Остаются: 22 (ssh), 80 (редирект+webroot), 443 (игра). 2567 слушает только localhost хоста.

## 6. Каждый следующий деплой

```bash
./deploy/deploy.sh root@77.42.4.230
```

## Операционка

- Логи: `ssh root@77.42.4.230 'cd /srv/mmo/deploy/docker && docker compose logs -f'` (или `-f server`/`nginx`).
- Статус: `docker compose ps` там же; healthz хоста: `curl http://127.0.0.1:2567/healthz`.
- Бэкап БД: `ssh root@77.42.4.230 'cd /srv/mmo/deploy/docker && docker compose stop server && cp /srv/mmo/data/game.db /root/game.db.$(date +%F-%H%M).bak && docker compose start server'`.
- Админка: `https://<домен>/admin/`, токен в `/srv/mmo/deploy/docker/.env`.
- Откат: вернуть `game.db` из бэкапа в `/srv/mmo/data/`, локально `git checkout <старый-sha>`, `./deploy/deploy.sh ...`.

## Структура deploy/docker

- `Dockerfile` — образ игрового сервера (node:20-slim, prod-зависимости, tsx, USER node).
- `nginx.Dockerfile` — сборка клиента (Vite) → nginx:alpine со статикой и админкой.
- `docker-compose.yml` — оба сервиса; `game.db` на хосте в `/srv/mmo/data`.
- `nginx/templates/` — конфиги nginx (envsubst `${DOMAIN}`); прод — `mmo.conf.template`, `bootstrap.conf.template` — только для первого выпуска certbot.
- `.env.example` → `.env` — DOMAIN и ADMIN_TOKEN (не коммитится).
