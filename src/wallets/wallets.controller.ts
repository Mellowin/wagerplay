import { Controller, Get, Post, Headers, Body, BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserStats } from '../users/user-stats.entity';
import { Wallet } from './wallet.entity';

function getTokenUserId(authHeader?: string): string {
    if (!authHeader) return '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const trimmed = token.trim();
    
    // Если это plain UUID (гостевой токен), возвращаем как есть
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(trimmed)) {
        return trimmed;
    }
    
    // Иначе пробуем декодировать как JWT
    try {
        const base64Payload = trimmed.split('.')[1];
        if (!base64Payload) return '';
        const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
        return payload.sub || '';
    } catch {
        return '';
    }
}

@Controller('wallet')
export class WalletsController {
    constructor(
        private wallets: WalletsService,
        @InjectRepository(UserStats) private statsRepo: Repository<UserStats>,
        @InjectRepository(Wallet) private walletRepo: Repository<Wallet>,
    ) { }

    @Get()
    async me(@Headers('authorization') auth?: string) {
        const userId = getTokenUserId(auth);
        if (!userId) {
            return { userId: '', balanceWp: 0, frozenWp: 0 };
        }
        const w = await this.wallets.getByUserId(userId);
        if (!w) return { userId, balanceWp: 0, frozenWp: 0 };
        return { userId, balanceWp: w.balanceWp, frozenWp: w.frozenWp };
    }

    // 🆕 Admin only: сброс frozen баланса (только для админов)
    @Post('admin/reset-frozen')
    async resetFrozen(@Headers('authorization') auth?: string, @Body() body?: { targetUserId?: string }) {
        const userId = getTokenUserId(auth);
        // TODO: проверка что userId - это админ
        const targetUserId = body?.targetUserId || userId;
        const result = await this.wallets.resetFrozen(targetUserId);
        return result;
    }

    // 🆕 Сверка баланса: ожидаемый vs фактический
    @Get('reconcile')
    async reconcile(@Headers('authorization') auth?: string) {
        const userId = getTokenUserId(auth);
        if (!userId) throw new BadRequestException('Необходима авторизация');

        const wallet = await this.walletRepo.findOne({ where: { user: { id: userId } } });
        const stats = await this.statsRepo.findOne({ where: { userId } });

        const actualBalance = wallet?.balanceWp || 0;
        const frozenBalance = wallet?.frozenWp || 0;
        const totalWon = stats?.totalWonVp || 0;
        const totalLost = stats?.totalLostVp || 0;
        const totalStaked = stats?.totalStakedVp || 0;

        // Ожидаемый баланс = 10000 (старт) + выигрыши - проигрыши - заморожено
        const expectedBalance = 10000 + totalWon - totalLost;
        const discrepancy = actualBalance - expectedBalance;

        return {
            userId,
            actualBalance,
            frozenBalance,
            expectedBalance,
            discrepancy,
            stats: {
                totalWon,
                totalLost,
                netProfit: totalWon - totalLost,
                totalStaked,
                wins: stats?.wins || 0,
                losses: stats?.losses || 0,
            },
            isBalanced: discrepancy === 0,
        };
    }
}
