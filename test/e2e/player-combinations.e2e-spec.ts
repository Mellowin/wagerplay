import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Player/Bot combinations
 * 
 * Tests various combinations of real players and bots
 * Focus: Single player + bots (most stable scenario)
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
    // Wait for flush to complete
    await new Promise(r => setTimeout(r, 200));
  });

  describe('2 Players: 1 real + 1 bot', () => {
    it('should create match with correct player count', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(2);
      expect(match.playerIds).toContain(user.userId);
      expect(match.playerIds.some((id: string) => id.startsWith('BOT'))).toBe(true);
    });

    it('should have correct pot calculation', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match.potVp).toBe(200); // 2 players * 100 stake
      expect(match.feeRate).toBe(0.05); // 5% fee
      expect(match.feeVp).toBe(10); // 5% of 200
      expect(match.payoutVp).toBe(190); // 200 - 10
    });

    it('should complete match with winner', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      // Make move
      await client.submitMove(matchId, user.token, 'ROCK');
      
      // Wait for bot to respond and match to finish
      await new Promise(r => setTimeout(r, 4000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
      expect(finalMatch.winnerId).toBeDefined();
    });

    it('should freeze stake from wallet', async () => {
      const user = await client.createGuest();
      
      const initialWallet = await client.getWallet(user.token);
      const initialBalance = initialWallet.balanceWp;
      
      await client.quickplay(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 100);
      await client.pollForActiveMatch(user.token);
      
      const duringWallet = await client.getWallet(user.token);
      expect(duringWallet.balanceWp).toBe(initialBalance - 100);
    });
  });

  describe('3 Players: 1 real + 2 bots', () => {
    it('should create match with 3 players', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 3, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match.playerIds).toHaveLength(3);
      expect(match.potVp).toBe(300);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(2);
    });

    it('should assign unique bot nicknames', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 3, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match.botNames).toBeDefined();
      
      const botIds = match.playerIds.filter((id: string) => id.startsWith('BOT'));
      for (const botId of botIds) {
        expect(match.botNames[botId]).toBeDefined();
        expect(match.botNames[botId].length).toBeGreaterThan(0);
      }
    });

    it('should complete 3-player match', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 3, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      await client.submitMove(matchId, user.token, 'PAPER');
      await new Promise(r => setTimeout(r, 4000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
    });
  });

  describe('4 Players: 1 real + 3 bots', () => {
    it('should create match with 4 players', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 4, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 4, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match.playerIds).toHaveLength(4);
      expect(match.potVp).toBe(400);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(3);
    });

    it('should complete 4-player match', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 4, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 4, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      await client.submitMove(matchId, user.token, 'SCISSORS');
      await new Promise(r => setTimeout(r, 4000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
    });
  });

  describe('5 Players: 1 real + 4 bots', () => {
    it('should create match with 5 players', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 5, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 5, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match.playerIds).toHaveLength(5);
      expect(match.potVp).toBe(500);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(4);
    });

    it('should complete 5-player match', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 5, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 5, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 4000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
    });
  });

  describe('Different stake amounts', () => {
    it('should handle 200 VP stake for 2 players', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 200);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 200);
      
      const state = await client.pollForActiveMatch(user.token);
      expect(state.activeMatch.potVp).toBe(400); // 2 * 200
      expect(state.activeMatch.feeVp).toBe(20); // 5% of 400
    });

    it('should handle 500 VP stake for 3 players', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 500);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 3, 500);
      
      const state = await client.pollForActiveMatch(user.token);
      expect(state.activeMatch.potVp).toBe(1500); // 3 * 500
    });

    it('should handle 1000 VP stake for 5 players', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 5, 1000);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 5, 1000);
      
      const state = await client.pollForActiveMatch(user.token);
      expect(state.activeMatch.potVp).toBe(5000); // 5 * 1000
    });
  });

  describe('Match state verification', () => {
    it('should have correct initial match state', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match.status).toMatch(/READY|IN_PROGRESS/);
      expect(match.round).toBe(1);
      expect(match.moves).toBeDefined();
      expect(Object.keys(match.moves).length).toBe(0); // No moves yet
      expect(match.aliveIds).toHaveLength(2);
      expect(match.eliminatedIds).toHaveLength(0);
    });

    it('should track player moves', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      // Submit move
      await client.submitMove(matchId, user.token, 'ROCK');
      
      // Check move was recorded
      const match = await client.getMatch(matchId, user.token);
      expect(match.moves[user.userId]).toBe('ROCK');
    });
  });
});
