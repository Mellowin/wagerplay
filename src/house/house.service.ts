import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Wallet } from '../wallets/wallet.entity';

@Injectable()
export class HouseService implements OnModuleInit {
    private houseId: string;

    constructor(
        private cfg: ConfigService,
        @InjectRepository(User) private usersRepo: Repository<User>,
        @InjectRepository(Wallet) private walletsRepo: Repository<Wallet>,
    ) {
        this.houseId = this.cfg.get<string>('HOUSE_USER_ID') || '';
    }

    // При старте приложения создаём House, если его нет
    async onModuleInit() {
        if (!this.houseId) {
            console.error('❌ HOUSE_USER_ID not set in .env');
            return;
        }

        await this.ensureHouseExists();
        console.log('✅ House initialized:', this.houseId);
    }

    private async ensureHouseExists() {
        // Проверяем, есть ли House user
        let houseUser = await this.usersRepo.findOne({
            where: { id: this.houseId },
        });

        // Если нет - создаём
        if (!houseUser) {
            houseUser = this.usersRepo.create({
                id: this.houseId,
            });
            await this.usersRepo.save(houseUser);
            console.log('✅ House user created');
        }

        // Проверяем, есть ли wallet у House
        let houseWallet = await this.walletsRepo.findOne({
            where: { user: { id: this.houseId } },
        });

        // Если нет - создаём с начальным балансом из .env
        if (!houseWallet) {
            const startBalance = Number(this.cfg.get<string>('HOUSE_START_BALANCE') || '10000000');
            houseWallet = this.walletsRepo.create({
                user: houseUser,
                balanceWp: startBalance,
                frozenWp: 0,
            });
            await this.walletsRepo.save(houseWallet);
            console.log('✅ House wallet created with balance:', startBalance);
        }
    }

    // Получить wallet House (для matchmaking)
    async getHouseWallet(): Promise<Wallet | null> {
        if (!this.houseId) return null;
        return this.walletsRepo.findOne({
            where: { user: { id: this.houseId } },
            relations: { user: true },
        });
    }

    // Получить ID House
    getHouseId(): string {
        return this.houseId;
    }

    // Пополнить баланс House
    async addBalance(amount: number): Promise<number> {
        const wallet = await this.getHouseWallet();
        if (!wallet) throw new Error('House wallet not found');
        
        wallet.balanceWp += amount;
        await this.walletsRepo.save(wallet);
        return wallet.balanceWp;
    }

    // Получить баланс
    async getBalance(): Promise<number> {
        const wallet = await this.getHouseWallet();
        if (!wallet) return 0;
        return wallet.balanceWp;
    }
}
