import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { UserStats } from '../users/user-stats.entity';
import { User } from '../users/user.entity';

export type LeaderboardCategory = 'wins' | 'winRate' | 'profit' | 'streak' | 'biggestWin';

export interface LeaderboardEntry {
    rank: number;
    userId: string;
    displayName: string;
    avatarUrl?: string | null;
    stats: {
        totalMatches: number;
        wins: number;
        losses: number;
        winRate: number;
        totalWonVp: number;
        totalLostVp: number;
        winStreak: number;
        maxWinStreak: number;
    };
    value: number;
}

@Injectable()
export class LeaderboardService {
    constructor(
        @InjectRepository(UserStats)
        private userStatsRepo: Repository<UserStats>,
        @InjectRepository(User)
        private userRepo: Repository<User>,
    ) {}

    /**
     * Получить топ игроков по категории
     */
    async getLeaderboard(
        category: LeaderboardCategory = 'wins',
        limit: number = 10,
        offset: number = 0,
    ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
        const orderField = this.getOrderField(category);
        
        // Получаем общее количество
        const total = await this.userStatsRepo.count();
        
        // Получаем статистику с сортировкой
        const stats = await this.userStatsRepo.find({
            order: { [orderField]: 'DESC' },
            take: limit,
            skip: offset,
            relations: ['user'],
        });

        // Формируем ответ
        const entries: LeaderboardEntry[] = [];
        
        for (let i = 0; i < stats.length; i++) {
            const stat = stats[i];
            const user = stat.user;
            
            entries.push({
                rank: offset + i + 1,
                userId: stat.userId,
                displayName: user?.displayName || user?.username || 'Unknown',
                avatarUrl: user?.avatarUrl,
                stats: {
                    totalMatches: stat.totalMatches,
                    wins: stat.wins,
                    losses: stat.losses,
                    winRate: stat.winRate,
                    totalWonVp: stat.totalWonVp,
                    totalLostVp: stat.totalLostVp,
                    winStreak: stat.winStreak,
                    maxWinStreak: stat.maxWinStreak,
                },
                value: this.getCategoryValue(stat, category),
            });
        }

        // Для winRate дополнительно сортируем по проценту (после получения из БД)
        if (category === 'winRate') {
            entries.sort((a, b) => b.stats.winRate - a.stats.winRate);
            // Пересчитываем rank
            entries.forEach((entry, idx) => {
                entry.rank = offset + idx + 1;
                entry.value = entry.stats.winRate;
            });
        }

        return { entries, total };
    }

    /**
     * Найти позицию пользователя в рейтинге
     */
    async findUserPosition(
        userId: string,
        category: LeaderboardCategory = 'wins',
    ): Promise<LeaderboardEntry | null> {
        const orderField = this.getOrderField(category);
        
        // Получаем статистику пользователя
        const stat = await this.userStatsRepo.findOne({
            where: { userId },
            relations: ['user'],
        });

        if (!stat) {
            return null;
        }

        const userValue = this.getCategoryValue(stat, category);

        // Считаем сколько игроков выше (с большим значением)
        let countAbove: number;
        
        if (category === 'winRate') {
            // Для winRate считаем вручную через все записи
            const allStats = await this.userStatsRepo.find();
            countAbove = allStats.filter(s => s.winRate > stat.winRate).length;
        } else {
            countAbove = await this.userStatsRepo.count({
                where: {
                    [orderField]: MoreThan(userValue),
                },
            });
        }

        const rank = countAbove + 1;
        const user = stat.user;

        return {
            rank,
            userId: stat.userId,
            displayName: user?.displayName || user?.username || 'Unknown',
            avatarUrl: user?.avatarUrl,
            stats: {
                totalMatches: stat.totalMatches,
                wins: stat.wins,
                losses: stat.losses,
                winRate: stat.winRate,
                totalWonVp: stat.totalWonVp,
                totalLostVp: stat.totalLostVp,
                winStreak: stat.winStreak,
                maxWinStreak: stat.maxWinStreak,
            },
            value: userValue,
        };
    }

    /**
     * Получить топ по всем категориям (для главной страницы)
     */
    async getGlobalLeaderboard(limit: number = 5): Promise<Record<LeaderboardCategory, LeaderboardEntry[]>> {
        const categories: LeaderboardCategory[] = ['wins', 'winRate', 'profit', 'streak', 'biggestWin'];
        const result = {} as Record<LeaderboardCategory, LeaderboardEntry[]>;

        for (const category of categories) {
            const { entries } = await this.getLeaderboard(category, limit);
            result[category] = entries;
        }

        return result;
    }

    private getOrderField(category: LeaderboardCategory): string {
        const fieldMap: Record<LeaderboardCategory, string> = {
            wins: 'wins',
            winRate: 'wins', // Используем wins для предварительной сортировки
            profit: 'totalWonVp',
            streak: 'winStreak',
            biggestWin: 'maxWinStreak',
        };
        return fieldMap[category];
    }

    private getCategoryValue(stat: UserStats, category: LeaderboardCategory): number {
        switch (category) {
            case 'wins':
                return stat.wins;
            case 'winRate':
                return stat.winRate;
            case 'profit':
                return stat.totalWonVp;
            case 'streak':
                return stat.winStreak;
            case 'biggestWin':
                return stat.maxWinStreak;
            default:
                return stat.wins;
        }
    }
}
