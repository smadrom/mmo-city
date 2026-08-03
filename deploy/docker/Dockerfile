# Игровой сервер MMO City (Colyseus + tsx). Образ без dev-зависимостей.
# Контекст сборки — КОРЕНЬ репо (нужны package-lock и workspace-манифесты).
FROM node:20-bookworm-slim AS deps
# toolchain для node-gyp: у better-sqlite3 нет prebuilt под node 20.20 (собирается из исходников)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --no-audit --no-fund --omit=dev --workspace=server --workspace=shared

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=2567 \
    GAME_DB=/data/game.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 2567
# cwd=server — tsx подхватывает server/tsconfig.json (experimentalDecorators для @colyseus/schema)
WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
