# ==========================================
# 🏗️ Stage 1: Dependencies
# ==========================================
FROM node:20-alpine AS deps

WORKDIR /app

# Копируем только package files для кэширования слоёв
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production && npm cache clean --force

# ==========================================
# 🏗️ Stage 2: Builder
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем ВСЕ зависимости (включая dev)
RUN npm ci

# Копируем исходники
COPY . .

# Собираем проект
RUN npm run build

# ==========================================
# 🚀 Stage 3: Production
# ==========================================
FROM node:20-alpine AS production

# Устанавливаем security обновления
RUN apk add --no-cache dumb-init && \
    apk upgrade --no-cache

# Создаём непривилегированного пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Копируем production зависимости из stage 1
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Копируем собранный проект из stage 2
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Копируем необходимые файлы
COPY --chown=nodejs:nodejs package.json ./

# Переключаемся на непривилегированного пользователя
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Открываем порт
EXPOSE 3000

# Используем dumb-init для корректной обработки сигналов
ENTRYPOINT ["dumb-init", "--"]

# Запускаем приложение
CMD ["node", "dist/main"]
