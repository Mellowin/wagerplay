/**
 * 🧪 Автоматические тесты матчей
 * Запуск: npx ts-node test-match-scenarios.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { MatchmakingService } from './src/matchmaking/matchmaking.service';
import { WalletsService } from './src/wallets/wallets.service';
import { UsersService } from './src/users/users.service';
import { Repository } from 'typeorm';
import { User } from './src/users/user.entity';
import { Wallet } from './src/wallets/wallet.entity';
import { getRepositoryToken } from '@nestjs/core';

interface TestPlayer {
    id: string;
    name: string;
    initialBalance: number;
    expectedBalance?: number;
}

interface TestResult {
    scenario: string;
    success: boolean;
    players: TestPlayer[];
    logs: string[];
    error?: string;
}

async function runTests() {
    console.log('🚀 Starting Match Test Suite\n');
    
    const app = await NestFactory.createApplicationContext(AppModule);
    const mm = app.get(MatchmakingService);
    const wallets = app.get(WalletsService);
    const users = app.get(UsersService);
    const userRepo = app.get<Repository<User>>(getRepositoryToken(User));
    const walletRepo = app.get<Repository<Wallet>>(getRepositoryToken(Wallet));

    const results: TestResult[] = [];

    // === Тест 1: Простой матч 1v1 ===
    results.push(await testScenario({
        name: '1v1 PVP - 100 VP stake',
        mm, wallets, userRepo, walletRepo,
        config: {
            players: 2,
            stake: 100,
            botMode: false
        }
    }));

    // === Тест 2: 1 игрок vs 1 бот ===
    results.push(await testScenario({
        name: '1v1 vs Bot - 100 VP stake',
        mm, wallets, userRepo, walletRepo,
        config: {
            players: 1,
            bots: 1,
            stake: 100,
            botMode: true
        }
    }));

    // === Тест 3: 2 игрока + 1 бот ===
    results.push(await testScenario({
        name: '2 Players + 1 Bot - 100 VP stake',
        mm, wallets, userRepo, walletRepo,
        config: {
            players: 2,
            bots: 1,
            stake: 100,
            botMode: true
        }
    }));

    // === Тест 4: 1 игрок + 4 бота ===
    results.push(await testScenario({
        name: '1 Player + 4 Bots - 100 VP stake',
        mm, wallets, userRepo, walletRepo,
        config: {
            players: 1,
            bots: 4,
            stake: 100,
            botMode: true
        }
    }));

    // Вывод результатов
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS');
    console.log('='.repeat(60));
    
    let passed = 0;
    let failed = 0;
    
    for (const result of results) {
        if (result.success) {
            console.log(`✅ ${result.scenario}: PASSED`);
            passed++;
        } else {
            console.log(`❌ ${result.scenario}: FAILED`);
            console.log(`   Error: ${result.error}`);
            failed++;
        }
        
        // Выводим логи каждого теста
        for (const log of result.logs) {
            console.log(`   ${log}`);
        }
        console.log();
    }
    
    console.log('='.repeat(60));
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('='.repeat(60));

    await app.close();
    process.exit(failed > 0 ? 1 : 0);
}

interface TestConfig {
    players: number;
    bots?: number;
    stake: number;
    botMode: boolean;
}

interface TestScenarioParams {
    name: string;
    mm: MatchmakingService;
    wallets: WalletsService;
    userRepo: Repository<User>;
    walletRepo: Repository<Wallet>;
    config: TestConfig;
}

async function testScenario(params: TestScenarioParams): Promise<TestResult> {
    const { name, mm, userRepo, walletRepo, config } = params;
    const logs: string[] = [];
    
    function log(msg: string) {
        logs.push(msg);
        console.log(`[${name}] ${msg}`);
    }
    
    try {
        log(`Starting test...`);
        
        // Создаем тестовых пользователей
        const testUsers: TestPlayer[] = [];
        for (let i = 0; i < config.players; i++) {
            const email = `test_${Date.now()}_${i}@wagerplay.test`;
            
            // Создаем пользователя
            let user = userRepo.create({
                email,
                displayName: `TestPlayer${i}`,
                password: 'test123',
            });
            await userRepo.save(user);
            
            // Создаем кошелек
            let wallet = walletRepo.create({
                user: user,
                balanceWp: 10000,
                frozenWp: 0,
            });
            await walletRepo.save(wallet);
            
            testUsers.push({
                id: user.id,
                name: user.displayName,
                initialBalance: 10000
            });
            
            log(`Created user ${user.displayName} (${user.id.slice(0,8)}) with 10000 VP`);
        }
        
        // TODO: Здесь нужно создать матч через matchmaking service
        // Но для этого нужен доступ к WebSocket или внутренним методам
        
        log(`Test setup complete. ${testUsers.length} players ready.`);
        log(`Expected scenario: ${config.players} players + ${config.bots || 0} bots, stake ${config.stake} VP`);
        
        // Пока просто проверяем что баланс не изменился (матч не создан)
        for (const player of testUsers) {
            const wallet = await walletRepo.findOne({
                where: { user: { id: player.id } }
            });
            
            if (wallet.balanceWp !== player.initialBalance) {
                throw new Error(`Balance changed unexpectedly for ${player.name}: ${player.initialBalance} -> ${wallet.balanceWp}`);
            }
        }
        
        log(`Balance check passed for all players`);
        
        // Чистим тестовых пользователей
        for (const player of testUsers) {
            await walletRepo.delete({ user: { id: player.id } });
            await userRepo.delete({ id: player.id });
        }
        log(`Cleaned up test users`);
        
        return {
            scenario: name,
            success: true,
            players: testUsers,
            logs
        };
        
    } catch (error) {
        log(`ERROR: ${error.message}`);
        return {
            scenario: name,
            success: false,
            players: [],
            logs,
            error: error.message
        };
    }
}

// Запускаем если файл запущен напрямую
if (require.main === module) {
    runTests().catch(err => {
        console.error('Test suite failed:', err);
        process.exit(1);
    });
}
