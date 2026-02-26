import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletsService implements OnModuleInit {
    constructor(@InjectRepository(Wallet) private walletsRepo: Repository<Wallet>) { }

    // 🆕 Автоматическая очистка зависших frozen средств при старте
    async onModuleInit() {
        console.log('[WalletsService] Checking for stuck frozen balances...');
        await this.cleanupFrozenBalances();
    }

    // 🆕 Очистка всех зависших frozen балансов
    async cleanupFrozenBalances(): Promise<{ cleaned: number; totalReturned: number }> {
        const wallets = await this.walletsRepo.find({
            where: { frozenWp: 0 },
            relations: { user: true },
        });
        
        // Ищем кошельки с frozenWp > 0
        const frozenWallets = await this.walletsRepo.createQueryBuilder('wallet')
            .leftJoinAndSelect('wallet.user', 'user')
            .where('wallet.frozenWp > 0')
            .getMany();

        if (frozenWallets.length === 0) {
            console.log('[cleanupFrozenBalances] No stuck frozen balances found');
            return { cleaned: 0, totalReturned: 0 };
        }

        let totalReturned = 0;
        
        for (const wallet of frozenWallets) {
            const frozenAmount = wallet.frozenWp;
            wallet.balanceWp += frozenAmount;
            wallet.frozenWp = 0;
            await this.walletsRepo.save(wallet);
            
            totalReturned += frozenAmount;
            console.log(`[cleanupFrozenBalances] Returned ${frozenAmount} VP to user ${wallet.user?.id?.slice(0,8) || 'unknown'}`);
        }

        console.log(`[cleanupFrozenBalances] Cleaned ${frozenWallets.length} wallets, returned ${totalReturned} VP total`);
        return { cleaned: frozenWallets.length, totalReturned };
    }

    async getByUserId(userId: string) {
        return this.walletsRepo.findOne({
            where: { user: { id: userId } },
            relations: { user: true },
        });
    }

    // 🆕 Сброс frozen баланса (возвращает frozen на balance)
    async resetFrozen(userId: string) {
        const wallet = await this.walletsRepo.findOne({
            where: { user: { id: userId } },
        });
        
        if (!wallet) {
            return { success: false, message: 'Wallet not found' };
        }

        const frozenAmount = wallet.frozenWp;
        if (frozenAmount === 0) {
            return { success: true, message: 'No frozen balance to reset', returnedVp: 0 };
        }

        wallet.balanceWp += frozenAmount;
        wallet.frozenWp = 0;
        await this.walletsRepo.save(wallet);

        return { 
            success: true, 
            message: `Returned ${frozenAmount} VP to balance`, 
            returnedVp: frozenAmount,
            newBalance: wallet.balanceWp,
            newFrozen: wallet.frozenWp
        };
    }
}
