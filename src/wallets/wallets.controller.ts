import { Controller, Get, Post, Headers, Body, BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserStats } from '../users/user-stats.entity';
import { Wallet } from './wallet.entity';
import { getUserIdFromToken } from '../common/token.utils';

@Controller('wallet')
export class WalletsController {
    constructor(
        private wallets: WalletsService,
        @InjectRepository(UserStats) private statsRepo: Repository<UserStats>,
        @InjectRepository(Wallet) private walletRepo: Repository<Wallet>,
    ) { }

    @Get()
    async me(@Headers('authorization') auth?: string) {
        const userId = getUserIdFromToken(auth);
        if (!userId) {
            return { userId: '', balanceWp: 0, frozenWp: 0 };
        }
        const w = await this.wallets.getByUserId(userId);
        if (!w) return { userId, balanceWp: 0, frozenWp: 0 };
        return { userId, balanceWp: w.balanceWp, frozenWp: w.frozenWp };
    }

    // 🆕 Сброс frozen баланса (возврат замороженных средств)
    @Post('reset-frozen')
    async resetFrozen(@Headers('authorization') auth?: string) {
        const userId = getUserIdFromToken(auth);
        if (!userId) throw new BadRequestException('Unauthorized');
        
        const result = await this.wallets.resetFrozen(userId);
        
        // 📝 Логируем действие пользователя
        console.log(`[reset-frozen] User ${userId.slice(0,8)}... returned ${result.returnedVp} VP`);
        
        return result;
    }

    // 🆕 Admin only: сброс frozen баланса для любого пользователя
    @Post('admin/reset-frozen')
    async adminResetFrozen(@Headers('authorization') auth?: string, @Body() body?: { targetUserId?: string }) {
        const userId = getUserIdFromToken(auth);
        // TODO: проверка что userId - это админ
        const targetUserId = body?.targetUserId || userId;
        const result = await this.wallets.resetFrozen(targetUserId);
        return result;
    }

    // 🆕 Сверка баланса: ожидаемый vs фактический
    @Get('reconcile')
    async reconcile(@Headers('authorization') auth?: string) {
        const userId = getUserIdFromToken(auth);
        if (!userId) throw new BadRequestException('Необходима авторизация');

        const wallet = await this.walletRepo.findOne({ where: { user: { id: userId } } });
        const stats = await this.statsRepo.findOne({ where: { userId } });

        const actualBalance = wallet?.balanceWp || 0;
        const frozenBalance = wallet?.frozenWp || 0;
        const totalWon = stats?.totalWonVp || 0;
        const totalLost = stats?.totalLostVp || 0;
        const totalStaked = stats?.totalStakedVp || 0;

        // Ожидаемый баланс = 10000 (старт) + чистая прибыль (выигрыши - проигрыши)
        // Примечание: frozenBalance уже учтен в actualBalance (вычтен из доступных средств)
        const expectedBalance = 10000 + totalWon - totalLost;
        const discrepancy = actualBalance - expectedBalance;

        return {
            userId,
            actualBalance,
            frozenBalance,
            totalAvailable: actualBalance + frozenBalance, // Доступно + заморожено
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
            note: 'frozenBalance уже учтен в actualBalance (вычтен из доступных)',
        };
    }
}
