# Клиент MMO City: сборка Vite → nginx со статикой и админкой.
# Конфиг (TLS, прокси) НЕ в образе — монтируется из deploy/docker/nginx/templates на хосте.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY shared/package.json shared/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w client

FROM nginx:alpine
COPY --from=build /app/client/dist /usr/share/nginx/html
COPY --from=build /app/server/public /usr/share/nginx/admin
