# WagerPlay Backend - Agent Documentation

## Project Overview

**Stack:** NestJS + TypeScript backend, vanilla JS frontend (ws-test.html single file)
**Real-time:** Socket.io with Redis for queues/match state
**Database:** PostgreSQL + TypeORM
**Ports:** Server 3000, PostgreSQL 5432, Redis 6379

## Architecture

### Backend Structure
```
src/
├── auth/           # JWT authentication, guards, decorators
├── matchmaking/    # Game logic, queue, match state
├── wallets/        # Balance, transactions, reconciliation
├── users/          # User profiles, stats
├── chat/           # Real-time chat (global + game)
├── admin/          # Admin tools, audit logs
└── ...
```

### Frontend (ws-test.html)
Single-page WebSocket client with:
- F5 recovery (queue/match state restoration)
- Responsive design (mobile <600px)
- Dropdown menus (language, burger menu)
- Sound management (blocked until user interaction)

## Key Patterns & Conventions

### Statistics Logic
- **Net profit** = payout - stake (e.g., 380 payout - 200 stake = 180 profit)
- Winners: `totalWonVp += (payoutVp - stakeVp)`
- Losers: `totalLostVp += stakeVp`

### Balance Reconciliation
```
expectedBalance = 10000 + totalWon - totalStaked
discrepancy = actualBalance - expectedBalance
```

### F5 Recovery
- UI state saved to localStorage: `uiState`, `displayName`, `selectedPlayers`, `selectedStake`
- Queue/match state fetched from `/matchmaking/active` on reconnect
- Token-based reconnection without re-login

### Audio Policy
- Global `hasUserInteracted` flag blocks AudioContext until first click
- All sounds suppressed until user interaction

### Mobile Layout
- Primary actions visible: Play, Stake, Profile
- Secondary actions in burger menu: Balance, Stats, Logs, Audit, Reconcile
- Language selector: single dropdown button (not 3 separate buttons)

## Critical Code Locations

### Matchmaking - Net Profit Calculation
File: `src/matchmaking/matchmaking.service.ts`
Method: `updatePlayerStats()`
```typescript
// Line ~1170 - MUST be net profit, not gross
stats.totalWonVp += (m.payoutVp - m.stakeVp);
```

### Wallets - Reconciliation Formula
File: `src/wallets/wallets.controller.ts`
Endpoint: `@Get('reconcile')`
```typescript
// Line ~75
const expectedBalance = 10000 + totalWon - totalStaked;
```

### Frontend - Language Dropdown
File: `ws-test.html`
- CSS: `.lang-dropdown-container`, `.lang-dropdown-btn`, `.lang-dropdown-menu`
- JS: `toggleLanguageDropdown()`, `closeLanguageDropdown()`, `setLang()`

## Server Protocol

After rebuilds, provide:

```powershell
# Shutdown:
taskkill /F /IM node.exe
taskkill /F /IM ngrok.exe
docker-compose down

# Startup:
cd C:\Users\Mellow\Desktop\wagerplay\backend
docker-compose up -d
npm run start:prod

# ngrok в новом терминале:
cd C:\Users\Mellow
.\ngrok http 3000
```

## Database Operations

### Reset Stats & Balance
```sql
-- reset_balance.sql
TRUNCATE TABLE user_stats;
UPDATE wallets SET balance_wp = 10000, balance_vp = 10000;
```

## Environment Variables

See `.env.example`:
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `JWT_SECRET` - Token signing
- `ADMIN_TOKEN` - Admin API access

## Common Issues

1. **AudioContext errors** - Normal, blocked until click
2. **Balance mismatch** - Check reconciliation formula
3. **Stats wrong** - Verify net vs gross profit calculation
4. **Mobile overlap** - Language selector should be dropdown
