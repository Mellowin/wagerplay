# WagerPlay Backend

Multiplayer Rock-Paper-Scissors game with matchmaking, real-time gameplay, and betting system.

> Practice project for full-stack development. Backend built with NestJS + PostgreSQL + Redis + Socket.io.

## Demo Video

[![WagerPlay Demo](https://img.youtube.com/vi/s5ViycpnBDM/0.jpg)](https://www.youtube.com/watch?v=s5ViycpnBDM)

Click the image above to watch the demo video showcasing F5 recovery, matchmaking, and real-time gameplay.

## What I Built

- **Matchmaking** - player queue with 20-second timeout, auto-fill with bots
- **Real-time gameplay** - WebSocket events for moves, timers, round results
- **Round system** - 12-second turns, auto-move if player doesn't respond, rock-paper-scissors win logic
- **F5 Recovery** - full state restoration after page refresh during search or match
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

### 3. Environment Setup

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
# Edit .env with your settings
```

### 4. Run

```bash
# Infrastructure (PostgreSQL + Redis)
docker-compose up -d

# Development server
npm run start:dev
```

Open `http://localhost:3000/ws-test.html` to test.

---

## Demo in 60 Seconds

Quick walkthrough to see all features:

1. **Start infrastructure**: `docker-compose up -d`
2. **Install & run**: `npm install && npm run start:dev`
3. **Open client**: Navigate to `http://localhost:3000/ws-test.html`
4. **Login**: Click "Guest Login" (no registration needed)
5. **Quick Play**: Select 2 players, 100 VP stake, click "Play"
6. **Open second tab**: Login as another guest, join same queue
7. **Watch matchmaking**: After 20s or 2 players → countdown → match starts
8. **Test chat**: Send messages in game chat
9. **Test F5 recovery**: Refresh page during search or match → state restored
10. **Make moves**: Rock/Paper/Scissors within 12 seconds

## How the Game Works

### Match Flow

1. Player clicks "Quick Play" → joins queue
2. System waits 20 seconds to gather players
3. If less than 5 players - bots are added
4. Countdown 5-4-3-2-1 → match starts
5. 12-second rounds (rock/paper/scissors)
6. Auto-move: if player doesn't respond in 12s, system makes random move
7. Losers eliminated, last player standing wins

## F5 Page Refresh Recovery

The game fully supports page refresh (F5) during any game state without losing progress:

| State | Recovery Behavior |
|-------|-------------------|
| **Searching** | Timer and queue position restored; match continues normally when found |
| **In Match** | Reconnects to active match, syncs timer, preserves all game data |
| **Settings** | Player count (2-5) and stake (100-10000 VP) preserved |

**Technical Implementation:**
- `localStorage` persists UI state (`uiState`), selected players, and stake amount
- `/matchmaking/active` endpoint checks for active queue or match on reconnect
- WebSocket auto-reconnects with session restoration via `checkActiveMatchOrQueue()`
- "Go to Profile" button disabled during search/match to prevent state corruption
- Server-side `findUserTicket()` locates player in queue after reconnect
- Socket events (`queue:sync`, `match:start`) sent to new socket ID after F5

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

## Roadmap

- [ ] **Reconnect after disconnect** - Handle network interruptions gracefully
- [ ] **Load testing** - Stress test with 100+ concurrent players
- [ ] **Horizontal scaling** - Support multiple server instances with Redis pub/sub
- [ ] **Match history** - Persist finished matches to database for replay/analysis

## Architecture Decisions

**Why Redis for queues?**
- Fast in-memory operations for queue management
- Built-in TTL for automatic ticket expiration
- Easy to scale horizontally later with Redis Cluster

**Why audit_logs?**
- Financial operations require traceability
- Helps debug balance discrepancies
- Immutable history of all transactions

**How I handled race conditions:**
- Queue locks (`queue:lock:${players}:${stake}`) prevent double match creation
- Match start locks (`match:startlock:${matchId}`) prevent duplicate match initialization
- Database transactions with `pessimistic_write` locks for wallet operations

**F5 Recovery design:**
- `localStorage` for client-side state persistence (settings, UI state)
- `/matchmaking/active` endpoint for server-side state check
- Socket.io reconnection with session restoration via `checkActiveMatchOrQueue()`

## Limitations / Future Improvements

- No load testing (behavior under 100+ players unknown)
- Not designed for horizontal scaling yet (single server instance)
- Email verification requires SMTP configuration
- AudioContext warnings in browser console (non-critical, audio works after first interaction)


