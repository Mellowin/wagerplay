import { Injectable, BadRequestException, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Wallet } from '../wallets/wallet.entity';
import { UserStats } from '../users/user-stats.entity';
import { AuditService } from '../audit/audit.service';
import { HouseService } from '../house/house.service';

const ALLOWED_PLAYERS = new Set([2, 3, 4, 5]);
const ALLOWED_STAKES = new Set([100, 200, 500, 1000, 2500, 5000, 10000]);

// ⏱️ Таймеры игры
const MATCH_SEARCH_TIMEOUT_SEC = 20;      // 60 сек на поиск матча
const MOVE_TIMEOUT_SEC = 12;              // 12 сек на ход
const BOT_FALLBACK_TIMEOUT_SEC = 5;       // 5 сек до ботов если нет соперников
const MIN_REAL_PLAYERS_FOR_PVP = 2;       // Минимум 2 игрока для PVP

// 🎮 Реалистичные ники для ботов
const BOT_NICKNAMES = [
    'Alex_Pro', 'LuckyShot', 'MasterRock', 'ScissorsKing', 'PaperTigress',
    'RockStar', 'NinjaMove', 'PhantomHand', 'BlitzPlay', 'StormGamer',
    'CyberFist', 'IronGrip', 'SwiftCut', 'SilentWin', 'DarkHorse',
    'FlashBang', 'NoMercy', 'RisingSun', 'IceBreaker', 'FireStorm',
    'ShadowHunter', 'ThunderBolt', 'QuickDraw', 'SteelFist', 'ViperStrike',
    'GhostRider', 'BladeRunner', 'MegaMind', 'SuperNova', 'ThunderBird',
    'CrystalEye', 'DiamondHand', 'GoldenTouch', 'SilverBullet', 'BronzeBeast',
    'NightWolf', 'DayWalker', 'StarLord', 'MoonLight', 'SunTzu',
    'TigerClaw', 'DragonFist', 'EagleEye', 'SharkBite', 'WolfPack',
    'CobraKai', 'Panthera', 'Grizzly', 'FalconPunch', 'PhoenixRise'
];

// ✅ NEW: тип хода (чтобы не было "любой строкой")
type Move = 'ROCK' | 'PAPER' | 'SCISSORS';

// ✅ NEW: статус матча расширили
type MatchStatus = 'READY' | 'BOT_MATCH' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

type Ticket = {
    ticketId: string;
    userId: string;
    playersCount: number;
    stakeVp: number;
    createdAt: number; // ms
    displayName?: string; // 👤 Имя игрока
};

// ✅ UPDATED: Match теперь хранит выбывших/живых и победителя
type Match = {
    matchId: string;
    playersCount: number;
    stakeVp: number;
    potVp: number;
    feeRate: number;
    feeVp: number;
    payoutVp: number;
    settled: boolean;

    // все игроки матча (включая BOT1/BOT2/BOT3)
    playerIds: string[];

    // кто еще в игре
    aliveIds: string[];

    // кто выбыл
    eliminatedIds: string[];

    // 🎮 Никнеймы ботов (id -> nickname)
    botNames?: Record<string, string>;
    
    // 👤 Имена игроков (id -> displayName)
    playerNames?: Record<string, string>;

    // ⏱️ Таймеры
    moveDeadline?: number;        // Дедлайн для хода (timestamp)
    moveTimerStarted?: number;    // Когда запустился таймер хода
    
    createdAt: number;
    status: MatchStatus;

    round: number;

    // ходы текущего раунда
    moves: Record<string, Move>;

    lastRound?: {
        roundNo: number;
        moves: Record<string, Move>;
        outcome: 'TIE' | 'ELIMINATION';
        reason?: 'ALL_SAME' | 'ALL_THREE';
        winningMove?: Move;
        winners?: string[];
        losers?: string[];
    };
    winnerId?: string;
    finishedAt?: number;
};

@Injectable()
export class MatchmakingService {
    readonly redis: Redis;

    // Публичный метод для установки lock из gateway
    async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
        const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
        return !!result;
    }

    async releaseLock(key: string): Promise<void> {
        await this.redis.del(key);
    }

    constructor(
        private cfg: ConfigService,
        @InjectRepository(Wallet) private walletsRepo: Repository<Wallet>,
        @InjectRepository(UserStats) private userStatsRepo: Repository<UserStats>,
        private audit: AuditService,
        private house: HouseService,
        private dataSource: DataSource,
    ) {
        this.redis = new Redis({
            host: this.cfg.get<string>('REDIS_HOST') || 'localhost',
            port: Number(this.cfg.get<string>('REDIS_PORT') || 6379),
        });

        // 🆕 Автоматическая очистка зависших матчей при старте
        this.cleanupOrphanedMatches(10).then(cleaned => {
            if (cleaned > 0) {
                console.log(`[MatchmakingService] Startup cleanup: ${cleaned} orphaned matches cleaned`);
            }
        });

        // 🆕 Периодическая проверка каждые 5 минут
        setInterval(() => {
            this.cleanupOrphanedMatches(10);
        }, 5 * 60 * 1000);

        // 🆕 Проверка таймаутов очередей каждую секунду (для F5 recovery)
        setInterval(() => {
            this.processQueueTimeouts();
        }, 1000);
    }

    private server: any;
    private isShuttingDown = false;
    private activeTimers: NodeJS.Timeout[] = [];

    setServer(server: any) {
        this.server = server;
    }

    onModuleDestroy() {
        this.isShuttingDown = true;
        // Clear all active timers
        this.activeTimers.forEach(timer => clearTimeout(timer));
        this.activeTimers = [];
    }

    /**
     * Helper to schedule a timeout that can be cancelled on shutdown
     */
    private scheduleTimeout(callback: () => any, delayMs: number): void {
        if (this.isShuttingDown) return;
        const timer = setTimeout(async () => {
            // Remove from active timers
            const idx = this.activeTimers.indexOf(timer);
            if (idx > -1) this.activeTimers.splice(idx, 1);
            // Don't execute if shutting down
            if (this.isShuttingDown) return;
            await callback();
        }, delayMs);
        this.activeTimers.push(timer);
    }

    /**
     * Генерирует числовой ID для PostgreSQL Advisory Lock из userId
     */
    private getPgLockId(userId: string): number {
        // Простой hash из UUID в число (bigint range)
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            const char = userId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash) % 2147483647; // Max int32
    }

    private qKey(playersCount: number, stakeVp: number) {
        return `queue:${playersCount}:${stakeVp}`;
    }

    private ticketKey(ticketId: string) {
        return `ticket:${ticketId}`;
    }

    private matchKey(matchId: string) {
        return `match:${matchId}`;
    }

    private randomMove(): Move {
        const variants: Move[] = ['ROCK', 'PAPER', 'SCISSORS'];
        return variants[Math.floor(Math.random() * variants.length)];
    }

    private isBot(id: string) {
        return id.startsWith('BOT');
    }

    // 🎮 Получить случайные ники для ботов
    private getRandomBotNames(count: number): string[] {
        const shuffled = [...BOT_NICKNAMES].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    private async getWalletByUserId(userId: string) {
        // важно: relations: { user: true } чтобы where по user.id работал стабильно
        return this.walletsRepo.findOne({
            where: { user: { id: userId } },
            relations: { user: true },
        });
    }

    // freeze: balance -> frozen (в транзакции с блокировкой)
    private async freezeStake(userId: string, stakeVp: number) {
        return this.dataSource.transaction(async (manager) => {
            // Блокируем строку FOR UPDATE
            const w = await manager.findOne(Wallet, {
                where: { user: { id: userId } },
                relations: { user: true },
                lock: { mode: 'pessimistic_write' },
            });
            
            if (!w) throw new BadRequestException('Wallet not found');

            if (w.balanceWp < stakeVp) {
                throw new BadRequestException(`Not enough balance. Need ${stakeVp}, have ${w.balanceWp}`);
            }

            w.balanceWp -= stakeVp;
            w.frozenWp += stakeVp;
            await manager.save(w);
            
            await this.audit.log({
                eventType: 'STAKE_FROZEN',
                matchId: null,
                actorId: userId,
                payload: { reason: 'FREEZE_STAKE', amountVp: stakeVp, balanceAfter: w.balanceWp, frozenAfter: w.frozenWp },
            });
        });
    }

    // rollback freeze, если что-то пошло не так в сборке матча
    private async unfreezeStake(userId: string, stakeVp: number) {
        return this.dataSource.transaction(async (manager) => {
            const w = await manager.findOne(Wallet, {
                where: { user: { id: userId } },
                relations: { user: true },
                lock: { mode: 'pessimistic_write' },
            });
            
            if (!w) return;

            w.frozenWp = Math.max(0, w.frozenWp - stakeVp);
            w.balanceWp += stakeVp;
            await manager.save(w);
            
            await this.audit.log({
                eventType: 'STAKE_UNFROZEN',
                matchId: null,
                actorId: userId,
                payload: { reason: 'UNFREEZE_STAKE', amountVp: stakeVp, balanceAfter: w.balanceWp, frozenAfter: w.frozenWp },
            });
        });
    }

    // 🆕 Отмена матча и возврат всех замороженных средств
    private async cancelMatch(matchId: string, reason: string): Promise<void> {
        const m = await this.getMatch(matchId);
        if (!m) {
            console.log(`[cancelMatch] Match ${matchId} not found`);
            return;
        }
        
        if (m.status === 'FINISHED' || m.status === 'CANCELLED') {
            console.log(`[cancelMatch] Match ${matchId} already ${m.status}, skipping`);
            return;
        }

        console.log(`[cancelMatch] Cancelling match ${matchId}, reason: ${reason}`);

        // Возвращаем замороженные средства всем реальным игрокам
        const realPlayers = m.playerIds.filter(id => !this.isBot(id));
        
        for (const userId of realPlayers) {
            await this.dataSource.transaction(async manager => {
                const w = await manager.findOne(Wallet, { 
                    where: { user: { id: userId } }, 
                    lock: { mode: 'pessimistic_write' } 
                });
                if (!w) return;

                // Проверяем что у игрока действительно заморожены средства
                if (w.frozenWp >= m.stakeVp) {
                    w.frozenWp -= m.stakeVp;
                    w.balanceWp += m.stakeVp;
                    await manager.save(w);

                    await this.audit.log({
                        actorId: userId,
                        eventType: 'STAKE_RETURNED',
                        matchId,
                        payload: { 
                            amountVp: m.stakeVp,
                            reason: `MATCH_CANCELLED: ${reason}`,
                            stakeVp: m.stakeVp,
                            balanceAfter: w.balanceWp,
                            frozenAfter: w.frozenWp 
                        },
                    });
                    console.log(`[cancelMatch] Returned ${m.stakeVp} VP to user ${userId}`);
                } else {
                    console.log(`[cancelMatch] User ${userId} has insufficient frozen balance: ${w.frozenWp} < ${m.stakeVp}`);
                }
            });
        }

        // Обновляем статус матча
        m.status = 'CANCELLED';
        m.finishedAt = Date.now();
        await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 3600);

        // Уведомляем игроков через комнату матча
        if (this.server) {
            this.server.to(`match:${matchId}`).emit('match:cancelled', { 
                matchId, 
                reason,
                message: 'Матч отменен, средства возвращены на счет'
            });
        }

        console.log(`[cancelMatch] Match ${matchId} cancelled successfully`);
    }

    // 🆕 Периодическая очистка зависших матчей (вызывать из cron или при старте)
    async cleanupOrphanedMatches(maxAgeMinutes: number = 10): Promise<number> {
        const pattern = this.matchKey('*');
        const keys = await this.redis.keys(pattern);
        let cleaned = 0;
        const now = Date.now();
        const maxAgeMs = maxAgeMinutes * 60 * 1000;

        console.log(`[cleanupOrphanedMatches] Checking ${keys.length} matches, max age: ${maxAgeMinutes}min`);

        for (const key of keys) {
            try {
                const data = await this.redis.get(key);
                if (!data) continue;

                const m: Match = JSON.parse(data);
                
                // Пропускаем завершенные матчи
                if (m.status === 'FINISHED' || m.status === 'CANCELLED') continue;

                // Проверяем возраст матча
                const age = now - m.createdAt;
                if (age > maxAgeMs) {
                    console.log(`[cleanupOrphanedMatches] Found orphaned match: ${m.matchId}, age: ${Math.round(age/60000)}min`);
                    await this.cancelMatch(m.matchId, `Match timeout (${Math.round(age/60000)} minutes)`);
                    cleaned++;
                }
            } catch (e) {
                console.error(`[cleanupOrphanedMatches] Error processing key ${key}:`, e);
            }
        }

        console.log(`[cleanupOrphanedMatches] Cleaned ${cleaned} orphaned matches`);
        return cleaned;
    }

    /**
     * ⏱️ Обработка таймаутов очередей (каждую секунду)
     * Создаёт матч с ботами если прошло 20 секунд и не набралось достаточно игроков
     */
    async processQueueTimeouts(): Promise<void> {
        if (this.isShuttingDown) return;
        
        for (const playersCount of ALLOWED_PLAYERS) {
            for (const stakeVp of ALLOWED_STAKES) {
                const q = this.qKey(playersCount, stakeVp);
                const queueTimeKey = `queue:time:${playersCount}:${stakeVp}`;
                
                try {
                    // Проверяем есть ли игроки в очереди
                    const len = await this.redis.llen(q);
                    if (len === 0) continue;
                    
                    // Проверяем время начала очереди
                    const queueStartTime = await this.redis.get(queueTimeKey);
                    if (!queueStartTime) {
                        // Первый игрок — устанавливаем время
                        await this.redis.set(queueTimeKey, Date.now().toString());
                        continue;
                    }
                    
                    const elapsedSec = Math.floor((Date.now() - parseInt(queueStartTime)) / 1000);
                    
                    // Если прошло 20+ секунд и есть хотя бы 1 игрок — пробуем собрать матч
                    if (elapsedSec >= 20 && len >= 1) {
                        console.log(`[processQueueTimeouts] Queue ${q}: timeout (${elapsedSec}s, ${len} players), forcing match creation`);
                        await this.tryAssembleMatch(playersCount, stakeVp, true);
                    }
                } catch (e) {
                    console.error(`[processQueueTimeouts] Error processing queue ${q}:`, e);
                }
            }
        }
    }

    validateInputs(playersCount: number, stakeVp: number) {
        if (!ALLOWED_PLAYERS.has(playersCount)) {
            throw new BadRequestException('playersCount must be 2, 3, or 4');
        }
        if (!ALLOWED_STAKES.has(stakeVp)) {
            throw new BadRequestException('stakeVp must be one of: 100,200,500,1000,2500,5000,10000');
        }
    }

    private async hasExistingTicket(userId: string, playersCount: number, stakeVp: number): Promise<Ticket | null> {
        const q = this.qKey(playersCount, stakeVp);
        const ticketIds = await this.redis.lrange(q, 0, -1);
        
        for (const tid of ticketIds) {
            const t = await this.getTicket(tid);
            if (t && t.userId === userId) {
                return t;
            }
        }
        return null;
    }

    /**
     * 🔒 TC-RACE-01 FINAL FIX: Lua CAS с глобальной проверкой ВСЕХ очередей
     * 
     * Lua скрипт атомарно:
     * 1. Берет глобальный lock на userId
     * 2. Проверяет ВСЕ очереди на наличие тикета этого пользователя
     * 3. Создает тикет только если нигде нет
     */
    private readonly QUICKPLAY_CAS_SCRIPT = `
        local lockKey = KEYS[1]
        local ticketKey = KEYS[2]
        local queueKey = KEYS[3]
        local queueTimeKey = KEYS[4]
        local ticketData = ARGV[1]
        local ticketId = ARGV[2]
        local ttl = tonumber(ARGV[3])
        local now = ARGV[4]
        local userId = ARGV[5]
        
        -- 1. Атомарно берем глобальный lock на userId
        local lockSet = redis.call('set', lockKey, '1', 'EX', ttl, 'NX')
        if not lockSet then
            return {-1, 'DUPLICATE_REQUEST'}
        end
        
        -- 2. Проверяем ВСЕ возможные очереди (2,3,4,5 игроков и все ставки)
        local allowedPlayers = {2, 3, 4, 5}
        local allowedStakes = {100, 200, 500, 1000, 2500, 5000, 10000}
        
        for _, pc in ipairs(allowedPlayers) do
            for _, stake in ipairs(allowedStakes) do
                local qkey = 'queue:' .. pc .. ':' .. stake
                local tids = redis.call('lrange', qkey, 0, -1)
                for _, tid in ipairs(tids) do
                    local tdata = redis.call('get', 'ticket:' .. tid)
                    if tdata and string.find(tdata, userId, 1, true) then
                        -- Нашли тикет в другой очереди!
                        return {-2, 'ALREADY_IN_QUEUE', tid}
                    end
                end
            end
        end
        
        -- 3. Все проверки пройдены - создаем тикет
        redis.call('set', ticketKey, ticketData, 'EX', 60)
        redis.call('rpush', queueKey, ticketId)
        
        -- 4. Обновляем время очереди
        local queueStart = redis.call('get', queueTimeKey)
        if not queueStart then
            redis.call('set', queueTimeKey, now, 'EX', 300)
        end
        
        local queueLen = redis.call('llen', queueKey)
        
        -- 5. Lock оставляем на TTL (предотвращает быстрые повторы)
        return {1, 'TICKET_CREATED', ticketId, queueLen}
    `;

    async quickPlay(userId: string, playersCount: number, stakeVp: number, displayName?: string) {
        this.validateInputs(playersCount, stakeVp);

        // ✅ CHECK ONLY (не морозим тут!)
        const w = await this.getWalletByUserId(userId);
        if (!w) throw new BadRequestException('Wallet not found');
        if (w.balanceWp < stakeVp) {
            throw new BadRequestException(`Not enough balance. Need ${stakeVp}, have ${w.balanceWp}`);
        }

        // 🔒 TC-RACE-01 FINAL FIX: PostgreSQL Advisory Lock (с fallback на Redis)
        
        // Проверяем подключение к БД
        let usePostgresLock = false;
        try {
            await this.dataSource.query('SELECT 1');
            usePostgresLock = true;
        } catch (e) {
            console.log('[quickPlay] PostgreSQL not available, using Redis lock fallback');
        }
        
        if (usePostgresLock) {
            return this.quickPlayWithPgLock(userId, playersCount, stakeVp, displayName);
        } else {
            return this.quickPlayWithRedisLock(userId, playersCount, stakeVp, displayName);
        }
    }
    
    /**
     * Вспомогательный метод для broadcast
     */
    private async broadcastQueueUpdate(playersCount: number, stakeVp: number, queueLen: number, remainingSec: number, elapsedSec: number) {
        if (!this.server) return;
        
        const sockets = await this.server.fetchSockets();
        let notifiedCount = 0;
        
        for (const socket of sockets) {
            const socketUserId = socket.data?.userId || socket.handshake?.auth?.userId;
            const hasTicket = await this.hasExistingTicket(socketUserId, playersCount, stakeVp);
            
            if (hasTicket) {
                socket.emit('queue:sync', { 
                    playersFound: queueLen, 
                    totalNeeded: playersCount,
                    secondsLeft: remainingSec,
                    elapsed: elapsedSec 
                });
                notifiedCount++;
            }
        }
        
        console.log(`[quickPlay] Notified ${notifiedCount} players about queue update`);
    }
    
    /**
     * Fallback метод если Lua CAS не сработал
     */
    /**
     * 🔒 Реализация с PostgreSQL Advisory Lock (production)
     */
    private async quickPlayWithPgLock(userId: string, playersCount: number, stakeVp: number, displayName?: string) {
        const pgLockId = this.getPgLockId(userId);
        let pgLockAcquired = false;
        
        try {
            // Берем PostgreSQL Advisory Lock
            const lockResult = await this.dataSource.query(
                `SELECT pg_try_advisory_lock($1) as acquired`,
                [pgLockId]
            );
            pgLockAcquired = lockResult[0]?.acquired;
            
            if (!pgLockAcquired) {
                throw new BadRequestException('Duplicate request, please retry');
            }
            
            return await this.createTicketAfterLock(userId, playersCount, stakeVp, displayName);
            
        } finally {
            if (pgLockAcquired) {
                await this.dataSource.query(`SELECT pg_advisory_unlock($1)`, [pgLockId]).catch(() => {});
            }
        }
    }
    
    /**
     * 🔒 Реализация с Redis Lock (fallback для тестов)
     */
    private async quickPlayWithRedisLock(userId: string, playersCount: number, stakeVp: number, displayName?: string) {
        const lockKey = `lock:quickplay:${userId}`;
        const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 5, 'NX');
        
        if (!lockAcquired) {
            throw new BadRequestException('Duplicate request, please retry');
        }
        
        try {
            return await this.createTicketAfterLock(userId, playersCount, stakeVp, displayName);
        } finally {
            await this.redis.del(lockKey);
        }
    }
    
    /**
     * Создание тикета после получения lock (общая логика)
     */
    private async createTicketAfterLock(userId: string, playersCount: number, stakeVp: number, displayName?: string) {
        // Проверяем состояние
        const existingTicket = await this.hasExistingTicket(userId, playersCount, stakeVp);
        if (existingTicket) {
            return { status: 'ALREADY_IN_QUEUE', ticketId: existingTicket.ticketId, message: 'You already have a ticket in this queue' };
        }
        
        const activeState = await this.getUserActiveState(userId);
        if (activeState.inQueue) {
            return { status: 'ALREADY_IN_QUEUE', message: 'You already have a ticket in queue' };
        }
        if (activeState.activeMatch) {
            return { status: 'ALREADY_IN_MATCH', matchId: activeState.activeMatch.matchId, message: 'You already have an active match' };
        }
        
        // Создаем тикет
        const ticketId = randomUUID();
        const ticket: Ticket = {
            ticketId,
            userId,
            playersCount,
            stakeVp,
            createdAt: Date.now(),
            displayName,
        };
        
        const q = this.qKey(playersCount, stakeVp);
        await this.redis.set(this.ticketKey(ticket.ticketId), JSON.stringify(ticket), 'EX', 60);
        await this.redis.rpush(q, ticket.ticketId);
        
        // 🆕 Устанавливаем время начала очереди (для таймаута 20 сек)
        const queueTimeKey = `queue:time:${playersCount}:${stakeVp}`;
        const existingQueueTime = await this.redis.get(queueTimeKey);
        if (!existingQueueTime) {
            await this.redis.set(queueTimeKey, Date.now().toString());
        }
        
        this.scheduleTimeout(() => this.tryAssembleMatch(playersCount, stakeVp, false), 100);
        
        return { status: 'QUEUED', ticketId };
    }
    
    private async quickPlayFallback(userId: string, playersCount: number, stakeVp: number, displayName?: string) {
        console.log(`[quickPlay] Using fallback for user ${userId.slice(0,8)}`);
        
        // 🔒 Fallback: сначала проверяем любые существующие тикеты (double-check)
        const existingTicket = await this.hasExistingTicket(userId, playersCount, stakeVp);
        if (existingTicket) {
            return { status: 'ALREADY_IN_QUEUE', ticketId: existingTicket.ticketId, message: 'You already have a ticket in this queue' };
        }
        
        // Проверяем активное состояние
        const activeState = await this.getUserActiveState(userId);
        if (activeState.inQueue) {
            return { status: 'ALREADY_IN_QUEUE', message: 'You already have a ticket in queue' };
        }
        if (activeState.activeMatch) {
            return { status: 'ALREADY_IN_MATCH', matchId: activeState.activeMatch.matchId, message: 'You already have an active match' };
        }
        
        // 🔒 Только после проверок - берем lock
        const lockKey = `lock:quickplay:${userId}`;
        const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 5, 'NX');
        
        if (!lockAcquired) {
            throw new BadRequestException('Duplicate request, please retry');
        }
        
        try {
            // Ещё одна проверка под lock
            const doubleCheck = await this.hasExistingTicket(userId, playersCount, stakeVp);
            if (doubleCheck) {
                return { status: 'ALREADY_IN_QUEUE', ticketId: doubleCheck.ticketId, message: 'You already have a ticket in this queue' };
            }
            
            // Создаем тикет
            const ticket: Ticket = {
                ticketId: randomUUID(),
                userId,
                playersCount,
                stakeVp,
                createdAt: Date.now(),
                displayName,
            };
            
            const q = this.qKey(playersCount, stakeVp);
            await this.redis.set(this.ticketKey(ticket.ticketId), JSON.stringify(ticket), 'EX', 60);
            await this.redis.rpush(q, ticket.ticketId);
            
            // 🆕 Устанавливаем время начала очереди (для таймаута 20 сек)
            const queueTimeKey = `queue:time:${playersCount}:${stakeVp}`;
            const existingQueueTime = await this.redis.get(queueTimeKey);
            if (!existingQueueTime) {
                await this.redis.set(queueTimeKey, Date.now().toString());
            }
            
            console.log(`[quickPlay] User ${userId.slice(0,8)} joined queue ${q} via fallback`);
            
            this.scheduleTimeout(() => this.tryAssembleMatch(playersCount, stakeVp, false), 100);
            
            return { status: 'QUEUED', ticketId: ticket.ticketId };
        } finally {
            await this.redis.del(lockKey);
        }
    }

    async getTicket(ticketId: string) {
        const raw = await this.redis.get(this.ticketKey(ticketId));
        if (!raw) return null;
        return JSON.parse(raw) as Ticket;
    }

    async getTicketForUser(ticketId: string, userId: string) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket) {
            throw new NotFoundException('Ticket not found');
        }
        if (ticket.userId !== userId) {
            throw new NotFoundException('Ticket not found');
        }
        return ticket;
    }

    // 🔍 Найти тикет пользователя в любой очереди
    async findUserTicket(userId: string): Promise<{ ticket: Ticket; queueKey: string; playersFound: number; secondsLeft: number } | null> {
        for (const playersCount of ALLOWED_PLAYERS) {
            for (const stakeVp of ALLOWED_STAKES) {
                const q = this.qKey(playersCount, stakeVp);
                const ticketIds = await this.redis.lrange(q, 0, -1);
                
                for (const tId of ticketIds) {
                    const ticket = await this.getTicket(tId);
                    if (ticket && ticket.userId === userId) {
                        const queueTime = Math.floor((Date.now() - ticket.createdAt) / 1000);
                        const secondsLeft = Math.max(0, 20 - queueTime);
                        const playersFound = ticketIds.length;
                        return { ticket, queueKey: q, playersFound, secondsLeft };
                    }
                }
            }
        }
        return null;
    }

    async getMatch(matchId: string) {
        const raw = await this.redis.get(this.matchKey(matchId));
        if (!raw) return null;
        return JSON.parse(raw) as Match;
    }

    async getMatchOrThrow(matchId: string) {
        const match = await this.getMatch(matchId);
        if (!match) {
            throw new NotFoundException('Match not found');
        }
        return match;
    }

    // 🔄 Проверяет есть ли пользователь в очереди или активном матче
    async getUserActiveState(userId: string): Promise<{ inQueue: boolean; queueTime?: number; playersFound?: number; totalNeeded?: number; secondsLeft?: number; activeMatch?: Match }> {
        console.log(`[getUserActiveState] Checking user: ${userId.slice(0, 8)}...`);
        
        // 1. Проверяем все очереди на наличие тикета пользователя
        for (const playersCount of ALLOWED_PLAYERS) {
            for (const stakeVp of ALLOWED_STAKES) {
                const q = this.qKey(playersCount, stakeVp);
                const ticketIds = await this.redis.lrange(q, 0, -1);
                
                if (ticketIds.length > 0) {
                    console.log(`[getUserActiveState] Queue ${q}: ${ticketIds.length} tickets`);
                }
                
                for (const tId of ticketIds) {
                    const ticket = await this.getTicket(tId);
                    if (ticket && ticket.userId === userId) {
                        const now = Date.now();
                        const queueTime = Math.floor((now - ticket.createdAt) / 1000);
                        const secondsLeft = Math.max(0, 20 - queueTime);
                        const playersFound = ticketIds.length;
                        const totalNeeded = playersCount;
                        
                        console.log(`[getUserActiveState] FOUND user in queue:`);
                        console.log(`  - queueKey: ${q}`);
                        console.log(`  - playersFound: ${playersFound}/${totalNeeded}`);
                        console.log(`  - queueTime: ${queueTime}s`);
                        console.log(`  - secondsLeft: ${secondsLeft}s`);
                        
                        return { inQueue: true, queueTime, playersFound, totalNeeded, secondsLeft };
                    }
                }
            }
        }

        // 2. Проверяем активные матчи
        // Получаем все ключи матчей
        const matchKeys = await this.redis.keys('match:*');
        for (const key of matchKeys) {
            const raw = await this.redis.get(key);
            if (raw) {
                const match: Match = JSON.parse(raw);
                // Проверяем что матч активен (не FINISHED и не CANCELLED)
                if (match.playerIds?.includes(userId) && 
                    match.status !== 'FINISHED' && 
                    match.status !== 'CANCELLED') {
                    return { inQueue: false, activeMatch: match };
                }
            }
        }

        return { inQueue: false };
    }

    async getQueueLength(playersCount: number, stakeVp: number): Promise<number> {
        const q = this.qKey(playersCount, stakeVp);
        await this.cleanExpiredTicketsFromQueue(q);  // 🧹 Очищаем перед подсчётом
        return await this.redis.llen(q);
    }

    // 🧹 Удаляет истёкшие тикеты из очереди
    async cleanExpiredTicketsFromQueue(queueKey: string): Promise<number> {
        const ticketIds = await this.redis.lrange(queueKey, 0, -1);
        let removed = 0;
        for (const tId of ticketIds) {
            const exists = await this.redis.exists(this.ticketKey(tId));
            if (!exists) {
                await this.redis.lrem(queueKey, 0, tId);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[cleanExpiredTickets] Removed ${removed} expired tickets from ${queueKey}`);
        }
        
        // Если очередь пуста - сбрасываем время начала
        const remaining = await this.redis.llen(queueKey);
        if (remaining === 0) {
            const parts = queueKey.split(':');
            if (parts.length >= 3) {
                const queueTimeKey = `queue:time:${parts[2]}:${parts[3] || '100'}`;
                await this.redis.del(queueTimeKey);
                console.log(`[cleanExpiredTickets] Reset queueTimeKey for empty queue`);
            }
        }
        
        return removed;
    }

    async tryAssembleMatch(playersCount: number, stakeVp: number, force: boolean = false) {
        const q = this.qKey(playersCount, stakeVp);
        const queueTimeKey = `queue:time:${playersCount}:${stakeVp}`;
        const lockKey = `queue:lock:${playersCount}:${stakeVp}`;

        // 🛡️ Защита от двойного создания матча (race condition)
        const lock = await this.redis.set(lockKey, '1', 'EX', 5, 'NX');
        if (!lock) {
            console.log(`[tryAssembleMatch] Lock exists, skipping duplicate`);
            return null;
        }

        try {
        // 🧹 Очищаем очередь от истёкших тикетов
        await this.cleanExpiredTicketsFromQueue(q);

        const len = await this.redis.llen(q);
        console.log(`[tryAssembleMatch] Queue ${q}: ${len} players`);
        
        // 🧹 Если очередь пуста - сбрасываем время начала очереди
        if (len === 0) {
            await this.redis.del(queueTimeKey);
            console.log(`[tryAssembleMatch] Queue empty, reset queueTime`);
            return null;
        }
        
        // ✅ Если меньше 2 реальных игроков - не собираем матч (ждем еще)
        if (len < 2) {
            console.log(`[tryAssembleMatch] Not enough players (${len}), waiting...`);
            return null;
        }
        
        // ✅ Проверяем условия для создания матча:
        // 1. Прошло 20 секунд с начала очереди (force из fallback)
        // 2. Или набралось 5 игроков (полная команда)
        const queueStartTime = await this.redis.get(queueTimeKey);
        let elapsedSec = queueStartTime ? Math.floor((Date.now() - parseInt(queueStartTime)) / 1000) : 0;
        
        // 🛡️ Защита от "застрявшего" времени (если прошло больше часа - сбрасываем)
        if (elapsedSec > 3600) {
            console.log(`[tryAssembleMatch] Stale queueTime detected (${elapsedSec}s), resetting`);
            await this.redis.set(queueTimeKey, Date.now().toString());
            elapsedSec = 0;
        }
        
        const isTimeUp = elapsedSec >= 20;
        const isFull = len >= playersCount;
        
        if (!force && !isTimeUp && !isFull) {
            console.log(`[tryAssembleMatch] Waiting... ${len}/5 players, ${elapsedSec}/20 sec`);
            return null;
        }
        
        console.log(`[tryAssembleMatch] Creating match! ${len} players, time: ${elapsedSec}s, force: ${force}`);

        // ✅ Берем всех из очереди (но не более playersCount)
        const takeCount = Math.min(len, playersCount);
        
        const ticketIds: string[] = [];
        for (let i = 0; i < takeCount; i++) {
            const id = await this.redis.lpop(q);
            if (id) ticketIds.push(id);
        }

        if (ticketIds.length < 1) {
            // Нет игроков - ничего не делаем
            return null;
        }
        
        // ✅ Есть хотя бы 1 игрок - собираем матч (добавим ботов до нужного количества)

        const tickets: Ticket[] = [];
        const seenUserIds = new Set<string>();
        const expiredIds: string[] = [];
        
        for (const tId of ticketIds) {
            const t = await this.getTicket(tId);
            if (!t) {
                // тикет истёк - удаляем его из очереди и продолжаем
                console.log(`[tryAssembleMatch] Ticket ${tId.slice(0,8)} expired, skipping`);
                expiredIds.push(tId);
                continue;
            }
            // ✅ Проверяем что один игрок не попал дважды
            if (seenUserIds.has(t.userId)) {
                // Дубликат! Удаляем дубликат
                console.log(`[tryAssembleMatch] Duplicate ticket for user ${t.userId.slice(0,8)}, deleting`);
                await this.redis.del(this.ticketKey(t.ticketId));
                continue;
            }
            seenUserIds.add(t.userId);
            tickets.push(t);
        }
        
        // Если не набралось минимум 1 валидного тикета - отменяем
        if (tickets.length < 1) {
            console.log(`[tryAssembleMatch] No valid tickets, aborting`);
            return null;
        }
        
        // Если только 1 игрок и не force-режим - возвращаем в очередь
        if (tickets.length < 2 && !force) {
            console.log(`[tryAssembleMatch] Only ${tickets.length} valid tickets (need 2+ or force=true), returning to queue`);
            const validIds = tickets.map(t => t.ticketId);
            await this.redis.lpush(q, ...validIds.reverse());
            return null;
        }

        const playerIds = tickets.map(t => t.userId);

        // ✅ freeze для всех реальных (здесь все реальные, ботов нет)
        const frozen: string[] = [];
        try {
            for (const uid of playerIds) {
                await this.freezeStake(uid, stakeVp);
                frozen.push(uid);
            }
        } catch (e) {
            // rollback тем, кого уже успели заморозить
            for (const uid of frozen) {
                await this.unfreezeStake(uid, stakeVp);
            }

            // важное решение MVP:
            // - проблемные тикеты удаляем
            // - остальные возвращаем в очередь
            // чтобы очередь не ломалась
            for (const t of tickets) {
                await this.redis.del(this.ticketKey(t.ticketId));
            }
            return null;
        }

        // ✅ теперь можно удалять тикеты (успешно собрали матч)
        for (const t of tickets) {
            await this.redis.del(this.ticketKey(t.ticketId));
        }


        // ✅ Добавляем ботов если реальных игроков меньше нужного
        const botsNeeded = playersCount - playerIds.length;
        const botIds: string[] = [];
        for (let i = 0; i < botsNeeded; i++) {
            botIds.push(`BOT${i + 1}`);
        }
        playerIds.push(...botIds);

        // ✅ UPDATED: добавили aliveIds/eliminatedIds/moves
        const potVp = stakeVp * playersCount;
        const feeRate = 0.05;
        const feeVp = Math.floor((potVp * 5) / 100);
        const payoutVp = potVp - feeVp;

        // 👤 Собираем имена игроков из тикетов
        const playerNames: Record<string, string> = {};
        for (const t of tickets) {
            if (t.displayName) {
                playerNames[t.userId] = t.displayName;
            }
        }

        const match: Match = {
            matchId: randomUUID(),
            playersCount,
            stakeVp,
            potVp,
            feeRate,
            feeVp,
            settled: false,
            payoutVp,
            playerIds,
            aliveIds: [...playerIds],  // теперь включает и ботов
            eliminatedIds: [],
            playerNames,  // 👤 Добавляем имена игроков
            createdAt: Date.now(),
            status: 'READY',
            round: 1,
            moves: {} as Record<string, Move>,
        };

        await this.redis.set(this.matchKey(match.matchId), JSON.stringify(match), 'EX', 600);

        await this.audit.log({
            eventType: 'MATCH_CREATED',
            matchId: match.matchId,
            actorId: 'SYSTEM',
            payload: {
                playersCount: match.playersCount,
                stakeVp: match.stakeVp,
                potVp: match.potVp,
                feeVp: match.feeVp,
                payoutVp: match.payoutVp,
                mode: match.stakeVp === 0 ? 'PRACTICE' : 'REAL',
                playerIds: match.playerIds,
            },
        });
        
        // ✅ Добавляем игроков в комнату матча и отправляем события ВСЕМ игрокам
        if (this.server) {
            const matchRoom = `match:${match.matchId}`;
            const realPlayerIds = match.playerIds.filter(pid => !pid.startsWith('BOT'));
            
            for (const pid of realPlayerIds) {
                const sockets = await this.server.fetchSockets();
                const playerSocket = sockets.find(s => s.data?.userId === pid || s.handshake?.auth?.userId === pid);
                if (playerSocket) {
                    playerSocket.join(matchRoom);
                    // 1. Отправляем match:ready
                    playerSocket.emit('match:ready', { matchId: match.matchId });
                    // 2. Отправляем match:found с отсчётом
                    playerSocket.emit('match:found', { matchId: match.matchId, countdown: 5, mode: 'PVP' });
                }
            }
            console.log(`[tryAssembleMatch] Match ${match.matchId.slice(0,8)} created, notified ${realPlayerIds.length} players`);
            
            // Отправляем отсчёт 5-4-3-2-1 всем в комнате
            for (let i = 5; i >= 1; i--) {
                this.scheduleTimeout(() => {
                    if (this.server) {
                        this.server.to(matchRoom).emit('match:countdown', { seconds: i });
                    }
                }, (5 - i) * 1000);
            }
            
            // 3. Отправляем match:start сразу после отсчёта (5 сек)
            this.scheduleTimeout(async () => {
                // 🛡️ Lock на время старта матча
                const startLockKey = `match:startlock:${match.matchId}`;
                const startLock = await this.redis.set(startLockKey, '1', 'EX', 10, 'NX');
                if (!startLock) {
                    console.log(`[SERVER] Match ${match.matchId.slice(0,8)} start already in progress, skipping duplicate`);
                    return;
                }
                
                try {
                    console.log(`[SERVER] === MATCH STARTING: ${match.matchId.slice(0,8)} ===`);
                    
                    // Сначала запускаем таймер (устанавливает moveDeadline в матч и отправляет match:timer)
                    console.log(`[SERVER] Calling startMoveTimer for ${match.matchId.slice(0,8)}`);
                    await this.startMoveTimer(match.matchId, 12);
                    
                    // Получаем обновлённый матч с moveDeadline
                    const m = await this.getMatch(match.matchId);
                    
                    // 🛡️ Проверяем что таймер действительно установился
                    if (!m?.moveDeadline) {
                        console.log(`[SERVER] No deadline after startMoveTimer, skipping emit`);
                        return;
                    }
                    
                    if (m && this.server) {
                        console.log(`[SERVER] Emitting match:start + match:update for ${match.matchId.slice(0,8)}`);
                        const matchWithDeadline = { ...m, deadline: m.moveDeadline };
                        this.server.to(matchRoom).emit('match:start', matchWithDeadline);
                        this.server.to(matchRoom).emit('match:update', matchWithDeadline);
                        // match:timer уже отправлен в startMoveTimer!
                        console.log(`[SERVER] === MATCH STARTED: ${match.matchId.slice(0,8)} ===`);
                    }
                } finally {
                    await this.redis.del(startLockKey);
                }
            }, 5000);
        }

        // Удаляем ключ времени очереди (матч создан)
        await this.redis.del(queueTimeKey);
        
        return match.matchId;
        } finally {
            // 🛡️ Снимаем lock
            await this.redis.del(lockKey);
        }
    }

    // Fallback: если тикет висит >BOT_TIMEOUT_SEC — создаём BOT_MATCH
    async fallbackToBotIfTimedOut(ticketId: string) {
        const BOT_TIMEOUT_SEC = 30;

        const t = await this.getTicket(ticketId);
        if (!t) {
            console.log(`[fallback] Ticket ${ticketId} not found - match may already be created`);
            return { status: 'ALREADY_IN_MATCH' };
        }

        const ageSec = (Date.now() - t.createdAt) / 1000;
        
        // ⏱️ Ждём пока не пройдёт 20 секунд с момента создания тикета
        if (ageSec < 20) {
            const msLeft = Math.ceil((20 - ageSec) * 1000);
            console.log(`[fallback] Waiting ${msLeft}ms for 20sec threshold...`);
            await new Promise(r => setTimeout(r, msLeft));
            return this.fallbackToBotIfTimedOut(ticketId);
        }
        
        // ✅ После 20 сек пробуем собрать PvP матч (force=true позволяет создать с < 5 игроками)
        console.log(`[fallback] Trying to assemble PvP match after 20sec...`);
        const pvpMatchId = await this.tryAssembleMatch(t.playersCount, t.stakeVp, true);
        if (pvpMatchId) {
            console.log(`[fallback] PvP match created: ${pvpMatchId.slice(0,8)}`);
            await this.redis.del(this.ticketKey(ticketId));
            return { status: 'MATCH_READY', matchId: pvpMatchId };
        }
        
        // ❌ Не собрался PvP - сразу создаём матч с ботами (не ждём больше)
        console.log(`[fallback] No PvP match after 20sec, creating bot match...`);

        // --- готовим расчёты ---
        const stake = t.stakeVp;
        const requiredHouse = stake * (t.playersCount - 1);

        const potVp = stake * t.playersCount;
        const feeRate = 0.05;
        const feeVp = Math.floor((potVp * 5) / 100);
        const payoutVp = potVp - feeVp;

        // --- решаем: REAL или PRACTICE ---
        const houseId = this.house.getHouseId();
        let practice = false;

        if (!houseId) {
            practice = true;
        } else {
            const houseWallet = await this.house.getHouseWallet();
            // House должен иметь банк >= requiredHouse (ставки ботов), т.к. мы морозим stake*(playersCount-1)
            if (!houseWallet || houseWallet.balanceWp < requiredHouse) {
                practice = true;
            }
        }

        // --- если PRACTICE: ничего не морозим ---
        if (practice) {
            await this.redis.del(this.ticketKey(ticketId));

            const botNames = this.getRandomBotNames(t.playersCount - 1);
            const bots = botNames.map((name, i) => `BOT${i + 1}`);
            const allPlayers = [t.userId, ...bots];

            const match: Match = {
                matchId: randomUUID(),
                playersCount: t.playersCount,
                stakeVp: 0,
                potVp: 0,
                feeRate: 0,
                feeVp: 0,
                settled: true,
                payoutVp: 0,
                playerIds: allPlayers,
                aliveIds: [...allPlayers],
                eliminatedIds: [],
                createdAt: Date.now(),
                status: 'BOT_MATCH',
                round: 1,
                moves: {} as Record<string, Move>,
                botNames: bots.reduce((acc, botId, i) => ({ ...acc, [botId]: botNames[i] }), {}),
                playerNames: t.displayName ? { [t.userId]: t.displayName } : {},  // 👤 Имя игрока
            };

            await this.redis.set(this.matchKey(match.matchId), JSON.stringify(match), 'EX', 600);

            await this.audit.log({
                eventType: 'MATCH_CREATED',
                matchId: match.matchId,
                actorId: 'SYSTEM',
                payload: {
                    playersCount: match.playersCount,
                    stakeVp: match.stakeVp,
                    potVp: match.potVp,
                    feeVp: match.feeVp,
                    payoutVp: match.payoutVp,
                    mode: 'PRACTICE',
                    playerIds: match.playerIds,
                },
            });

            return { status: 'BOT_MATCH_READY', matchId: match.matchId };
        }

        // --- REAL: морозим stake игрока + морозим payout у HOUSE (банк под выплату) ---

        try {
            await this.freezeStake(t.userId, stake);
            await this.freezeStake(houseId, requiredHouse);
        }
        catch (e) {
            // если успели заморозить игрока, а house не смог — откатим игрока
            await this.unfreezeStake(t.userId, stake);
            // важно: возвращаем ticket в очередь, чтобы игрок мог попробовать снова
            await this.redis.rpush(this.qKey(t.playersCount, t.stakeVp), ticketId);
            throw e;
        }

        // удаляем ticket ТОЛЬКО после успешного freeze
        await this.redis.del(this.ticketKey(ticketId));

        const botNames = this.getRandomBotNames(t.playersCount - 1);
        const bots = botNames.map((name, i) => `BOT${i + 1}`);
        const allPlayers = [t.userId, ...bots];

        const match: Match = {
            matchId: randomUUID(),
            playersCount: t.playersCount,
            stakeVp: stake,
            potVp,
            feeRate,
            feeVp,
            settled: false,
            payoutVp,
            playerIds: allPlayers,
            aliveIds: [...allPlayers],
            eliminatedIds: [],
            createdAt: Date.now(),
            status: 'BOT_MATCH',
            round: 1,
            moves: {} as Record<string, Move>,
            botNames: bots.reduce((acc, botId, i) => ({ ...acc, [botId]: botNames[i] }), {}),
            playerNames: t.displayName ? { [t.userId]: t.displayName } : {},  // 👤 Имя игрока
        };

        await this.redis.set(this.matchKey(match.matchId), JSON.stringify(match), 'EX', 600);

        await this.audit.log({
            eventType: 'MATCH_CREATED',
            matchId: match.matchId,
            actorId: 'SYSTEM',
            payload: {
                playersCount: match.playersCount,
                stakeVp: match.stakeVp,
                potVp: match.potVp,
                feeVp: match.feeVp,
                payoutVp: match.payoutVp,
                mode: 'REAL',
                playerIds: match.playerIds,
            },
        });

        return { status: 'BOT_MATCH_READY', matchId: match.matchId };
    }

    private async settleIfFinished(m: any) {
        if (this.isShuttingDown) return m;
        if (m.status !== 'FINISHED') return m;
        
        // ⚠️ Перезагружаем из Redis чтобы проверить, не был ли уже settlement
        const currentM = await this.getMatch(m.matchId);
        if (currentM?.settled) {
            console.log(`[settleIfFinished] Match ${m.matchId} already settled, skipping`);
            return currentM;
        }
        
        if (m.settled) return m;

        const houseId = this.house.getHouseId();

        const hasBots = (m.playerIds || []).some((id: string) => this.isBot(id));
        const realPlayers = (m.playerIds || []).filter((id: string) => !this.isBot(id));

        // 1) Списываем frozen у реальных игроков (они уже оплатили stake при freeze)
        for (const uid of realPlayers) {
            const w = await this.getWalletByUserId(uid);
            if (w) {
                w.frozenWp = Math.max(0, w.frozenWp - m.stakeVp);
                await this.walletsRepo.save(w);

                await this.audit.log({
                    eventType: 'STAKE_CONSUMED',
                    matchId: m.matchId,
                    actorId: uid,
                    payload: { stakeVp: m.stakeVp, frozenAfter: w.frozenWp },
                });
            }
        }

        // 2) Если есть боты — списываем frozen у HOUSE за ботов
        // (мы морозили: stake * (playersCount - 1))
        if (hasBots && houseId && m.stakeVp > 0) {
            const requiredHouse = m.stakeVp * (m.playersCount - 1);

            const hw = await this.getWalletByUserId(houseId);
            if (hw) {
                hw.frozenWp = Math.max(0, hw.frozenWp - requiredHouse);
                await this.walletsRepo.save(hw);

                await this.audit.log({
                    eventType: 'HOUSE_STAKE_CONSUMED',
                    matchId: m.matchId,
                    actorId: houseId,
                    payload: { requiredHouse, frozenAfter: hw.frozenWp },
                });
            }
        }

        // 3) Выплата победителю (payout)
        if (m.winnerId) {
            if (!this.isBot(m.winnerId)) {
                // победил человек
                const w = await this.getWalletByUserId(m.winnerId);
                if (w) {
                    w.balanceWp += m.payoutVp;
                    await this.walletsRepo.save(w);

                    await this.audit.log({
                        eventType: 'PAYOUT_APPLIED',
                        matchId: m.matchId,
                        actorId: m.winnerId,
                        payload: { payoutVp: m.payoutVp, balanceAfter: w.balanceWp },
                    });
                }
            } else {
                // победил бот — payout уходит HOUSE
                if (houseId && m.payoutVp > 0) {
                    const hw = await this.getWalletByUserId(houseId);
                    if (hw) {
                        hw.balanceWp += m.payoutVp;
                        await this.walletsRepo.save(hw);

                        await this.audit.log({
                            eventType: 'HOUSE_PAYOUT_WON',
                            matchId: m.matchId,
                            actorId: houseId,
                            payload: { payoutVp: m.payoutVp, balanceAfter: hw.balanceWp },
                        });
                    }
                }
            }
        }

        // 4) feeVp — доход платформы (HOUSE)
        if (houseId && m.feeVp > 0) {
            const hw = await this.getWalletByUserId(houseId);
            if (hw) {
                hw.balanceWp += m.feeVp;
                await this.walletsRepo.save(hw);

                await this.audit.log({
                    eventType: 'FEE_COLLECTED',
                    matchId: m.matchId,
                    actorId: houseId,
                    payload: { feeVp: m.feeVp, balanceAfter: hw.balanceWp },
                });
            }
        }

        m.settled = true;

        await this.audit.log({
            eventType: 'SETTLED',
            matchId: m.matchId,
            actorId: 'SYSTEM',
            payload: {
                winnerId: m.winnerId,
                stakeVp: m.stakeVp,
                potVp: m.potVp,
                feeVp: m.feeVp,
                payoutVp: m.payoutVp,
                hasBots,
            },
        });

        // 📊 Обновляем статистику игроков
        console.log(`[settleIfFinished] Updating stats for ${realPlayers.length} players...`);
        for (const uid of realPlayers) {
            await this.updatePlayerStats(uid, m);
        }
        console.log(`[settleIfFinished] Stats updated`);

        return m;
    }

    // 📊 Обновление статистики игрока
    private async updatePlayerStats(userId: string, m: any) {
        const start = Date.now();
        
        // 🛡️ Защита от дублей: не обновляем статистику если матч отменен или тестовый
        if (m.status === 'CANCELLED' || m.stakeVp === 0) {
            console.log(`[updatePlayerStats] Skipping stats for user ${userId} - match ${m.matchId} is ${m.status || 'practice'}`);
            return;
        }
        
        const isWinner = m.winnerId === userId;
        
        // Находим или создаём запись статистики
        let stats = await this.userStatsRepo.findOne({ where: { userId } });
        if (!stats) {
            stats = this.userStatsRepo.create({ 
                userId,
                totalMatches: 0,
                wins: 0,
                losses: 0,
                totalWonVp: 0,
                totalLostVp: 0,
                totalStakedVp: 0,
                biggestWinVp: 0,
                biggestStakeVp: 0,
                winStreak: 0,
                maxWinStreak: 0,
            });
        }

        // Обновляем общую статистику
        stats.totalMatches += 1;
        stats.totalStakedVp += m.stakeVp;
        
        if (isWinner) {
            stats.wins += 1;
            stats.totalWonVp += m.payoutVp;
            stats.winStreak += 1;
            if (stats.winStreak > stats.maxWinStreak) {
                stats.maxWinStreak = stats.winStreak;
            }
            if (m.payoutVp > stats.biggestWinVp) {
                stats.biggestWinVp = m.payoutVp;
            }
        } else {
            stats.losses += 1;
            stats.totalLostVp += m.stakeVp;
            stats.winStreak = 0;
        }

        if (m.stakeVp > stats.biggestStakeVp) {
            stats.biggestStakeVp = m.stakeVp;
        }

        // ✅ Используем upsert чтобы избежать duplicate key error
        await this.userStatsRepo.upsert(stats, ['userId']);
        console.log(`[updatePlayerStats] ${userId} done in ${Date.now() - start}ms`);
    }

    async getAudit(matchId: string) {
        return this.audit.getByMatch(matchId);
    }


    private resolveRoundPure(m: any) {
        // ожидаем, что m.moves заполнены для всех m.aliveIds
        const unique = new Set(Object.values(m.moves));

        // ничья: все одинаково или все три
        if (unique.size === 1 || unique.size === 3) {
            m.lastRound = {
                roundNo: m.round,
                moves: { ...m.moves },
                outcome: 'TIE',
                reason: unique.size === 1 ? 'ALL_SAME' : 'ALL_THREE',
            };
            m.round += 1;
            m.moves = {};
            return;
        }

        // elimination
        const beats: Record<'ROCK' | 'PAPER' | 'SCISSORS', 'ROCK' | 'PAPER' | 'SCISSORS'> = {
            ROCK: 'SCISSORS',
            SCISSORS: 'PAPER',
            PAPER: 'ROCK',
        };

        const [a, b] = Array.from(unique) as any[];
        const winningMove = beats[a] === b ? a : b;

        const winners = Object.entries(m.moves)
            .filter(([, mv]) => mv === winningMove)
            .map(([id]) => id);

        const losers = m.aliveIds.filter((id: string) => !winners.includes(id));

        m.lastRound = {
            roundNo: m.round,
            moves: { ...m.moves },
            outcome: 'ELIMINATION',
            winningMove,
            winners,
            losers,
        };

        m.eliminatedIds.push(...losers);
        m.aliveIds = m.aliveIds.filter((id: string) => winners.includes(id));

        if (m.aliveIds.length === 1) {
            m.status = 'FINISHED';
            m.winnerId = m.aliveIds[0];
            m.finishedAt = Date.now();
            m.moves = {};
            return;
        }

        m.round += 1;
        m.moves = {};
    }

    private autoplayBotsUntilFinished(m: any) {
        // Устаревший метод — теперь используем processSingleBotRound с задержкой в Gateway
        // Оставляем для совместимости, но не используем в новом коде
        let guard = 0;

        while (m.status !== 'FINISHED' && m.aliveIds.length > 0 && m.aliveIds.every((id) => this.isBot(id))) {
            guard += 1;
            if (guard > 50) break; // safety

            // боты выбирают ходы
            m.moves = {};
            for (const id of m.aliveIds) {
                m.moves[id] = this.randomMove();
            }

            this.resolveRoundPure(m);
            
            // 🏆 Если остался 1 игрок - матч завершается
            if (m.aliveIds.length === 1 && m.status !== 'FINISHED') {
                m.status = 'FINISHED';
                m.winnerId = m.aliveIds[0];
                m.finishedAt = Date.now();
            }
        }
    }

    // ✅ NEW: Обрабатывает один раунд ботов и возвращает обновлённый матч
    async processSingleBotRound(matchId: string): Promise<any> {
        const m = await this.getMatch(matchId);
        if (!m) return null;
        
        // Проверяем, что матч ещё активен
        if (m.status === 'FINISHED' || m.aliveIds.length <= 1) {
            return m;
        }
        
        // Проверяем, что все оставшиеся — боты
        if (!m.aliveIds.every((id: string) => this.isBot(id))) {
            return m;
        }

        // Боты делают ходы
        m.moves = {};
        for (const id of m.aliveIds) {
            m.moves[id] = this.randomMove();
        }

        // Резолвим раунд
        this.resolveRoundPure(m);
        
        // 🏆 Если остался 1 игрок - матч завершается
        if (m.aliveIds.length === 1) {
            m.status = 'FINISHED';
            m.winnerId = m.aliveIds[0];
            m.finishedAt = Date.now();
            await this.settleIfFinished(m);
            console.log(`[processSingleBotRound] Match finished - winner: ${m.winnerId}`);
        }

        // Сохраняем в Redis
        await this.redis.set(this.matchKey(matchId), JSON.stringify(m), 'EX', 600);

        // Логируем
        if (m.lastRound) {
            await this.audit.log({
                eventType: 'ROUND_RESOLVED',
                matchId: m.matchId,
                actorId: 'SYSTEM',
                roundNo: m.lastRound.roundNo,
                payload: m.lastRound,
            });
        }

        // Если матч закончился — логируем финиш
        // @ts-ignore - статус мог измениться после resolveRoundPure
        if (m.status === 'FINISHED' && m.winnerId) {
            await this.settleIfFinished(m);
            
            await this.audit.log({
                eventType: 'MATCH_FINISHED',
                matchId: m.matchId,
                actorId: 'SYSTEM',
                payload: {
                    winnerId: m.winnerId,
                    potVp: m.potVp,
                    feeVp: m.feeVp,
                    payoutVp: m.payoutVp,
                    stakeVp: m.stakeVp,
                    settled: m.settled,
                },
            });
        }

        return m;
    }

    // ✅ UPDATED: submitMove теперь делает выбывание 2/3/4 до 1 победителя
    async submitMove(matchId: string, userId: string, move: Move) {
        const start = Date.now();
        console.log(`[submitMove] START ${matchId} ${userId} ${move}`);
        
        const m = await this.getMatch(matchId);
        console.log(`[submitMove] getMatch: ${Date.now() - start}ms`);
        if (!m) throw new BadRequestException('Match not found');

        // Check if match is already finished
        if (m.status === 'FINISHED') {
            throw new BadRequestException('Match is already finished');
        }

        // Проверка: является ли пользователь участником матча
        if (!m.playerIds.includes(userId)) {
            throw new BadRequestException('You are not a player in this match');
        }

        // Проверка: не выбыл ли уже
        console.log(`[submitMove] Check elimination: userId=${userId}, aliveIds=${JSON.stringify(m.aliveIds)}, includes=${m.aliveIds.includes(userId)}`);
        if (!m.aliveIds.includes(userId)) {
            console.log(`[submitMove] REJECTED: ${userId} is eliminated`);
            throw new BadRequestException('You are eliminated from this match');
        }

        // нельзя перезаписать ход в этом раунде
        if (m.moves?.[userId]) {
            throw new BadRequestException('You already made your move this round');
        }

        m.status = 'IN_PROGRESS';
        m.moves = m.moves || {};
        m.moves[userId] = move;

        await this.audit.log({
            eventType: 'MOVE_SUBMITTED',
            matchId: m.matchId,
            actorId: userId,
            roundNo: m.round,
            payload: { move },
        });

        // ✅ NEW: автоходы для всех ботов (чтобы руками не слать BOT move)
        for (const id of m.aliveIds) {
            if (id.startsWith('BOT') && !m.moves[id]) {
                m.moves[id] = this.randomMove();
            }
        }
        console.log(`[submitMove] bot moves: ${Date.now() - start}ms`);


        // если ещё не все живые походили — сохраняем и выходим
        const allMoved = m.aliveIds.every((id) => !!m.moves[id]);
        console.log(`[submitMove] allMoved=${allMoved}: ${Date.now() - start}ms`);
        if (!allMoved) {
            await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
            console.log(`[submitMove] saved (not all): ${Date.now() - start}ms`);
            return m;
        }

        // ⚠️ Только ходы живых игроков!
        const snapshotMoves: Record<string, Move> = {};
        for (const id of m.aliveIds) {
            if (m.moves[id]) {
                snapshotMoves[id] = m.moves[id];
            }
        }

        // --- Решаем раунд ---
        const unique = new Set(Object.values(snapshotMoves));

        // Ничья: все одинаково ИЛИ присутствуют все три (R,P,S)
        if (unique.size === 1 || unique.size === 3) {
            m.lastRound = {
                roundNo: m.round,
                moves: snapshotMoves,
                outcome: 'TIE',
                reason: unique.size === 1 ? 'ALL_SAME' : 'ALL_THREE',
            };

            await this.audit.log({
                eventType: 'ROUND_RESOLVED',
                matchId: m.matchId,
                actorId: 'SYSTEM',
                roundNo: m.lastRound.roundNo,
                payload: m.lastRound,
            });

            // 🏆 Если остался 1 игрок - матч завершается
            if (m.aliveIds.length === 1) {
                m.status = 'FINISHED';
                m.winnerId = m.aliveIds[0];
                m.finishedAt = Date.now();
                await this.settleIfFinished(m);
                await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
                console.log(`[submitMove] Match finished (single player tie) - winner: ${m.winnerId}`);
                return m;
            }
            
            m.round += 1;
            m.moves = {};
            m.moveDeadline = undefined; // ⏱️ Сбрасываем старый дедлайн для нового раунда
            console.log(`[submitMove] TIE resolved: ${Date.now() - start}ms`);

            // ✅ Сначала сохраняем в Redis
            await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);

            // 🤖 Если остались только боты - запускаем их игру
            const hasRealPlayers = m.aliveIds.some((id: string) => !id.startsWith('BOT'));
            if (!hasRealPlayers && this.server) {
                console.log(`[submitMove] Only bots left after tie, triggering bot rounds`);
                this.scheduleTimeout(() => {
                    this.processBotRounds(m.matchId);
                }, 1500);
            } else if (hasRealPlayers) {
                // ⏱️ Запускаем таймер для следующего раунда (есть реальные игроки)
                console.log(`[submitMove] Starting timer for round ${m.round} after tie`);
                await this.startMoveTimer(m.matchId, 12);
            }

            if (m.winnerId) {
                await this.settleIfFinished(m);
                await this.audit.log({
                    eventType: 'MATCH_FINISHED',
                    matchId: m.matchId,
                    actorId: 'SYSTEM',
                    payload: {
                        winnerId: m.winnerId,
                        potVp: m.potVp,
                        feeVp: m.feeVp,
                        payoutVp: m.payoutVp,
                        stakeVp: m.stakeVp,
                        settled: m.settled,
                    },
                });
            }

            return m;
        }

        // unique.size === 2 => есть проигравшие
        const beats: Record<Move, Move> = {
            ROCK: 'SCISSORS',
            SCISSORS: 'PAPER',
            PAPER: 'ROCK',
        };

        const [a, b] = Array.from(unique) as Move[];
        const winningMove = beats[a] === b ? a : b;

        const winners = Object.entries(m.moves)
            .filter(([, mv]) => mv === winningMove)
            .map(([id]) => id);

        const losers = m.aliveIds.filter((id) => !winners.includes(id));

        m.lastRound = {
            roundNo: m.round,
            moves: snapshotMoves,
            outcome: 'ELIMINATION',
            winningMove,
            winners,
            losers,
        };

        await this.audit.log({
            eventType: 'ROUND_RESOLVED',
            matchId: m.matchId,
            actorId: 'SYSTEM',
            roundNo: m.lastRound.roundNo,
            payload: m.lastRound,
        });

        // выбывают losers
        m.eliminatedIds.push(...losers);
        m.aliveIds = m.aliveIds.filter((id) => winners.includes(id));
        console.log(`[submitMove] ELIMINATION resolved, alive=${m.aliveIds.length}: ${Date.now() - start}ms`);

        // победитель найден
        if (m.aliveIds.length === 1) {
            m.status = 'FINISHED';
            m.winnerId = m.aliveIds[0];
            m.finishedAt = Date.now();
            m.moves = {};

            // ✅ ВОТ ЭТО ШАГ 3.4 — выполняем экономику
            await this.settleIfFinished(m);

            await this.audit.log({
                eventType: 'MATCH_FINISHED',
                matchId: m.matchId,
                actorId: 'SYSTEM',
                payload: {
                    winnerId: m.winnerId,
                    potVp: m.potVp,
                    feeVp: m.feeVp,
                    payoutVp: m.payoutVp,
                    stakeVp: m.stakeVp,
                    settled: m.settled,
                },
            });

            // сохраняем матч уже с settled=true
            await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
            return m;
        }

        // игра продолжается
        m.round += 1;
        m.moves = {};
        m.moveDeadline = undefined; // ⏱️ Сбрасываем старый дедлайн для нового раунда

        // ✅ Сохраняем в Redis
        await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);

        // 🤖 Если остались только боты - запускаем их игру
        const hasRealPlayers = m.aliveIds.some((id: string) => !id.startsWith('BOT'));
        if (!hasRealPlayers && this.server) {
            console.log(`[submitMove] Only bots left after elimination, triggering bot rounds`);
            this.scheduleTimeout(() => {
                this.processBotRounds(m.matchId);
            }, 1500);
        } else if (hasRealPlayers) {
            // ⏱️ Запускаем таймер для следующего раунда (есть реальные игроки)
            console.log(`[submitMove] Starting timer for round ${m.round} after elimination`);
            await this.startMoveTimer(m.matchId, 12);
        }

        console.log(`[submitMove] END: ${Date.now() - start}ms`);
        return m;
    }

    // ⏱️ Запускает таймер хода (12 секунд)
    async startMoveTimer(matchId: string, seconds: number) {
        const m = await this.getMatch(matchId);
        if (!m || m.status === 'FINISHED') return;
        
        // Если остались только боты - не запускаем таймер
        const hasRealPlayers = m.aliveIds.some((id: string) => !id.startsWith('BOT'));
        if (!hasRealPlayers) {
            console.log(`[startMoveTimer] Only bots left, skipping timer`);
            return;
        }

        // 🛡️ Защита от дублирования через Redis lock
        const timerLockKey = `timerlock:${matchId}:${m.round}`;
        const lock = await this.redis.set(timerLockKey, '1', 'EX', 10, 'NX');
        if (!lock) {
            console.log(`[SERVER startMoveTimer] Lock exists for round ${m.round}, skipping duplicate`);
            return;
        }

        // 🛡️ Дополнительная проверка: свежие данные из Redis
        const freshM = await this.getMatch(matchId);
        console.log(`[SERVER startMoveTimer] freshM.moveDeadline=${freshM?.moveDeadline}, now=${Date.now()}, diff=${freshM?.moveDeadline ? freshM.moveDeadline - Date.now() : 'N/A'}`);
        if (freshM?.moveDeadline && freshM.moveDeadline > Date.now() + 1000) {
            console.log(`[SERVER startMoveTimer] Timer already active (deadline ${freshM.moveDeadline}), skipping duplicate`);
            await this.redis.del(timerLockKey); // снимаем свой lock
            return;
        }

        // Устанавливаем дедлайн
        m.moveDeadline = Date.now() + seconds * 1000;
        m.moveTimerStarted = Date.now();
        
        await this.redis.set(this.matchKey(matchId), JSON.stringify(m), 'EX', 600);
        
        console.log(`[startMoveTimer] Match ${matchId}: ${seconds}s deadline set`);

        // ⏱️ Отправляем событие таймера всем клиентам
        if (this.server) {
            this.server.to(`match:${matchId}`).emit('match:timer', {
                type: 'move',
                deadline: m.moveDeadline,
                secondsLeft: seconds,
                round: m.round,  // 👈 Добавляем номер раунда
            });
        }

        // Запускаем таймаут (сохраняем дедлайн и раунд для проверки актуальности)
        const expectedDeadline = m.moveDeadline;
        const expectedRound = m.round;
        this.scheduleTimeout(() => {
            this.processMoveTimeout(matchId, expectedDeadline, expectedRound);
        }, seconds * 1000);
    }

    // ⏱️ Обработка таймаута хода (игрок не сделал ход)
    async processMoveTimeout(matchId: string, expectedDeadline?: number, expectedRound?: number) {
        if (this.isShuttingDown) return;
        console.log(`[processMoveTimeout] Processing timeout for ${matchId}, expectedRound=${expectedRound}`);
        
        let m = await this.getMatch(matchId);
        if (!m || m.status === 'FINISHED') {
            console.log(`[processMoveTimeout] Match not found or finished`);
            return;
        }
        
        // Проверяем, не изменился ли раунд (раунд уже резолвлен)
        if (expectedRound && m.round !== expectedRound) {
            console.log(`[processMoveTimeout] Round changed (${expectedRound} != ${m.round}), skipping outdated timeout`);
            return;
        }
        
        // Проверяем, не устарел ли дедлайн
        if (expectedDeadline && m.moveDeadline && m.moveDeadline !== expectedDeadline) {
            console.log(`[processMoveTimeout] Deadline changed (${expectedDeadline} != ${m.moveDeadline}), skipping outdated timeout`);
            return;
        }
        
        console.log(`[processMoveTimeout] Initial aliveIds: ${JSON.stringify(m.aliveIds)}, moves: ${JSON.stringify(m.moves)}, round: ${m.round}`);

        // ⚠️ КРИТИЧНО: Перезагружаем из Redis чтобы получить актуальный aliveIds
        // (игроки могли выбыть пока шел таймер)
        const freshM = await this.getMatch(matchId);
        if (!freshM || freshM.status === 'FINISHED') {
            console.log(`[processMoveTimeout] Match not found or finished after reload`);
            return;
        }
        // Проверяем раунд снова после reload
        if (expectedRound && freshM.round !== expectedRound) {
            console.log(`[processMoveTimeout] Round changed after reload (${expectedRound} != ${freshM.round}), skipping`);
            return;
        }
        m = freshM;
        console.log(`[processMoveTimeout] Fresh aliveIds: ${JSON.stringify(m.aliveIds)}, moves: ${JSON.stringify(m.moves)}`);

        // Проверяем, не все ли уже походили
        const allMoved = m.aliveIds.every((id) => !!(m?.moves?.[id]));
        if (allMoved) {
            console.log(`[processMoveTimeout] All players moved, skipping`);
            return;
        }

        // Для игроков без хода делаем рандомный ход
        let autoMovesMade = false;
        for (const id of m.aliveIds) {
            if (!m.moves?.[id]) {
                const randomMove: Move = ['ROCK', 'PAPER', 'SCISSORS'][Math.floor(Math.random() * 3)] as Move;
                console.log(`[processMoveTimeout] Auto-move for ${id}: ${randomMove}`);
                m.moves[id] = randomMove;
                autoMovesMade = true;
                
                await this.audit.log({
                    eventType: 'MOVE_AUTO',
                    matchId: m.matchId,
                    actorId: id,
                    roundNo: m.round,
                    payload: { move: randomMove, reason: 'TIMEOUT' },
                });
            }
        }

        if (autoMovesMade && m) {
            // ⚠️ Перед сохранением ещё раз проверяем раунд
            const currentM = await this.getMatch(matchId);
            if (currentM && currentM.round !== m.round) {
                console.log(`[processMoveTimeout] Round changed before save (${m.round} != ${currentM.round}), discarding auto-moves`);
                return;
            }
            
            // Сохраняем и резолвим раунд
            await this.redis.set(this.matchKey(matchId), JSON.stringify(m), 'EX', 600);
            await this.resolveRoundAfterAutoMoves(m);
        }
    }

    // ⏱️ Резолв раунда после автоматических ходов
    private async resolveRoundAfterAutoMoves(m: any) {
        if (this.isShuttingDown) return;
        console.log(`[SERVER resolveRound] START round=${m.round}, match=${m.matchId.slice(0,8)}, alive=${m.aliveIds.length}`);
        
        // ⚠️ КРИТИЧНО: Перезагружаем из Redis для актуальных данных
        const freshM = await this.getMatch(m.matchId);
        if (!freshM || freshM.status === 'FINISHED') {
            console.log(`[SERVER resolveRound] Match not found or finished`);
            return;
        }
        // Если раунд изменился - пропускаем
        if (freshM.round !== m.round) {
            console.log(`[SERVER resolveRound] Round changed (${m.round} != ${freshM.round}), skipping`);
            return;
        }
        // Сохраняем auto-moves перед перезаписью
        const autoMoves = { ...m.moves };
        // Используем свежие данные
        m = freshM;
        // Применяем наши auto-moves к свежим данным (только для живых игроков без хода)
        for (const [id, move] of Object.entries(autoMoves)) {
            if (m.aliveIds.includes(id) && !m.moves[id]) {
                m.moves[id] = move as Move;
            }
        }
        
        const allMoved = m.aliveIds.every((id) => !!m.moves?.[id]);
        if (!allMoved) return;

        // Копируем логику из submitMove для резолва раунда
        // ⚠️ Только для живых игроков!
        const snapshotMoves: Record<string, Move> = {};
        for (const id of m.aliveIds) {
            if (m.moves[id]) {
                snapshotMoves[id] = m.moves[id];
            }
        }
        const unique = new Set(Object.values(snapshotMoves));

        if (unique.size === 1 || unique.size === 3) {
            // Ничья
            m.lastRound = {
                roundNo: m.round,
                moves: snapshotMoves,
                outcome: 'TIE',
                reason: unique.size === 1 ? 'ALL_SAME' : 'ALL_THREE',
            };
            m.round += 1;
            m.moves = {};
        } else {
            // Есть победитель
            const beats: Record<Move, Move> = { ROCK: 'SCISSORS', SCISSORS: 'PAPER', PAPER: 'ROCK' };
            const [a, b] = Array.from(unique) as Move[];
            const winningMove = beats[a] === b ? a : b;
            const winners = Object.entries(m.moves).filter(([, mv]) => mv === winningMove).map(([id]) => id);
            const losers = m.aliveIds.filter((id) => !winners.includes(id));

            m.lastRound = {
                roundNo: m.round,
                moves: snapshotMoves,
                outcome: 'ELIMINATION',
                winningMove,
                winners,
                losers,
            };

            m.eliminatedIds.push(...losers);
            m.aliveIds = m.aliveIds.filter((id) => winners.includes(id));

            if (m.aliveIds.length === 1) {
                m.status = 'FINISHED';
                m.winnerId = m.aliveIds[0];
                m.finishedAt = Date.now();
                m.moves = {};
                await this.settleIfFinished(m);
            } else {
                m.round += 1;
                m.moves = {};
            }
        }
        
        // 🏆 Если остался 1 игрок - матч завершается (может быть ничья при 1 игроке)
        if (m.aliveIds.length === 1 && m.status !== 'FINISHED') {
            m.status = 'FINISHED';
            m.winnerId = m.aliveIds[0];
            m.finishedAt = Date.now();
            await this.settleIfFinished(m);
            console.log(`[resolveRoundAfterAutoMoves] Match finished (single player) - winner: ${m.winnerId}`);
        }

        // ⚠️ Проверяем, не изменились ли данные в Redis с момента загрузки
        const currentM = await this.getMatch(m.matchId);
        if (currentM && (currentM.round > m.round || currentM.status === 'FINISHED')) {
            console.log(`[resolveRoundAfterAutoMoves] Data in Redis is newer (round ${currentM.round} vs ${m.round}, status ${currentM.status}), skipping save`);
            return;
        }
        
        // ✅ Сначала сохраняем в Redis
        console.log(`[SERVER resolveRound] Saving round ${m.round} to Redis, outcome=${m.lastRound?.outcome}`);
        await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
        
        // Запускаем таймер только если матч не закончился (ДО отправки match:update!)
        if (m.status !== 'FINISHED') {
            console.log(`[SERVER resolveRound] Starting timer for round ${m.round}`);
            await this.startMoveTimer(m.matchId, MOVE_TIMEOUT_SEC);
            // Обновляем m после установки дедлайна
            const updatedM = await this.getMatch(m.matchId);
            if (updatedM) m = updatedM;
        }
        
        // 📢 Отправляем обновление матча всем клиентам (ПОСЛЕ установки таймера!)
        console.log(`[SERVER resolveRound] Emitting match:update for round ${m.round}, deadline=${m.moveDeadline}`);
        if (this.server) {
            // 🛡️ Добавляем deadline как алиас для moveDeadline для совместимости с клиентом
            const matchUpdate = { ...m, deadline: m.moveDeadline };
            this.server.to(`match:${m.matchId}`).emit('match:update', matchUpdate);
        }
        
        console.log(`[SERVER resolveRound] END round=${m.round}, alive=${m.aliveIds.length}, status=${m.status}`);
        
        // 🤖 Если остались только боты - запускаем их игру
        const hasRealPlayers = m.aliveIds.some((id: string) => !id.startsWith('BOT'));
        if (!hasRealPlayers && m.status !== 'FINISHED' && this.server) {
            console.log(`[resolveRoundAfterAutoMoves] Only bots left, triggering bot rounds`);
            // Запускаем ботов с небольшой задержкой
            this.scheduleTimeout(() => {
                this.processBotRounds(m.matchId);
            }, 1500);
        }
    }

    // 🤖 Автоматическая игра ботов после выбывания игрока
    async processBotRounds(matchId: string) {
        if (this.isShuttingDown) return;
        const ROUND_DELAY_MS = 1500;
        const MAX_ROUNDS = 50;
        
        for (let round = 0; round < MAX_ROUNDS; round++) {
            if (this.isShuttingDown) return;
            await new Promise(resolve => setTimeout(resolve, ROUND_DELAY_MS));
            
            const m = await this.getMatch(matchId);
            
            if (!m || m.status === 'FINISHED' || m.aliveIds.length <= 1) {
                break;
            }
            
            if (!m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
                break;
            }

            const updated = await this.processSingleBotRound(matchId);
            
            if (!updated) {
                break;
            }

            if (this.server) {
                this.server.to(`match:${matchId}`).emit('match:round', { 
                    round: updated.round,
                    aliveCount: updated.aliveIds.length 
                });
                this.server.to(`match:${matchId}`).emit('match:update', { ...updated, deadline: updated.moveDeadline });
            }

            if (updated.status === 'FINISHED' || updated.aliveIds.length === 1) {
                break;
            }
        }
    }

    // 🆕 Получение активных матчей пользователя (для проверки зависших)
    async getUserActiveMatches(userId: string): Promise<Match[]> {
        const pattern = this.matchKey('*');
        const keys = await this.redis.keys(pattern);
        const activeMatches: Match[] = [];

        for (const key of keys) {
            try {
                const data = await this.redis.get(key);
                if (!data) continue;

                const m: Match = JSON.parse(data);
                if (m.status !== 'FINISHED' && m.status !== 'CANCELLED' && m.playerIds.includes(userId)) {
                    activeMatches.push(m);
                }
            } catch (e) {
                console.error(`[getUserActiveMatches] Error processing key ${key}:`, e);
            }
        }

        return activeMatches;
    }

    // 🆕 Проверка и очистка зависших матчей пользователя (вызывать при входе)
    async checkAndCleanupUserMatches(userId: string): Promise<{ cleaned: number; returnedVp: number }> {
        const activeMatches = await this.getUserActiveMatches(userId);
        let cleaned = 0;
        let returnedVp = 0;
        const now = Date.now();
        const maxAgeMs = 10 * 60 * 1000; // 10 минут

        for (const m of activeMatches) {
            const age = now - m.createdAt;
            if (age > maxAgeMs) {
                console.log(`[checkAndCleanupUserMatches] Found orphaned match for user ${userId}: ${m.matchId}, age: ${Math.round(age/60000)}min`);
                await this.cancelMatch(m.matchId, `User rejoined, match timeout (${Math.round(age/60000)} minutes)`);
                cleaned++;
                returnedVp += m.stakeVp;
            }
        }

        return { cleaned, returnedVp };
    }

    // 🧪 ТЕСТ: Создать фейковый зависший матч
    async createTestOrphanedMatch(userId: string, stakeVp: number) {
        const matchId = randomUUID();
        const oldTimestamp = Date.now() - 15 * 60 * 1000; // 15 минут назад
        
        // Сначала заморозим средства
        await this.freezeStake(userId, stakeVp);
        
        const m: Match = {
            matchId,
            playersCount: 2,
            stakeVp,
            potVp: stakeVp * 2,
            feeRate: 0.05,
            feeVp: Math.floor((stakeVp * 2) * 0.05),
            payoutVp: stakeVp * 2 - Math.floor((stakeVp * 2) * 0.05),
            settled: false,
            playerIds: [userId, 'BOT1'],
            aliveIds: [userId, 'BOT1'],
            eliminatedIds: [],
            playerNames: {},
            createdAt: oldTimestamp, // ⏰ Старый timestamp!
            status: 'IN_PROGRESS',
            round: 1,
            moves: {},
        };
        
        await this.redis.set(this.matchKey(matchId), JSON.stringify(m), 'EX', 600);
        
        console.log(`[TEST] Created orphaned match: ${matchId}, createdAt: ${new Date(oldTimestamp).toISOString()}`);
        
        return { 
            matchId, 
            message: 'Test orphaned match created (15 min old)',
            stakeVp,
            createdAt: oldTimestamp
        };
    }
}
