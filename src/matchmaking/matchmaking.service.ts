import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from '../wallets/wallet.entity';
import { AuditService } from '../audit/audit.service';

const ALLOWED_PLAYERS = new Set([2, 3, 4]);
const ALLOWED_STAKES = new Set([100, 200, 500, 1000, 2500, 5000, 10000]);

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
        private audit: AuditService,
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

    private async getWalletByUserId(userId: string) {
        // важно: relations: { user: true } чтобы where по user.id работал стабильно
        return this.walletsRepo.findOne({
            where: { user: { id: userId } },
            relations: { user: true },
        });
    }

    // freeze: balance -> frozen
    private async freezeStake(userId: string, stakeVp: number) {
        const w = await this.getWalletByUserId(userId);
        if (!w) throw new BadRequestException('Wallet not found');

        if (w.balanceWp < stakeVp) {
            throw new BadRequestException(`Not enough balance. Need ${stakeVp}, have ${w.balanceWp}`);
        }

        w.balanceWp -= stakeVp;
        w.frozenWp += stakeVp;
        await this.walletsRepo.save(w);
    }

    // rollback freeze, если что-то пошло не так в сборке матча
    private async unfreezeStake(userId: string, stakeVp: number) {
        const w = await this.getWalletByUserId(userId);
        if (!w) return;

        w.frozenWp = Math.max(0, w.frozenWp - stakeVp);
        w.balanceWp += stakeVp;
        await this.walletsRepo.save(w);
    }

    validateInputs(playersCount: number, stakeVp: number) {
        if (!ALLOWED_PLAYERS.has(playersCount)) {
            throw new BadRequestException('playersCount must be 2, 3, or 4');
        }
        if (!ALLOWED_STAKES.has(stakeVp)) {
            throw new BadRequestException('stakeVp must be one of: 100,200,500,1000,2500,5000,10000');
        }
    }

    async quickPlay(userId: string, playersCount: number, stakeVp: number) {
        this.validateInputs(playersCount, stakeVp);

        // ✅ CHECK ONLY (не морозим тут!)
        const w = await this.getWalletByUserId(userId);
        if (!w) throw new BadRequestException('Wallet not found');
        if (w.balanceWp < stakeVp) {
            throw new BadRequestException(`Not enough balance. Need ${stakeVp}, have ${w.balanceWp}`);
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
        for (const tId of ticketIds) {
            const t = await this.getTicket(tId);
            if (!t) {
                // тикета нет — вернем то что забрали обратно
                if (ticketIds.length) await this.redis.lpush(q, ...ticketIds.reverse());
                return null;
            }
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

    // Fallback: если тикет висит >60 сек — создаём BOT_MATCH
    async fallbackToBotIfTimedOut(ticketId: string) {
        const BOT_TIMEOUT_SEC = 5;
        const t = await this.getTicket(ticketId);
        if (!t) throw new BadRequestException('Ticket not found (expired or already used)');

        const ageSec = (Date.now() - t.createdAt) / 1000;
        if (ageSec < BOT_TIMEOUT_SEC) {
            return { status: 'WAIT', secondsLeft: Math.ceil(BOT_TIMEOUT_SEC - ageSec) };
        }

        // ✅ Вариант 2: если не хватает банка платформы — делаем practice (stake=0)
        // Примечание: пока у нас нет HOUSE-кошелька, считаем что "банка нет всегда".
        // Когда добавим HOUSE — здесь будет реальная проверка.

        // временно: всегда practice если это BOT_MATCH (чтобы не стопориться на банке)
        const practice = true;

        if (!practice) {
            // обычный денежный бот-матч (пока оставим на будущее)
            await this.freezeStake(t.userId, t.stakeVp);
        }
        // если practice=true — ничего не морозим

        await this.redis.del(this.ticketKey(ticketId));

        // ✅ UPDATED: если игроков 3/4 — добавляем BOT1/BOT2/BOT3
        const bots = Array.from({ length: t.playersCount - 1 }, (_, i) => `BOT${i + 1}`);
        const allPlayers = [t.userId, ...bots];

        const stake = practice ? 0 : t.stakeVp;

        const potVp = stake * t.playersCount;
        const feeRate = practice ? 0 : 0.05;
        const feeVp = Math.floor((potVp * 5) / 100);
        const payoutVp = potVp - feeVp;

        const match: Match = {
            matchId: randomUUID(),
            playersCount: t.playersCount,
            stakeVp: stake,
            potVp,
            feeRate,
            feeVp,
            settled: practice ? true : false,
            payoutVp,
            playerIds: allPlayers,
            aliveIds: [...allPlayers],
            eliminatedIds: [],
            createdAt: Date.now(),
            status: 'BOT_MATCH',
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

        return { status: 'BOT_MATCH_READY', matchId: match.matchId };
    }

    private async settleIfFinished(m: any) {
        if (m.status !== 'FINISHED') return m;
        if (m.settled) return m;

        const realPlayers = (m.playerIds || []).filter((id: string) => !this.isBot(id));

        // 1) снимаем frozen у всех реальных (они уже оплатили stake при freeze)
        for (const uid of realPlayers) {
            const w = await this.getWalletByUserId(uid);
            if (w) {
                w.frozenWp = Math.max(0, w.frozenWp - m.stakeVp);
                await this.walletsRepo.save(w);
            }
        }

        // 2) победитель получает payout (если он реальный)
        if (m.winnerId && !this.isBot(m.winnerId)) {
            const w = await this.getWalletByUserId(m.winnerId);
            if (w) {
                w.balanceWp += m.payoutVp;
                await this.walletsRepo.save(w);
            }
        }

        m.settled = true;
        return m;
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
        // Доигрываем пока не останется 1 бот
        // страховка от бесконечных ничьих:
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

    // ✅ UPDATED: submitMove теперь делает выбывание 2/3/4 до 1 победителя
    async submitMove(matchId: string, userId: string, move: Move) {
        const m = await this.getMatch(matchId);
        if (!m) throw new BadRequestException('Match not found');

        if (!m.aliveIds.includes(userId)) {
            throw new BadRequestException('You are eliminated or not in this match');
        }

        // нельзя перезаписать ход в этом раунде
        if (m.moves?.[userId]) return m;

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

        // если ещё не все живые походили — сохраняем и выходим
        const allMoved = m.aliveIds.every((id) => !!m.moves[id]);
        if (!allMoved) {
            await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
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

            if (m.aliveIds.length > 0 && m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
                this.autoplayBotsUntilFinished(m);
                await this.settleIfFinished(m); // на случай, если autoplay завершил матч
            }

            if (m.winnerId) {
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

        // ✅ Если остались только боты — доигрываем автоматически до конца
        if (m.aliveIds.length > 0 && m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
            this.autoplayBotsUntilFinished(m);

            await this.settleIfFinished(m); // если autoplay довёл до FINISHED

            if (m.winnerId) {
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
        }

        await this.redis.set(this.matchKey(m.matchId), JSON.stringify(m), 'EX', 600);
        return m;
    }
}
