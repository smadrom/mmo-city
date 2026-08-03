# Деплой MMO City на VPS

Сервер уже жив: **77.42.4.230** (Node 22, systemd, nginx, `/srv/mmo`, `game.db` с игроками с июля).
Ниже — обновление до текущего кода + выход на TLS по своему домену. Для чистого сервера — то же самое, плюс первичная установка пакетов (раздел внизу).

## 0. Что нужно заранее

- **Домен**: любой регистратор, A-запись на `77.42.4.230`. Без домена TLS не выдать — игра работает только по wss.
- Локальный `ssh root@77.42.4.230` должен работать с этой машины (ключ/агент) — `deploy.sh` ходит по ssh.

## 1. Бэкап БД (обязательно перед выкатом)

```bash
ssh root@77.42.4.230 'systemctl stop mmo-server && cp /srv/mmo/server/game.db /root/game.db.$(date +%F-%H%M).bak && systemctl start mmo-server'
```

Июльские аккаунты никуда не денутся: новые миграции идемпотентны (колонки `secret`/`rent_due`/`playtime_sec` добавятся сами), а ники без секрета заклеймятся при первом входе владельцем.

## 2. Выкат кода (с этой машины, из корня репо)

```bash
./deploy/deploy.sh root@77.42.4.230
```

Скрипт: `git archive HEAD` → `/srv/mmo` → `npm ci` → `npm run build -w client` → `systemctl restart mmo-server` → проверка `/healthz`.

Клиент и сервер версионируются вместе (`PROTOCOL_VERSION=4`): старые открытые вкладки получат «Обновите страницу» — это штатно.

## 3. Systemd-юнит (заменить старый, один раз)

```bash
ssh root@77.42.4.230 'cp /srv/mmo/deploy/systemd/mmo-server.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now mmo-server'
```

Env-файл `/etc/mmo/env` — если ещё не существует:

```bash
ssh root@77.42.4.230 'mkdir -p /etc/mmo && cat > /etc/mmo/env <<EOF
PORT=2567
GAME_DB=/srv/mmo/server/game.db
ADMIN_TOKEN=$(openssl rand -hex 32)
EOF
chmod 600 /etc/mmo/env && cat /etc/mmo/env'
```

`ADMIN_TOKEN` сохранить себе — это вход в админку `/admin/`.

## 4. Nginx + домен (один раз)

```bash
ssh root@77.42.4.230 'cp /srv/mmo/deploy/nginx/mmo.conf /etc/nginx/sites-available/mmo'
# отредактировать на сервере: example.com → свой домен (2 места, listen 80 и 443)
ssh root@77.42.4.230 'nano /etc/nginx/sites-available/mmo'
ssh root@77.42.4.230 'ln -sf /etc/nginx/sites-available/mmo /etc/nginx/sites-enabled/mmo && nginx -t && systemctl reload nginx'
```

Проверка до TLS: `http://<домен>/healthz` → `{"status":"ok",...}` (80-й порт временно редиректит на https — если 301 мешает проверке, смотри после certbot).

## 5. TLS (после того как A-запись пропагировалась)

```bash
ssh root@77.42.4.230 'certbot --nginx -d <домен>'
```

Certbot сам допишет `ssl_*` в `mmo.conf` и настроит редирект 80→443. Автопродление уже встроено в certbot (таймер systemd).

Проверка: `https://<домен>/healthz` → `{"status":"ok","players":N,...}`; `https://<домен>/admin/` → страница логина админки (токен из `/etc/mmo/env`).

## 6. Закрыть игровой порт наружу

Сейчас ufw открывает 2567 напрямую (в обход nginx/TLS). После перехода на wss через 443:

```bash
ssh root@77.42.4.230 'ufw delete allow 2567 && ufw status'
```

Остаются: 22 (ssh), 80 (редирект), 443 (игра).

## 7. Каждый следующий деплой

```bash
./deploy/deploy.sh root@77.42.4.230
```

## Операционка

- Логи: `ssh root@77.42.4.230 'journalctl -u mmo-server -f'`
- Бэкап БД: как в п.1 (остановить, скопировать, запустить). SQLite WAL, живую копию лучше не снимать.
- Админка: `https://<домен>/admin/` — онлайн, кик/бан/мут. Токен в `/etc/mmo/env`.
- Нагрузочный тест против прода: `SERVER_URL=wss://<домен> npm run loadtest -w server` (боты создадут тестовых botN в БД — на проде лучше не гонять, только на стейдже).
- Откат: `systemctl stop mmo-server`, вернуть `game.db` из бэкапа, `git checkout <старый-sha>` локально, `./deploy/deploy.sh ...`, `systemctl start mmo-server`.

## Чистый сервер с нуля (если переезжаем)

```bash
# на VPS под root, Ubuntu 24.04
apt update && apt install -y nginx certbot python3-certbot-nginx ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
useradd -r -m -d /srv/mmo -s /usr/sbin/nologin mmo || true
mkdir -p /etc/mmo
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

Дальше — с п.1 (бэкап не нужен) и сразу п.2–6.
