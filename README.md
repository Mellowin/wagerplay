# WagerPlay Backend

Multiplayer Rock-Paper-Scissors game with real-time matchmaking, WebSocket support, and PvP gameplay.

## 🎮 Features

- **Guest Login** - Quick play without registration
- **PvP Matchmaking** - 2-5 players with auto-fill bots
- **Real-time Gameplay** - WebSocket events for live updates
- **Synchronized Timers** - 20s queue wait + 5s countdown + 12s move timer
- **In-game Chat** - Match room chat + Global chat
- **Wallet System** - VP (virtual points) with freeze/unfreeze
- **Match History** - Audit log for all matches
- **Cross-platform** - Works on desktop & mobile

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- npm

### 1. Clone & Install

```bash
git clone https://github.com/Mellowin/wagerplay.git
cd wagerplay/backend
npm install
```

### 2. Environment Setup

Create `.env` file:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wagerplay

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=7d

# Server
PORT=3000
NODE_ENV=development

# Email (optional - for password reset)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### 3. Start Infrastructure

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379

### 4. Run Server

```bash
# Development mode (auto-reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

Server will be available at `http://localhost:3000`

### 5. Test Client

Open `http://localhost:3000/ws-test.html` in your browser.

For multiplayer testing:
- Open 2 browser tabs
- Or share your local IP: `http://YOUR_IP:3000/ws-test.html`
- Or use ngrok for public access

## 🔌 WebSocket Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `quickplay` | `{ playersCount: number, stakeVp: number }` | Join matchmaking queue |
| `move` | `{ matchId: string, move: 'ROCK' \| 'PAPER' \| 'SCISSORS' }` | Submit move |
| `match:get` | `{ matchId: string }` | Get match state |
| `match:join` | `{ matchId: string }` | Join match room |
| `chat:game` | `{ matchId: string, text: string }` | Send match chat message |
| `chat:global` | `{ text: string }` | Send global chat message |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `match:ready` | `{ matchId: string }` | Match created, waiting to start |
| `match:found` | `{ matchId: string, countdown: 5 }` | Match found, countdown started |
| `match:countdown` | `{ seconds: number }` | Countdown tick (5-4-3-2-1) |
| `match:start` | `Match` object | Game started |
| `match:update` | `Match` object | Game state updated |
| `match:timer` | `{ type: 'move', deadline: number, secondsLeft: number }` | Move timer |
| `queue:sync` | `{ playersFound: number, totalNeeded: number, secondsLeft: number }` | Queue status |
| `queue:waiting` | `{ seconds: number, playersFound: number }` | Waiting in queue |
| `chat:game` | `{ author: string, text: string, timestamp: number }` | Match chat message |
| `chat:global` | `{ author: string, text: string, timestamp: number }` | Global chat message |

## 🌐 REST API

### Auth (No authentication required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register with email |
| POST | `/auth/login` | Login with credentials |
| POST | `/auth/guest` | Create guest account |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset password with token |
| GET | `/auth/verify-email` | Verify email address |

### Auth Required (JWT Bearer token)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/me` | Get current user info |
| PATCH | `/auth/profile` | Update profile |
| GET | `/auth/stats` | Get player statistics |
| GET | `/wallet` | Get wallet balance |
| POST | `/matchmaking/quickplay` | Start matchmaking (HTTP alternative) |

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/matchmaking/match/:id` | Get match by ID |
| GET | `/matchmaking/match/:id/audit` | Get match audit log |
| POST | `/matchmaking/match/:id/move` | Submit move (HTTP alternative) |
| GET | `/avatars` | List avatars |
| GET | `/avatars/:filename` | Get avatar image |

## 🧪 Test Scenario

1. Open `http://localhost:3000/ws-test.html`
2. Click **"GUEST"** button to login
3. Select **"5 Players / 100 VP"** and click **Quick Play**
4. You will see: `Ищем соперников (1/5)...`
5. Open second browser tab or another device with same URL
6. Second player joins - both see `(2/5)`
7. After 20 seconds or if 5 players found → match starts
8. Countdown 5-4-3-2-1 begins
9. Select your move (Rock/Paper/Scissors) within 12 seconds
10. Watch round results and elimination
11. Continue until winner determined
12. Check wallet for winnings!

## 🐳 Docker Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Reset data
docker-compose down -v
docker-compose up -d
```

## 🌐 Public Access (ngrok)

For testing with friends over internet:

```bash
# Install ngrok
choco install ngrok

# Configure (one time)
ngrok config add-authtoken YOUR_TOKEN

# Start tunnel
ngrok http 3000
```

Share the HTTPS URL with friends!

## 🛠 Tech Stack

- **Backend:** NestJS + TypeScript
- **Real-time:** Socket.io (WebSockets)
- **Database:** PostgreSQL + TypeORM
- **Cache/Queue:** Redis
- **Container:** Docker + Docker Compose
- **Testing:** Jest (unit) + Supertest (e2e)

## 📁 Project Structure

```
backend/
├── src/
│   ├── auth/              # Authentication module
│   ├── matchmaking/       # Game logic & matchmaking
│   ├── wallets/           # Virtual currency
│   ├── audit/             # Match history
│   ├── house/             # Bank/House system
│   ├── avatars/           # User avatars
│   └── main.ts            # Application entry
├── test/                  # E2E tests
├── docker-compose.yml     # Infrastructure
├── ws-test.html          # Test client
└── README.md             # This file
```

## 📝 Scripts

```bash
# Development
npm run start:dev

# Build
npm run build

# Production
npm run start:prod

# Tests
npm run test
npm run test:e2e

# Lint
npm run lint
```

## 🤝 Multiplayer Testing

### Local Network
```bash
# Find your IP
ipconfig | findstr IPv4
# Use: http://192.168.1.XXX:3000/ws-test.html
```

### Internet (ngrok)
```bash
ngrok http 3000
# Share: https://xxxx.ngrok-free.app/ws-test.html
```

## ⚠️ Known Limitations

- Email verification requires SMTP configuration
- Free ngrok URL changes on restart
- WebSocket connections may drop on mobile background

## 📄 License

MIT

## 🙏 Credits

Built with AI assistance for rapid prototyping and debugging.
