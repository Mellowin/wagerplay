# WagerPlay Backend

Многопользовательская игра "Камень-Ножницы-Бумага" с матчмейкингом, real-time геймплеем и системой ставок.

[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)](https://redis.io/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socket.io&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)

## Демо-видео

[![WagerPlay Demo](https://img.youtube.com/vi/s5ViycpnBDM/0.jpg)](https://www.youtube.com/watch?v=s5ViycpnBDM)

## Что реализовано

### Основной геймплей
- **Матчмейкинг** - 20-секундная очередь с автозаполнением ботами
- **Турнирная система** - 2-5 игроков, система выбывания
- **Real-time геймплей** - WebSocket события для ходов, таймеров, результатов
- **Система раундов** - 12-секундные ходы, автоход при AFK
- **F5 Recovery** - полное восстановление состояния после обновления страницы

### Финансовая система
- **Кошельки** - баланс VP (Virtual Points)
- **Заморозка ставок** - безопасное хранение ставок во время матча
- **Система комиссии** - 5% комиссия house на каждом матче
- **Выплаты** - автоматическое распределение выигрышей
- **Сверка баланса** - проверка целостности через историю
- **Защита зависших ставок** - автовозврат через 5 минут

### Пользовательские функции
- **Авторизация** - JWT токены + гостевой вход
- **Профили** - никнеймы, аватарки, загрузка изображений
- **Статистика** - игры, победы/поражения, VP заработано/потеряно
- **Чат** - глобальный и внутриигровой чат
- **Темы** - тёмная/светлая тема интерфейса

### Безопасность и аудит
- **IDOR защита** - проверка доступа к ресурсам
- **Защита от массового присвоения** - валидация входных данных
- **Аудит** - логирование финансовых операций
- **Обработка race conditions** - PostgreSQL Advisory Locks + Redis locks
- **JWT аутентификация** - безопасная авторизация

### DevOps и мониторинг
- **Swagger API Docs** - интерактивная документация `/api/docs`
- **Docker** - контейнеризированное развёртывание
- **CI/CD Pipeline** - GitHub Actions для тестирования
- **Health Checks** - endpoint проверки состояния сервера

## Стек технологий

| Слой | Технология |
|------|------------|
| **Backend** | NestJS + TypeScript |
| **База данных** | PostgreSQL + TypeORM |
| **Кэш/Очереди** | Redis (ioredis) |
| **Real-time** | Socket.io |
| **Тестирование** | Jest + Supertest |
| **Документация** | Swagger/OpenAPI |
| **DevOps** | Docker + Docker Compose + GitHub Actions |

## Быстрый старт

### 1. Установка

```bash
git clone https://github.com/Mellowin/wagerplay.git
cd wagerplay
npm install
```

### 2. Переменные окружения

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wagerplay
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
PORT=3000
NODE_ENV=development
```

### 3. Запуск

```bash
# Инфраструктура (PostgreSQL + Redis)
docker-compose up -d

# Сервер разработки
npm run start:dev
```

Открой `http://localhost:3000/ws-test.html` для тестирования.

API документация: `http://localhost:3000/api/docs`

## API

### REST Endpoints

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | `/auth/guest` | Гостевой вход |
| POST | `/auth/login` | Вход (JWT) |
| POST | `/auth/register` | Регистрация |
| GET | `/auth/me` | Профиль пользователя |
| GET | `/wallet` | Баланс |
| POST | `/wallet/reset-frozen` | Вернуть замороженные VP |
| GET | `/wallet/reconcile` | Сверка баланса |
| POST | `/matchmaking/quickplay` | Вступить в очередь |
| GET | `/matchmaking/active` | Активное состояние |
| GET | `/matchmaking/history` | История матчей |
| GET | `/health` | Проверка сервера |

### WebSocket Events

**Client → Server:**
- `quickplay` - начать поиск
- `move` - сделать ход
- `chat:global`, `chat:game` - отправить сообщение

**Server → Client:**
- `queue:sync` - обновление очереди
- `match:found` - матч найден (отсчёт 5 сек)
- `match:start` - начало игры
- `match:update` - результат раунда
- `match:timer` - синхронизация таймера

## Тестирование

```bash
# E2E тесты
npm run test:e2e

# Покрытие: 80+ тестов
# Тесты: матчмейкинг, игровой процесс, финансы, безопасность,
# комбинации игроков (2-5), race conditions, IDOR защита
```

## Как работает игра

### Flow матча

1. Игрок нажимает "Играть" → попадает в очередь Redis
2. Система ждёт 20 секунд для сбора игроков
3. Если игроков меньше требуемого → добавляются боты
4. Отсчёт 5-4-3-2-1 → матч начинается
5. Раунды по 12 секунд (камень/ножницы/бумага)
6. Автоход при отсутствии ответа
7. Выбывание до последнего победителя

### Финансовый flow

```
Ставка: 100 VP
  ↓
Заморозка: 100 VP (заблокировано)
  ↓
[Если матч не начнётся за 5 мин → автовозврат]
  ↓
Банк: 200 VP (2 игрока)
  ↓
Комиссия: 10 VP (5% house)
  ↓
Выплата: 190 VP → победителю
```

### Система ботов

Боты автоматически заполняют неполные матчи:
- **Триггер**: Если в очереди меньше требуемого количества после 20с
- **Поведение**: Реалистичные ники, случайные ходы
- **Комбинации**: 1+ бота, 2+ бота, 3+ бота, 4+ бота, 5 реальных игроков

### F5 Recovery

Полная поддержка обновления страницы в любом состоянии:

| Состояние | Поведение при восстановлении |
|-----------|------------------------------|
| **Поиск** | Таймер и позиция восстанавливаются |
| **В матче** | Переподключение к активному матчу |
| **Отсчёт** | Синхронизация оставшихся секунд |

## Защита зависших ставок

```typescript
// 1. При заморозке ставки - сохраняем в Redis с timestamp
await redis.set(`frozen:${userId}`, JSON.stringify({
  userId, stakeVp, frozenAt: Date.now()
}), 'EX', 600);

// 2. Фоновая задача каждые 5 минут
if (frozenTime > 5 * 60 * 1000 && !hasActiveMatch) {
  await unfreezeStake(userId, stakeVp); // Автовозврат
}

// 3. Пользователь может вернуть вручную
POST /wallet/reset-frozen
```

## Структура проекта

```
src/
├── matchmaking/    # Логика игры, очередь, WebSocket
├── wallets/        # Балансы, ставки, выплаты
├── auth/           # JWT авторизация
├── users/          # Пользователи
├── audit/          # Аудит логи
└── house/          # House банк

test/e2e/           # E2E тесты
├── race-conditions/
├── financial-security/
├── idor/
└── state-machine/
```

## Архитектурные решения

### Почему Redis для матчмейкинга?
- O(1) операции с очередями
- Встроенный TTL для истечения тикетов
- Атомарные операции через Lua скрипты
- Идеально для временного состояния матчей

### Защита от race conditions
```typescript
// PostgreSQL Advisory Lock (основной)
const lock = await dataSource.query(
  `SELECT pg_try_advisory_lock($1)`, [lockId]
);

// Redis Lock (резервный)
const lock = await redis.set(lockKey, '1', 'EX', 5, 'NX');

// Double-check pattern
const existing = await hasExistingTicket(userId);
if (existing) return { status: 'ALREADY_IN_QUEUE' };
```

## Roadmap

- [x] **Swagger документация** - Интерактивная API документация
- [x] **Защита зависших ставок** - Автовозврат frozen средств
- [x] **CI/CD Pipeline** - GitHub Actions для тестирования
- [ ] **Нагрузочное тестирование** - Тестирование с 1000+ игроков
- [ ] **Горизонтальное масштабирование** - Несколько серверов через Redis pub/sub
- [ ] **Таблица лидеров** - Топ игроков по выигрышам

## Лицензия

Проект для портфолио и демонстрации навыков.
