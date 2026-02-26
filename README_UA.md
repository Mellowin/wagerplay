# WagerPlay Backend

Багатокористувацька гра "Камінь-Ножиці-Папір" з матчмейкінгом, real-time геймплеєм та системою ставок.

[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)](https://redis.io/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socket.io&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)

## Демо-відео

[![WagerPlay Demo](https://img.youtube.com/vi/s5ViycpnBDM/0.jpg)](https://www.youtube.com/watch?v=s5ViycpnBDM)

## Що реалізовано

### Основний геймплей
- **Матчмейкінг** - 20-секундна черга з автозаповненням ботами
- **Турнірна система** - 2-5 гравців, система вибування
- **Real-time геймплей** - WebSocket події для ходів, таймерів, результатів
- **Система раундів** - 12-секундні ходи, автохід при AFK
- **F5 Recovery** - повне відновлення стану після оновлення сторінки

### Фінансова система
- **Гаманці** - баланс VP (Virtual Points)
- **Заморожування ставок** - безпечне зберігання ставок під час матчу
- **Система комісії** - 5% комісія house на кожному матчі
- **Виплати** - автоматичний розподіл виграшів
- **Звірка балансу** - перевірка цілісності через історію
- **Захист завислих ставок** - автоповернення через 5 хвилин

### Користувацькі функції
- **Авторизація** - JWT токени + гостьовий вхід
- **Профілі** - нікнейми, аватарки, завантаження зображень
- **Статистика** - ігри, перемоги/поразки, VP зароблено/втрачено
- **Чат** - глобальний та внутрішньоігровий чат
- **Теми** - темна/світла тема інтерфейсу

### Безпека та аудит
- **IDOR захист** - перевірка доступу до ресурсів
- **Захист від масового привласнення** - валідація вхідних даних
- **Аудит** - логування фінансових операцій
- **Обробка race conditions** - PostgreSQL Advisory Locks + Redis locks
- **JWT автентифікація** - безпечна авторизація

### DevOps та моніторинг
- **Swagger API Docs** - інтерактивна документація `/api/docs`
- **Docker** - контейнеризоване розгортання
- **CI/CD Pipeline** - GitHub Actions для тестування
- **Health Checks** - endpoint перевірки стану сервера

## Стек технологій

| Шар | Технологія |
|-----|------------|
| **Backend** | NestJS + TypeScript |
| **База даних** | PostgreSQL + TypeORM |
| **Кеш/Черги** | Redis (ioredis) |
| **Real-time** | Socket.io |
| **Тестування** | Jest + Supertest |
| **Документація** | Swagger/OpenAPI |
| **DevOps** | Docker + Docker Compose + GitHub Actions |

## Швидкий старт

### 1. Встановлення

```bash
git clone https://github.com/Mellowin/wagerplay.git
cd wagerplay
npm install
```

### 2. Змінні середовища

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wagerplay
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
PORT=3000
NODE_ENV=development
```

### 3. Запуск

```bash
# Інфраструктура (PostgreSQL + Redis)
docker-compose up -d

# Сервер розробки
npm run start:dev
```

Відкрий `http://localhost:3000/ws-test.html` для тестування.

API документація: `http://localhost:3000/api/docs`

## API

### REST Endpoints

| Метод | Endpoint | Опис |
|-------|----------|------|
| POST | `/auth/guest` | Гостьовий вхід |
| POST | `/auth/login` | Вхід (JWT) |
| POST | `/auth/register` | Реєстрація |
| GET | `/auth/me` | Профіль користувача |
| GET | `/wallet` | Баланс |
| POST | `/wallet/reset-frozen` | Повернути заморожені VP |
| GET | `/wallet/reconcile` | Звірка балансу |
| POST | `/matchmaking/quickplay` | Вступити в чергу |
| GET | `/matchmaking/active` | Активний стан |
| GET | `/matchmaking/history` | Історія матчів |
| GET | `/health` | Перевірка сервера |

### WebSocket Events

**Client → Server:**
- `quickplay` - почати пошук
- `move` - зробити хід
- `chat:global`, `chat:game` - надіслати повідомлення

**Server → Client:**
- `queue:sync` - оновлення черги
- `match:found` - матч знайдено (відлік 5 сек)
- `match:start` - початок гри
- `match:update` - результат раунду
- `match:timer` - синхронізація таймера

## Тестування

```bash
# E2E тести
npm run test:e2e

# Покриття: 80+ тестів
# Тести: матчмейкінг, ігровий процес, фінанси, безпека,
# комбінації гравців (2-5), race conditions, IDOR захист
```

## Як працює гра

### Flow матчу

1. Гравець натискає "Грати" → потрапляє в чергу Redis
2. Система чекає 20 секунд для збору гравців
3. Якщо гравців менше необхідного → додаються боти
4. Відлік 5-4-3-2-1 → матч починається
5. Раунди по 12 секунд (камінь/ножиці/папір)
6. Автохід при відсутності відповіді
7. Вибування до останнього переможця

### Фінансовий flow

```
Ставка: 100 VP
  ↓
Заморожування: 100 VP (заблоковано)
  ↓
[Якщо матч не почнеться за 5 хв → автоповернення]
  ↓
Банк: 200 VP (2 гравці)
  ↓
Комісія: 10 VP (5% house)
  ↓
Виплата: 190 VP → переможцю
```

### Система ботів

Боти автоматично заповнюють неповні матчі:
- **Тригер**: Якщо в черзі менше необхідної кількості після 20с
- **Поведінка**: Реалістичні ніки, випадкові ходи
- **Комбінації**: 1+ бот, 2+ боти, 3+ боти, 4+ боти, 5 реальних гравців

### F5 Recovery

Повна підтримка оновлення сторінки в будь-якому стані:

| Стан | Поведінка при відновленні |
|------|---------------------------|
| **Пошук** | Таймер і позиція відновлюються |
| **В матчі** | Перепідключення до активного матчу |
| **Відлік** | Синхронізація залишених секунд |

## Захист завислих ставок

```typescript
// 1. При заморожуванні ставки - зберігаємо в Redis з timestamp
await redis.set(`frozen:${userId}`, JSON.stringify({
  userId, stakeVp, frozenAt: Date.now()
}), 'EX', 600);

// 2. Фонове завдання кожні 5 хвилин
if (frozenTime > 5 * 60 * 1000 && !hasActiveMatch) {
  await unfreezeStake(userId, stakeVp); // Автоповернення
}

// 3. Користувач може повернути вручну
POST /wallet/reset-frozen
```

## Структура проекту

```
src/
├── matchmaking/    # Логіка гри, черга, WebSocket
├── wallets/        # Баланси, ставки, виплати
├── auth/           # JWT авторизація
├── users/          # Користувачі
├── audit/          # Аудит логи
└── house/          # House банк

test/e2e/           # E2E тести
├── race-conditions/
├── financial-security/
├── idor/
└── state-machine/
```

## Архітектурні рішення

### Чому Redis для матчмейкінгу?
- O(1) операції з чергами
- Вбудований TTL для закінчення тікетів
- Атомарні операції через Lua скрипти
- Ідеально для тимчасового стану матчів

### Захист від race conditions
```typescript
// PostgreSQL Advisory Lock (основний)
const lock = await dataSource.query(
  `SELECT pg_try_advisory_lock($1)`, [lockId]
);

// Redis Lock (резервний)
const lock = await redis.set(lockKey, '1', 'EX', 5, 'NX');

// Double-check pattern
const existing = await hasExistingTicket(userId);
if (existing) return { status: 'ALREADY_IN_QUEUE' };
```

## Roadmap

- [x] **Swagger документація** - Інтерактивна API документація
- [x] **Захист завислих ставок** - Автоповернення frozen коштів
- [x] **CI/CD Pipeline** - GitHub Actions для тестування
- [ ] **Навантажувальне тестування** - Тестування з 1000+ гравців
- [ ] **Горизонтальне масштабування** - Кілька серверів через Redis pub/sub
- [ ] **Таблиця лідерів** - Топ гравців за виграшами

## Ліцензія

Проект для портфоліо та демонстрації навичок.
