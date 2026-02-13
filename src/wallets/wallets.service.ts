import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletsService {
    constructor(@InjectRepository(Wallet) private walletsRepo: Repository<Wallet>) { }

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
