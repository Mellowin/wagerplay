# WagerPlay Backend

Real-time multiplayer Rock-Paper-Scissors gaming platform with matchmaking, betting system, bot integration, and comprehensive admin tools.

[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)](https://redis.io/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socket.io&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)

## Demo Video

[![WagerPlay Demo](https://img.youtube.com/vi/s5ViycpnBDM/0.jpg)](https://www.youtube.com/watch?v=s5ViycpnBDM)

## Features

### Core Gameplay
- **Matchmaking** - 20-second queue with auto-fill bots
- **Tournament System** - 2-5 player elimination rounds
- **Real-time Gameplay** - WebSocket events for moves, timers, results
- **Round System** - 12-second turns, auto-move if AFK
- **F5 Recovery** - Full state restoration after page refresh

### Financial System
- **Wallets** - VP (Virtual Points) balance management
- **Stake Freezing** - Secure bet handling during matches
- **Fee System** - 5% house fee on each match
- **Payouts** - Automatic winner distribution
- **Reconciliation** - Balance verification against history

### Leaderboard System
- **5 Categories**: Wins, Win Rate, Profit, Current Streak, Max Streak
- **Pagination** - Navigate through top players
- **Real-time Position** - See your rank in each category
- **Player Stats** - Detailed statistics for each player

### User Features
- **Authentication** - JWT tokens + guest login
- **User Profiles** - Custom display names, avatars
- **Statistics** - Games played, wins/losses, VP earned/lost
- **Chat** - Global and in-game match chat

### Admin Panel
- **Balance Management** - Add/remove VP from users
- **User Ban System** - Ban/unban users with reason logging
- **Security**:
  - IP Whitelist - Admin access locked to first-login IP
  - Session Timeout - Auto-logout after 30 min inactivity
  - Email Whitelist - Only approved emails can access admin
- **Resizable UI** - Adjustable modal size for convenience
- **Audit Logs** - Track all admin actions

### Security & Audit
- **IDOR Protection** - Resource access validation
- **Mass Assignment Protection** - Input sanitization
- **Audit Logging** - Financial operation tracking
- **Race Condition Handling** - PostgreSQL Advisory Locks + Redis locks
- **Frozen Stake Protection** - Auto-return after 5 min timeout
- **JWT Authentication** - Secure token-based auth with global module

### DevOps & Monitoring
- **Swagger API Docs** - Interactive documentation at `/api/docs`
- **Docker** - Containerized deployment
- **CI/CD Pipeline** - GitHub Actions for testing
- **Health Checks** - Server status endpoint

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | NestJS + TypeScript |
| **Database** | PostgreSQL + TypeORM |
| **Cache/Queues** | Redis (ioredis) |
| **Real-time** | Socket.io |
| **Testing** | Jest + Supertest + k6 (load testing) |
| **DevOps** | Docker + Docker Compose + GitHub Actions |
| **Documentation** | Swagger/OpenAPI |

## Project Structure

```
src/
├── matchmaking/          # Game logic & WebSocket
│   ├── matchmaking.service.ts
│   ├── matchmaking.gateway.ts
│   └── matchmaking.controller.ts
├── wallets/              # Financial system
├── auth/                 # JWT authentication
│   ├── jwt-auth.module.ts    # Global JWT module
│   ├── jwt-auth.guard.ts
│   └── auth.service.ts
├── leaderboard/          # Leaderboard system
│   ├── leaderboard.service.ts
│   └── leaderboard.controller.ts
├── admin/                # Admin panel & user management
├── users/                # User management
├── audit/                # Audit logging
└── house/                # House bank

test/e2e/                 # E2E tests
├── race-conditions/
├── financial-security/
├── idor/
└── state-machine/
```

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose

### Installation

```bash
# Clone
git clone https://github.com/Mellowin/wagerplay.git
cd wagerplay

# Install
npm install

# Environment
cp .env.example .env
# Edit .env with your credentials

# Infrastructure
docker-compose up -d

# Development
npm run start:dev
```

### Environment Variables

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wagerplay
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
PORT=3000
NODE_ENV=development
ADMIN_TOKEN=your-admin-token
```

## Testing

```bash
# Run E2E tests
npm run test:e2e

# Current coverage: 80+ tests
# Tests cover: matchmaking, game flow, financial transactions, security,
# player combinations (2-5 players), race conditions, IDOR protection
```

### Test Categories
- **Race Conditions** - Parallel request handling
- **Financial Security** - Balance validation, reconciliation
- **IDOR** - Resource access control
- **State Machine** - Match lifecycle, transitions

## API Documentation

Interactive Swagger documentation available at: `http://localhost:3000/api/docs`

### REST Endpoints

#### Authentication
```
POST   /auth/guest              # Guest login
POST   /auth/register           # User registration
POST   /auth/login              # User login
GET    /auth/me                 # Current user info
PATCH  /auth/profile            # Update profile
```

#### Matchmaking
```
POST   /matchmaking/quickplay           # Join queue
POST   /matchmaking/match/:id/move      # Submit move
GET    /matchmaking/match/:id           # Get match details
GET    /matchmaking/history             # Match history
GET    /matchmaking/online              # Online players count
```

#### Wallet
```
GET    /wallet                   # Get balance
POST   /wallet/reset-frozen     # Return frozen stake
GET    /wallet/reconcile         # Verify integrity
```

#### Leaderboard
```
GET    /leaderboard              # Get top players
GET    /leaderboard/me           # Get my position
GET    /leaderboard/categories   # List categories
```

#### Admin (Requires admin privileges)
```
GET    /admin/users              # List all users
POST   /admin/users/balance      # Update user balance
POST   /admin/users/ban          # Ban user
POST   /admin/users/unban        # Unban user
```

### WebSocket Events
```
# Queue Events
queue:join          # Joined queue
queue:sync          # Queue status
queue:error         # Queue error

# Match Events  
match:found         # Match created
match:start         # Match started
match:state         # Game state update
match:timer         # Countdown timer
match:round_result  # Round resolution
match:elimination   # Player eliminated
match:end           # Match ended

# Chat Events
chat:global         # Global chat message
chat:game           # In-game chat message
```

## How It Works

### Match Flow
1. Player clicks "Quick Play" → joins Redis queue
2. 20-second timer to gather players
3. If < 2 players → bots added automatically
4. Countdown 5-4-3-2-1 → match starts
5. 12-second rounds (Rock/Paper/Scissors)
6. AFK players get auto-move
7. Elimination until 1 winner remains

### Financial Flow
```
stake: 100 VP
  ↓
frozen: 100 VP (locked for match)
  ↓
[If match doesn't start in 5 min → auto-return]
  ↓
pot: 200 VP (2 players)
  ↓
fee: 10 VP (5% house)
  ↓
payout: 190 VP → winner
```

### Leaderboard Categories
- **Wins** - Total victories
- **Win Rate** - Win percentage (min 10 matches)
- **Profit** - Total VP earned
- **Current Streak** - Current win streak
- **Max Streak** - All-time longest streak

### Bot System
Bots automatically fill incomplete matches:
- **Trigger**: If queue has < required players after 20s
- **Behavior**: Realistic nicknames, random moves
- **Combinations Tested**: 1+ bots, 2+ bots, 3+ bots, 4+ bots, 5 real players

### Admin Security
```typescript
// 1. Email whitelist check
const whitelistedEmails = ['admin@example.com'];

// 2. IP lock on first login
if (!user.adminIp) user.adminIp = currentIp;
if (user.adminIp !== currentIp) throw Forbidden;

// 3. Session timeout check
if (now - user.lastAdminActivity > 30min) throw Unauthorized;

// 4. Update activity on each call
user.lastAdminActivity = now;
```

### Ban System
```typescript
// Ban user
POST /admin/users/ban
{
  "userId": "uuid",
  "reason": "Cheating"
}

// User cannot login when banned
// Ban reason stored for audit
```

## Key Technical Decisions

### Why Redis for Matchmaking?
- O(1) queue operations
- Built-in TTL for ticket expiration
- Atomic operations via Lua scripts
- Perfect for transient match state
- Keys: `queue:{players}:{stake}`, `ticket:{id}`, `match:{id}`

### Global JWT Module
```typescript
@Global()
@Module({
  imports: [JwtModule.registerAsync({...})],
  exports: [JwtModule, JwtAuthGuard],
})
export class JwtAuthModule {}
```
- Single JWT configuration across all modules
- Consistent token validation
- No duplicate JwtModule imports

### Frozen Stake Protection
```typescript
// 1. On stake freeze - save to Redis with timestamp
await redis.set(`frozen:${userId}`, JSON.stringify({
  userId, stakeVp, frozenAt: Date.now()
}), 'EX', 600);

// 2. Cleanup job every 5 minutes
if (frozenTime > 5 * 60 * 1000 && !hasActiveMatch) {
  await unfreezeStake(userId, stakeVp); // Auto-return
}

// 3. User can manually return anytime
POST /wallet/reset-frozen
```

### Race Condition Protection
```typescript
// PostgreSQL Advisory Lock (primary)
const lock = await dataSource.query(
  `SELECT pg_try_advisory_lock($1)`, [lockId]
);

// Redis Lock (fallback)
const lock = await redis.set(lockKey, '1', 'EX', 5, 'NX');

// Double-check pattern
const existing = await hasExistingTicket(userId);
if (existing) return { status: 'ALREADY_IN_QUEUE' };
```

### F5 Recovery
```typescript
// On WebSocket connect:
// 1. Check for orphaned matches → cleanup
// 2. Check for active queue → restore
// 3. Check for active match → rejoin
```

## Development

```bash
# Start with watch mode
npm run start:dev

# Build for production
npm run build

# Production start
npm run start:prod

# Run tests
npm run test:e2e
```

## Demo

Open `http://localhost:3000/ws-test.html` after starting the server.

**Test Flow:**
1. Click "Guest Login"
2. Select 2 players, 100 VP stake
3. Click "Play"
4. Open second tab → another guest
5. Watch matchmaking (20s or 2 players)
6. Make moves within 12 seconds
7. Refresh page (F5) → state restored
8. Click "🏆 Топ" → view leaderboard

## License

Portfolio project for demonstration purposes.
