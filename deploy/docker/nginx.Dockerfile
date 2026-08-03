# Клиент MMO City: сборка Vite → nginx со статикой и админкой.
# TLS и роутинг — на traefik (см. docker-compose.yml), здесь только статика по 80-му.
FROM node:20-bookworm-slim AS build
# toolchain для node-gyp: у better-sqlite3 нет prebuilt под node 20.20 (собирается из исходников)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY shared/package.json shared/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w client

FROM nginx:alpine
COPY deploy/docker/nginx-static.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
COPY --from=build /app/server/public /usr/share/nginx/admin
