# WagerPlay Backend

Multiplayer Rock-Paper-Scissors game with matchmaking, real-time gameplay, and betting system.

> Practice project for full-stack development. Backend built with NestJS + PostgreSQL + Redis + Socket.io.

## What I Built

- **Matchmaking** - player queue with 20-second timeout, auto-fill with bots
- **Real-time gameplay** - WebSocket events for moves, timers, round results
- **Round system** - 12-second turns, auto-move if player doesn't respond, rock-paper-scissors win logic
- **Wallets** - VP (virtual points) balance, stake freezing, winner payouts
- **User Profiles** - customizable display name, avatar selection, upload custom avatar image
- **Statistics** - track games played, wins/losses, VP earned/lost; view other players' stats in chat
- **Audit logging** - financial operation logs for debugging
- **Authentication** - JWT tokens + guest login without registration
- **Chat** - global and in-game match chat with player profiles

## Tech Stack

- **Backend:** NestJS + TypeScript
- **Database:** PostgreSQL + TypeORM
- **Cache/Queues:** Redis (ioredis)
- **Real-time:** Socket.io
- **Containerization:** Docker + Docker Compose

## Quick Start

### 1. Install

```bash
git clone https://github.com/Mellowin/wagerplay.git
cd wagerplay/backend
npm install
```

### 2. Environment

Create `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wagerplay
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
PORT=3000
NODE_ENV=development
```

### 3. Run

```bash
# Infrastructure (PostgreSQL + Redis)
docker-compose up -d

# Development server
npm run start:dev
```

Open `http://localhost:3000/ws-test.html` to test.

## How the Game Works

### Match Flow

1. Player clicks "Quick Play" → joins queue
2. System waits 20 seconds to gather players
3. If less than 5 players - bots are added
4. Countdown 5-4-3-2-1 → match starts
5. 12-second rounds (rock/paper/scissors)
6. Auto-move: if player doesn't respond in 12s, system makes random move
7. Losers eliminated, last player standing wins

### Financial Flow

```
1. Stake is frozen (balance → frozen)
2. Match plays out
3. Winner receives pot - fee (10% house fee)
4. Operation history saved to audit_logs
```

## API

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/guest` | Create guest account |
| POST | `/auth/login` | Login (JWT) |
| GET | `/auth/me` | Get profile |
| PATCH | `/auth/profile` | Update profile (name, avatar) |
| GET | `/auth/stats` | Get statistics |
| GET | `/wallet` | Get balance |
| GET | `/wallet/reconcile` | Debug: compare expected vs actual balance |
| GET | `/matchmaking/match/:id` | Get match by ID |
| GET | `/matchmaking/match/:id/audit` | Match event history |

### WebSocket Events

**Client → Server:**
- `quickplay` - start match search
- `move` - submit move
- `chat:global`, `chat:game` - send message

**Server → Client:**
- `queue:sync` - queue update
- `match:found` - match found (5-sec countdown)
- `match:start` - game starts
- `match:update` - round result
- `match:timer` - timer sync

## Project Structure

```
src/
├── auth/           # Auth (JWT, guest)
├── matchmaking/    # Game logic, queue, WebSocket
├── wallets/        # Balances, stakes, payouts
├── audit/          # Operation logging
└── house/          # System "bank"
```

## What I Learned / Practiced

- **WebSocket synchronization:** how to sync timers between client and server
- **Race conditions:** round/deadline checks before processing moves
- **State consistency:** freeze → deduct → payout with consistent state updates
- **Redis:** using for queues and temporary match data
- **NestJS:** modules, guards, gateways, TypeORM integration

## Testing

```bash
# Multiplayer test
1. Open 3 browser tabs
2. Login as Guest in each
3. Click Quick Play with same settings
4. After 20 seconds match creates

# Balance check
GET /wallet/reconcile - compares actual vs expected
```

## Limitations / Future Improvements

- No load testing (behavior under 100+ players unknown)
- Not designed for horizontal scaling yet (single server instance)
- No reconnection on disconnect
- Email verification requires SMTP configuration


