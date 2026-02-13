# WagerPlay Backend

**Multiplayer Rock-Paper-Scissors platform** с real-time matchmaking, financial audit system и PvP геймплеем на 2-5 игроков.

> Проект создан для практики full-stack разработки: NestJS, WebSockets, PostgreSQL, Redis, Docker.

---

## 🎯 Key Features

| Feature | Implementation |
|---------|---------------|
| **Matchmaking** | Redis-based queue с 20s таймаутом, auto-fill ботами |
| **Real-time** | Socket.io + Redis адаптер, синхронизированные таймеры |
| **Game Logic** | Камень-ножницы-бумага, elimination раунды, 12s ход |
| **Financial System** | Wallet (VP), frozen balance, stake/payout, audit trail |
| **Dual Auth** | JWT для регистрации + UUID guest tokens |
| **Chat System** | Global + Match room чаты с историей |
| **Admin Tools** | Audit logs, balance reconciliation, orphaned match cleanup |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (ws-test.html)                │
└───────────────────────────┬─────────────────────────────────┘
                            │ WebSocket / HTTP
┌───────────────────────────▼─────────────────────────────────┐
│                    NestJS Application                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   Auth      │  │ Matchmaking  │  │     Wallet      │   │
│  │  Module     │  │   Service    │  │    Service      │   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘   │
│         │                │                    │            │
│         └────────────────┼────────────────────┘            │
│                          │                                 │
│  ┌───────────────────────▼────────────────────────┐        │
│  │           Matchmaking Gateway (Socket.io)      │        │
│  └───────────────────────┬────────────────────────┘        │
└──────────────────────────┼──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
│   PostgreSQL    │ │    Redis    │ │   Redis Pub/Sub │
│   (TypeORM)     │ │   (Queue)   │ │  (WS Adapter)   │
│                 │ │             │ │                 │
│ • users         │ │ • queues    │ │ • multi-server  │
│ • wallets       │ │ • matches   │ │ • broadcasts    │
│ • stats         │ │ • tickets   │ │                 │
│ • audit_logs    │ │ • timers    │ │                 │
└─────────────────┘ └─────────────┘ └─────────────────┘
```

---

## 🎮 Game Mechanics

### Match Flow

```
Queue (20s timeout) ──► Match Found ──► Countdown (5s) ──► Round 1 (12s)
                                                              │
                    Elimination ◄── Round 2 (12s) ◄────────────┘
                         │
                    Round 3... ──► Winner ──► Payout
```

### Queue System

- **Минимум игроков**: 2 (реальных) или 1 + боты
- **Таймаут**: 20 секунд перед созданием матча
- **Боты**: Автозаполнение до `playersCount` (BOT1, BOT2...)

### Round Resolution

1. **Все сделали ход** → мгновенный резолв
2. **Таймаут 12s** → auto-move случайным ходом
3. **Elimination**: проигравшие выбывают
4. **Tie**: все живые остаются, новый раунд

### Financial Model

| Param | Value |
|-------|-------|
| House Fee | 10% от pot |
| Stake | 100 / 500 / 1000 VP |
| Payout | `pot - fee` → победителю |

```
Example (5 players, 100 VP stake):
  Pot: 500 VP
  Fee: 50 VP (10%)
  Payout: 450 VP → winner
```

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 10 + TypeScript 5 |
| Real-time | Socket.io 4 with Redis adapter |
| Database | PostgreSQL 15 + TypeORM |
| Cache/Queue | Redis 7 (ioredis) |
| Auth | JWT ( Passport ) + UUID guest tokens |
| Validation | class-validator |
| Testing | Jest |
| Container | Docker + Docker Compose |

---

## 📁 Project Structure

```
src/
├── auth/                    # Authentication & authorization
│   ├── auth.controller.ts   # Login, register, guest, password reset
│   ├── auth.service.ts      # JWT generation, email verification
│   └── guards/              # JwtAuthGuard
├── matchmaking/             # Core game logic
│   ├── matchmaking.service.ts   # Queue, match creation, round resolution
│   ├── matchmaking.gateway.ts   # WebSocket handlers
│   ├── matchmaking.controller.ts # HTTP endpoints
│   └── types.ts             # Match, Ticket types
├── wallets/                 # Financial operations
│   ├── wallets.service.ts   # Balance, freeze, stake, payout
│   └── wallets.controller.ts # Admin endpoints
├── audit/                   # Audit logging system
│   └── audit.service.ts     # Financial event tracking
├── house/                   # Bank system
│   └── house.service.ts     # House balance management
├── avatars/                 # Static assets
└── main.ts                  # Bootstrap
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker Desktop
- npm

### 1. Install
```bash
git clone https://github.com/Mellowin/wagerplay.git
cd wagerplay/backend
npm install
```

### 2. Environment
```bash
cp .env.example .env
# Edit .env with your values
```

Required env vars:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wagerplay
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
PORT=3000
```

### 3. Start Infrastructure
```bash
docker-compose up -d
```

### 4. Run Server
```bash
# Development (hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

### 5. Test Client
Open `http://localhost:3000/ws-test.html` in browser.

---

## 🔌 REST API Reference

### Auth Endpoints

#### POST `/auth/guest`
Create guest account (no auth required).

**Response:**
```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "Guest550e84",
  "balanceWp": 10000
}
```

#### POST `/auth/register`
Register with email.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "username": "PlayerOne"
}
```

#### POST `/auth/login`
Login and get JWT.

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "...",
  "balanceWp": 10000
}
```

### Wallet Endpoints (Auth Required)

#### GET `/wallet`
Get current balance.

**Response:**
```json
{
  "userId": "...",
  "balanceWp": 9500,
  "frozenWp": 100
}
```

#### GET `/wallet/reconcile`
Reconcile actual vs expected balance.

**Response:**
```json
{
  "userId": "...",
  "actualBalance": 9500,
  "expectedBalance": 9500,
  "discrepancy": 0,
  "isBalanced": true
}
```

### Admin Endpoints (Internal)

#### POST `/wallet/admin/reset-frozen`
Return frozen funds to balance (for orphaned matches).

#### GET `/auth/audit`
Get recent audit events.

---

## ⚡ WebSocket API Reference

### Connection
```javascript
const socket = io('ws://localhost:3000', {
  auth: { token: 'jwt-or-uuid-token' }
});
```

### Client → Server Events

#### `quickplay`
Join matchmaking queue.

**Payload:**
```typescript
{
  playersCount: number;  // 2-5
  stakeVp: number;       // 100, 500, 1000
}
```

#### `move`
Submit move for current round.

**Payload:**
```typescript
{
  matchId: string;
  move: 'ROCK' | 'PAPER' | 'SCISSORS';
}
```

#### `chat:global`
Send global chat message.

**Payload:**
```typescript
{ text: string }
```

#### `chat:game`
Send match chat message.

**Payload:**
```typescript
{
  matchId: string;
  text: string;
}
```

### Server → Client Events

#### `queue:sync`
Queue status update.

**Payload:**
```typescript
{
  playersFound: number;  // Current queue size
  totalNeeded: number;   // Target (e.g., 5)
  secondsLeft: number;   // Until 20s timeout
}
```

#### `match:ready`
Match created, countdown pending.

**Payload:**
```typescript
{
  matchId: string;
  countdown: number;  // 5 seconds
}
```

#### `match:countdown`
Countdown tick (5-4-3-2-1).

**Payload:**
```typescript
{ seconds: number }
```

#### `match:start`
Game started, first round active.

**Payload:**
```typescript
{
  matchId: string;
  playerIds: string[];
  aliveIds: string[];
  eliminatedIds: string[];
  round: number;
  status: 'IN_PROGRESS';
  deadline: number;      // Unix timestamp ms
  stakeVp: number;
  potVp: number;
}
```

#### `match:update`
Game state changed (after each round).

**Payload:**
```typescript
{
  matchId: string;
  round: number;
  status: 'IN_PROGRESS' | 'FINISHED';
  aliveIds: string[];
  eliminatedIds: string[];
  moves: Record<string, 'ROCK' | 'PAPER' | 'SCISSORS'>;  // Visible after round
  lastRound: {
    roundNo: number;
    moves: Record<string, string>;
    outcome: 'ELIMINATION' | 'TIE';
    eliminated: string[];
  };
  deadline: number;  // Next round deadline
  winnerId?: string; // If FINISHED
}
```

#### `match:timer`
Timer synchronization.

**Payload:**
```typescript
{
  type: 'move';
  deadline: number;      // Unix timestamp
  secondsLeft: number;   // Calculated
  round: number;
}
```

#### `chat:global` / `chat:game`
Chat message received.

**Payload:**
```typescript
{
  author: string;
  text: string;
  timestamp: number;
}
```

---

## 🧪 Testing Scenarios

### Scenario 1: Guest Quick Play
```
1. POST /auth/guest → get token
2. WS: connect with token
3. WS: emit 'quickplay' { playersCount: 5, stakeVp: 100 }
4. Wait for queue:sync updates
5. Receive match:ready → match:countdown → match:start
6. Emit 'move' within 12s
7. Receive match:update with round results
```

### Scenario 2: Multiplayer (2 Real + 3 Bots)
```
1. Player A: Guest login → quickplay (5/100)
2. Within 20s, Player B: Guest login → quickplay (5/100)
3. After 20s timeout, match created with 2 real + 3 bot players
4. Both players receive match:start
5. If Player A doesn't move in 12s → auto-move ROCK
6. Round resolves, loser eliminated
```

### Scenario 3: Financial Audit
```
1. Play match and finish
2. GET /wallet/reconcile
3. Expected balance = 10000 + totalWon - totalLost
4. Compare with actual balance
5. Check /auth/audit for STAKE_FROZEN, PAYOUT_APPLIED events
```

---

## 🔍 Implementation Details

### Matchmaking Flow

```typescript
// 1. Player joins queue
await redis.rpush(`queue:${players}:${stake}`, ticketId);
await redis.set(`ticket:${ticketId}`, JSON.stringify(ticket), 'EX', 300);

// 2. Background job checks queue every second
const len = await redis.llen(queueKey);
if (len >= 2 && elapsedSec >= 20) {
  // Create match
  const match = await createMatch(playerIds, botsNeeded);
}

// 3. Cleanup orphaned matches every 5 minutes
setInterval(cleanupOrphanedMatches, 5 * 60 * 1000);
```

### Round Resolution Algorithm

```typescript
function resolveRound(match) {
  // Collect moves (including auto-moves for timeout)
  const moves = match.moves;
  const uniqueMoves = new Set(Object.values(moves));
  
  if (uniqueMoves.size === 1) {
    // All same = TIE, everyone stays
    return { outcome: 'TIE', eliminated: [] };
  }
  
  if (uniqueMoves.size === 3) {
    // ROCK + PAPER + SCISSORS = TIE
    return { outcome: 'TIE', eliminated: [] };
  }
  
  // 2 moves: determine winner
  const [a, b] = Array.from(uniqueMoves);
  const winningMove = beats(a, b); // ROCK beats SCISSORS
  
  const losers = aliveIds.filter(id => moves[id] !== winningMove);
  return { outcome: 'ELIMINATION', eliminated: losers };
}
```

### Financial Transaction Flow

```
Player clicks Quick Play:
  1. STAKE_FROZEN: 100 VP moved balance → frozen
  
Match finishes:
  2. STAKE_CONSUMED: frozen → consumed (losers)
  3. PAYOUT_APPLIED: pot - fee → winner balance
  
Or match cancelled:
  2. STAKE_RETURNED: frozen → balance
```

### Timer Synchronization

- **Server-side**: `setTimeout` в `startMoveTimer()`
- **Client-side**: `deadline - Date.now()` для отображения
- **Race condition protection**: Lock в Redis + round checking

---

## 🛡️ Security Measures

| Layer | Implementation |
|-------|---------------|
| Auth | JWT (access token) + UUID guest tokens |
| Input | class-validator на все DTO |
| Race Conditions | Redis locks для critical operations |
| Replay Protection | Round checking в move submissions |
| Cleanup | Автоочистка зависших матчей |

---

## 📊 Database Schema

### users
```sql
id UUID PRIMARY KEY
email VARCHAR UNIQUE
password_hash VARCHAR
display_name VARCHAR
is_guest BOOLEAN
created_at TIMESTAMP
```

### wallets
```sql
user_id UUID PRIMARY KEY
balance_wp INTEGER
frozen_wp INTEGER
```

### user_stats
```sql
user_id UUID PRIMARY KEY
total_played INTEGER
total_won INTEGER
total_lost INTEGER
total_won_vp INTEGER
total_lost_vp INTEGER
```

### audit_logs
```sql
id UUID PRIMARY KEY
event_type VARCHAR -- STAKE_FROZEN, PAYOUT_APPLIED, etc.
user_id UUID
match_id UUID
amount INTEGER
metadata JSONB
created_at TIMESTAMP
```

---

## 🐛 Troubleshooting

### Queue timer stuck (204s bug)
**Cause**: Stale `queue:time:${players}:${stake}` в Redis
**Fix**: Автоматический сброс при `len === 0 || elapsedHours > 1`

### Orphaned frozen balance
**Cause**: Матч завис, игрок вышел
**Fix**: Cleanup job возвращает frozen → balance

### Duplicate match creation
**Cause**: Race condition при assembly
**Fix**: Redis lock `match:start:${matchId}`

---

## 🚧 Future Improvements

- [ ] Tournament mode (multi-round brackets)
- [ ] Spectator mode
- [ ] Reconnection after disconnect
- [ ] Mobile app (React Native/Flutter)
- [ ] Blockchain integration (crypto stakes)

---

## 📄 License

MIT License - for educational and portfolio purposes.

---

## 👨‍💻 Author

Developed as practice project to master NestJS, WebSockets, and real-time game architecture.

**Tech highlights:**
- Handling 100+ concurrent matches
- Sub-second timer synchronization
- Zero-balance-discrepancy guarantee via audit system
- Graceful handling of edge cases (disconnects, timeouts, race conditions)
