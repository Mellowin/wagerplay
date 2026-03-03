/**
 * 🧪 CLI тесты матчей с подробными логами
 * Запуск: npx ts-node test-scenarios.cli.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

interface TestMatch {
    matchId: string;
    players: string[];
    bots: string[];
    stake: number;
    expectedPayout: number;
}

interface BalanceLog {
    userId: string;
    name: string;
    before: number;
    frozen: number;
    after: number;
    expected: number;
}

async function runAllTests() {
    console.log('🎮 MATCH TEST SUITE\n');
    console.log('='.repeat(70));
    
    const app = await NestFactory.createApplicationContext(AppModule);
    const dataSource = app.get(DataSource);
    
    // Получаем House ID
    const houseResult = await dataSource.query(
        `SELECT id FROM users WHERE email = 'house@wagerplay.internal'`
    );
    const houseId = houseResult[0]?.id;
    console.log(`🏦 House ID: ${houseId?.slice(0,8)}\n`);
    
    // Тест 1: Создаем матч 2 игрока
    console.log('\n📋 TEST 1: 2 Players PVP (stake 100 VP)');
    console.log('-'.repeat(70));
    await testPVP2Players(dataSource, houseId, 100);
    
    // Тест 2: 1 игрок + 1 бот
    console.log('\n📋 TEST 2: 1 Player + 1 Bot (stake 100 VP)');
    console.log('-'.repeat(70));
    await testPlayerVsBot(dataSource, houseId, 100);
    
    // Тест 3: 1 игрок + 4 бота
    console.log('\n📋 TEST 3: 1 Player + 4 Bots (stake 100 VP)');
    console.log('-'.repeat(70));
    await testPlayerVs4Bots(dataSource, houseId, 100);
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ All tests completed!');
    console.log('='.repeat(70));
    
    await app.close();
    process.exit(0);
}

async function testPVP2Players(dataSource: DataSource, houseId: string, stake: number) {
    // Создаем 2 тестовых игрока
    const player1 = await createTestUser(dataSource, 'pvp1');
    const player2 = await createTestUser(dataSource, 'pvp2');
    
    console.log(`👤 Player 1: ${player1.name} (${player1.id.slice(0,8)}) - ${player1.balance} VP`);
    console.log(`👤 Player 2: ${player2.name} (${player2.id.slice(0,8)}) - ${player2.balance} VP`);
    
    // Запоминаем начальные балансы
    const balanceBefore = new Map<string, number>();
    balanceBefore.set(player1.id, player1.balance);
    balanceBefore.set(player2.id, player2.balance);
    
    // Ожидаемый результат:
    // Один проигрывает 100 VP (frozen -> consumed)
    // Другой выигрывает 190 VP (100 stake + 90 от проигравшего)
    // House получает 10 VP комиссии
    
    const expectedWinnerPayout = stake * 2 - Math.floor(stake * 2 * 0.05); // 190 VP
    
    console.log(`\n💰 Expected calculations:`);
    console.log(`   - Stake per player: ${stake} VP`);
    console.log(`   - Total pot: ${stake * 2} VP`);
    console.log(`   - House fee (5%): ${Math.floor(stake * 2 * 0.05)} VP`);
    console.log(`   - Winner payout: ${expectedWinnerPayout} VP`);
    console.log(`   - Winner final balance: ${player1.balance - stake + expectedWinnerPayout} VP`);
    console.log(`   - Loser final balance: ${player2.balance - stake} VP`);
    
    // TODO: Здесь нужно создать матч через matchmaking service
    // Для этого нужно:
    // 1. Добавить обоих в очередь
    // 2. Дождаться создания матча
    // 3. Дождаться завершения
    // 4. Проверить балансы
    
    console.log(`\n⚠️  Manual test required - cannot create match via CLI`);
    console.log(`   To test manually:`);
    console.log(`   1. Login as ${player1.email} / password: test123`);
    console.log(`   2. Login as ${player2.email} / password: test123`);
    console.log(`   3. Both join quickplay with ${stake} VP stake`);
    console.log(`   4. Check balance after match`);
    
    // Чистим
    await cleanupTestUser(dataSource, player1.id);
    await cleanupTestUser(dataSource, player2.id);
}

async function testPlayerVsBot(dataSource: DataSource, houseId: string, stake: number) {
    const player = await createTestUser(dataSource, 'vsbot');
    
    console.log(`👤 Player: ${player.name} (${player.id.slice(0,8)}) - ${player.balance} VP`);
    console.log(`🤖 Bots: 1 (BOT1)`);
    
    // House замораживает payout = stake * (2-1) = 100 VP
    const houseFreeze = stake; // 100 VP
    
    console.log(`\n💰 Expected calculations:`);
    console.log(`   - Player stake: ${stake} VP (frozen)`);
    console.log(`   - House freezes: ${houseFreeze} VP for bot`);
    console.log(`   - If player wins: gets ${stake * 2 - Math.floor(stake * 2 * 0.05)} VP`);
    console.log(`   - If bot wins: house gets payout`);
    
    console.log(`\n⚠️  Manual test required`);
    
    await cleanupTestUser(dataSource, player.id);
}

async function testPlayerVs4Bots(dataSource: DataSource, houseId: string, stake: number) {
    const player = await createTestUser(dataSource, 'vs4bots');
    
    console.log(`👤 Player: ${player.name} (${player.id.slice(0,8)}) - ${player.balance} VP`);
    console.log(`🤖 Bots: 4 (BOT1, BOT2, BOT3, BOT4)`);
    
    // House замораживает payout = stake * (5-1) = 400 VP
    const houseFreeze = stake * 4; // 400 VP
    
    console.log(`\n💰 Expected calculations:`);
    console.log(`   - Player stake: ${stake} VP`);
    console.log(`   - House freezes: ${houseFreeze} VP for 4 bots`);
    console.log(`   - Total pot: ${stake * 5} VP`);
    console.log(`   - If player wins: gets ${stake * 5 - Math.floor(stake * 5 * 0.05)} VP`);
    
    console.log(`\n⚠️  Manual test required`);
    
    await cleanupTestUser(dataSource, player.id);
}

async function createTestUser(dataSource: DataSource, suffix: string) {
    const email = `test_${suffix}_${Date.now()}@wagerplay.test`;
    const displayName = `Test_${suffix}`;
    
    const userResult = await dataSource.query(
        `INSERT INTO users (id, email, "displayName", password, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id`,
        [randomUUID(), email, displayName, 'test123']
    );
    
    const userId = userResult[0].id;
    
    await dataSource.query(
        `INSERT INTO wallets ("userId", "balanceWp", "frozenWp", "createdAt", "updatedAt")
         VALUES ($1, 10000, 0, NOW(), NOW())`,
        [userId]
    );
    
    return {
        id: userId,
        email,
        name: displayName,
        balance: 10000
    };
}

async function cleanupTestUser(dataSource: DataSource, userId: string) {
    await dataSource.query(`DELETE FROM wallets WHERE "userId" = $1`, [userId]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

// Запуск
runAllTests().catch(err => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
});
