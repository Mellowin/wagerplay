// 🎮 Типы для матчмейкинга

export type Move = 'ROCK' | 'PAPER' | 'SCISSORS';

export type MatchStatus = 'READY' | 'BOT_MATCH' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

export type Ticket = {
    ticketId: string;
    userId: string;
    playersCount: number;
    stakeVp: number;
    createdAt: number;
    displayName?: string;
};

export type Match = {
    matchId: string;
    playersCount: number;
    stakeVp: number;
    potVp: number;
    feeRate: number;
    feeVp: number;
    payoutVp: number;
    settled: boolean;
    playerIds: string[];
    aliveIds: string[];
    eliminatedIds: string[];
    botNames?: Record<string, string>;
    playerNames?: Record<string, string>;
    moveDeadline?: number;
    moveTimerStarted?: number;
    createdAt: number;
    status: MatchStatus;
    round: number;
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
