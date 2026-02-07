import { Injectable, BadRequestException } from '@nestjs/common';
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
type MatchStatus = 'READY' | 'BOT_MATCH' | 'IN_PROGRESS' | 'FINISHED';

type Ticket = {
    ticketId: string;
    userId: string;
    playersCount: number;
    stakeVp: number;
    createdAt: number; // ms
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
    private redis: Redis;

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

    async quickPlay(userId: string, playersCount: number, stakeVp: number) {
        this.validateInputs(playersCount, stakeVp);

        // ✅ CHECK ONLY (не морозим тут!)
        const w = await this.getWalletByUserId(userId);
        if (!w) throw new BadRequestException('Wallet not found');
        if (w.balanceWp < stakeVp) {
            throw new BadRequestException(`Not enough balance. Need ${stakeVp}, have ${w.balanceWp}`);
        }

        // ✅ Проверяем, нет ли уже тикета в очереди
        const existingTicket = await this.hasExistingTicket(userId, playersCount, stakeVp);
        if (existingTicket) {
            return { 
                status: 'ALREADY_IN_QUEUE', 
                ticketId: existingTicket.ticketId,
                message: 'You already have a ticket in this queue'
            };
        }

        const ticket: Ticket = {
            ticketId: randomUUID(),
            userId,
            playersCount,
            stakeVp,
            createdAt: Date.now(),
        };

        const q = this.qKey(playersCount, stakeVp);
        await this.redis.set(this.ticketKey(ticket.ticketId), JSON.stringify(ticket), 'EX', 300);
        await this.redis.rpush(q, ticket.ticketId);

        const matchId = await this.tryAssembleMatch(playersCount, stakeVp);
        if (matchId) {
            return { status: 'MATCH_READY', matchId };
        }

        return { status: 'IN_QUEUE', ticketId: ticket.ticketId };
    }

    async getTicket(ticketId: string) {
        const raw = await this.redis.get(this.ticketKey(ticketId));
        if (!raw) return null;
        return JSON.parse(raw) as Ticket;
    }

    async getMatch(matchId: string) {
        const raw = await this.redis.get(this.matchKey(matchId));
        if (!raw) return null;
        return JSON.parse(raw) as Match;
    }

    async tryAssembleMatch(playersCount: number, stakeVp: number) {
        const q = this.qKey(playersCount, stakeVp);

        const len = await this.redis.llen(q);
        if (len < playersCount) return null;

        const ticketIds: string[] = [];
        for (let i = 0; i < playersCount; i++) {
            const id = await this.redis.lpop(q);
            if (id) ticketIds.push(id);
        }

        if (ticketIds.length < playersCount) {
            if (ticketIds.length) await this.redis.lpush(q, ...ticketIds.reverse());
            return null;
        }

        const tickets: Ticket[] = [];
        const seenUserIds = new Set<string>();
        
        for (const tId of ticketIds) {
            const t = await this.getTicket(tId);
            if (!t) {
                // тикета нет — вернем то что забрали обратно
                if (ticketIds.length) await this.redis.lpush(q, ...ticketIds.reverse());
                return null;
            }
            // ✅ Проверяем что один игрок не попал дважды
            if (seenUserIds.has(t.userId)) {
                // Дубликат! Удаляем дубликат и возвращаем остальные
                await this.redis.del(this.ticketKey(t.ticketId));
                const remaining = ticketIds.filter(id => id !== tId);
                if (remaining.length) await this.redis.lpush(q, ...remaining.reverse());
                return null;
            }
            seenUserIds.add(t.userId);
            tickets.push(t);
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


        if (playerIds.length < playersCount) return null;

        // ✅ UPDATED: добавили aliveIds/eliminatedIds/moves
        const potVp = stakeVp * playersCount;
        const feeRate = 0.05;
        const feeVp = Math.floor((potVp * 5) / 100);
        const payoutVp = potVp - feeVp;

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
            aliveIds: [...playerIds],
            eliminatedIds: [],
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

        return match.matchId;
    }

    // Fallback: если тикет висит >BOT_TIMEOUT_SEC — создаём BOT_MATCH
    async fallbackToBotIfTimedOut(ticketId: string) {
        const BOT_TIMEOUT_SEC = 5;

        const t = await this.getTicket(ticketId);
        if (!t) throw new BadRequestException('Ticket not found (expired or already used)');

        const ageSec = (Date.now() - t.createdAt) / 1000;
        // ✅ Если ещё не прошло 5 секунд — ждём оставшееся время и вызываем себя рекурсивно
        if (ageSec < BOT_TIMEOUT_SEC) {
            const msLeft = Math.ceil((BOT_TIMEOUT_SEC - ageSec) * 1000);
            await new Promise(r => setTimeout(r, msLeft));
            return this.fallbackToBotIfTimedOut(ticketId);
        }

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
        if (m.status !== 'FINISHED') return m;
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
        const isWinner = m.winnerId === userId;
        const isEliminated = m.eliminatedIds?.includes(userId);
        
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
            stats.winStreak = 0; // Сброс серии
        }

        if (m.stakeVp > stats.biggestStakeVp) {
            stats.biggestStakeVp = m.stakeVp;
        }

        await this.userStatsRepo.save(stats);
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

        // Проверка: является ли пользователь участником матча
        if (!m.playerIds.includes(userId)) {
            throw new BadRequestException('You are not a player in this match');
        }

        // Проверка: не выбыл ли уже
        if (!m.aliveIds.includes(userId)) {
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

        const snapshotMoves: Record<string, Move> = { ...m.moves };

        // --- Решаем раунд ---
        const unique = new Set(Object.values(m.moves));

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

            m.round += 1;
            m.moves = {};
            console.log(`[submitMove] TIE resolved: ${Date.now() - start}ms`);

            // НЕ запускаем autoplay сразу — Gateway сделает это с задержкой
            // if (m.aliveIds.length > 0 && m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
            //     this.autoplayBotsUntilFinished(m);
            //     await this.settleIfFinished(m);
            // }

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

            await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
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

        // НЕ запускаем autoplay сразу — Gateway сделает это с задержкой
        // if (m.aliveIds.length > 0 && m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
        //     this.autoplayBotsUntilFinished(m);
        //     await this.settleIfFinished(m);
        //     ...
        // }

        await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
        console.log(`[submitMove] END: ${Date.now() - start}ms`);
        return m;
    }
}
