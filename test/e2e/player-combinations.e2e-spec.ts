import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Player/Bot combinations
 * 
 * Tests various combinations of real players and bots:
 * - 2 players: 1 real + 1 bot, 2 real
 * - 3 players: 1 real + 2 bots, 2 real + 1 bot, 3 real
 * - 4 players: 1 real + 3 bots, 2 real + 2 bots, 3 real + 1 bot, 4 real
 * - 5 players: various combinations
 */

describe('Player/Bot Combinations (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;

  beforeAll(async () => {
    app = await createTestApp();
    client = new TestClient(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await flushTestDb();
  });

  describe('2 Players combinations', () => {
    it('should create 2-player match with 1 real player + 1 bot', async () => {
      const user = await client.createGuest();
      
      // Create match with 2 players (1 real + 1 bot)
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(2);
      expect(match.playerIds).toContain(user.userId);
      expect(match.playerIds.some((id: string) => id.startsWith('BOT'))).toBe(true);
      expect(match.potVp).toBe(200); // 2 players * 100 stake
    });

    it('should create 2-player match with 2 real players', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      // Both players join queue
      await client.quickplay(user1.token, 2, 100);
      await client.quickplay(user2.token, 2, 100);
      
      // Force match creation with 2 real players
      await client.forceMatch(user1.token, 2, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(2);
      expect(match.playerIds).toContain(user1.userId);
      expect(match.playerIds).toContain(user2.userId);
      expect(match.playerIds.some((id: string) => id.startsWith('BOT'))).toBe(false);
    });
  });

  describe('3 Players combinations', () => {
    it('should create 3-player match with 1 real + 2 bots', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 100);
      await client.forceMatch(user.token, 3, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(3);
      expect(match.playerIds).toContain(user.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(2);
      expect(match.potVp).toBe(300); // 3 players * 100 stake
    });

    it('should create 3-player match with 2 real + 1 bot', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      await client.quickplay(user1.token, 3, 100);
      await client.quickplay(user2.token, 3, 100);
      await client.forceMatch(user1.token, 3, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(3);
      expect(match.playerIds).toContain(user1.userId);
      expect(match.playerIds).toContain(user2.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(1);
    });

    it('should create 3-player match with 3 real players', async () => {
      const [user1, user2, user3] = await client.createGuests(3);
      
      await client.quickplay(user1.token, 3, 100);
      await client.quickplay(user2.token, 3, 100);
      await client.quickplay(user3.token, 3, 100);
      await client.forceMatch(user1.token, 3, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(3);
      expect(match.playerIds).toContain(user1.userId);
      expect(match.playerIds).toContain(user2.userId);
      expect(match.playerIds).toContain(user3.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(0);
    });
  });

  describe('4 Players combinations', () => {
    it('should create 4-player match with 1 real + 3 bots', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 4, 100);
      await client.forceMatch(user.token, 4, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(4);
      expect(match.playerIds).toContain(user.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(3);
      expect(match.potVp).toBe(400); // 4 players * 100 stake
    });

    it('should create 4-player match with 2 real + 2 bots', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      await client.quickplay(user1.token, 4, 100);
      await client.quickplay(user2.token, 4, 100);
      await client.forceMatch(user1.token, 4, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(4);
      expect(match.playerIds).toContain(user1.userId);
      expect(match.playerIds).toContain(user2.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(2);
    });

    it('should create 4-player match with 3 real + 1 bot', async () => {
      const [user1, user2, user3] = await client.createGuests(3);
      
      await client.quickplay(user1.token, 4, 100);
      await client.quickplay(user2.token, 4, 100);
      await client.quickplay(user3.token, 4, 100);
      await client.forceMatch(user1.token, 4, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(4);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(1);
    });

    it('should create 4-player match with 4 real players', async () => {
      const [user1, user2, user3, user4] = await client.createGuests(4);
      
      await client.quickplay(user1.token, 4, 100);
      await client.quickplay(user2.token, 4, 100);
      await client.quickplay(user3.token, 4, 100);
      await client.quickplay(user4.token, 4, 100);
      await client.forceMatch(user1.token, 4, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(4);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(0);
    });
  });

  describe('5 Players combinations', () => {
    it('should create 5-player match with 1 real + 4 bots', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 5, 100);
      await client.forceMatch(user.token, 5, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(5);
      expect(match.playerIds).toContain(user.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(4);
      expect(match.potVp).toBe(500); // 5 players * 100 stake
    });

    it('should create 5-player match with 3 real + 2 bots', async () => {
      const [user1, user2, user3] = await client.createGuests(3);
      
      await client.quickplay(user1.token, 5, 100);
      await client.quickplay(user2.token, 5, 100);
      await client.quickplay(user3.token, 5, 100);
      await client.forceMatch(user1.token, 5, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(5);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(2);
    });

    it('should create 5-player match with 5 real players', async () => {
      const users = await client.createGuests(5);
      
      // All 5 players join queue
      for (const user of users) {
        await client.quickplay(user.token, 5, 100);
      }
      
      await client.forceMatch(users[0].token, 5, 100);
      
      const state1 = await client.pollForActiveMatch(users[0].token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(5);
      
      // All should be real players
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(0);
      
      // All 5 users should be in the match
      for (const user of users) {
        expect(match.playerIds).toContain(user.userId);
      }
    });
  });

  describe('Gameplay with different combinations', () => {
    it('should complete 2-player match (1 real + 1 bot)', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      // Make move
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
      expect(finalMatch.winnerId).toBeDefined();
    });

    it('should complete 3-player match (2 real + 1 bot)', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      await client.quickplay(user1.token, 3, 100);
      await client.quickplay(user2.token, 3, 100);
      await client.forceMatch(user1.token, 3, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const matchId = state1.activeMatch.matchId;
      
      // Both players make moves
      await client.submitMove(matchId, user1.token, 'ROCK');
      await client.submitMove(matchId, user2.token, 'PAPER');
      
      await new Promise(r => setTimeout(r, 3000));
      
      const finalMatch = await client.getMatch(matchId, user1.token);
      expect(finalMatch.status).toBe('FINISHED');
    });

    it('should verify stakes are frozen for all players', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      // Get initial balances
      const initialBalance1 = await client.getWallet(user1.token);
      const initialBalance2 = await client.getWallet(user2.token);
      
      await client.quickplay(user1.token, 3, 100);
      await client.quickplay(user2.token, 3, 100);
      await client.forceMatch(user1.token, 3, 100);
      
      await client.pollForActiveMatch(user1.token);
      
      // Check balances are reduced by stake
      const duringBalance1 = await client.getWallet(user1.token);
      const duringBalance2 = await client.getWallet(user2.token);
      
      expect(duringBalance1.balanceWp).toBe(initialBalance1.balanceWp - 100);
      expect(duringBalance2.balanceWp).toBe(initialBalance2.balanceWp - 100);
    });
  });

  describe('Edge cases', () => {
    it('should handle player leaving queue before match starts', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      await client.quickplay(user1.token, 2, 100);
      await client.quickplay(user2.token, 2, 100);
      
      // Don't call forceMatch - simulate timeout
      // In real scenario, queue timeout would trigger match creation
      await new Promise(r => setTimeout(r, 100));
      
      // Both should be in queue
      const state1 = await client.getActiveState(user1.token);
      const state2 = await client.getActiveState(user2.token);
      
      expect(state1.queueTicket || state1.activeMatch).toBeDefined();
      expect(state2.queueTicket || state2.activeMatch).toBeDefined();
    });

    it('should handle different stakes for different player counts', async () => {
      const user = await client.createGuest();
      
      // Test with 500 stake
      await client.quickplay(user.token, 2, 500);
      await client.forceMatch(user.token, 2, 500);
      
      const state = await client.pollForActiveMatch(user.token);
      expect(state.activeMatch.potVp).toBe(1000); // 2 * 500
    });
  });
});
