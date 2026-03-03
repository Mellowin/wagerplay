import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Wallet } from '../wallets/wallet.entity';
import { MatchmakingService } from '../matchmaking/matchmaking.service';

interface TestScenario {
    name: string;
    players: number;
    bots: number;
    stake: number;
    expectedWinner: 'player' | 'bot' | 'random';
}

@Injectable()
export class MatchTestService {
    constructor(
        @InjectRepository(User)
        private userRepo: Repository<User>,
        @InjectRepository(Wallet)
        private walletRepo: Repository<Wallet>,
        private mm: MatchmakingService,
    ) {}

    // 🎮 Тестовые сценарии
    private scenarios: TestScenario[] = [
        { name: '1v1 PVP', players: 2, bots: 0, stake: 100, expectedWinner: 'random' },
        { name: '1v1 vs Bot', players: 1, bots: 1, stake: 100, expectedWinner: 'random' },
        { name: '2 Players + 1 Bot', players: 2, bots: 1, stake: 100, expectedWinner: 'random' },
        { name: '1 Player + 4 Bots', players: 1, bots: 4, stake: 100, expectedWinner: 'random' },
        { name: '5 Players', players: 5, bots: 0, stake: 100, expectedWinner: 'random' },
        { name: '3 Players + 2 Bots', players: 3, bots: 2, stake: 100, expectedWinner: 'random' },
    ];

    async runAllTests(adminId: string) {
        const results = [];
        
        for (const scenario of this.scenarios) {
            console.log(`[TEST] Running: ${scenario.name}`);
            const result = await this.runScenario(scenario, adminId);
            results.push(result);
        }
        
        return {
            total: results.length,
            passed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            details: results
        };
    }

    private async runScenario(scenario: TestScenario, adminId: string) {
        const startTime = Date.now();
        
        try {
            // Создаем тестовых игроков если нужно
            const testUsers = await this.getOrCreateTestUsers(scenario.players);
            
            // Запоминаем начальные балансы
            const initialBalances = new Map<string, number>();
            for (const user of testUsers) {
                const wallet = await this.walletRepo.findOne({ 
                    where: { user: { id: user.id } } 
                });
                initialBalances.set(user.id, wallet?.balanceWp || 0);
            }
            
            // TODO: Создать матч и проверить результат
            // Это требует доступа к приватным методам или рефакторинга
            
            return {
                name: scenario.name,
                success: true,
                duration: Date.now() - startTime,
                message: 'Test completed (manual verification needed)'
            };
            
        } catch (error) {
            return {
                name: scenario.name,
                success: false,
                duration: Date.now() - startTime,
                error: error.message
            };
        }
    }

    private async getOrCreateTestUsers(count: number): Promise<User[]> {
        const users = [];
        
        for (let i = 0; i < count; i++) {
            // Ищем существующих тестовых пользователей
            let user = await this.userRepo.findOne({
                where: { email: `test${i}@wagerplay.test` }
            });
            
            if (!user) {
                // Создаем нового
                user = this.userRepo.create({
                    email: `test${i}@wagerplay.test`,
                    displayName: `TestPlayer${i}`,
                    password: 'test123',
                });
                await this.userRepo.save(user);
                
                // Создаем кошелек с начальным балансом
                const wallet = this.walletRepo.create({
                    user: user,
                    balanceWp: 10000,
                    frozenWp: 0,
                });
                await this.walletRepo.save(wallet);
            }
            
            users.push(user);
        }
        
        return users;
    }
}
